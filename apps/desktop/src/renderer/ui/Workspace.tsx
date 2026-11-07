import { Icon } from '../shared/ui/Icon';
import { taskPriorityNames } from './task-priority';
import type { ReactNode, Ref } from 'react';
import type { Task } from '../../preload/caselite-api';
import BrandLogo from './BrandLogo';
import { taskStatusNames } from './task-status';

const profileAvatar = new URL('./profile-avatar.svg', import.meta.url).href;

export type WorkspaceView =
  | 'home'
  | 'reminders'
  | 'tasks'
  | 'projects'
  | 'finance'
  | 'tools'
  | 'whiteboard'
  | 'documents'
  | 'knowledge'
  | 'settings'
  | 'agent-history';
export const navigation: Array<{ id: WorkspaceView; label: string; icon: string }> = [
  { id: 'home', label: '首页', icon: 'home' },
  { id: 'reminders', label: '提醒', icon: 'bell' },
  { id: 'tasks', label: '任务', icon: 'check' },
  { id: 'knowledge', label: '知识库', icon: 'book' },
];
const workspaceNavigation: typeof navigation = [
  { id: 'projects', label: '项目', icon: 'folder' },
  { id: 'finance', label: '财务', icon: 'wallet' },
  { id: 'tools', label: '工具', icon: 'tool' },
  { id: 'whiteboard', label: '白板', icon: 'board' },
  { id: 'documents', label: '文档', icon: 'file' },
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
            aria-label="谭律师 · 设置"
            title="谭律师 · 设置"
            aria-current={view === 'settings' ? 'page' : undefined}
            onClick={() => onNavigate('settings')}
          >
            <img className="profile-avatar" src={profileAvatar} alt="" />
            {!collapsed && (
              <span className="profile-name">
                <strong>谭律师</strong> <small className="profile-pro">Pro</small>
              </span>
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
            <strong
              className={documents ? undefined : 'task-row-title'}
              onClick={
                documents
                  ? undefined
                  : (event) => {
                      event.stopPropagation();
                      onOpen(t.id);
                    }
              }
            >
              {t.title}
              {documents ? ' · 初稿' : ''}
              {!documents && (
                <small className="task-attribute-summary">
                  {taskPriorityNames[t.priority ?? 0]} · {t.due_date ?? '无截止日期'}
                  {t.matter_title && ` · ${t.matter_title}`}
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
