import { flexRender, getCoreRowModel, createTable, type ColumnDef } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import type { Task } from '../../preload/caselite-api';
import { PriorityGlyph, StatusGlyph } from './TaskListGlyph';
import { taskPriorityNames } from './task-priority';
import { taskStatusNames } from './task-status';
export const taskOptionalColumns = {
  project: '关联项目',
  owner: '负责人',
  'due-date': '截止日期',
} as const;
export type TaskOptionalColumn = keyof typeof taskOptionalColumns;
export type TaskCompletionActions = {
  complete(task: Task): void;
  busyIds: readonly string[];
  blocked: boolean;
};

type ListTask = Task;

export type SharedTaskTableProps = {
  tasks: ListTask[];
  onOpen(id: string): void;
  selectedId?: string;
  onSelect?(id: string): void;
  hiddenColumns?: (TaskOptionalColumn | 'priority' | 'status' | 'tags')[];
  selectedIds?: string[];
  onSelection?(ids: string[]): void;
  compact?: boolean;
  disabled?: boolean;
  busyIds?: readonly string[];
  onComplete?(task: ListTask): void;
  rowMetadata?(task: ListTask): ReactNode;
  rowActions?(task: ListTask): ReactNode;
  titleData?(task: ListTask): Record<`data-${string}`, string>;
};

const normalWidths: Record<string, string> = {
  actions: 'max-content',
  complete: '32px',
  selection: '32px',
  priority: '42px',
  status: '32px',
  title: 'minmax(90px, 1fr)',
  project: 'minmax(58px, 16%)',
  owner: 'minmax(48px, 12%)',
  'due-date': 'max-content',
};
const compactWidths: Record<string, string> = {
  actions: 'max-content',
  complete: '24px',
  selection: '24px',
  priority: '20px',
  status: '20px',
  title: 'minmax(140px,1fr)',
  tags: 'minmax(0, auto)',
  project: 'minmax(60px, 13%)',
  'due-date': '86px',
  owner: '32px',
};
const overviewWidths: Record<string, string> = {
  actions: 'max-content',
  complete: '32px',
  selection: '32px',
  title: 'minmax(200px,1fr)',
  priority: '90px',
  status: '100px',
  'due-date': '125px',
  owner: '100px',
  project: 'minmax(130px,17%)',
};

function isInteractiveTarget(target: EventTarget | null, row: HTMLElement): boolean {
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const interactive = element?.closest(
    'button, input, select, textarea, a, label, summary, [role="button"], [role="checkbox"], [contenteditable="true"]',
  );
  return Boolean(interactive && row.contains(interactive));
}

export default function SharedTaskTable({
  tasks,
  onOpen,
  selectedId,
  onSelect,
  hiddenColumns = [],
  selectedIds = [],
  onSelection,
  compact = false,
  disabled = false,
  busyIds = [],
  onComplete,
  rowMetadata,
  rowActions,
  titleData,
}: SharedTaskTableProps) {
  const overview = Boolean(onSelection);
  const blocked = (task: ListTask) => disabled || busyIds.includes(task.id);
  const columns: ColumnDef<ListTask>[] = [
    { id: 'actions', header: '操作', cell: ({ row }) => rowActions?.(row.original) },
    {
      id: 'complete',
      header: '完成',
      cell: ({ row: { original: task } }) => (
        <button
          type="button"
          className="task-complete-toggle"
          aria-label={`${task.status === 'done' ? '已完成任务' : '完成任务'}：${task.title}`}
          aria-pressed={task.status === 'done'}
          disabled={
            blocked(task) || task.status === 'done' || task.status === 'canceled' || !onComplete
          }
          onClick={(event) => {
            event.stopPropagation();
            onComplete?.(task);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {task.status === 'done' && <span aria-hidden="true">✓</span>}
        </button>
      ),
    },
    {
      id: 'priority',
      header: '优先级',
      cell: ({ row }) => (
        <span className="task-cell-value">
          <PriorityGlyph priority={row.original.priority ?? 0} />
          {overview && !compact && taskPriorityNames[row.original.priority ?? 0]}
        </span>
      ),
    },
    {
      id: 'status',
      header: '状态',
      cell: ({ row }) => (
        <span className="task-cell-value" data-status={row.original.status ?? 'todo'}>
          <StatusGlyph status={row.original.status ?? 'todo'} />
          {overview && !compact && taskStatusNames[row.original.status ?? 'todo']}
        </span>
      ),
    },
    {
      id: 'title',
      header: '任务名称',
      cell: ({ row: { original: task } }) => (
        <span className="task-name task-name-with-metadata">
          <button
            type="button"
            {...titleData?.(task)}
            className="task-row-title"
            disabled={blocked(task)}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(task.id);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {task.title}
          </button>
          {rowMetadata && <span className="task-row-metadata">{rowMetadata(task)}</span>}
        </span>
      ),
    },
    { id: 'project', header: '关联项目', accessorFn: (task) => task.matter_title ?? '—' },
    {
      id: 'owner',
      header: '负责人',
      cell: ({ row: { original: task } }) => {
        const name = task.assignee === undefined ? '本人' : (task.assignee ?? '未分配');
        return compact ? (
          <span className="task-assignee-avatar" title={name} aria-label={`负责人：${name}`}>
            {name.slice(0, 1)}
          </span>
        ) : (
          name
        );
      },
    },
    {
      id: 'due-date',
      header: '截止日期',
      cell: ({ row: { original: task } }) =>
        task.due_date ? (
          <time dateTime={task.due_date} title={task.due_date}>
            {compact
              ? `${Number(task.due_date.slice(5, 7))}月${Number(task.due_date.slice(8, 10))}日`
              : task.due_date}
          </time>
        ) : (
          '—'
        ),
    },
    {
      id: 'tags',
      header: '标签',
      cell: ({ row: { original: task } }) => (
        <span className="task-row-tags">
          {task.tags?.slice(0, 2).map((tag) => (
            <small key={tag}>{tag}</small>
          ))}
        </span>
      ),
    },
  ];
  const selection: ColumnDef<ListTask> = {
    id: 'selection',
    header: compact
      ? '选择'
      : () => (
          <input
            type="checkbox"
            aria-label="全选当前页任务"
            disabled={disabled || tasks.some((task) => busyIds.includes(task.id))}
            checked={tasks.length > 0 && tasks.every((task) => selectedIds.includes(task.id))}
            onChange={(event) =>
              onSelection?.(
                event.target.checked
                  ? [...new Set([...selectedIds, ...tasks.map((task) => task.id)])]
                  : selectedIds.filter((id) => !tasks.some((task) => task.id === id)),
              )
            }
          />
        ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        aria-label={`勾选任务：${row.original.title}`}
        disabled={blocked(row.original)}
        checked={selectedIds.includes(row.id)}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={(event) =>
          onSelection?.(
            event.target.checked
              ? [...selectedIds, row.id]
              : selectedIds.filter((id) => id !== row.id),
          )
        }
      />
    ),
  };
  const order = compact
    ? ['complete', 'priority', 'status', 'title', 'tags', 'project', 'due-date', 'owner']
    : overview
      ? ['complete', 'title', 'priority', 'status', 'due-date', 'owner', 'project']
      : ['complete', 'priority', 'status', 'title', 'project', 'owner', 'due-date'];
  if (rowActions) order.push('actions');
  if (onSelection) order.splice(1, 0, 'selection');
  if (!onComplete) order.splice(order.indexOf('complete'), 1);
  const visible = order
    .map((id) => (id === 'selection' ? selection : columns.find((column) => column.id === id)!))
    .filter((column) => !hiddenColumns.some((hidden) => hidden === column.id));
  const widths = compact ? compactWidths : overview ? overviewWidths : normalWidths;
  const rowStyle = {
    gridTemplateColumns: visible.map((column) => widths[column.id ?? 'title']).join(' '),
  };
  const table = createTable({
    data: tasks,
    columns: visible,
    getRowId: (task) => task.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    state: { columnPinning: {} },
    onStateChange: () => {},
    renderFallbackValue: null,
  });
  return (
    <div
      className={`task-table task-table-structured${overview ? ' task-table-overview' : ''}${compact ? ' task-table-compact' : ''}`}
      role="table"
      aria-label="本地任务列表"
    >
      {table.getHeaderGroups().map((group) => (
        <div className="table-head" role="row" key={group.id} style={rowStyle}>
          {group.headers.map((header) => (
            <span key={header.id} role="columnheader" data-column={header.column.id}>
              {flexRender(header.column.columnDef.header, header.getContext())}
            </span>
          ))}
        </div>
      ))}
      {table.getRowModel().rows.map((row) => (
        <div
          tabIndex={blocked(row.original) ? -1 : 0}
          className="task-row"
          style={rowStyle}
          role="row"
          key={row.id}
          data-row-task={row.id}
          aria-label={`选择任务：${row.original.title}`}
          aria-current={selectedId === row.id ? 'true' : undefined}
          aria-busy={busyIds.includes(row.id) || undefined}
          onClick={(event) => {
            if (!blocked(row.original) && !isInteractiveTarget(event.target, event.currentTarget))
              (onSelect ?? onOpen)(row.id);
          }}
          onDoubleClick={
            onSelect
              ? (event) => {
                  if (
                    !blocked(row.original) &&
                    !isInteractiveTarget(event.target, event.currentTarget)
                  )
                    onOpen(row.id);
                }
              : undefined
          }
          onKeyDown={(event) => {
            if (
              !blocked(row.original) &&
              event.target === event.currentTarget &&
              (event.key === 'Enter' || event.key === ' ')
            ) {
              event.preventDefault();
              if (event.key === ' ' && !overview) (onSelect ?? onOpen)(row.id);
              else onOpen(row.id);
            }
          }}
        >
          {row.getVisibleCells().map((cell) => (
            <span role="cell" key={cell.id} data-column={cell.column.id}>
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </span>
          ))}
        </div>
      ))}
      {tasks.length === 0 && (
        <div className="table-empty">没有匹配的任务。可以新建任务，或调整搜索条件。</div>
      )}
    </div>
  );
}
