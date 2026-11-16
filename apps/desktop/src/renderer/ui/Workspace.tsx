import SharedTaskTable, {
  taskOptionalColumns,
  type TaskOptionalColumn,
  type SharedTaskTableProps,
} from './SharedTaskTable';
import { taskPriorityNames } from './task-priority';
import { taskStatusNames } from './task-status';
import { PriorityGlyph, StatusGlyph } from './TaskListGlyph';
import { flexRender, getCoreRowModel, createTable, type ColumnDef } from '@tanstack/react-table';
import { Icon } from '../shared/ui/Icon';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import ResizeSeparator from './ResizeSeparator';
import {
  FourColumnWorkspace,
  type WorkspacePageActions,
  type WorkspaceCreateKind,
} from './FourColumnWorkspace';
import type { Task } from '../../preload/caselite-api';
import BrandLogo from './BrandLogo';
import { useLocalPreferences } from '../shared/data/LocalPreferences';
import { useSkin } from './skins/context';
import { orderSkinNavigation } from './skins';

export { taskOptionalColumns };
export type { TaskOptionalColumn };

const profileAvatar = new URL('./profile-avatar.svg', import.meta.url).href;

export type WorkspaceView =
  | 'new-tab'
  | 'home'
  | 'calendar'
  | 'reminders'
  | 'intake'
  | 'tasks'
  | 'projects'
  | 'finance'
  | 'reports'
  | 'contacts'
  | 'tools'
  | 'whiteboard'
  | 'documents'
  | 'knowledge'
  | 'favorites'
  | 'settings'
  | 'agent-history';
export const navigation: Array<{ id: WorkspaceView; label: string; icon: string }> = [
  { id: 'home', label: '首页', icon: 'home' },
  { id: 'calendar', label: '日历', icon: 'calendar' },
  { id: 'tasks', label: '任务', icon: 'check' },
  { id: 'projects', label: '项目', icon: 'folder' },
  { id: 'documents', label: '文档', icon: 'file' },
];
const secondaryNavigation: typeof navigation = [
  { id: 'intake', label: '收件', icon: 'filter' },
  { id: 'finance', label: '财务', icon: 'wallet' },
  { id: 'contacts', label: '联系人', icon: 'person' },
  { id: 'knowledge', label: '知识库', icon: 'book' },
  { id: 'favorites', label: '收藏', icon: 'star' },
];
export function WorkspaceShell({
  view,
  onNavigate,
  importantDatesCount,
  favoritesPanel,
  favoritesActive = false,
  agentDraft = false,
  children,
  topbar,
  inspectorOpen = true,
  onToggleInspector,
  createRequest,
  onCreateRequestConsumed,
}: {
  view: WorkspaceView;
  collapsed: boolean;
  onCollapse(): void;
  onNavigate(view: WorkspaceView): void;
  tasks: Task[];
  importantDatesCount?: number;
  favoritesPanel?: ReactNode;
  favoritesActive?: boolean;
  agentDraft?: boolean;
  onOpen(id: string): void;
  children: ReactNode;
  topbar?: ReactNode;
  inspectorOpen?: boolean;
  onToggleInspector?(): void;
  createRequest?: { kind: WorkspaceCreateKind; id: number };
  onCreateRequestConsumed?(id: number): void;
}) {
  const { preferences } = useLocalPreferences();
  const directoryRoot = useRef<HTMLElement>(null);
  const [directorySearch, setDirectorySearch] = useState<{
    field: HTMLInputElement;
    disabled: boolean;
  } | null>(null);
  useEffect(() => {
    const root = directoryRoot.current;
    if (!root) return;
    const update = () => {
      const field = [
        ...root.querySelectorAll<HTMLInputElement>(
          'input[type="search"], input[data-directory-search]',
        ),
      ].find((item) => !item.closest('[hidden], [inert]'));
      setDirectorySearch((old) =>
        old?.field === field && old?.disabled === field?.disabled
          ? old
          : field
            ? { field, disabled: field.disabled }
            : null,
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'inert', 'type', 'data-directory-search'],
    });
    return () => observer.disconnect();
  }, [favoritesActive]);
  const [directory, setDirectory] = useState<HTMLDivElement | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(true);
  const [directoryWidth, setDirectoryWidth] = useState(248);
  const [directoryPreview, setDirectoryPreview] = useState<number | null>(null);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [directoryOverlayOpen, setDirectoryOverlayOpen] = useState(false);
  const narrowDirectory = viewport <= 900;
  const directoryVisible = narrowDirectory ? directoryOverlayOpen : directoryOpen;
  const returnDirectoryFocus = useCallback(() => {
    const aside = directoryRoot.current;
    if (aside?.contains(document.activeElement))
      aside
        .closest('.workbench')
        ?.querySelector<HTMLButtonElement>('[aria-controls="workspace-directory"]')
        ?.focus();
  }, []);
  const toggleDirectory = () => {
    if (directoryVisible) returnDirectoryFocus();
    if (narrowDirectory) setDirectoryOverlayOpen((open) => !open);
    else setDirectoryOpen((open) => !open);
  };
  const [registered, setRegistered] = useState<ReadonlyMap<symbol, WorkspacePageActions>>(
    () => new Map(),
  );
  const registerActions = useCallback((owner: symbol, actions: WorkspacePageActions | null) => {
    setRegistered((old) => {
      const next = new Map(old);
      if (actions) next.set(owner, actions);
      else next.delete(owner);
      return next;
    });
  }, []);
  const pageActions = [...registered.values()].reduce<WorkspacePageActions>(
    (result, actions) => ({
      ...result,
      ...(actions.create ? { create: actions.create } : {}),
      ...(actions.export ? { export: actions.export } : {}),
    }),
    {},
  );
  useEffect(() => {
    const resize = () => {
      if (window.innerWidth <= 900 || !directoryOpen) returnDirectoryFocus();
      setDirectoryOverlayOpen(false);
      setViewport(window.innerWidth);
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [directoryOpen, returnDirectoryFocus]);
  useEffect(() => {
    if (!narrowDirectory || !directoryOverlayOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      returnDirectoryFocus();
      setDirectoryOverlayOpen(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [narrowDirectory, directoryOverlayOpen, returnDirectoryFocus]);
  const directoryMax = Math.max(0, Math.floor(viewport / 3));
  const directoryMin = Math.min(180, directoryMax);
  const shownWidth = Math.max(
    directoryMin,
    Math.min(directoryMax, directoryPreview ?? directoryWidth),
  );
  const pageLabel =
    [...navigation, ...secondaryNavigation].find((item) => item.id === view)?.label ??
    (
      {
        settings: '设置',
        'agent-history': '对话记录',
        'new-tab': '新页面',
        reminders: '提醒',
      } as Record<string, string>
    )[view] ??
    '工作台';
  const skin = useSkin();
  const sortedNavigation = orderSkinNavigation([...navigation, ...secondaryNavigation], skin);
  const primaryItems = skin ? sortedNavigation.slice(0, navigation.length) : navigation;
  const moreItems = skin ? sortedNavigation.slice(navigation.length) : secondaryNavigation;
  return (
    <FourColumnWorkspace.Provider
      value={{
        request: createRequest,
        consumeRequest: onCreateRequestConsumed,
        directory,
        directoryOpen: directoryVisible,
        toggleDirectory,
        registerActions,
        actions: pageActions,
      }}
    >
      <main
        className="workbench is-collapsed four-column-workbench"
        data-directory-open={directoryVisible}
        data-workspace-view={view}
        style={
          {
            '--shell-directory-width': `${!narrowDirectory && directoryOpen ? shownWidth : 0}px`,
            '--shell-directory-panel-width': `${shownWidth}px`,
            '--shell-rail-width': inspectorOpen ? '0px' : 'var(--shell-collapsed-rail-width)',
          } as CSSProperties
        }
        data-inspector-open={inspectorOpen}
        data-navigation-hidden={false}
        data-navigation-overlay={false}
        data-properties-layout="sidebar"
        data-platform={/Mac/.test(navigator.userAgent) ? 'mac' : 'other'}
      >
        <link rel="stylesheet" href={new URL('../ui-design.css', window.location.href).href} />
        <header className="workspace-topbar" aria-label="工作台顶部栏">
          {topbar ?? (
            <>
              <div className="workspace-topbar-navigation">
                <button
                  className="workspace-navigation-toggle"
                  aria-label={directoryVisible ? '收起目录栏' : '展开目录栏'}
                  aria-expanded={directoryVisible}
                  aria-controls="workspace-directory"
                  title={directoryVisible ? '收起目录栏' : '展开目录栏'}
                  onClick={toggleDirectory}
                >
                  <Icon name="panel" size={18} />
                </button>
              </div>
            </>
          )}
        </header>
        <aside className="primary-sidebar" aria-label="一级导航" inert={false}>
          {topbar && (
            <div className="workspace-sidebar-heading">
              <div className="workspace-topbar-brand">
                <BrandLogo />
                <b>CaseLite</b>
              </div>
            </div>
          )}
          <div className="sidebar-scroll">
            <nav className="primary-navigation" id="primary-navigation">
              {[
                { label: '常用', items: primaryItems },
                { label: '更多', items: moreItems },
              ].map(({ label, items }) => (
                <div key={label} className="sidebar-nav-group" role="group" aria-label={label}>
                  {items.map((item) => (
                    <button
                      key={item.id}
                      data-nav={item.id}
                      aria-label={item.label}
                      aria-current={view === item.id ? 'page' : undefined}
                      title={
                        item.id === 'calendar' && importantDatesCount !== undefined
                          ? `日历 · ${importantDatesCount} 个重要日期`
                          : item.label
                      }
                      onClick={() => onNavigate(item.id)}
                    >
                      <Icon name={item.icon} />
                      {item.id === 'calendar' && importantDatesCount !== undefined && (
                        <small
                          className="navigation-date-count"
                          aria-label={`重要日期 ${importantDatesCount} 项`}
                        >
                          {importantDatesCount}
                        </small>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          </div>
          <div className="sidebar-bottom">
            {agentDraft && view !== 'home' && (
              <button
                className="sidebar-draft"
                onClick={() => onNavigate('home')}
                title="首页有未提交的工作目标"
              >
                <Icon name="spark" size={15} />
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
            </button>
          </div>
        </aside>
        <aside
          ref={directoryRoot}
          id="workspace-directory"
          className="workspace-directory"
          aria-label={`${pageLabel}目录`}
          data-directory-mode={narrowDirectory ? 'overlay' : 'column'}
          hidden={!directoryVisible}
          inert={!directoryVisible}
        >
          <header className="workspace-directory-heading">
            <h1>{pageLabel}</h1>
            <button
              type="button"
              aria-label={`搜索${pageLabel}目录`}
              title={
                !directorySearch
                  ? '此目录暂未接入搜索'
                  : directorySearch.disabled
                    ? '请先完成当前编辑或核对提交'
                    : '搜索目录'
              }
              disabled={!directorySearch || directorySearch.disabled}
              onClick={() => directorySearch?.field.focus()}
            >
              <Icon name="search" size={18} />
            </button>
          </header>
          <div className="workspace-directory-content">
            <div
              className="workspace-favorites-directory"
              hidden={!favoritesActive}
              inert={!favoritesActive}
            >
              {favoritesPanel}
            </div>
            <div
              className="workspace-page-directory"
              ref={setDirectory}
              hidden={favoritesActive}
              inert={favoritesActive}
            />
          </div>
          <div className="workspace-directory-resize">
            <ResizeSeparator
              label="调整目录栏宽度"
              value={shownWidth}
              min={directoryMin}
              max={directoryMax}
              disabled={false}
              onPreview={setDirectoryPreview}
              onCommit={(value) => {
                setDirectoryWidth(value);
                setDirectoryPreview(null);
              }}
              onCancel={() => setDirectoryPreview(null)}
            />
          </div>
        </aside>
        <div className="workspace-main" id="workspace-page-content">
          <div className="favorites-workspace" data-active={favoritesActive}>
            <div className="favorites-workspace-content">{children}</div>
            <aside className="shell-empty-inspector" aria-label="辅助栏空态">
              <h2>{view === 'home' ? '预览' : '属性'}</h2>
              <p>选择目录中的对象以查看详情。</p>
              <section>
                <h3>AI 对话</h3>
                <p>选择工作对象后开启对话。</p>
              </section>
            </aside>
          </div>
        </div>
        <aside
          className="workspace-auxiliary-rail"
          aria-label="辅助列"
          hidden={inspectorOpen}
          inert={inspectorOpen}
        >
          <button
            type="button"
            aria-label={view === 'home' ? '展开预览' : inspectorOpen ? '收起辅助栏' : '展开辅助栏'}
            title={
              view === 'home'
                ? '从对话中打开附件或回答以预览'
                : inspectorOpen
                  ? '收起辅助栏'
                  : '展开辅助栏'
            }
            onClick={onToggleInspector}
          >
            <Icon name="panel-right-open" size={18} />
          </button>
          {!inspectorOpen && view !== 'home' && (
            <button
              type="button"
              aria-label="展开属性与 AI 对话"
              title="属性与 AI 对话"
              onClick={onToggleInspector}
            >
              <Icon name="spark" size={18} />
            </button>
          )}
        </aside>
        <div className="workspace-corner-logo" title="CaseLite">
          <BrandLogo />
        </div>
      </main>
    </FourColumnWorkspace.Provider>
  );
}

const taskColumnWidths: Record<string, string> = {
  priority: '42px',
  status: '32px',
  title: 'minmax(90px, 1fr)',
  project: 'minmax(58px, 16%)',
  owner: 'minmax(48px, 12%)',
  'due-date': 'max-content',
};

export function TaskTable(
  props: Omit<SharedTaskTableProps, 'hiddenColumns'> & {
    documents?: boolean;
    hiddenColumns?: TaskOptionalColumn[];
  },
) {
  if (props.documents) return <LegacyTaskTable {...props} />;
  return <SharedTaskTable {...props} />;
}

function LegacyTaskTable({
  tasks,
  onOpen,
  documents = false,
  selectedId,
  onSelect,
  hiddenColumns = [],
  selectedIds = [],
  onSelection,
  compact = false,
}: {
  tasks: Task[];
  onOpen(id: string): void;
  documents?: boolean;
  selectedId?: string;
  onSelect?(id: string): void;
  hiddenColumns?: TaskOptionalColumn[];
  selectedIds?: string[];
  onSelection?(ids: string[]): void;
  compact?: boolean;
}) {
  const overview = !documents && Boolean(onSelection);
  const RowElement = overview ? 'div' : 'button';
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
        titleColumn,
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
        ...(compact
          ? [
              {
                id: 'tags',
                header: '标签',
                cell: ({ row }: { row: { original: Task } }) => (
                  <span className="task-row-tags">
                    {row.original.tags?.slice(0, 2).map((tag) => (
                      <small key={tag}>{tag}</small>
                    ))}
                  </span>
                ),
              },
            ]
          : []),
      ];
  const arranged: ColumnDef<Task>[] = compact
    ? [
        ...(onSelection
          ? [
              {
                id: 'selection',
                header: '选择',
                cell: ({ row }: { row: { original: Task; id: string } }) => (
                  <input
                    type="checkbox"
                    aria-label={`勾选任务：${row.original.title}`}
                    checked={selectedIds.includes(row.id)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onSelection(
                        e.target.checked
                          ? [...selectedIds, row.id]
                          : selectedIds.filter((id) => id !== row.id),
                      )
                    }
                  />
                ),
              },
            ]
          : []),
        ...['priority', 'status', 'title', 'tags', 'project', 'due-date', 'owner'].map((id) =>
          columns.find((c) => c.id === id)!,
        ),
      ]
    : overview
      ? [
          {
            id: 'selection',
            header: () => (
              <input
                type="checkbox"
                aria-label="全选当前页任务"
                checked={tasks.length > 0 && tasks.every((t) => selectedIds.includes(t.id))}
                onChange={(e) =>
                  onSelection?.(
                    e.target.checked
                      ? [...new Set([...selectedIds, ...tasks.map((t) => t.id)])]
                      : selectedIds.filter((id) => !tasks.some((t) => t.id === id)),
                  )
                }
              />
            ),
            cell: ({ row }) => (
              <input
                type="checkbox"
                aria-label={`勾选任务：${row.original.title}`}
                checked={selectedIds.includes(row.id)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) =>
                  onSelection?.(
                    e.target.checked
                      ? [...selectedIds, row.id]
                      : selectedIds.filter((id) => id !== row.id),
                  )
                }
              />
            ),
          },
          ...['title', 'priority', 'status', 'due-date', 'owner', 'project'].map((id) =>
            columns.find((c) => c.id === id)!,
          ),
        ]
      : columns;
  const visible = arranged.filter(
    (column) => !hiddenColumns.some((hidden) => hidden === column.id),
  );
  const rowStyle = documents
    ? undefined
    : {
        gridTemplateColumns: visible
          .map((column) =>
            compact
              ? (
                  {
                    selection: '24px',
                    priority: '20px',
                    status: '20px',
                    title: 'minmax(140px,1fr)',
                    tags: 'minmax(0, auto)',
                    project: 'minmax(60px, 13%)',
                    'due-date': '86px',
                    owner: '32px',
                  } as Record<string, string>
                )[column.id ?? 'title']
              : overview
                ? (
                    {
                      selection: '32px',
                      title: 'minmax(200px,1fr)',
                      priority: '90px',
                      status: '100px',
                      'due-date': '125px',
                      owner: '100px',
                      project: 'minmax(130px,17%)',
                    } as Record<string, string>
                  )[column.id ?? 'title']
                : taskColumnWidths[column.id ?? 'title'],
          )
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
      className={`task-table${documents ? '' : ' task-table-structured'}${overview ? ' task-table-overview' : ''}${compact ? ' task-table-compact' : ''}`}
      aria-busy={undefined}
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
        <RowElement
          tabIndex={overview || compact ? 0 : undefined}
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
            if (
              event.target === event.currentTarget &&
              (event.key === 'Enter' || (overview && event.key === ' '))
            ) {
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
        </RowElement>
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
