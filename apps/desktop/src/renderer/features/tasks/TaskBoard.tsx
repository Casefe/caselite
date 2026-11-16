import { useLayoutEffect, useRef } from 'react';
import type { DragEvent } from 'react';
import type { Task } from '../../../preload/caselite-api';
import { PriorityGlyph, StatusGlyph } from '../../ui/TaskListGlyph';
import { taskStatusNames } from '../../ui/task-status';

type Props = {
  tasks: Task[];
  queryKey: string;
  disabled: boolean;
  loading?: boolean;
  busyIds?: readonly string[];
  selectedId?: string;
  selectedIds: string[];
  onSelection?(ids: string[]): void;
  onSelect?(id: string): void;
  onOpen(id: string): void;
  onStatus?(task: Task, status: Task['status']): void;
};
type Source = { id: string; version: number; generation: number };

export default function TaskBoard({
  tasks,
  queryKey,
  disabled,
  loading = false,
  busyIds = [],
  selectedId,
  selectedIds,
  onSelection,
  onSelect,
  onOpen,
  onStatus,
}: Props) {
  const source = useRef<Source | null>(null);
  const boardElement = useRef<HTMLDivElement>(null);
  const statusElements = useRef(new Map<string, HTMLSelectElement>());
  const focusIntent = useRef<{ id: string; element: HTMLSelectElement } | null>(null);
  // 仅恢复本次由聚焦状态控件发起、且控件已被确认结果移除的焦点。
  // 用户随后移到其他控件时放弃恢复，拖放和普通刷新不创建焦点意图。
  useLayoutEffect(() => {
    const intent = focusIntent.current;
    if (!intent || disabled || loading) return;
    focusIntent.current = null;
    if (intent.element.isConnected || document.activeElement !== document.body) return;
    (statusElements.current.get(intent.id) ?? boardElement.current)?.focus();
  }, [tasks, disabled, loading]);
  const generation = useRef(0);
  // 查询、页结果或编辑守卫变动即废弃拖放；A→B→A也不能复用旧拖放源。
  useLayoutEffect(() => {
    generation.current += 1;
    source.current = null;
  }, [tasks, queryKey, disabled, busyIds]);
  const blocked = (task: Task) => disabled || busyIds.includes(task.id);
  const currentSource = () => {
    const original = source.current;
    if (!original || original.generation !== generation.current || !onStatus) return null;
    return (
      tasks.find(
        (task) => task.id === original.id && task.version === original.version && !blocked(task),
      ) ?? null
    );
  };
  const over = (event: DragEvent, status: Task['status']) => {
    const task = currentSource();
    if (task && task.status !== status) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  };
  return (
    <div
      ref={boardElement}
      className="task-board"
      role="group"
      tabIndex={-1}
      aria-label="当前页任务看板"
    >
      {(Object.keys(taskStatusNames) as Task['status'][]).map((status) => {
        const rows = tasks.filter((task) => task.status === status);
        return (
          <section
            key={status}
            className="task-board-column"
            aria-label={`${taskStatusNames[status]}列`}
            onDragOver={(event) => over(event, status)}
            onDrop={(event) => {
              const task = currentSource();
              source.current = null;
              if (!task || task.status === status) return;
              event.preventDefault();
              onStatus?.(task, status);
            }}
          >
            <h2>
              <StatusGlyph status={status} />
              {taskStatusNames[status]} <span>{rows.length} 项（本页）</span>
            </h2>
            {rows.length === 0 && (
              <p className="task-board-empty">
                {loading ? '正在读取当前筛选页…' : '当前筛选页无任务'}
              </p>
            )}
            {rows.map((task) => (
              <article
                key={task.id}
                className="task-board-card"
                aria-label={`任务：${task.title}`}
                aria-current={selectedId === task.id ? 'true' : undefined}
                aria-busy={busyIds.includes(task.id) || undefined}
                tabIndex={blocked(task) ? -1 : 0}
                onClick={(event) => {
                  if (
                    !blocked(task) &&
                    event.target instanceof Element &&
                    !event.target.closest('button,input,select,label')
                  )
                    (onSelect ?? onOpen)(task.id);
                }}
                onDoubleClick={(event) => {
                  if (
                    onSelect &&
                    !blocked(task) &&
                    event.target instanceof Element &&
                    !event.target.closest('button,input,select,label')
                  )
                    onOpen(task.id);
                }}
                onKeyDown={(event) => {
                  if (
                    blocked(task) ||
                    event.target !== event.currentTarget ||
                    !['Enter', ' '].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  if (event.key === ' ' && onSelect) onSelect(task.id);
                  else onOpen(task.id);
                }}
              >
                <div className="task-board-card-heading">
                  <button
                    type="button"
                    className="task-board-drag"
                    aria-label={`拖动任务：${task.title}`}
                    disabled={blocked(task) || !onStatus}
                    draggable={!blocked(task) && Boolean(onStatus)}
                    onDragStart={(event) => {
                      if (blocked(task) || !onStatus) {
                        event.preventDefault();
                        return;
                      }
                      source.current = {
                        id: task.id,
                        version: task.version,
                        generation: generation.current,
                      };
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', 'caselite-task');
                    }}
                    onDragEnd={() => {
                      source.current = null;
                    }}
                  >
                    ⠿
                  </button>
                  {onSelection && (
                    <input
                      type="checkbox"
                      aria-label={`勾选任务：${task.title}`}
                      checked={selectedIds.includes(task.id)}
                      disabled={blocked(task)}
                      onChange={(event) =>
                        onSelection(
                          event.target.checked
                            ? [...new Set([...selectedIds, task.id])]
                            : selectedIds.filter((id) => id !== task.id),
                        )
                      }
                    />
                  )}
                  <button
                    type="button"
                    className="task-board-title"
                    disabled={blocked(task)}
                    onClick={() => onOpen(task.id)}
                  >
                    {task.title}
                  </button>
                </div>
                <div className="task-board-metadata">
                  <PriorityGlyph priority={task.priority} />
                  <span>{task.matter_title ?? '独立任务'}</span>
                  <span>{task.assignee === undefined ? '本人' : (task.assignee ?? '未分配')}</span>
                </div>
                {task.due_date && <time dateTime={task.due_date}>{task.due_date}</time>}
                {Boolean(task.tags?.length) && (
                  <div className="task-row-tags">
                    {task.tags?.slice(0, 2).map((tag) => (
                      <small key={tag}>{tag}</small>
                    ))}
                  </div>
                )}
                <label className="task-board-status">
                  状态
                  <select
                    ref={(element) => {
                      if (element) statusElements.current.set(task.id, element);
                      else statusElements.current.delete(task.id);
                    }}
                    aria-label={`修改任务状态：${task.title}`}
                    value={task.status}
                    disabled={blocked(task) || !onStatus}
                    onBlur={(event) => {
                      if (event.relatedTarget && event.relatedTarget !== document.body)
                        focusIntent.current = null;
                    }}
                    onChange={(event) => {
                      const status = event.target.value as Task['status'];
                      if (
                        !blocked(task) &&
                        status !== task.status &&
                        Object.hasOwn(taskStatusNames, status)
                      ) {
                        if (document.activeElement === event.currentTarget)
                          focusIntent.current = { id: task.id, element: event.currentTarget };
                        onStatus?.(task, status);
                      }
                    }}
                  >
                    {(Object.keys(taskStatusNames) as Task['status'][]).map((value) => (
                      <option key={value} value={value}>
                        {taskStatusNames[value]}
                      </option>
                    ))}
                  </select>
                </label>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
