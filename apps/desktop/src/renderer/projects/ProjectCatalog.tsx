import { catalogMutation } from '../shared/data/catalogMutation';
import { Icon } from '../shared/ui/Icon';
import { formatCents } from '../finance/money';
import { createPortal } from 'react-dom';
import { projectStatuses } from './project-display';
import ProjectPropertyEditor from './ProjectPropertyEditor';
import { useCallback, useEffect, useLayoutEffect, useState, useRef } from 'react';
import type { Matter, Task, CatalogRequest, CatalogResponse } from '../../preload/caselite-api';
import ProjectEditor from './ProjectEditor';

import SidebarAgent from '../ui/SidebarAgent';
import { useCatalog } from '../ui/useCatalog';
import ProjectCreateDialog from './ProjectCreateDialog';
import ProjectSummary from './ProjectSummary';
import ProjectFiles from './ProjectFiles';
import ActivityList from './ActivityList';
import ProjectDiscussion from './ProjectDiscussion';
const names = { ...projectStatuses, archived: '已归档' };
const projectStatus = (project: Matter) => (project.archived_at ? 'archived' : project.status);
type CatalogSuccess = Extract<CatalogResponse, { ok: true }>;
const sections = {
  overview: '概述',
  tasks: '任务',
  files: '文件',
  visualization: '可视化',
  deliverables: '交付物',
  activity: '活动',
};
export type ProjectViewState = {
  selected: string | null;
  projectId: string | null;
  section: keyof typeof sections;
  query: string;
  statusFilter: keyof typeof names | 'all';
  order: string;
  columns: { status: boolean; tasks: boolean; updated: boolean };
  scrollTop: number;
  workspaceScrollTop: number;
  returnTaskId: string;
  documentId?: string;
};
export default function ProjectCatalog({
  tasks,
  onOpen,
  onNewTask,
  onFinance,
  onDirty,
  onChanged,
  initialView,
  backSlot,
  navigationPending = false,
}: {
  tasks: Task[];
  onOpen(id: string, source: ProjectViewState): void;
  onFinance?(projectId: string): void;
  onNewTask?(source: ProjectViewState): void;
  initialView?: ProjectViewState | null;
  backSlot?: HTMLDivElement | null;
  navigationPending?: boolean;
  onDirty(v: boolean): void;
  onChanged(): void | Promise<boolean>;
}) {
  const c = useCatalog(true),
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
  const [bodyError, setBodyError] = useState('');
  const [bodyCommand, setBodyCommand] = useState(false);
  const [lifecycleDraft, setLifecycleDraft] = useState(false);
  const [section, setSection] = useState<keyof typeof sections>(initialView?.section ?? 'overview');
  const [query, setQuery] = useState(initialView?.query ?? '');
  const [statusFilter, setStatusFilter] = useState<keyof typeof names | 'all'>(
    initialView?.statusFilter ?? 'all',
  );
  const [order, setOrder] = useState(initialView?.order ?? 'updated');
  const [columns, setColumns] = useState(
    initialView?.columns ?? { status: true, tasks: true, updated: true },
  );
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
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const [discussionDirty, setDiscussionDirty] = useState(false);
  const dirty = bodyDirty || propertyDirty || discussionDirty;
  const discussionDisabled =
    navigationPending || reading || bodyDirty || propertyDirty || c.pending || c.unknown;
  const projects = Object.values({
    ...acknowledged,
    ...Object.fromEntries(
      (c.data?.projects ?? []).map((project) => {
        const confirmed = acknowledged[project.id];
        return [project.id, confirmed && confirmed.version > project.version ? confirmed : project];
      }),
    ),
  });
  const list = projects
    .filter(
      (p) =>
        (statusFilter === 'all' ? !p.archived_at : projectStatus(p) === statusFilter) &&
        p.title.toLocaleLowerCase().includes(normalizedQuery),
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
  const p = editor
    ? (projects.find((x) => x.id === editor.project.id && x.version >= editor.project.version) ??
      editor.project)
    : initialView?.projectId && (reading || sourceUnavailable)
      ? undefined
      : (list.find((x) => x.id === selected) ??
        (propertyDirty ? projects.find((x) => x.id === selected) : undefined) ??
        list[0]);
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
    if (!source || reading || (source.projectId ? !editor : !c.data)) return;
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
  }, [reading, editor, c.data, c.error, tasks]);
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
    order,
    columns,
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
  const documentLinks = (draftsOnly: boolean) => {
    if (c.error) return <p role="status">暂时无法读取项目文档。</p>;
    if (!documents) return <p role="status">正在读取项目文档…</p>;
    const rows = draftsOnly ? documents.filter((doc) => doc.body_revision > 0) : documents;
    if (!rows.length)
      return <p>{draftsOnly ? '还没有已保存的交付草稿。' : '还没有可编辑文档。'}</p>;
    return (
      <ul className="project-document-list">
        {rows.map((doc) => (
          <li key={doc.id}>
            <button
              disabled={blocked}
              data-project-task={doc.task_id}
              data-project-document={doc.id}
              onClick={() => openTask(doc.task_id, doc.id)}
            >
              {doc.title}
            </button>
            {draftsOnly && <span>已保存 · 修订 {doc.body_revision}</span>}
          </li>
        ))}
      </ul>
    );
  };
  const command = (input: CatalogRequest, done?: (r: CatalogSuccess) => void | Promise<void>) =>
    c.execute(input, async (r) => {
      const refreshed = onChanged();
      await done?.(r);
      if (input.operation === 'assign_task') await refreshed;
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
  return (
    <section
      ref={workspace}
      inert={navigationPending}
      aria-busy={navigationPending}
      className="collection-workspace catalog-view project-catalog"
      data-layout="three-column"
      data-testid="project-catalog"
    >
      <div className="collection-main">
        {backSlot && createPortal(backButton, backSlot)}
        <div className="collection-heading project-catalog-heading">
          {!backSlot && backButton}
          {!editor && <Icon name="folder" size={18} />}
          <h1>{editor ? (p ?? editor.project).title : '项目'}</h1>
          {!editor && <span>{list.length}</span>}
          <button className="primary" disabled={blocked} onClick={() => setCreating(true)}>
            创建项目
          </button>
        </div>
        {!editor && (
          <div className="project-list-controls" aria-label="项目列表选项">
            <label className="project-list-search">
              <Icon name="search" size={15} />
              <input
                disabled={dirty || creating || reading || c.pending || c.unknown}
                aria-label="搜索项目"
                placeholder="搜索项目…"
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
                <p>显示属性 · 本次会话</p>
                {Object.entries({ status: '状态', tasks: '任务', updated: '更新时间' }).map(
                  ([id, label]) => (
                    <label key={id}>
                      <input
                        type="checkbox"
                        checked={columns[id as keyof typeof columns]}
                        onChange={(e) => setColumns({ ...columns, [id]: e.target.checked })}
                      />
                      {label}
                    </label>
                  ),
                )}
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
              <div className="project-section-tabs" role="tablist" aria-label="项目栏目">
                {Object.entries(sections).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    id={`project-tab-${id}`}
                    aria-controls={`project-panel-${id}`}
                    aria-selected={section === id}
                    disabled={reading || dirty || c.pending || c.unknown}
                    onClick={() => setSection(id as keyof typeof sections)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div
                hidden={section !== 'overview'}
                role="tabpanel"
                id="project-panel-overview"
                aria-labelledby="project-tab-overview"
              >
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
                    discussionDirty
                  }
                  disabled={
                    navigationPending || reading || lifecycleDraft || bodyCommand || discussionDirty
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
                className="project-record-panel"
              >
                <h2>项目任务</h2>
                {onNewTask && p && !p.archived_at && (
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => onNewTask(sourceView(''))}
                  >
                    新建任务
                  </button>
                )}
                {tasks
                  .filter((t) => t.matter_id === editor.project.id)
                  .map((t) => (
                    <div key={t.id}>
                      <button
                        disabled={blocked}
                        data-project-task={t.id}
                        onClick={() => openTask(t.id)}
                      >
                        {t.title}
                      </button>
                      <button
                        disabled={blocked || !!p?.archived_at}
                        onClick={() =>
                          void command(
                            catalogMutation({
                              operation: 'assign_task' as const,
                              task_id: t.id,
                              expected_version: t.version,
                              matter_id: null,
                            }),
                          )
                        }
                      >
                        移出项目
                      </button>
                    </div>
                  ))}
                {!p?.archived_at && (
                  <>
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
                  </>
                )}
                <p className="caption">归组保留任务、正文和历史身份。</p>
                {!tasks.some((task) => task.matter_id === editor.project.id) && (
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
                    <section aria-labelledby="project-pdf-heading">
                      <h3 id="project-pdf-heading">受管 PDF 原件</h3>
                      <ProjectFiles
                        key={editor.project.id}
                        projectId={editor.project.id}
                        disabled={blocked}
                      />
                    </section>
                    <section aria-labelledby="project-documents-heading">
                      <h3 id="project-documents-heading">可编辑文档</h3>
                      {documentLinks(false)}
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
                <p>这里还没有可视化内容。</p>
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
                  <>
                    <h3>交付草稿</h3>
                    {documentLinks(true)}
                    <p>草稿沿用任务成果正文。正式交付视图尚未接入。</p>
                  </>
                )}
              </section>
              <section
                hidden={section !== 'activity'}
                role="tabpanel"
                id="project-panel-activity"
                aria-labelledby="project-tab-activity"
                className="project-record-panel"
              >
                <h2>活动</h2>
                {section === 'activity' && (
                  <>
                    <h3>系统活动</h3>
                    <ActivityList
                      key={editor.project.id}
                      scope={{ type: 'project', id: editor.project.id }}
                      refresh={activityRevision}
                      disabled={blocked}
                      onTask={openTask}
                      onProject={openActivityProject}
                    />
                    <ProjectDiscussion
                      key={`activity-discussion:${editor.project.id}`}
                      projectId={editor.project.id}
                      activity
                      archived={!!p?.archived_at}
                      disabled={discussionDisabled || lifecycleDraft}
                      onDirty={setDiscussionDirty}
                    />
                  </>
                )}
              </section>
            </>
          ) : (
            <>
              <table className="catalog-table project-list-table" aria-label="项目列表">
                <thead>
                  <tr>
                    <th>项目名称</th>
                    {columns.status && <th>状态</th>}
                    {columns.tasks && <th>任务</th>}
                    <th>待收款（元）</th>
                    {columns.updated && <th>更新时间</th>}
                  </tr>
                </thead>
                <tbody>
                  {list.map((m) => (
                    <tr
                      key={m.id}
                      data-project-id={m.id}
                      aria-selected={p?.id === m.id}
                      onClick={() => {
                        if (!reading && !creating && !dirty && !c.pending && !c.unknown)
                          setSelected(m.id);
                      }}
                      onDoubleClick={() => void open(m)}
                    >
                      <td>
                        <button
                          className="project-title-link"
                          title={m.title}
                          disabled={reading || creating || dirty || c.pending || c.unknown}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(m.id);
                            void open(m);
                          }}
                        >
                          <Icon name="folder" size={14} /> <span>{m.title}</span>
                        </button>
                      </td>
                      {columns.status && (
                        <td>
                          <span className={`project-status-label is-${projectStatus(m)}`}>
                            <i />
                            {names[projectStatus(m)]}
                          </span>
                        </td>
                      )}
                      {columns.tasks && <td className="project-list-count">{m.task_count}</td>}
                      <td>
                        {onFinance ? (
                          <button
                            type="button"
                            className="project-title-link"
                            aria-label={`查看 ${m.title} 的待收款 ${formatCents(m.outstanding_cents)} 元`}
                            disabled={reading || creating || dirty || c.pending || c.unknown}
                            onClick={(event) => {
                              event.stopPropagation();
                              onFinance(m.id);
                            }}
                            onDoubleClick={(event) => event.stopPropagation()}
                          >
                            {formatCents(m.outstanding_cents)}
                          </button>
                        ) : (
                          formatCents(m.outstanding_cents)
                        )}
                      </td>
                      {columns.updated && (
                        <td>
                          <time dateTime={m.updated_at}>
                            {new Date(m.updated_at).toLocaleDateString()}
                          </time>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!list.length && (
                <p className="catalog-empty">
                  {c.data
                    ? normalizedQuery || statusFilter !== 'all'
                      ? '没有匹配的项目。'
                      : '暂无项目，独立任务仍可直接使用。'
                    : '正在读取本地项目…'}
                  {(normalizedQuery || statusFilter !== 'all') && (
                    <button
                      disabled={dirty || creating || reading || c.pending || c.unknown}
                      onClick={() => {
                        setQuery('');
                        setStatusFilter('all');
                      }}
                    >
                      清除筛选
                    </button>
                  )}
                </p>
              )}
            </>
          )}
        </div>
        <footer className="collection-footer">真实本地项目 · 仅此设备</footer>
      </div>
      <aside className="project-properties" aria-label="项目辅助栏">
        {p && !sourceUnavailable ? (
          <>
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
                    if (confirmed && !editor) setStatusFilter(archived ? 'archived' : 'all');
                    onCommitted(confirmed);
                  },
                )
              }
            />
            <section className="project-inspector-section project-ai-content" aria-label="AI 对话">
              <h3>AI 对话</h3>
              <SidebarAgent
                project={{ id: p.id, version: p.version, archived: Boolean(p.archived_at) }}
                blocked={blocked}
              />
            </section>
          </>
        ) : (
          <p>选择项目查看实际属性。</p>
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
