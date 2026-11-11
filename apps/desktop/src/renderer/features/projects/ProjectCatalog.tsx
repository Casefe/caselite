import PropertyResizeHandle from '../../ui/PropertyResizeHandle';
import { useProjectCatalog } from '../../shared/data/ordinary-catalog-query';
import ProjectMetrics from './ProjectMetrics';
import { useStatisticsCards } from '../../shared/statistics/statistics-preferences';
import InspectorCards from '../../ui/InspectorCards';
import ProjectList, {
  projectListDefaults,
  projectListProperties,
  type ProjectListColumns,
} from './ProjectList';
import { catalogMutation } from '../../shared/data/catalogMutation';
import { Icon } from '../../shared/ui/Icon';
import { PriorityGlyph, StatusGlyph } from '../../ui/TaskListGlyph';
import { taskStatusNames } from '../../ui/task-status';
import { createPortal } from 'react-dom';
import { projectHealthNames, projectStatuses, projectTypes } from './project-display';
import ProjectPropertyEditor from './ProjectPropertyEditor';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { Matter, Task, CatalogRequest, CatalogResponse } from '../../../preload/caselite-api';
import ProjectEditor from './ProjectEditor';

import SidebarAgent from '../../ui/SidebarAgent';
import InspectorLayout from '../../ui/InspectorLayout';
import { useCatalog } from '../../ui/useCatalog';
import ProjectCreateDialog from './ProjectCreateDialog';
import ProjectSummary from './ProjectSummary';
import ProjectFiles from './ProjectFiles';
import ActivityList from './ActivityList';
import ProjectDeliverables from './ProjectDeliverables';
import ProjectDiscussion from './ProjectDiscussion';
import ProjectPlanning from './ProjectPlanning';
const ProjectRelationshipGraph = lazy(() => import('./ProjectRelationshipGraph'));
const names = { ...projectStatuses, archived: '已归档' };
const projectStatus = (project: Matter) => (project.archived_at ? 'archived' : project.status);
const projectTaskStatuses = ['in_progress', 'todo', 'done', 'canceled'] as const;
type CatalogSuccess = Extract<CatalogResponse, { ok: true }>;
const sections = {
  overview: '概述',
  activity: '活动',
  tasks: '任务',
  files: '文件',
  visualization: '可视化',
  deliverables: '交付物',
};
export type ProjectViewState = {
  selected: string | null;
  projectId: string | null;
  section: keyof typeof sections;
  query: string;
  statusFilter: keyof typeof names | 'all';
  order: string;
  ownerFilter?: string;
  typeFilter?: string;
  columns: ProjectListColumns;
  groupByStatus?: boolean;
  scrollTop: number;
  workspaceScrollTop: number;
  returnTaskId: string;
  documentId?: string;
  page?: number;
  pageSize?: number;
};
export default function ProjectCatalog({
  tasks,
  onOpen,
  onNewTask,
  onFinance,
  onCalendar,
  importantInfo: ImportantInfo,
  onDirty,
  onChanged,
  initialView,
  backSlot,
  navigationPending = false,
  favoriteAction,
}: {
  tasks: Task[];
  onOpen(id: string, source: ProjectViewState): void;
  onFinance?(projectId: string): void;
  onCalendar?(): void;
  importantInfo?: ComponentType<{ onOpen(id: string): void; onCalendar?(): void; title?: string }>;
  onNewTask?(source: ProjectViewState): void;
  initialView?: ProjectViewState | null;
  backSlot?: HTMLDivElement | null;
  navigationPending?: boolean;
  favoriteAction?(project: Matter, disabled: boolean): ReactNode;
  onDirty(v: boolean): void;
  onChanged(): void | Promise<boolean>;
}) {
  const readCatalog = useProjectCatalog();
  const c = useCatalog(true, readCatalog),
    [selected, setSelected] = useState<string | null>(initialView?.selected ?? null),
    [creating, setCreating] = useState(false),
    [editor, setEditor] = useState<{
      project: Matter;
      state: number[] | null;
      epoch: number;
    } | null>(null),
    [bodyDirty, setBodyDirty] = useState(false),
    [propertyDirty, setPropertyDirty] = useState(false),
    [acknowledged, setAcknowledged] = useState<Record<string, Matter>>({}),
    [assigning, setAssigning] = useState('');
  const [collapsedTaskGroups, setCollapsedTaskGroups] = useState<Record<string, boolean>>({});
  const [listInspectorOpen, setListInspectorOpen] = useState(false);
  const [bodyError, setBodyError] = useState('');
  const [bodyCommand, setBodyCommand] = useState(false);
  const [lifecycleDraft, setLifecycleDraft] = useState(false);
  const [section, setSection] = useState<keyof typeof sections>(initialView?.section ?? 'overview');
  const [query, setQuery] = useState(initialView?.query ?? '');
  const [statusFilter, setStatusFilter] = useState<keyof typeof names | 'all'>(
    initialView?.statusFilter ?? 'all',
  );
  const [ownerFilter, setOwnerFilter] = useState(initialView?.ownerFilter ?? '');
  const [typeFilter, setTypeFilter] = useState(initialView?.typeFilter ?? '');
  const [order, setOrder] = useState(initialView?.order ?? 'updated');
  const [groupByStatus, setGroupByStatus] = useState(initialView?.groupByStatus ?? false);
  const [columns, setColumns] = useState({
    ...projectListDefaults,
    status: false,
    priority: false,
    client: true,
    nextDate: true,
    targetDate: false,
    tasks: false,
    updated: false,
    ...initialView?.columns,
  });
  const [pageSize, setPageSize] = useState(initialView?.pageSize ?? 8);
  const listKey = JSON.stringify([
    query,
    statusFilter,
    ownerFilter,
    typeFilter,
    order,
    groupByStatus,
    pageSize,
  ]);
  const [pagination, setPagination] = useState({ key: listKey, index: initialView?.page ?? 0 });
  if (pagination.key !== listKey) setPagination({ key: listKey, index: 0 });
  const workspace = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const returnProjectId = useRef<string | null>(null);
  const restoring = useRef(initialView ?? null);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const alive = useRef(true),
    readId = useRef(0);
  const [reading, setReading] = useState(Boolean(initialView?.projectId)),
    [readError, setReadError] = useState(''),
    [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const closeDisplayMenu = () => {
      const menu = workspace.current?.querySelector<HTMLDetailsElement>('.project-display-menu');
      if (menu) menu.open = false;
    };
    window.addEventListener('resize', closeDisplayMenu);
    return () => window.removeEventListener('resize', closeDisplayMenu);
  }, []);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const [discussionDirty, setDiscussionDirty] = useState(false);
  const [planningDirty, setPlanningDirty] = useState(false);
  const dirty = bodyDirty || propertyDirty || discussionDirty || planningDirty;
  const discussionDisabled =
    navigationPending ||
    reading ||
    bodyDirty ||
    propertyDirty ||
    planningDirty ||
    c.pending ||
    c.unknown;
  const projects = Object.values({
    ...acknowledged,
    ...Object.fromEntries(
      (c.data?.projects ?? []).map((project) => {
        const confirmed = acknowledged[project.id];
        return [project.id, confirmed && confirmed.version > project.version ? confirmed : project];
      }),
    ),
  });
  const ownerOptions = [
    ...new Set(
      projects.flatMap((item) => (item.attributes?.assignee ? [item.attributes.assignee] : [])),
    ),
  ].sort();
  const list = projects
    .filter(
      (p) =>
        (statusFilter === 'all' ? !p.archived_at : projectStatus(p) === statusFilter) &&
        (p.title.toLocaleLowerCase().includes(normalizedQuery) ||
          p.id.toLowerCase().includes(normalizedQuery)) &&
        (!ownerFilter || p.attributes?.assignee === ownerFilter) &&
        (!typeFilter ||
          (p.attributes?.professional_type ?? p.attributes?.project_type) === typeFilter),
    )
    .sort((a, b) => {
      if (order === 'title')
        return a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id);
      if (order === 'status') {
        const positions = { planned: 0, active: 1, done: 2, archived: 3 };
        return (
          positions[projectStatus(a)] - positions[projectStatus(b)] ||
          a.title.localeCompare(b.title, 'zh-CN')
        );
      }
      return b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id);
    });
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
  const page = Math.min(pageCount - 1, pagination.key === listKey ? pagination.index : 0);
  const visibleProjects = list.slice(page * pageSize, (page + 1) * pageSize);
  const p = editor
    ? (projects.find((x) => x.id === editor.project.id && x.version >= editor.project.version) ??
      editor.project)
    : initialView?.projectId && (reading || sourceUnavailable)
      ? undefined
      : (visibleProjects.find((x) => x.id === selected) ??
        (propertyDirty ? projects.find((x) => x.id === selected) : undefined) ??
        visibleProjects[0]);
  const members = tasks.filter((task) => task.matter_id === p?.id);
  const activityRevision = JSON.stringify([
    p?.version,
    p?.task_count,
    members.map((task) => [task.id, task.version]),
  ]);
  useEffect(() => {
    onDirty(dirty || creating || reading || c.pending || c.unknown);
    return () => onDirty(false);
  }, [dirty, creating, reading, c.pending, c.unknown, onDirty]);
  const read = useCallback(async (id: string, restore = false) => {
    const sequence = ++readId.current;
    setReading(true);
    setReadError('');
    try {
      const r = await window.caselite.catalog({
        operation: 'read_project',
        protocol_version: 1,
        id,
      });
      if (!alive.current || sequence !== readId.current) return;
      if (r.ok) {
        const actual = r.projects.find((p) => p.id === id);
        if (actual) {
          setEditor({ project: actual, state: r.state, epoch: sequence });
          setAssigning('');
          setBodyDirty(false);
          setBodyError('');
          setCreatedId(null);
          if (!restore) setSection('overview');
          setSourceUnavailable(false);
        } else {
          setReadError('来源项目已失效，未能读取该项目。');
          if (restore) setSourceUnavailable(true);
        }
      } else {
        setReadError(r.message);
        if (restore) setSourceUnavailable(true);
      }
    } catch {
      if (alive.current && sequence === readId.current) {
        setReadError('无法读取来源项目说明，请重试。');
        if (restore) setSourceUnavailable(true);
      }
    } finally {
      if (alive.current && sequence === readId.current) setReading(false);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && initialView?.projectId) void read(initialView.projectId, true);
    });
    return () => {
      cancelled = true;
    };
  }, [initialView, read]);
  const documents = c.data?.documents.filter(
    (doc) =>
      doc.matter_id === p?.id &&
      !doc.archived_at &&
      tasks.some(
        (task) =>
          task.id === doc.task_id &&
          task.document_id === doc.id &&
          task.matter_id === doc.matter_id &&
          !task.document_archived_at,
      ),
  );
  useLayoutEffect(() => {
    const source = restoring.current;
    if (!source || reading || navigationPending || (source.projectId ? !editor : !c.data)) return;
    // 文档入口要等目录查询完成，才能恢复到原来的按钮或栏目。
    if (source.documentId && !c.data && !c.error) return;
    const target = Array.from(
      workspace.current?.querySelectorAll<HTMLButtonElement>(
        `#project-panel-${source.section} [data-project-task]`,
      ) ?? [],
    ).find(
      (button) =>
        button.dataset.projectTask === source.returnTaskId &&
        button.dataset.projectDocument === source.documentId &&
        !button.closest('[hidden]'),
    );
    (
      target ??
      (source.projectId
        ? workspace.current?.querySelector<HTMLButtonElement>(`#project-tab-${source.section}`)
        : (Array.from(
            workspace.current?.querySelectorAll<HTMLButtonElement>(
              '[data-project-id] .project-title-link',
            ) ?? [],
          ).find(
            (button) =>
              button.closest<HTMLElement>('[data-project-id]')?.dataset.projectId ===
              source.selected,
          ) ?? workspace.current?.querySelector<HTMLInputElement>('[aria-label=搜索项目]')))
    )?.focus({ preventScroll: true });
    if (scroll.current) scroll.current.scrollTop = source.scrollTop;
    if (workspace.current) workspace.current.scrollTop = source.workspaceScrollTop;
    restoring.current = null;
  }, [reading, navigationPending, editor, c.data, c.error, tasks]);
  useLayoutEffect(() => {
    const id = returnProjectId.current;
    if (editor || !id) return;
    returnProjectId.current = null;
    const title = Array.from(
      workspace.current?.querySelectorAll<HTMLButtonElement>(
        '[data-project-id] .project-title-link',
      ) ?? [],
    ).find((button) => button.closest<HTMLElement>('[data-project-id]')?.dataset.projectId === id);
    (title ?? workspace.current?.querySelector<HTMLInputElement>('[aria-label=搜索项目]'))?.focus();
  }, [editor]);
  const sourceView = (id: string, documentId?: string): ProjectViewState => ({
    selected: p?.id ?? selected,
    projectId: editor?.project.id ?? null,
    section,
    query,
    statusFilter,
    ownerFilter,
    typeFilter,
    order,
    columns,
    groupByStatus,
    page,
    pageSize,
    scrollTop: scroll.current?.scrollTop ?? 0,
    workspaceScrollTop: workspace.current?.scrollTop ?? 0,
    returnTaskId: id,
    ...(documentId ? { documentId } : {}),
  });
  const openTask = (id: string, documentId?: string) => {
    if (!blocked) onOpen(id, sourceView(id, documentId));
  };
  const open = async (project: Matter) => {
    if (!dirty && !creating && !reading && !c.pending && !c.unknown) await read(project.id);
  };
  const blocked = navigationPending || reading || dirty || creating || c.pending || c.unknown;
  const openActivityProject = (id: string) => {
    if (!blocked) void read(id);
  };
  const documentLinks = () => {
    if (c.error) return <p role="status">暂时无法读取项目文档。</p>;
    if (!documents) return <p role="status">正在读取项目文档…</p>;
    if (!documents.length) return <p>还没有可编辑文档。</p>;
    return (
      <ul className="project-document-list">
        {documents.map((doc) => (
          <li key={doc.id}>
            <button
              disabled={blocked}
              data-project-task={doc.task_id}
              data-project-document={doc.id}
              onClick={() => openTask(doc.task_id, doc.id)}
            >
              {doc.title}
            </button>
          </li>
        ))}
      </ul>
    );
  };
  const command = (input: CatalogRequest, done?: (r: CatalogSuccess) => void | Promise<void>) =>
    c.execute(input, async (r) => {
      const refreshed = onChanged();
      await done?.(r);
      if (input.operation === 'assign_task' || input.operation === 'assign_milestone')
        await refreshed;
    });
  const handleBodyResult = (result: CatalogResponse | null) => {
    if (result?.ok) return;
    setBodyError(result?.message ?? '说明提交结果未知。');
    if (result && result.code !== 'RESULT_UNKNOWN' && result.code !== 'UNAVAILABLE')
      setBodyCommand(false);
  };
  const acknowledge = (result: CatalogSuccess, base: Matter) => {
    const actual = result.projects.find((item) => item.id === base.id);
    if (result.target_id !== base.id || !actual || actual.version <= base.version) return null;
    const project = { ...base, ...actual, attributes: actual.attributes ?? base.attributes };
    setAcknowledged((previous) => ({ ...previous, [base.id]: project }));
    return project;
  };
  const backButton = editor && (
    <button
      type="button"
      className="workspace-project-back-button"
      disabled={blocked}
      title="返回项目列表"
      onClick={() => {
        returnProjectId.current = editor.project.id;
        setEditor(null);
      }}
    >
      <Icon name="back" />
      <span className="sr-only">返回项目列表</span>
    </button>
  );
  const cards = useStatisticsCards(
    'projects',
    <ProjectMetrics projects={projects} unavailable={!c.data || Boolean(c.error)} />,
    !editor,
  );
  return (
    <section
      ref={workspace}
      inert={navigationPending}
      aria-busy={navigationPending}
      className="collection-workspace catalog-view project-catalog property-resizable"
      data-properties-resizable="true"
      data-project-view={editor ? section : 'list'}
      data-layout="three-column"
      data-testid="project-catalog"
    >
      <PropertyResizeHandle module="projects" />
      <div className="collection-main">
        {backSlot && createPortal(backButton, backSlot)}
        <div className="collection-heading project-catalog-heading">
          {!backSlot && backButton}
          {editor ? (
            <>
              <Icon name="folder" size={16} />
              <h1>{(p ?? editor.project).title}</h1>
              {favoriteAction?.(
                p ?? editor.project,
                blocked || !!(p ?? editor.project).archived_at,
              )}
            </>
          ) : (
            <div className="project-dashboard-title">
              <h1>项目管理</h1>
              <p>集中管理案件与项目，跟踪进展、重要日期与团队协作。</p>
            </div>
          )}
          <button className="work-list-create" disabled={blocked} onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> 创建项目
          </button>
        </div>
        {!editor && (
          <div className="project-list-stages" aria-label="项目阶段">
            <button
              type="button"
              aria-pressed={statusFilter === 'all'}
              disabled={blocked}
              onClick={() => {
                setSelected(null);
                setStatusFilter('all');
              }}
            >
              全部项目 <span>{projects.filter((item) => !item.archived_at).length}</span>
            </button>
            {(
              [
                ['active', '进行中'],
                ['planned', '待启动'],
                ['done', '已结项'],
              ] as const
            ).map(([status, label]) => (
              <button
                type="button"
                key={status}
                aria-pressed={statusFilter === status}
                disabled={blocked}
                onClick={() => {
                  setSelected(null);
                  setStatusFilter(statusFilter === status ? 'all' : status);
                }}
              >
                {label}{' '}
                <span>{projects.filter((item) => projectStatus(item) === status).length}</span>
              </button>
            ))}
            {(query || statusFilter !== 'all' || ownerFilter || typeFilter) && (
              <button
                type="button"
                disabled={blocked}
                onClick={() => {
                  setQuery('');
                  setStatusFilter('all');
                  setOwnerFilter('');
                  setTypeFilter('');
                  setSelected(null);
                }}
              >
                清除筛选
              </button>
            )}
            <button
              className="project-list-inspector-toggle"
              type="button"
              aria-label="项目预览"
              aria-expanded={listInspectorOpen}
              disabled={blocked}
              onClick={() => setListInspectorOpen((open) => !open)}
            >
              <Icon name="panel" size={16} />
            </button>
          </div>
        )}

        {!editor && <h2 className="project-dashboard-list-title">项目列表</h2>}
        {!editor && (
          <div
            className="project-list-controls"
            id="project-list-filters"
            aria-label="项目列表选项"
          >
            <label className="project-list-search">
              <Icon name="search" size={15} />
              <input
                disabled={dirty || creating || reading || c.pending || c.unknown}
                aria-label="搜索项目"
                placeholder="搜索项目名称或编号…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              disabled={dirty || creating || reading || c.pending || c.unknown}
              aria-label="筛选项目状态"
              value={statusFilter}
              onChange={(e) => {
                setSelected(null);
                setStatusFilter(e.target.value as typeof statusFilter);
              }}
            >
              <option value="all">未归档项目</option>
              {Object.entries(names).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="按负责人筛选项目"
              disabled={blocked}
              value={ownerFilter}
              onChange={(event) => {
                setSelected(null);
                setOwnerFilter(event.target.value);
              }}
            >
              <option value="">全部负责人</option>
              {ownerOptions.map((owner) => (
                <option key={owner}>{owner}</option>
              ))}
            </select>
            <select
              aria-label="按类型筛选项目"
              disabled={blocked}
              value={typeFilter}
              onChange={(event) => {
                setSelected(null);
                setTypeFilter(event.target.value);
              }}
            >
              <option value="">全部类型</option>
              {Object.entries(projectTypes).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select
              disabled={dirty || creating || reading || c.pending || c.unknown}
              aria-label="项目排序"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
            >
              <option value="updated">最近更新</option>
              <option value="title">名称</option>
              <option value="status">状态</option>
            </select>
            <details
              className="project-display-menu"
              onToggle={(event) => {
                const menu = event.currentTarget;
                const panel = menu.querySelector<HTMLElement>('div');
                const trigger = menu.querySelector('summary');
                const center = workspace.current?.querySelector('.collection-main');
                if (!menu.open || !panel || !trigger || !center) return;
                // 工具栏换行后菜单可能贴近窗口底部，浮层仍须完整可达。
                panel.style.position = 'fixed';
                panel.style.right = 'auto';
                panel.style.maxHeight = `${Math.max(80, window.innerHeight - 16)}px`;
                const anchor = trigger.getBoundingClientRect();
                const bounds = center.getBoundingClientRect();
                const rect = panel.getBoundingClientRect();
                panel.style.left = `${Math.max(bounds.left + 8, Math.min(anchor.right - rect.width, bounds.right - rect.width - 8, window.innerWidth - rect.width - 8))}px`;
                panel.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - rect.height - 8))}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector('summary')?.focus();
                }
              }}
            >
              <summary>
                <Icon name="list" size={15} /> 显示
              </summary>
              <div>
                <label>
                  <input
                    type="checkbox"
                    checked={groupByStatus}
                    disabled={blocked}
                    onChange={(event) => setGroupByStatus(event.target.checked)}
                  />
                  按状态分组
                </label>
                <p>显示属性 · 本次会话</p>
                {Object.entries(projectListProperties).map(([id, label]) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={columns[id as keyof typeof columns]}
                      onChange={(e) => setColumns({ ...columns, [id]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </details>
          </div>
        )}
        {readError && <p role="alert">{readError}</p>}
        {sourceUnavailable && (
          <div role="alert">
            来源项目暂不可用；未选择其他项目。
            <button
              disabled={reading}
              onClick={() => {
                if (initialView?.projectId) void read(initialView.projectId, true);
              }}
            >
              重试来源项目
            </button>
            <button
              onClick={() => {
                restoring.current = null;
                setSourceUnavailable(false);
                setReadError('');
                setSelected(null);
              }}
            >
              返回项目列表
            </button>
          </div>
        )}
        {createdId && readError && (
          <div className="project-open-recovery">
            <p>项目已保存，暂时无法打开。请重试打开这个项目。</p>
            <button disabled={reading} onClick={() => void read(createdId)}>
              重新打开已创建项目
            </button>
          </div>
        )}
        {c.error && !creating && !propertyDirty && !bodyDirty && (
          <div role="alert" className="assistant-error">
            {c.error}
            {!c.unknown && (
              <button disabled={c.pending} onClick={() => void c.load()}>
                重新读取项目列表
              </button>
            )}
          </div>
        )}
        {c.unknown && !creating && !propertyDirty && !bodyDirty && (
          <button disabled={c.pending} onClick={() => void c.retry()}>
            核对原提交
          </button>
        )}
        <div className="collection-scroll" ref={scroll}>
          {sourceUnavailable || (reading && !editor) ? (
            <p role="status">正在核对来源项目；请稍候或返回列表。</p>
          ) : editor ? (
            <>
              <div
                className="project-section-tabs"
                role="tablist"
                aria-label="项目栏目"
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  const tabs = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]:not(:disabled)',
                    ),
                  );
                  const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
                  if (current < 0) return;
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
                          tabs.length;
                  tabs[next]?.focus();
                  tabs[next]?.click();
                }}
              >
                {Object.entries(sections).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    id={`project-tab-${id}`}
                    aria-controls={`project-panel-${id}`}
                    aria-selected={section === id}
                    tabIndex={section === id ? 0 : -1}
                    disabled={
                      reading ||
                      propertyDirty ||
                      discussionDirty ||
                      planningDirty ||
                      c.pending ||
                      c.unknown
                    }
                    onClick={() => setSection(id as keyof typeof sections)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {bodyDirty && section !== 'overview' && (
                <div className="project-draft-notice" role="status">
                  项目说明尚未保存，草稿仍保留。
                  <button type="button" onClick={() => setSection('overview')}>
                    返回概述保存
                  </button>
                </div>
              )}
              <div
                hidden={section !== 'overview'}
                role="tabpanel"
                id="project-panel-overview"
                aria-labelledby="project-tab-overview"
              >
                {section === 'overview' && (
                  <div className="project-overview-intro">
                    <span className="project-overview-icon">
                      <Icon name="folder" size={26} />
                    </span>
                    <h2>{(p ?? editor.project).title}</h2>
                    <div className="project-overview-meta" aria-label="项目概览属性">
                      <span
                        className={`project-status-label is-${projectStatus(p ?? editor.project)}`}
                      >
                        <i aria-hidden="true" />
                        {names[projectStatus(p ?? editor.project)]}
                      </span>
                      <PriorityGlyph priority={(p ?? editor.project).attributes?.priority ?? 0} />
                      {(p ?? editor.project).attributes?.assignee && (
                        <span>
                          <Icon name="person" size={15} />
                          {(p ?? editor.project).attributes?.assignee}
                        </span>
                      )}
                      {p?.health && (
                        <span className="project-health" data-health={p.health}>
                          {projectHealthNames[p.health]}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <ProjectEditor
                  key={editor.project.id + ':' + editor.epoch}
                  data={editor}
                  archived={!!p?.archived_at}
                  pending={
                    navigationPending ||
                    reading ||
                    c.pending ||
                    c.unknown ||
                    propertyDirty ||
                    planningDirty ||
                    discussionDirty
                  }
                  disabled={
                    navigationPending ||
                    reading ||
                    lifecycleDraft ||
                    bodyCommand ||
                    discussionDirty ||
                    planningDirty
                  }
                  unknown={c.unknown && bodyCommand}
                  error={bodyError}
                  onRetry={() => void c.retry().then(handleBodyResult)}
                  onDirty={setBodyDirty}
                  onReload={() => void read(editor.project.id)}
                  onSave={async (state, onCommitted) => {
                    if (!p) return;
                    setBodyCommand(true);
                    setBodyError('');
                    const result = await command(
                      catalogMutation({
                        operation: 'update_project' as const,
                        id: p.id,
                        title: p.title,
                        status: p.status,
                        expected_version: p.version,
                        expected_body_revision: editor.project.body_revision,
                        state,
                      }),
                      (r) => {
                        setBodyCommand(false);
                        const confirmed = acknowledge(r, p);
                        if (!confirmed) {
                          setBodyError('保存回执缺少说明版本，请重新读取项目。');
                          return;
                        }
                        setBodyError('');
                        setEditor({ ...editor, project: confirmed, state });
                        onCommitted();
                      },
                    );
                    handleBodyResult(result);
                  }}
                />
                {section === 'overview' && (
                  <ProjectSummary
                    project={p ?? editor.project}
                    tasks={tasks}
                    documents={c.data?.documents ?? []}
                    unavailable={!!c.error || !c.data}
                    disabled={navigationPending || reading || dirty || c.pending || c.unknown}
                    onOpen={openTask}
                    onProject={(id) => {
                      if (!blocked) void read(id);
                    }}
                  />
                )}
                {section === 'overview' && (
                  <div className="project-update-action">
                    <button
                      className="project-update-entry"
                      type="button"
                      disabled={blocked}
                      onClick={() => setSection('activity')}
                    >
                      <Icon name="plus" size={15} />
                      {p?.archived_at ? '查看项目更新' : '撰写项目更新'}
                    </button>
                  </div>
                )}
                {section === 'overview' && (
                  <ProjectDiscussion
                    key={`overview-discussion:${editor.project.id}`}
                    projectId={editor.project.id}
                    archived={!!p?.archived_at}
                    disabled={discussionDisabled || lifecycleDraft}
                    onDirty={setDiscussionDirty}
                  />
                )}
              </div>
              <section
                hidden={section !== 'tasks'}
                role="tabpanel"
                id="project-panel-tasks"
                aria-labelledby="project-tab-tasks"
                className="project-record-panel project-task-panel"
              >
                <div className="project-task-heading">
                  <h2>
                    项目任务 <small>{members.length}</small>
                  </h2>
                  {onNewTask && p && !p.archived_at && (
                    <button
                      className="work-list-create"
                      type="button"
                      disabled={blocked}
                      onClick={() => onNewTask(sourceView(''))}
                    >
                      <Icon name="plus" size={15} /> 新建任务
                    </button>
                  )}
                </div>
                {!!members.length && (
                  <div className="project-task-table-scroll">
                    <table className="catalog-table project-task-table" aria-label="项目任务列表">
                      <thead>
                        <tr>
                          {['优先级', '状态', '任务名称', '负责人', '截止日期', '操作'].map(
                            (label) => (
                              <th key={label} scope="col">
                                {label}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      {projectTaskStatuses.map((status) => {
                        const group = members.filter((task) => (task.status ?? 'todo') === status);
                        if (!group.length) return null;
                        const key = `${editor.project.id}:${status}`;
                        const expanded = !collapsedTaskGroups[key];
                        return (
                          <tbody key={status} aria-label={taskStatusNames[status]}>
                            <tr className="project-task-group">
                              <th scope="rowgroup" colSpan={6}>
                                <button
                                  type="button"
                                  aria-expanded={expanded}
                                  onClick={() =>
                                    setCollapsedTaskGroups((previous) => ({
                                      ...previous,
                                      [key]: expanded,
                                    }))
                                  }
                                >
                                  <Icon name="chevron" size={12} />
                                  <span aria-hidden="true">
                                    <StatusGlyph status={status} />
                                  </span>
                                  {taskStatusNames[status]} <small>{group.length}</small>
                                </button>
                              </th>
                            </tr>
                            {expanded &&
                              group.map((task) => (
                                <tr key={task.id} onClick={() => openTask(task.id)}>
                                  <td>
                                    <PriorityGlyph priority={task.priority ?? 0} />
                                  </td>
                                  <td>
                                    <StatusGlyph status={task.status ?? 'todo'} />
                                  </td>
                                  <td>
                                    <button
                                      className="project-title-link"
                                      disabled={blocked}
                                      data-project-task={task.id}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openTask(task.id);
                                      }}
                                    >
                                      {task.title}
                                    </button>
                                  </td>
                                  <td>
                                    {task.assignee === undefined
                                      ? '本人'
                                      : (task.assignee ?? '未分配')}
                                  </td>
                                  <td>
                                    {task.due_date && (
                                      <time dateTime={task.due_date}>{task.due_date}</time>
                                    )}
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      disabled={blocked || !!p?.archived_at}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void command(
                                          catalogMutation({
                                            operation: 'assign_task' as const,
                                            task_id: task.id,
                                            expected_version: task.version,
                                            matter_id: null,
                                          }),
                                        );
                                      }}
                                    >
                                      移出项目
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        );
                      })}
                    </table>
                  </div>
                )}
                {!p?.archived_at && (
                  <div className="project-task-assignment">
                    <label>
                      归入已有任务
                      <select
                        aria-label="归入已有任务"
                        value={assigning}
                        disabled={blocked}
                        onChange={(e) => setAssigning(e.target.value)}
                      >
                        <option value="">选择任务</option>
                        {tasks
                          .filter((t) => t.matter_id !== editor.project.id)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      disabled={!assigning || blocked}
                      onClick={() => {
                        const t = tasks.find((t) => t.id === assigning);
                        if (t)
                          void command(
                            catalogMutation({
                              operation: 'assign_task' as const,
                              task_id: t.id,
                              expected_version: t.version,
                              matter_id: editor.project.id,
                            }),
                            () => setAssigning(''),
                          );
                      }}
                    >
                      归入项目
                    </button>
                  </div>
                )}
                <p className="caption">归组保留任务、正文和历史身份。</p>
                {!members.length && (
                  <p>
                    {p?.task_count
                      ? '任务列表正在更新，请稍后重读。'
                      : '还没有任务。可在此新建任务或归入已有任务。'}
                  </p>
                )}
              </section>
              <section
                hidden={section !== 'files'}
                role="tabpanel"
                id="project-panel-files"
                aria-labelledby="project-tab-files"
                className="project-record-panel"
              >
                <h2>项目文件</h2>
                {section === 'files' && (
                  <>
                    <section
                      className="project-managed-files"
                      aria-labelledby="project-pdf-heading"
                    >
                      <h3 id="project-pdf-heading">受管 PDF / Word 原件</h3>
                      <ProjectFiles
                        key={editor.project.id}
                        projectId={editor.project.id}
                        disabled={blocked}
                      />
                    </section>
                    <section aria-labelledby="project-documents-heading">
                      <h3 id="project-documents-heading">可编辑文档</h3>
                      {documentLinks()}
                    </section>
                  </>
                )}
              </section>
              <section
                hidden={section !== 'visualization'}
                role="tabpanel"
                id="project-panel-visualization"
                aria-labelledby="project-tab-visualization"
                className="project-record-panel"
              >
                <h2>项目可视化</h2>
                {section === 'visualization' &&
                  (c.error ? (
                    <p role="status">暂时无法读取项目关系。</p>
                  ) : !documents ? (
                    <p role="status">正在读取项目关系…</p>
                  ) : (
                    <Suspense fallback={<p role="status">正在加载关系图…</p>}>
                      <ProjectRelationshipGraph
                        key={editor.project.id}
                        project={p ?? editor.project}
                        tasks={tasks}
                        documents={documents}
                        onOpen={openTask}
                      />
                    </Suspense>
                  ))}
              </section>
              <section
                hidden={section !== 'deliverables'}
                role="tabpanel"
                id="project-panel-deliverables"
                aria-labelledby="project-tab-deliverables"
                className="project-record-panel"
              >
                <h2>交付物</h2>
                {section === 'deliverables' && (
                  <ProjectDeliverables
                    documents={documents}
                    tasks={members}
                    readError={c.error}
                    disabled={blocked}
                    onOpen={openTask}
                  />
                )}
              </section>
              <section
                hidden={section !== 'activity'}
                role="tabpanel"
                id="project-panel-activity"
                aria-labelledby="project-tab-activity"
                className="project-record-panel project-activity-panel"
              >
                <h2 className="sr-only">活动</h2>
                {section === 'activity' && (
                  <>
                    <ProjectDiscussion
                      key={`activity-discussion:${editor.project.id}`}
                      projectId={editor.project.id}
                      activity
                      health={p?.health}
                      onPublished={() => void c.load()}
                      archived={!!p?.archived_at}
                      disabled={discussionDisabled || lifecycleDraft}
                      onDirty={setDiscussionDirty}
                    />
                    <h3>系统活动</h3>
                    <ActivityList
                      key={editor.project.id}
                      scope={{ type: 'project', id: editor.project.id }}
                      refresh={activityRevision}
                      disabled={blocked}
                      onTask={openTask}
                      onProject={openActivityProject}
                    />
                  </>
                )}
              </section>
            </>
          ) : (
            <>
              <ProjectList
                projects={visibleProjects}
                tasks={tasks}
                datesUnavailable={navigationPending || Boolean(c.error)}
                groupByStatus={groupByStatus}
                columns={columns}
                selectedId={p?.id}
                disabled={blocked}
                order={order}
                onOrder={setOrder}
                onSelect={(project) => {
                  setSelected(project.id);
                  if (!listInspectorOpen) void open(project);
                }}
                onOpen={(project) => {
                  setSelected(project.id);
                  void open(project);
                }}
                onPreview={(project) => {
                  setSelected(project.id);
                  setListInspectorOpen(true);
                }}
                onFinance={onFinance}
              />
              {!list.length && (
                <p className="catalog-empty">
                  {c.data
                    ? normalizedQuery || statusFilter !== 'all' || ownerFilter || typeFilter
                      ? '没有匹配的项目。'
                      : '暂无项目，独立任务仍可直接使用。'
                    : '正在读取本地项目…'}
                </p>
              )}
            </>
          )}
        </div>
        <footer className="collection-footer">
          {editor ? (
            '真实本地项目 · 仅此设备'
          ) : (
            <>
              <span>
                显示 {list.length ? page * pageSize + 1 : 0}–
                {Math.min((page + 1) * pageSize, list.length)} 条，共 {list.length} 条
              </span>
              <nav aria-label="项目分页">
                <button
                  type="button"
                  aria-label="项目上一页"
                  disabled={blocked || page === 0}
                  onClick={() => setPagination({ key: listKey, index: page - 1 })}
                >
                  ‹
                </button>
                <span>
                  {page + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  aria-label="项目下一页"
                  disabled={blocked || page + 1 >= pageCount}
                  onClick={() => setPagination({ key: listKey, index: page + 1 })}
                >
                  ›
                </button>
                <select
                  aria-label="每页项目数"
                  disabled={blocked}
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                >
                  {[8, 20, 50].map((size) => (
                    <option key={size} value={size}>
                      每页 {size} 条
                    </option>
                  ))}
                </select>
              </nav>
            </>
          )}
        </footer>
      </div>
      <aside className="project-properties" aria-label="项目辅助栏">
        {!sourceUnavailable ? (
          <InspectorLayout
            cards={cards}
            className="project-ai-content"
            blocked={blocked}
            expandedActions={
              !editor && (
                <details
                  className="project-ai-actions"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && event.currentTarget.open) {
                      event.preventDefault();
                      event.currentTarget.open = false;
                      event.currentTarget.querySelector('summary')?.focus();
                    }
                  }}
                >
                  <summary>
                    <Icon name="plus" size={14} /> 快速操作
                  </summary>
                  <div>
                    {p && <p>当前项目：{p.title}</p>}
                    <button type="button" disabled={blocked} onClick={() => setCreating(true)}>
                      <Icon name="folder" size={15} />
                      新建项目
                    </button>
                    {onNewTask && (
                      <button
                        type="button"
                        disabled={blocked}
                        onClick={() => onNewTask(sourceView(''))}
                      >
                        <Icon name="check" size={15} />
                        新建任务
                      </button>
                    )}
                    {onCalendar && (
                      <button type="button" disabled={blocked} onClick={onCalendar}>
                        <Icon name="calendar" size={15} />
                        查看日历
                      </button>
                    )}
                  </div>
                </details>
              )
            }
            properties={
              <>
                {!editor && (
                  <div className="project-dashboard-important" inert={blocked}>
                    {ImportantInfo ? (
                      <ImportantInfo title="重要事项" onOpen={openTask} onCalendar={onCalendar} />
                    ) : (
                      <p>重要事项暂不可用。</p>
                    )}
                  </div>
                )}
                {p && (editor || listInspectorOpen) && (
                  <div className="project-sidebar-properties">
                    <ProjectPropertyEditor
                      key={p.id}
                      project={p}
                      sidebar={!editor}
                      pending={c.pending}
                      disabled={
                        navigationPending ||
                        reading ||
                        creating ||
                        bodyCommand ||
                        discussionDirty ||
                        planningDirty ||
                        (!propertyDirty && (c.pending || c.unknown))
                      }
                      unknown={c.unknown && !bodyCommand}
                      bodyDirty={bodyDirty}
                      onDirty={(value, lifecycle = false) => {
                        setLifecycleDraft(value && lifecycle);
                        if (value) setSelected(p.id);
                        setPropertyDirty(value);
                      }}
                      onReload={c.load}
                      onRetry={c.retry}
                      onSave={(base, values, onCommitted) =>
                        command(
                          catalogMutation({
                            operation: 'update_project' as const,
                            id: base.id,
                            expected_version: base.version,
                            expected_body_revision: base.body_revision,
                            ...values,
                          }),
                          (r) => onCommitted(acknowledge(r, base)),
                        )
                      }
                      onArchive={(base, archived, onCommitted) =>
                        command(
                          catalogMutation({
                            operation: 'archive_project' as const,
                            id: base.id,
                            expected_version: base.version,
                            archived,
                          }),
                          (r) => {
                            const confirmed = acknowledge(r, base);
                            if (confirmed && !editor)
                              setStatusFilter(archived ? 'archived' : 'all');
                            onCommitted(confirmed);
                          },
                        )
                      }
                    />
                    {editor && (
                      <ProjectPlanning
                        key={p.id}
                        project={p}
                        tasks={members}
                        disabled={
                          navigationPending ||
                          reading ||
                          creating ||
                          bodyDirty ||
                          propertyDirty ||
                          discussionDirty
                        }
                        pending={c.pending || c.unknown}
                        onDirty={setPlanningDirty}
                        execute={command}
                      />
                    )}
                  </div>
                )}
              </>
            }
          >
            <SidebarAgent
              project={
                p ? { id: p.id, version: p.version, archived: Boolean(p.archived_at) } : undefined
              }
              unavailable="暂无可用项目，新建或选择项目后开始对话。"
              blocked={blocked}
            />
          </InspectorLayout>
        ) : (
          <div
            className="inspector-properties-scroll inspector-cards-fallback"
            tabIndex={0}
            aria-label="属性滚动区域"
          >
            <InspectorCards cards={cards} properties={<p>选择项目查看实际属性。</p>} />
          </div>
        )}
      </aside>
      {creating && (
        <ProjectCreateDialog
          pending={c.pending}
          unknown={c.unknown}
          error={c.error}
          onCancel={() => setCreating(false)}
          onRetry={() => void c.retry()}
          onCreate={(values) => {
            void command(
              catalogMutation({ operation: 'create_project' as const, ...values }),
              async (r) => {
                setCreating(false);
                setStatusFilter('all');
                setSelected(r.target_id);
                setEditor(null);
                if (r.target_id) {
                  setCreatedId(r.target_id);
                  await read(r.target_id);
                }
              },
            );
          }}
        />
      )}
    </section>
  );
}
