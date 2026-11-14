import type { TaskCompletionActions } from '../features/tasks/useTaskCompletion';
import { InlinePropertiesSlot } from './ResponsiveWorkspace';
import { createPortal } from 'react-dom';
import { useWorkspaceInspector } from '../shared/navigation/PageNavigation';
import PropertyResizeHandle from './PropertyResizeHandle';
import TaskInspector from './TaskInspector';
import { Icon } from '../shared/ui/Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Matter, Task, TaskListQuery } from '../../preload/caselite-api';
import { TaskTable, taskOptionalColumns, type TaskOptionalColumn } from './Workspace';
import TaskBulkActions from '../features/tasks/TaskBulkActions';
import { taskStatusNames } from './task-status';
import { taskPriorityNames } from './task-priority';
import { useTaskPage } from './task-list-query';

export type TaskListState = {
  query: TaskListQuery;
  selected: string | null;
  scroll: number;
  groupByStatus?: boolean;
  hiddenColumns?: TaskOptionalColumn[];
};
const optionalColumns = Object.entries(taskOptionalColumns) as [TaskOptionalColumn, string][];
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
  propertiesBlocked: propertyEditBlocked,
  onPropertiesBlocked,
  projectDirty = false,
  onTaskChanged,
  onProjectDirty,
  project,
  toolbarHost,
  completion,
}: {
  tasks: Task[];
  completion?: TaskCompletionActions;
  project?: Matter;
  toolbarHost?: HTMLElement | null;
  viewState: TaskListState;
  onViewState(value: TaskListState): void;
  onOpen(id: string, navigation?: TaskListQuery): void;
  onNew(): void;
  propertiesBlocked: boolean;
  onPropertiesBlocked(value: boolean): void;
  projectDirty?: boolean;
  onProjectDirty?(value: boolean): void;
  onTaskChanged(task: Task, state: number[] | null): void;
}) {
  const [bulkBlocked, setBulkBlocked] = useState(false);
  const [inspectorBlocked, setInspectorBlocked] = useState(false);
  const propertiesBlocked =
    propertyEditBlocked ||
    projectDirty ||
    bulkBlocked ||
    inspectorBlocked ||
    Boolean(completion?.blocked);
  useEffect(() => {
    onPropertiesBlocked(bulkBlocked || inspectorBlocked);
  }, [bulkBlocked, inspectorBlocked, onPropertiesBlocked]);
  const [previewOpen, setPreviewOpen] = useWorkspaceInspector(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [projects, setProjects] = useState<Matter[]>([]);
  const [catalogError, setCatalogError] = useState(''),
    [retry, setRetry] = useState(0);
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
  const q = useMemo<TaskListQuery>(
    () =>
      project
        ? { ...viewState.query, scope: { type: 'project', id: project.id } }
        : viewState.query,
    [viewState.query, project],
  );
  const scopedTasks = project ? tasks.filter((t) => t.matter_id === project.id) : tasks;
  const taskPage = useTaskPage(q, !propertiesBlocked);
  const data = taskPage.data;
  const outOfRange = Boolean(data && q.offset > 0 && q.offset >= data.page.total);
  const loading =
    !propertiesBlocked &&
    (taskPage.isPending || taskPage.isFetching || (!taskPage.isError && outOfRange));
  const rows = taskPage.isError ? [] : (data?.rows ?? []);
  const grouped = viewState.groupByStatus && rows.length > 0;
  const groups = grouped
    ? Object.entries(taskStatusNames)
        .map(([status, label]) => ({
          label,
          rows: rows.filter((task) => (task.status ?? 'todo') === status),
        }))
        .filter((group) => group.rows.length > 0)
    : [{ label: '', rows }];
  const hiddenColumns = [
    ...new Set([...(viewState.hiddenColumns ?? []), ...(project ? ['project' as const] : [])]),
  ];
  const total = loading || taskPage.isError ? 0 : (data?.page.total ?? 0);
  const more = data?.page.has_more ?? false;
  const error = taskPage.error?.message ?? '';
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
    if (propertiesBlocked || taskPage.isFetching || taskPage.isError || !data || !outOfRange)
      return;
    update.current({
      ...latest.current,
      query: { ...q, offset: Math.max(0, Math.floor((data.page.total - 1) / 20) * 20) },
    });
  }, [data, outOfRange, propertiesBlocked, q, taskPage.isError, taskPage.isFetching]);
  useEffect(() => {
    if (loading) restoring.current = true;
    else if (scroll.current) {
      scroll.current.scrollTop = latest.current.scroll;
      const frame = requestAnimationFrame(() => {
        restoring.current = false;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [loading, q]);
  const change = (patch: Partial<TaskListQuery>) => {
    if (propertiesBlocked) return;
    setSelectedIds([]);
    onViewState({
      ...viewState,
      query: { ...q, ...patch, ...(project ? { scope: q.scope } : {}), offset: 0 },
      scroll: 0,
      selected: null,
    });
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
    onOpen(id, rows.some((task) => task.id === id) ? q : undefined);
  };
  const listed = rows.find((t) => t.id === viewState.selected) ?? rows[0] ?? null;
  const selected = tasks.find((t) => t.id === listed?.id && t.version > listed.version) ?? listed;
  const unavailable =
    q.scope.type === 'project' &&
    !projects.some((p) => p.id === (q.scope.type === 'project' ? q.scope.id : ''));
  const controls = (
    <div className="task-list-controls">
      <button
        type="button"
        aria-label="打开任务搜索"
        title="搜索任务"
        aria-expanded={searchOpen}
        disabled={propertiesBlocked}
        onClick={() => setSearchOpen((open) => !open)}
      >
        <Icon name="search" size={17} />
      </button>
      <button
        type="button"
        aria-label="筛选任务"
        title="筛选任务"
        aria-expanded={filtersOpen}
        disabled={propertiesBlocked}
        onClick={() => setFiltersOpen((open) => !open)}
      >
        <Icon name="filter" size={17} />
      </button>
      <details className="task-display-options">
        <summary aria-label="任务显示设置">
          <Icon name="settings" size={16} />
          显示设置
        </summary>
        <fieldset disabled={propertiesBlocked}>
          <legend>当前列表</legend>
          <label>
            <input
              type="checkbox"
              checked={selectionMode}
              onChange={(e) => {
                setSelectionMode(e.target.checked);
                setSelectedIds([]);
              }}
            />
            选择多个任务
          </label>
          <label>
            <input
              type="checkbox"
              checked={viewState.groupByStatus ?? false}
              onChange={(e) =>
                onViewState({ ...viewState, groupByStatus: e.target.checked, scroll: 0 })
              }
            />
            按状态分组（当前页）
          </label>
          {optionalColumns
            .filter(([id]) => !project || id !== 'project')
            .map(([id, label]) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={!hiddenColumns.includes(id)}
                  onChange={(e) =>
                    onViewState({
                      ...viewState,
                      hiddenColumns: e.target.checked
                        ? hiddenColumns.filter((column) => column !== id)
                        : [...hiddenColumns, id],
                    })
                  }
                />
                {label}
              </label>
            ))}
        </fieldset>
      </details>
      <button
        type="button"
        aria-label="任务预览"
        title="任务预览"
        aria-expanded={previewOpen}
        disabled={propertiesBlocked}
        onClick={() => setPreviewOpen((open) => !open)}
      >
        <Icon name="panel" size={17} />
      </button>
    </div>
  );
  return (
    <section
      className="list-view collection-workspace issue-collection task-query-list compact-task-list property-resizable"
      data-properties-resizable="true"
      data-layout={previewOpen ? 'three-column' : 'list'}
      data-collection="tasks"
    >
      {previewOpen && <PropertyResizeHandle module="tasks" />}
      <div className="collection-main">
        {!project && (
          <div className="collection-heading">
            <Icon name="check" size={18} />
            <h1>任务</h1>
            <span className="collection-total">{loading ? '…' : total}</span>
            <button
              className="work-list-create"
              data-testid="new-task"
              disabled={propertiesBlocked}
              onClick={onNew}
            >
              <Icon name="plus" size={15} />
              新建任务
            </button>
          </div>
        )}
        <InlinePropertiesSlot />
        {toolbarHost ? (
          createPortal(controls, toolbarHost)
        ) : (
          <div className="task-list-viewbar">{controls}</div>
        )}
        <div
          className="task-query-toolbar"
          id="task-list-filters"
          hidden={!filtersOpen && !searchOpen}
        >
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
          <div className="task-filter-fields" hidden={!filtersOpen}>
            <select
              aria-label="任务视图"
              value={q.view ?? 'all'}
              disabled={propertiesBlocked}
              onChange={(e) => change({ view: e.target.value as TaskListQuery['view'] })}
            >
              <option value="all">全部任务</option>
              <option value="created">我创建的</option>
              <option value="subscribed">我订阅的</option>
            </select>
            {!project && (
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
            )}
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
              aria-label="筛选任务负责人"
              disabled={propertiesBlocked}
              value={q.assignee === undefined ? '__all__' : (q.assignee ?? '__none__')}
              onChange={(e) =>
                change({
                  assignee:
                    e.target.value === '__all__'
                      ? undefined
                      : e.target.value === '__none__'
                        ? null
                        : e.target.value,
                })
              }
            >
              <option value="__all__">全部负责人</option>
              <option value="__none__">未分配</option>
              {[
                ...new Set(['本人', ...tasks.flatMap((t) => (t.assignee ? [t.assignee] : []))]),
              ].map((v) => (
                <option key={v} value={v}>
                  {v}
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
              <option value="updated">{q.view === 'created' ? '最近创建' : '最近更新'}</option>
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
            <button
              type="button"
              disabled={propertiesBlocked}
              onClick={() => {
                setText('');
                setDateErrors({ from: false, to: false });
                change({ ...initialTaskListState.query, scope: q.scope, view: q.view });
              }}
            >
              清除筛选
            </button>
          </div>
        </div>
        {selectionMode && (
          <TaskBulkActions
            tasks={rows}
            selected={selectedIds.filter((id) => rows.some((t) => t.id === id))}
            disabled={
              inspectorBlocked ||
              projectDirty ||
              (propertyEditBlocked && !bulkBlocked) ||
              Boolean(completion?.blocked)
            }
            onSelection={setSelectedIds}
            onBlocked={setBulkBlocked}
            onChanged={onTaskChanged}
          />
        )}
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
            <button onClick={() => void taskPage.refetch()} disabled={propertiesBlocked}>
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
            groups.map((group) => (
              <section
                key={group.label}
                className="task-display-group"
                aria-label={group.label || undefined}
              >
                {group.label && (
                  <h2>
                    {group.label} <span>{group.rows.length}</span>
                  </h2>
                )}
                <TaskTable
                  compact
                  disabled={propertiesBlocked}
                  busyIds={completion?.busyIds}
                  onComplete={completion?.complete}
                  tasks={group.rows}
                  hiddenColumns={hiddenColumns}
                  selectedId={selected?.id}
                  onSelect={
                    previewOpen
                      ? (id) => {
                          if (!propertiesBlocked) onViewState({ ...viewState, selected: id });
                        }
                      : undefined
                  }
                  selectedIds={selectedIds}
                  onSelection={
                    selectionMode
                      ? (ids) => {
                          if (!propertiesBlocked) setSelectedIds(ids);
                        }
                      : undefined
                  }
                  onOpen={openTask}
                />
              </section>
            ))
          )}
        </div>
        <footer className="collection-footer">
          <span>
            {loading
              ? '正在读取任务…'
              : `${total} 个任务 · ${project ? '当前项目' : '仅此工作区'} · ${total === 0 ? 0 : q.offset + 1}—${Math.min(q.offset + 20, total)}`}
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
      <aside
        className={`task-summary-sidebar${previewOpen ? '' : ' is-preview-closed'}`}
        aria-label="任务辅助栏"
        hidden={!previewOpen}
      >
        <TaskInspector
          key={selected?.id ?? 'empty'}
          cards={[]}
          compactAi
          task={error ? null : selected}
          suggestions={[...new Set(scopedTasks.flatMap((t) => t.tags ?? []))]}
          assigneeSuggestions={scopedTasks.flatMap((t) => (t.assignee ? [t.assignee] : []))}
          onPropertiesBlocked={setInspectorBlocked}
          propertiesDisabled={projectDirty || bulkBlocked || Boolean(completion?.blocked)}
          projectDisabled={
            inspectorBlocked || bulkBlocked || loading || Boolean(completion?.blocked)
          }
          reminderEditing={projectDirty || bulkBlocked || Boolean(completion?.blocked)}
          onProjectDirty={onProjectDirty}
          onProjectChanged={onTaskChanged}
          onTaskChanged={onTaskChanged}
        />
      </aside>
    </section>
  );
}
