import { useEffect, useRef, useState } from 'react';
import type { Matter, Task, TaskListQuery } from '../../preload/caselite-api';
import { Icon, TaskTable } from './Workspace';
import TaskInspector from './TaskInspector';
import { taskStatusNames } from './task-status';
import { taskPriorityNames } from './task-priority';

export type TaskListState = { query: TaskListQuery; selected: string | null; scroll: number };
export const initialTaskListState: TaskListState = {
  query: {
    scope: { type: 'workspace' },
    text: '',
    status: null,
    priority: null,
    dates: 'all',
    from: null,
    to: null,
    body: 'all',
    sort: 'updated',
    offset: 0,
  },
  selected: null,
  scroll: 0,
};
export default function RecordList({
  tasks,
  viewState,
  onViewState,
  onOpen,
  onNew,
  propertiesBlocked,
  onPropertiesBlocked,
  onTaskChanged,
}: {
  tasks: Task[];
  viewState: TaskListState;
  onViewState(value: TaskListState): void;
  onOpen(id: string): void;
  onNew(): void;
  propertiesBlocked: boolean;
  onPropertiesBlocked(value: boolean): void;
  onTaskChanged(task: Task, state: number[] | null): void;
}) {
  const [projects, setProjects] = useState<Matter[]>([]);
  const [catalogError, setCatalogError] = useState(''),
    [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    query: TaskListQuery;
    source: Task[];
    retry: number;
    rows: Task[];
    total: number;
    more: boolean;
    error: string;
  } | null>(null);
  const [text, setText] = useState(viewState.query.text);
  const [dateErrors, setDateErrors] = useState({ from: false, to: false });
  const restoring = useRef(true),
    composing = useRef(false),
    scroll = useRef<HTMLDivElement>(null),
    latest = useRef(viewState),
    update = useRef(onViewState);
  useEffect(() => {
    latest.current = viewState;
    update.current = onViewState;
  }, [viewState, onViewState]);
  const q = viewState.query;
  const matches = result?.query === q && result?.source === tasks && result?.retry === retry;
  const loading = !propertiesBlocked && !matches;
  const rows = result?.rows ?? [],
    total = loading ? 0 : (result?.total ?? 0),
    more = result?.more ?? false,
    error = matches ? (result?.error ?? '') : '';
  useEffect(() => {
    let alive = true;
    void window.caselite
      .catalog({ protocol_version: 1, operation: 'list' })
      .then((r) => {
        if (!alive) return;
        if (!r.ok) throw new Error(r.message);
        setProjects(r.projects.filter((p) => !p.archived_at));
        setCatalogError('');
      })
      .catch(() => {
        if (alive) setCatalogError('项目范围读取失败，请重试。');
      });
    return () => {
      alive = false;
    };
  }, [retry]);
  useEffect(() => {
    if (propertiesBlocked) return;
    let alive = true;
    restoring.current = true;
    void window.caselite
      .task({ protocol_version: 1, operation: 'list', query: q })
      .then((r) => {
        if (!alive) return;
        if (!r.ok) throw new Error(r.message);
        if (!r.page) throw new Error('任务列表响应缺少分页信息，请使用当前版本。');
        if (q.offset > 0 && q.offset >= r.page.total) {
          update.current({
            ...latest.current,
            query: { ...q, offset: Math.max(0, Math.floor((r.page.total - 1) / 20) * 20) },
          });
          return;
        }
        setResult({
          query: q,
          source: tasks,
          retry,
          rows: r.tasks,
          total: r.page.total,
          more: r.page.has_more,
          error: '',
        });
      })
      .catch((e) => {
        if (alive) {
          setResult({
            query: q,
            source: tasks,
            retry,
            rows: [],
            total: 0,
            more: false,
            error: e instanceof Error ? e.message : '任务读取失败，请重试。',
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [q, tasks, propertiesBlocked, retry]);
  useEffect(() => {
    if (!loading && scroll.current) {
      scroll.current.scrollTop = latest.current.scroll;
      const frame = requestAnimationFrame(() => {
        restoring.current = false;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [loading]);
  const change = (patch: Partial<TaskListQuery>) => {
    if (propertiesBlocked) return;
    onViewState({ ...viewState, query: { ...q, ...patch, offset: 0 }, scroll: 0, selected: null });
  };
  const bound = (field: 'from' | 'to', input: HTMLInputElement) => {
    const valid = input.validity.valid;
    setDateErrors((e) => ({ ...e, [field]: !valid }));
    if (valid) change({ [field]: input.value || null });
  };
  const openTask = (id: string) => {
    if (propertiesBlocked) return;
    onViewState({
      ...viewState,
      selected: id,
      scroll: scroll.current?.scrollTop ?? viewState.scroll,
    });
    onOpen(id);
  };
  const selected = rows.find((t) => t.id === viewState.selected) ?? rows[0] ?? null;
  const unavailable =
    q.scope.type === 'project' &&
    !projects.some((p) => p.id === (q.scope.type === 'project' ? q.scope.id : ''));
  return (
    <section
      className="list-view collection-workspace issue-collection task-query-list"
      data-layout="three-column"
      data-collection="tasks"
    >
      <div className="collection-main">
        <div className="collection-heading">
          <Icon name="check" size={18} />
          <h1>我的任务</h1>
          <span className="collection-total">{loading ? '…' : total}</span>
          <button data-testid="new-task" onClick={onNew}>
            新建任务
          </button>
        </div>
        <div className="task-query-toolbar">
          <input
            aria-label="搜索任务"
            placeholder="搜索任务标题或说明…"
            value={text}
            disabled={propertiesBlocked}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(e) => {
              composing.current = false;
              change({ text: e.currentTarget.value });
            }}
            onChange={(e) => {
              setText(e.target.value);
              if (!composing.current) change({ text: e.target.value });
            }}
            maxLength={160}
          />
          <select
            aria-label="任务项目范围"
            disabled={propertiesBlocked}
            value={q.scope.type === 'workspace' ? 'workspace' : q.scope.id}
            onChange={(e) =>
              change({
                scope:
                  e.target.value === 'workspace'
                    ? { type: 'workspace' }
                    : { type: 'project', id: e.target.value },
              })
            }
          >
            <option value="workspace">全部任务 · 当前本机工作区</option>
            {unavailable && q.scope.type === 'project' && (
              <option value={q.scope.id}>当前项目（请核对范围）</option>
            )}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <select
            aria-label="筛选任务状态"
            disabled={propertiesBlocked}
            value={q.status ?? 'all'}
            onChange={(e) =>
              change({
                status: e.target.value === 'all' ? null : (e.target.value as Task['status']),
              })
            }
          >
            <option value="all">全部状态</option>
            {Object.entries(taskStatusNames).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
          <select
            aria-label="筛选任务优先级"
            disabled={propertiesBlocked}
            value={q.priority ?? 'all'}
            onChange={(e) =>
              change({ priority: e.target.value === 'all' ? null : Number(e.target.value) })
            }
          >
            <option value="all">全部优先级</option>
            {Object.entries(taskPriorityNames).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
          <select
            aria-label="筛选普通日期"
            disabled={propertiesBlocked}
            value={q.dates}
            onChange={(e) =>
              change({ dates: e.target.value as TaskListQuery['dates'], from: null, to: null })
            }
          >
            <option value="all">全部日期</option>
            <option value="dated">有截止日期</option>
            <option value="undated">无截止日期</option>
          </select>
          <label>
            从
            <input
              aria-label="截止日期起始"
              aria-invalid={dateErrors.from}
              onInput={(e) => {
                if (dateErrors.from) bound('from', e.currentTarget);
              }}
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={q.from ?? ''}
              disabled={propertiesBlocked || q.dates === 'undated'}
              onChange={(e) => {
                bound('from', e.currentTarget);
              }}
            />
          </label>
          <label>
            至
            <input
              aria-label="截止日期结束"
              aria-invalid={dateErrors.to}
              onInput={(e) => {
                if (dateErrors.to) bound('to', e.currentTarget);
              }}
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={q.to ?? ''}
              disabled={propertiesBlocked || q.dates === 'undated'}
              onChange={(e) => {
                bound('to', e.currentTarget);
              }}
            />
          </label>
          <select
            aria-label="任务排序"
            disabled={propertiesBlocked}
            value={q.sort}
            onChange={(e) => change({ sort: e.target.value as TaskListQuery['sort'] })}
          >
            <option value="updated">最近更新</option>
            <option value="title">标题</option>
            <option value="priority">优先级</option>
            <option value="due_date">截止日期</option>
          </select>
          <select
            aria-label="筛选任务正文"
            disabled={propertiesBlocked}
            value={q.body}
            onChange={(e) => change({ body: e.target.value as TaskListQuery['body'] })}
          >
            <option value="all">全部正文</option>
            <option value="written">已写正文</option>
            <option value="empty">未写正文</option>
          </select>
        </div>
        {(dateErrors.from || dateErrors.to) && (
          <p role="alert">日期筛选尚未应用：请输入完整有效日期，或明确清空。</p>
        )}
        {catalogError && (
          <p role="alert">
            {catalogError}
            <button onClick={() => setRetry((n) => n + 1)} disabled={propertiesBlocked}>
              重试范围读取
            </button>
          </p>
        )}
        {error && (
          <p role="alert">
            {error}
            <button onClick={() => setRetry((n) => n + 1)} disabled={propertiesBlocked}>
              重试任务列表
            </button>
          </p>
        )}
        <div
          className="collection-scroll"
          ref={scroll}
          onScroll={(e) => {
            if (!loading && !restoring.current)
              onViewState({ ...viewState, scroll: e.currentTarget.scrollTop });
          }}
        >
          {loading ? (
            <p role="status">正在读取任务…</p>
          ) : (
            <TaskTable
              tasks={rows}
              documents={false}
              selectedId={selected?.id}
              onSelect={(id) => {
                if (!propertiesBlocked) onViewState({ ...viewState, selected: id });
              }}
              onOpen={openTask}
            />
          )}
        </div>
        <footer className="collection-footer">
          <span>
            {loading
              ? '正在读取任务…'
              : `${total} 个任务 · 仅此工作区 · ${total === 0 ? 0 : q.offset + 1}—${Math.min(q.offset + 20, total)}`}
          </span>
          <div>
            <button
              disabled={propertiesBlocked || loading || q.offset === 0}
              onClick={() =>
                onViewState({
                  ...viewState,
                  query: { ...q, offset: Math.max(0, q.offset - 20) },
                  scroll: 0,
                  selected: null,
                })
              }
            >
              上一页
            </button>
            <button
              disabled={propertiesBlocked || loading || !more}
              onClick={() =>
                onViewState({
                  ...viewState,
                  query: { ...q, offset: q.offset + 20 },
                  scroll: 0,
                  selected: null,
                })
              }
            >
              下一页
            </button>
          </div>
        </footer>
      </div>
      <TaskInspector
        key={selected?.id ?? 'empty'}
        task={loading || error ? null : selected}
        onOpen={openTask}
        onPropertiesBlocked={onPropertiesBlocked}
        onTaskChanged={onTaskChanged}
      />
    </section>
  );
}
