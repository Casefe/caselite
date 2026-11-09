import { PriorityGlyph, StatusGlyph } from './TaskListGlyph';
import { flexRender, getCoreRowModel, createTable, type ColumnDef } from '@tanstack/react-table';
import { Icon } from '../shared/ui/Icon';
import type { ReactNode, Ref } from 'react';
import type { Task } from '../../preload/caselite-api';
import BrandLogo from './BrandLogo';
import { useLocalPreferences } from '../shared/data/LocalPreferences';

const profileAvatar = new URL('./profile-avatar.svg', import.meta.url).href;

export type WorkspaceView =
  | 'home'
  | 'calendar'
  | 'reminders'
  | 'tasks'
  | 'projects'
  | 'finance'
  | 'reports'
  | 'contacts'
  | 'tools'
  | 'whiteboard'
  | 'documents'
  | 'knowledge'
  | 'settings'
  | 'agent-history';
export const navigation: Array<{ id: WorkspaceView; label: string; icon: string }> = [
  { id: 'home', label: '首页', icon: 'home' },
  { id: 'calendar', label: '日历', icon: 'calendar' },
  { id: 'tasks', label: '任务', icon: 'check' },
  { id: 'projects', label: '项目', icon: 'folder' },
  { id: 'documents', label: '文档', icon: 'file' },
];
const workspaceNavigation: typeof navigation = [
  { id: 'knowledge', label: '知识库', icon: 'book' },
  { id: 'finance', label: '财务', icon: 'wallet' },
  { id: 'contacts', label: '客户', icon: 'user' },
];
export function WorkspaceShell({
  view,
  collapsed,
  onCollapse,
  projectBackSlot,
  onNavigate,
  tasks,
  favorites = [],
  agentDraft = false,
  onOpen,
  children,
}: {
  view: WorkspaceView;
  collapsed: boolean;
  onCollapse(): void;
  projectBackSlot?: Ref<HTMLDivElement>;
  onNavigate(view: WorkspaceView): void;
  tasks: Task[];
  favorites?: string[];
  agentDraft?: boolean;
  onOpen(id: string): void;
  children: ReactNode;
}) {
  const { preferences } = useLocalPreferences();
  return (
    <main className={`workbench ${collapsed ? 'is-collapsed' : ''}`}>
      <link rel="stylesheet" href={new URL('../ui-design.css', window.location.href).href} />
      <header className="workspace-topbar" aria-label="工作台顶部栏">
        <div className="workspace-topbar-navigation">
          {!collapsed && (
            <div className="workspace-topbar-brand">
              <BrandLogo />
              <b>CaseLite</b>
            </div>
          )}
          <button
            className="workspace-navigation-toggle"
            aria-label={collapsed ? '展开导航' : '收起导航'}
            aria-expanded={!collapsed}
            aria-controls="primary-navigation"
            title={collapsed ? '展开导航' : '收起导航'}
            onClick={onCollapse}
          >
            <Icon name="panel" size={18} />
          </button>
        </div>
        <div className="workspace-project-back" ref={projectBackSlot} />
      </header>
      <aside className="primary-sidebar" aria-label="一级导航">
        <div className="sidebar-scroll">
          <nav className="primary-navigation" id="primary-navigation">
            {[
              { label: '常用', items: navigation },
              { label: '工作区', items: workspaceNavigation },
            ].map(({ label, items }) => (
              <div key={label} className="sidebar-nav-group" role="group" aria-label={label}>
                {!collapsed && label === '工作区' && <p className="sidebar-caption">{label}</p>}
                {items.map((item) => (
                  <button
                    key={item.id}
                    data-nav={item.id}
                    aria-label={item.label}
                    aria-current={view === item.id ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    onClick={() => onNavigate(item.id)}
                  >
                    <Icon name={item.icon} />
                    {!collapsed && <span>{item.label}</span>}
                    {!collapsed && item.id === 'tasks' && <small>{tasks.length}</small>}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          {!collapsed && (
            <section className="shortcuts" aria-label="收藏">
              <p className="sidebar-caption">
                收藏 <span title="当前为界面原型，收藏在本次会话内有效">本次会话</span>
              </p>
              {tasks
                .filter((t) => favorites.includes(t.id))
                .map((t) => (
                  <button
                    key={t.id}
                    data-task-id={t.id}
                    onClick={() => onOpen(t.id)}
                    title={t.title}
                  >
                    <Icon name="star" size={14} />
                    <span>{t.title}</span>
                  </button>
                ))}
              {!tasks.some((task) => favorites.includes(task.id)) && (
                <p className="sidebar-empty">在任务标题旁点 ☆ 添加收藏</p>
              )}
            </section>
          )}
        </div>
        <div className="sidebar-bottom">
          {agentDraft && view !== 'home' && (
            <button
              className="sidebar-draft"
              onClick={() => onNavigate('home')}
              title="首页有未提交的工作目标"
            >
              <Icon name="spark" size={15} />
              {!collapsed && 'Agent 草稿'}
            </button>
          )}
          <button
            className="profile-settings"
            data-nav="settings"
            aria-label={`${preferences.name} · 设置`}
            title={`${preferences.name} · 设置`}
            aria-current={view === 'settings' ? 'page' : undefined}
            onClick={() => onNavigate('settings')}
          >
            {preferences.avatar === 'portrait' ? (
              <img className="profile-avatar" src={profileAvatar} alt="" />
            ) : (
              <span className="profile-avatar profile-initial" aria-hidden="true">
                {Array.from(preferences.name)[0]}
              </span>
            )}
            {!collapsed && (
              <span className="profile-name">
                <strong>{preferences.name}</strong> <small className="profile-pro">Pro</small>
              </span>
            )}
          </button>
        </div>
      </aside>
      <div className="workspace-main">{children}</div>
    </main>
  );
}
export const taskOptionalColumns = {
  project: '关联项目',
  owner: '负责人',
  'due-date': '截止日期',
} as const;
export type TaskOptionalColumn = keyof typeof taskOptionalColumns;

const taskColumnWidths: Record<string, string> = {
  priority: '42px',
  status: '32px',
  title: 'minmax(90px, 1fr)',
  project: 'minmax(58px, 16%)',
  owner: 'minmax(48px, 12%)',
  'due-date': 'max-content',
};

export function TaskTable({
  tasks,
  onOpen,
  documents = false,
  selectedId,
  onSelect,
  hiddenColumns = [],
}: {
  tasks: Task[];
  onOpen(id: string): void;
  documents?: boolean;
  selectedId?: string;
  onSelect?(id: string): void;
  hiddenColumns?: TaskOptionalColumn[];
}) {
  const titleColumn: ColumnDef<Task> = {
    id: 'title',
    header: documents ? '文档名称' : '任务名称',
    cell: ({ row: { original: task } }) => (
      <span className="task-name">
        {documents && (
          <>
            <Icon name="file" size={16} />
            <small>{task.id.slice(0, 4).toUpperCase()}</small>
          </>
        )}
        <strong
          className="task-row-title"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(task.id);
          }}
        >
          {task.title}
        </strong>
      </span>
    ),
  };
  const columns: ColumnDef<Task>[] = documents
    ? [
        titleColumn,
        { id: 'task', header: '关联任务', accessorFn: (task) => task.title },
        {
          id: 'revision',
          header: '正文',
          accessorFn: (task) => (task.body_revision ? `修订 ${task.body_revision}` : '未写正文'),
        },
        { accessorKey: 'updated_at', header: '最近更新' },
      ]
    : [
        {
          id: 'priority',
          header: '优先级',
          cell: ({ row }) => <PriorityGlyph priority={row.original.priority ?? 0} />,
        },
        {
          id: 'status',
          header: '状态',
          cell: ({ row }) => <StatusGlyph status={row.original.status ?? 'todo'} />,
        },
        titleColumn,
        { id: 'project', header: '关联项目', accessorFn: (task) => task.matter_title ?? '—' },
        {
          id: 'owner',
          header: '负责人',
          accessorFn: (task) =>
            task.assignee === undefined ? '本人' : (task.assignee ?? '未分配'),
        },
        { id: 'due-date', header: '截止日期', accessorFn: (task) => task.due_date ?? '—' },
      ];
  const visible = columns.filter((column) => !hiddenColumns.some((hidden) => hidden === column.id));
  const rowStyle = documents
    ? undefined
    : {
        gridTemplateColumns: visible
          .map((column) => taskColumnWidths[column.id ?? 'title'])
          .join(' '),
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
      className={`task-table${documents ? '' : ' task-table-structured'}`}
      role="table"
      aria-label={documents ? '成果文档列表' : '本地任务列表'}
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
        <button
          className="task-row"
          style={rowStyle}
          role="row"
          key={row.id}
          data-row-task={row.id}
          aria-label={`选择${documents ? '文档' : '任务'}：${row.original.title}`}
          aria-current={selectedId === row.id ? 'true' : undefined}
          onClick={() => (onSelect ?? onOpen)(row.id)}
          onDoubleClick={onSelect ? () => onOpen(row.id) : undefined}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onOpen(row.id);
            }
          }}
        >
          {row.getVisibleCells().map((cell) => (
            <span role="cell" key={cell.id} data-column={cell.column.id}>
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </span>
          ))}
        </button>
      ))}
      {tasks.length === 0 && (
        <div className="table-empty">
          {documents
            ? '没有匹配的成果文档。可在任务中编写正文，或调整筛选。'
            : '没有匹配的任务。可以新建任务，或调整搜索条件。'}
        </div>
      )}
    </div>
  );
}
