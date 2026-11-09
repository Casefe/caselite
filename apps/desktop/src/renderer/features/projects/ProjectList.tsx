import type { ColumnDef } from '@tanstack/react-table';
import type { Matter, Task } from '../../../preload/caselite-api';
import { attentionDate, attentionGroup } from '../../shared/data/calendar-dates';
import ReadTable from '../../shared/ui/ReadTable';
import { Icon } from '../../shared/ui/Icon';
import { PriorityGlyph } from '../../ui/TaskListGlyph';
import { formatCents } from '../finance/money';
import { projectHealthNames, projectStatuses, projectTypes } from './project-display';

export const projectListProperties = {
  status: '状态',
  priority: '优先级',
  owner: '负责人',
  domain: '领域',
  targetDate: '目标日',
  tasks: '任务',
  updated: '更新时间',
  health: '健康度',
  client: '客户',
  nextDate: '下一关键日期',
  risk: '风险／异常',
  balance: '余额（元）',
};
export type ProjectListColumns = { status: boolean; tasks: boolean; updated: boolean } & Partial<
  Record<keyof typeof projectListProperties, boolean>
>;
export const projectListDefaults: ProjectListColumns = {
  status: true,
  priority: true,
  owner: true,
  domain: true,
  targetDate: true,
  tasks: true,
  updated: true,
  health: false,
  client: false,
  nextDate: false,
  risk: false,
  balance: true,
};
const statusOf = (project: Matter) => (project.archived_at ? 'archived' : project.status);
const statuses = { ...projectStatuses, archived: '已归档' };

// 来自 Logixy 的固定列宽、属性列与预览布局；业务值和受控动作仍由 CaseLite 提供。
export default function ProjectList({
  projects,
  groupByStatus = false,
  columns,
  selectedId,
  disabled,
  order,
  onOrder,
  onSelect,
  onOpen,
  onPreview,
  onFinance,
  tasks = [],
  datesUnavailable = false,
}: {
  projects: Matter[];
  groupByStatus?: boolean;
  columns: ProjectListColumns;
  selectedId?: string;
  disabled: boolean;
  order: string;
  onOrder(value: string): void;
  onSelect(project: Matter): void;
  onOpen(project: Matter): void;
  onPreview(project: Matter): void;
  onFinance?(projectId: string): void;
  tasks?: Task[];
  datesUnavailable?: boolean;
}) {
  const visible = { ...projectListDefaults, ...columns };
  const sortHeader = (label: string, key: string) => (
    <button
      type="button"
      className="project-column-sort"
      disabled={disabled}
      aria-label={`按${label}排序`}
      aria-pressed={order === key}
      onClick={() => onOrder(key)}
    >
      {label}
      <span aria-hidden="true">{order === key ? (key === 'updated' ? '↓' : '↑') : '↕'}</span>
    </button>
  );
  const definitions: ColumnDef<Matter>[] = [
    {
      id: 'title',
      size: 270,
      header: () => sortHeader('项目名称', 'title'),
      cell: ({ row: { original: project } }) => (
        <button
          className="project-title-link"
          title={project.title}
          aria-label={project.title}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(project);
          }}
        >
          <span className="project-list-symbol">
            <Icon name="folder" size={16} />
          </span>
          <span className="project-list-title-text">
            <strong>{project.title}</strong>
            <small title={project.id}>{project.id.slice(0, 8)}</small>
          </span>
        </button>
      ),
    },
  ];
  const add = (key: keyof ProjectListColumns, definition: ColumnDef<Matter>) => {
    if (visible[key]) definitions.push({ id: key, ...definition });
  };
  add('status', {
    id: 'status',
    size: 120,
    header: () => sortHeader('状态', 'status'),
    cell: ({ row: { original } }) => (
      <span className={`project-status-label is-${statusOf(original)}`}>
        <i aria-hidden="true" />
        {statuses[statusOf(original)]}
      </span>
    ),
  });
  add('priority', {
    size: 100,
    header: '优先级',
    cell: ({ row }) => <PriorityGlyph priority={row.original.attributes?.priority ?? 0} />,
  });
  add('owner', {
    size: 116,
    header: '负责人',
    cell: ({ row }) => {
      const name = row.original.attributes?.assignee;
      return name ? (
        <span className="project-list-owner">
          <span aria-hidden="true">{Array.from(name)[0]}</span>
          {name}
        </span>
      ) : (
        <span className="project-list-unset">未分配</span>
      );
    },
  });
  add('domain', {
    size: 108,
    header: '领域',
    accessorFn: (project) => {
      const type = project.attributes?.professional_type ?? project.attributes?.project_type;
      return type ? projectTypes[type] : '—';
    },
  });
  add('targetDate', {
    size: 124,
    header: '目标日',
    cell: ({ row }) => {
      const date = row.original.attributes?.target_date;
      return date ? <time dateTime={date}>{date}</time> : null;
    },
  });
  add('tasks', { size: 70, header: '任务', accessorKey: 'task_count' });
  add('updated', {
    id: 'updated',
    size: 120,
    header: () => sortHeader('更新时间', 'updated'),
    cell: ({ row }) => (
      <time dateTime={row.original.updated_at}>
        {new Date(row.original.updated_at).toLocaleDateString()}
      </time>
    ),
  });
  add('health', {
    size: 108,
    header: '健康度',
    cell: ({ row }) => (
      <span className="project-health" data-health={row.original.health ?? undefined}>
        {row.original.health ? projectHealthNames[row.original.health] : '暂无更新'}
      </span>
    ),
  });
  // 尚未接入的法律属性保持空值，不用目标日、健康度等近似字段冒充。
  add('client', {
    size: 120,
    header: '客户',
    cell: () => <span className="project-list-unset">—</span>,
  });
  add('nextDate', {
    size: 124,
    header: '下一关键日期',
    cell: ({ row: { original: project } }) => {
      const members = tasks.filter((task) => task.matter_id === project.id);
      // 只有完整项目任务投影才能判断最早日期；加载中的子集不冒充完整结果。
      if (datesUnavailable || members.length !== project.task_count)
        return <span className="project-list-unset">正在更新</span>;
      const important = members.filter(
        (task) => task.calendar?.important && !['done', 'canceled'].includes(task.status),
      );
      const next = important
        .filter((task) => attentionDate(task))
        .sort((a, b) => attentionDate(a)!.localeCompare(attentionDate(b)!))[0];
      const date = next && attentionDate(next);
      return next && date ? (
        <span className="project-list-date">
          <time dateTime={date}>{date}</time>
          <small>{attentionGroup(next)}</small>
        </span>
      ) : (
        <span className="project-list-unset">{important.length ? '日期待确认' : '—'}</span>
      );
    },
  });
  add('risk', { size: 120, header: '风险／异常', cell: () => null });
  add('balance', {
    size: 124,
    header: '余额（元）',
    cell: ({ row: { original } }) =>
      onFinance ? (
        <button
          type="button"
          className="project-title-link project-list-money"
          disabled={disabled}
          aria-label={`查看 ${original.title} 的待收款 ${formatCents(original.outstanding_cents)} 元`}
          onClick={(event) => {
            event.stopPropagation();
            onFinance(original.id);
          }}
        >
          {formatCents(original.outstanding_cents)}
        </button>
      ) : (
        formatCents(original.outstanding_cents)
      ),
  });
  const groups = groupByStatus
    ? Object.entries(statuses)
        .map(([status, label]) => ({
          label,
          data: projects.filter((item) => statusOf(item) === status),
        }))
        .filter((group) => group.data.length > 0)
    : [{ label: '', data: projects }];
  const dashboardOrder = ['title', 'client', 'domain', 'nextDate', 'owner', 'balance'];
  const orderedDefinitions = [...definitions].sort((a, b) => {
    const rank = (column: ColumnDef<Matter>) => {
      const index = dashboardOrder.indexOf(column.id ?? '');
      return index < 0 ? dashboardOrder.length : index;
    };
    return rank(a) - rank(b);
  });
  return (
    <div className="project-list-groups">
      {groups.map(({ label, data }) => (
        <section key={label} aria-label={label || undefined}>
          {label && (
            <h2>
              {label} <span>{data.length}</span>
            </h2>
          )}
          <ReadTable
            data={data}
            columns={orderedDefinitions}
            sized
            getRowId={(project) => project.id}
            label={label ? `项目列表：${label}` : '项目列表'}
            className="catalog-table project-portfolio-table"
            rowProps={(project) => ({
              'data-project-id': project.id,
              'aria-selected': selectedId === project.id,
              tabIndex: disabled ? -1 : 0,
              onClick: () => {
                if (!disabled) onSelect(project);
              },
              onKeyDown: (event) => {
                if (disabled || event.target !== event.currentTarget) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onOpen(project);
                }
                if (event.key === ' ') {
                  event.preventDefault();
                  onPreview(project);
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  const rows = Array.from(
                    event.currentTarget
                      .closest('.project-list-groups')
                      ?.querySelectorAll<HTMLElement>('[data-project-id]') ?? [],
                  );
                  const index = rows.indexOf(event.currentTarget);
                  const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
                  if (next instanceof HTMLElement) {
                    event.preventDefault();
                    next.focus();
                  }
                }
              },
            })}
          />
        </section>
      ))}
    </div>
  );
}
