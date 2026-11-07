import { taskPriorityNames } from './task-priority';
import type { ReactNode } from 'react';
import type { Task } from '../../preload/caselite-api';
import BrandLogo from './BrandLogo';
import { taskStatusNames } from './task-status';

export type WorkspaceView =
  | 'home'
  | 'reminders'
  | 'tasks'
  | 'projects'
  | 'documents'
  | 'knowledge'
  | 'settings'
  | 'agent-history';
export const navigation: Array<{ id: WorkspaceView; label: string; icon: string }> = [
  { id: 'home', label: '首页', icon: 'home' },
  { id: 'reminders', label: '提醒', icon: 'bell' },
  { id: 'tasks', label: '任务', icon: 'check' },
  { id: 'projects', label: '项目', icon: 'folder' },
  { id: 'documents', label: '文档', icon: 'file' },
  { id: 'knowledge', label: '知识库', icon: 'book' },
];
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v10H3Z" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 2v6m10-6v6M3 11h18m-13 4h1m6 0h1" />
      </>
    ),
    check: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="3" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    folder: <path d="M3 7V5h7l2 3h9v12H3V7Z" />,
    file: (
      <>
        <path d="M5 3h9l5 5v13H5Z" />
        <path d="M14 3v6h5M8 13h8m-8 4h6" />
      </>
    ),
    book: (
      <>
        <path d="M12 5C8 2 3 4 3 4v16s5-2 9 1c4-3 9-1 9-1V4s-5-2-9 1Z" />
        <path d="M12 5v16" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    plus: <path d="M12 4v16M4 12h16" />,
    panel: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
      </>
    ),
    back: <path d="m10 5-7 7 7 7M3 12h18" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13M3 6h1m-1 6h1m-1 6h1" />
      </>
    ),
    star: <path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2L2.9 9.6l6.3-.9Z" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 2" />
      </>
    ),
    spark: <path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6ZM20 3v4m-2-2h4" />,
    bell: (
      <>
        <path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5Zm5 3h4" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.file}
    </svg>
  );
}
export function WorkspaceShell({
  view,
  collapsed,
  onCollapse,
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
  onNavigate(view: WorkspaceView): void;
  tasks: Task[];
  favorites?: string[];
  agentDraft?: boolean;
  onOpen(id: string): void;
  children: ReactNode;
}) {
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
      </header>
      <aside className="primary-sidebar" aria-label="一级导航">
        <nav className="primary-navigation" id="primary-navigation">
          {navigation.map((item) => (
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
        </nav>
        {!collapsed && (
          <section className="shortcuts">
            <p className="sidebar-caption">
              收藏 <span title="当前为界面原型，收藏在本次会话内有效">本次会话</span>
            </p>
            {tasks
              .filter((t) => favorites.includes(t.id))
              .map((t) => (
                <button key={t.id} data-task-id={t.id} onClick={() => onOpen(t.id)} title={t.title}>
                  <Icon name="star" size={14} />
                  <span>{t.title}</span>
                </button>
              ))}
            {!tasks.some((task) => favorites.includes(task.id)) && (
              <p className="sidebar-empty">在任务标题旁点 ☆ 添加收藏</p>
            )}
          </section>
        )}
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
            aria-label="设置"
            title="本地用户 · 设置"
            aria-current={view === 'settings' ? 'page' : undefined}
            onClick={() => onNavigate('settings')}
          >
            <span className="profile-avatar">我</span>
            {!collapsed && (
              <>
                <span className="profile-name">
                  <strong>本地用户</strong>
                  <small>
                    {new URLSearchParams(window.location.search).has('preview')
                      ? '设置 · 演示工作区'
                      : '设置'}
                  </small>
                </span>
                <Icon name="settings" size={16} />
              </>
            )}
          </button>
        </div>
      </aside>
      <div className="workspace-main">{children}</div>
    </main>
  );
}
export function TaskTable({
  tasks,
  onOpen,
  documents = false,
  selectedId,
  onSelect,
}: {
  tasks: Task[];
  onOpen(id: string): void;
  documents?: boolean;
  selectedId?: string;
  onSelect(id: string): void;
}) {
  return (
    <div
      className="task-table"
      role="table"
      aria-label={documents ? '成果文档列表' : '本地任务列表'}
    >
      <div className="table-head" role="row">
        <span>{documents ? '文档名称' : '任务名称'}</span>
        <span>{documents ? '关联任务' : '工作目标'}</span>
        <span>正文</span>
        <span>最近更新</span>
      </div>
      {tasks.map((t) => (
        <button
          className="task-row"
          role="row"
          key={t.id}
          data-row-task={t.id}
          aria-label={`选择${documents ? '文档' : '任务'}：${t.title}`}
          aria-current={selectedId === t.id ? 'true' : undefined}
          onClick={() => onSelect(t.id)}
          onDoubleClick={() => onOpen(t.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onOpen(t.id);
            }
          }}
        >
          <span className="task-name">
            {!documents && (
              <small className="task-status-tag" data-status={t.status ?? 'todo'}>
                {taskStatusNames[t.status ?? 'todo']}
              </small>
            )}
            <Icon name={documents ? 'file' : 'check'} size={16} />
            <small>{t.id.slice(0, 4).toUpperCase()}</small>
            <strong>
              {t.title}
              {documents ? ' · 初稿' : ''}
              {!documents && (
                <small className="task-attribute-summary">
                  {taskPriorityNames[t.priority ?? 0]} · {t.due_date ?? '无截止日期'}
                </small>
              )}
            </strong>
          </span>
          <span className="row-objective">{documents ? t.title : t.objective || '尚未填写'}</span>
          <span className="revision-badge">
            {t.body_revision > 0 ? `修订 ${t.body_revision}` : '未写正文'}
          </span>
          <time>
            {new Date(t.updated_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
          </time>
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
