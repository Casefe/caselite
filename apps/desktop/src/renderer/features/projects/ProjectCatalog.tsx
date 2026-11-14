import SharedTaskTable from '../../ui/SharedTaskTable';
import type { TaskCompletionActions } from '../../ui/SharedTaskTable';
import WorkspacePageChrome, {
  closeWorkspaceDisplayOnEscape,
} from '../../shared/ui/WorkspacePageChrome';
import { InlinePropertiesSlot } from '../../ui/ResponsiveWorkspace';
import PropertyResizeHandle from '../../ui/PropertyResizeHandle';
import {
  useChildPage,
  usePageNavigation,
  useWorkspaceInspector,
} from '../../shared/navigation/PageNavigation';
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
  useId,
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
import ProjectDocuments from './ProjectDocuments';
import ActivityList from './ActivityList';
import ProjectDiscussion from './ProjectDiscussion';
import ProjectPlanning from './ProjectPlanning';
import ProjectVisualizationInspector from './ProjectVisualizationInspector';
import type { VisualizationInspection } from './project-visualization-model';
const ProjectVisualization = lazy(() => import('./ProjectVisualization'));
const names = { ...projectStatuses, archived: '已归档' };
const projectStatus = (project: Matter) => (project.archived_at ? 'archived' : project.status);
const projectTaskStatuses = ['in_progress', 'todo', 'done', 'canceled'] as const;
type CatalogSuccess = Extract<CatalogResponse, { ok: true }>;
const sections = {
  overview: '概述',
  activity: '活动',
  tasks: '任务',
  documents: '文档',
  visualization: '可视化',
};
export type ProjectViewState = {
  selected: string | null;
  projectId: string | null;
  section: keyof typeof sections | 'files' | 'deliverables';
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
  completion,
}: {
  tasks: Task[];
  completion?: TaskCompletionActions;
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
  const chromeFiltersId = useId();
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
  const [chromeFilterOpen, setChromeFilterOpen] = useState(false);
  const [chromeSearchOpen, setChromeSearchOpen] = useState(false);
  const [visualizationCollapsed, setVisualizationCollapsed] = useWorkspaceInspector(false, true);
  const [visualizationInspection, setVisualizationInspection] =
    useState<VisualizationInspection | null>(null);
  const [bodyError, setBodyError] = useState('');
  const [bodyCommand, setBodyCommand] = useState(false);
  const [lifecycleDraft, setLifecycleDraft] = useState(false);
  const [section, setSection] = useState<keyof typeof sections>(
    initialView?.section === 'files' || initialView?.section === 'deliverables'
      ? 'documents'
      : (initialView?.section ?? 'overview'),
  );
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
  const [initialDocumentPending, setInitialDocumentPending] = useState(
    Boolean(initialView?.documentId),
  );
  const [documentDirty, setDocumentDirty] = useState(false);
  const otherDirty = bodyDirty || propertyDirty || discussionDirty || planningDirty;
  const dirty = otherDirty || documentDirty;
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
    if (!restore) setInitialDocumentPending(false);
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
    const restoredSection =
      source.section === 'files' || source.section === 'deliverables'
        ? 'documents'
        : source.section;
    const target = Array.from(
      workspace.current?.querySelectorAll<HTMLButtonElement>(
        `#project-panel-${restoredSection} [data-project-task]`,
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
        ? workspace.current?.querySelector<HTMLButtonElement>(`#project-tab-${restoredSection}`)
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
  const pageNavigation = usePageNavigation();
  useChildPage(() => {
    const id = editor?.project.id ?? (sourceUnavailable ? initialView?.projectId : null);
    const title = editor
      ? (p ?? editor.project).title
      : sourceUnavailable
        ? ((initialView as ProjectViewState & { pageTitle?: string })?.pageTitle ?? '项目')
        : '项目';
    return {
      key: id ? `projects:${id}:${section}` : 'projects:list',
      title,
      icon: 'folder',
      state: { ...sourceView(''), projectId: id ?? null, pageTitle: title },
    };
  }, !reading && !navigationPending);
  function changeSection(next: keyof typeof sections) {
    if (section === 'documents' && next !== 'documents') setInitialDocumentPending(false);
    pageNavigation?.beforeChange();
    setSection(next);
  }
  const openTask = (id: string, documentId?: string) => {
    if (!blocked) onOpen(id, sourceView(id, documentId));
  };
  const open = async (project: Matter) => {
    if (!dirty && !creating && !reading && !c.pending && !c.unknown) {
      pageNavigation?.beforeChange();
      await read(project.id);
    }
  };
  const blocked =
    navigationPending ||
    reading ||
    dirty ||
    creating ||
    c.pending ||
    c.unknown ||
    Boolean(completion?.blocked);
  const openActivityProject = (id: string) => {
    if (!blocked) {
      pageNavigation?.beforeChange();
      void read(id);
    }
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
        setInitialDocumentPending(false);
        pageNavigation?.beforeChange();
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
  const toggleVisualizationSidebar = (collapsed = !visualizationCollapsed) => {
    setVisualizationCollapsed(collapsed);
    requestAnimationFrame(() =>
      workspace.current
        ?.querySelector<HTMLButtonElement>(
          '.visualization-actions [aria-controls="project-visualization-auxiliary"]',
        )
        ?.focus({ preventScroll: true }),
    );
  };
  const chromeDisplay = (
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
      onKeyDown={closeWorkspaceDisplayOnEscape}
    >
      <summary>
        <Icon name="settings" size={16} /> 显示设置
      </summary>
      <div>
        <button
          type="button"
          aria-label="项目预览"
          aria-expanded={listInspectorOpen}
          disabled={blocked}
          onClick={() => {
            if (!listInspectorOpen) pageNavigation?.inspector.setOpen(true);
            setListInspectorOpen((open) => !open);
          }}
        >
          项目预览
        </button>
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
  );
  return (
    <section
      ref={workspace}
      inert={navigationPending}
      aria-busy={navigationPending}
      className={`collection-workspace catalog-view project-catalog property-resizable${editor ? '' : ' workspace-has-page-chrome'}`}
      data-properties-resizable="true"
      data-project-view={editor ? section : 'list'}
      data-visualization-collapsed={Boolean(
        editor && section === 'visualization' && visualizationCollapsed,
      )}
      data-layout="three-column"
      data-testid="project-catalog"
    >
      {section !== 'documents' && <PropertyResizeHandle module="projects" />}
      {!editor && (
        <WorkspacePageChrome
          title="项目"
          createLabel="新建项目"
          create={{ onClick: () => setCreating(true), disabled: blocked }}
          navigation={(
            [
              ['all', '全部项目'],
              ['active', '进行中'],
              ['planned', '待启动'],
              ['done', '已结项'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={blocked}
              aria-pressed={statusFilter === value}
              onClick={() => {
                setSelected(null);
                setStatusFilter(value === statusFilter ? 'all' : value);
              }}
            >
              {label}
            </button>
          ))}
          search={{
            expanded: chromeSearchOpen,
            controls: chromeFiltersId,
            disabled: blocked,
            onClick: () => {
              setChromeFilterOpen(false);
              setChromeSearchOpen((open) => !open);
            },
          }}
          filter={{
            expanded: chromeFilterOpen,
            controls: chromeFiltersId,
            disabled: blocked,
            onClick: () => {
              setChromeSearchOpen(false);
              setChromeFilterOpen((open) => !open);
            },
          }}
          display={chromeDisplay}
          inspector={
            pageNavigation
              ? {
                  expanded: pageNavigation.inspector.open,
                  disabled: blocked,
                  onClick: () => pageNavigation.inspector.setOpen((open) => !open),
                }
              : undefined
          }
        />
      )}
      <div className="collection-main">
        {backSlot && createPortal(backButton, backSlot)}
        {editor && (
          <div className="collection-heading project-catalog-heading">
            {!backSlot && backButton}
            <Icon name="folder" size={16} />
            <h1>{(p ?? editor.project).title}</h1>
            {favoriteAction?.(p ?? editor.project, blocked || !!(p ?? editor.project).archived_at)}
            <button
              className="work-list-create"
              disabled={blocked}
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" size={15} /> 创建项目
            </button>
          </div>
        )}
        <InlinePropertiesSlot />
        {!editor && <h2 className="project-dashboard-list-title">项目列表</h2>}
        {!editor && (
          <div
            className="project-list-controls"
            id={chromeFiltersId}
            aria-label="项目列表选项"
            hidden={!chromeSearchOpen && !chromeFilterOpen}
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
            <button
              type="button"
              disabled={blocked || !(query || statusFilter !== 'all' || ownerFilter || typeFilter)}
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
                      documentDirty ||
                      c.pending ||
                      c.unknown
                    }
                    onClick={() => changeSection(id as keyof typeof sections)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {bodyDirty && section !== 'overview' && (
                <div className="project-draft-notice" role="status">
                  项目说明尚未保存，草稿仍保留。
                  <button type="button" onClick={() => changeSection('overview')}>
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
                      onClick={() => changeSection('activity')}
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
                    {projectTaskStatuses.map((status) => {
                      const group = members.filter((task) => (task.status ?? 'todo') === status);
                      if (!group.length) return null;
                      const key = `${editor.project.id}:${status}`;
                      const expanded = !collapsedTaskGroups[key];
                      return (
                        <section key={status} aria-label={taskStatusNames[status]}>
                          <button
                            type="button"
                            aria-expanded={expanded}
                            disabled={blocked}
                            onClick={() =>
                              setCollapsedTaskGroups((previous) => ({
                                ...previous,
                                [key]: expanded,
                              }))
                            }
                          >
                            <Icon name="chevron" size={12} />
                            <StatusGlyph status={status} />
                            {taskStatusNames[status]} <small>{group.length}</small>
                          </button>
                          {expanded && (
                            <SharedTaskTable
                              tasks={group}
                              titleData={(task) => ({ 'data-project-task': task.id })}
                              onOpen={openTask}
                              disabled={blocked}
                              busyIds={completion?.busyIds}
                              onComplete={p?.archived_at ? undefined : completion?.complete}
                              hiddenColumns={['project']}
                              rowActions={(task) => (
                                <button
                                  type="button"
                                  disabled={blocked || !!p?.archived_at}
                                  onClick={() =>
                                    void command(
                                      catalogMutation({
                                        operation: 'assign_task' as const,
                                        task_id: task.id,
                                        expected_version: task.version,
                                        matter_id: null,
                                      }),
                                    )
                                  }
                                >
                                  移出项目
                                </button>
                              )}
                            />
                          )}
                        </section>
                      );
                    })}
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
                hidden={section !== 'documents'}
                role="tabpanel"
                id="project-panel-documents"
                aria-labelledby="project-tab-documents"
                className="project-document-panel"
              >
                {section === 'documents' && (
                  <ProjectDocuments
                    key={editor.project.id}
                    projectId={editor.project.id}
                    initialDocumentId={
                      initialDocumentPending && initialView?.projectId === editor.project.id
                        ? initialView.documentId
                        : undefined
                    }
                    externalBlocked={
                      navigationPending ||
                      reading ||
                      creating ||
                      otherDirty ||
                      c.pending ||
                      c.unknown
                    }
                    onDirty={setDocumentDirty}
                  />
                )}
              </section>
              <section
                hidden={section !== 'visualization'}
                role="tabpanel"
                id="project-panel-visualization"
                aria-labelledby="project-tab-visualization"
                className="project-record-panel project-visualization-panel"
              >
                {section === 'visualization' && (
                  <Suspense fallback={<p role="status">正在加载可视化画布…</p>}>
                    <ProjectVisualization
                      key={editor.project.id}
                      project={p ?? editor.project}
                      tasks={tasks}
                      documents={documents ?? null}
                      readError={Boolean(c.error)}
                      onOpen={openTask}
                      onInspect={setVisualizationInspection}
                      sidebarCollapsed={visualizationCollapsed}
                      onToggleSidebar={() => toggleVisualizationSidebar()}
                    />
                  </Suspense>
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
      <aside
        hidden={Boolean(editor && section === 'documents')}
        id="project-visualization-auxiliary"
        className="project-properties"
        aria-label="项目辅助栏"
        data-visualization-hidden={Boolean(
          editor && section === 'visualization' && visualizationCollapsed,
        )}
        inert={Boolean(editor && section === 'visualization' && visualizationCollapsed)}
        aria-hidden={Boolean(editor && section === 'visualization' && visualizationCollapsed)}
      >
        {editor && section === 'visualization' && (
          <header className="visualization-sidebar-heading">
            <strong>辅助栏</strong>
            <button
              type="button"
              aria-label="收起可视化辅助栏"
              title="收起辅助栏，扩大画布"
              onClick={() => toggleVisualizationSidebar(true)}
            >
              <Icon name="chevron" size={18} />
            </button>
          </header>
        )}
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
                {editor && section === 'visualization' && (
                  <ProjectVisualizationInspector
                    inspection={visualizationInspection}
                    projectId={(p ?? editor.project).id}
                    projectTitle={(p ?? editor.project).title}
                    onOpen={openTask}
                  />
                )}
                <div hidden={Boolean(editor && section === 'visualization')}>
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
                </div>
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
