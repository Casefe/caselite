import TaskTags from './ui/TaskTags';
import ReminderEditor from './ui/ReminderEditor';
import ReminderInbox from './ui/ReminderInbox';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '@tiptap/react';
import * as Y from 'yjs';
import type { Matter, Task, TaskRequest, TaskResponse } from '../preload/caselite-api';
import EngineeringApp from './EngineeringApp';
import { WorkspaceShell, Icon, type WorkspaceView } from './ui/Workspace';
import ProjectCatalog, { type ProjectViewState } from './projects/ProjectCatalog';
import DocumentLibrary from './ui/DocumentLibrary';
import TaskInspector from './ui/TaskInspector';
import { taskStatusNames } from './ui/task-status';
import { taskPriorityNames } from './ui/task-priority';

import SettingsView, { ModelSettingsNavigation, type SettingsSection } from './ui/SettingsView';
import { AppearanceProvider } from './ui/Appearance';
import RecordList, { initialTaskListState } from './ui/RecordList';
import AgentHome from './ui/AgentHome';
import AgentHistory from './ui/AgentHistory';
import {
  DraftEditor,
  EditorSurface,
  emptyDraft,
  localExtensions,
  type RichDraft,
} from './editors/RichEditor';
import ActivityList from './projects/ActivityList';
import { DiscussionFeed } from './projects/ProjectDiscussion';
import TaskContentEditor from './editors/TaskContentEditor';
import DocumentReview from './review/DocumentReview';

const mutation = () => ({
  protocol_version: 1 as const,
  request_id: crypto.randomUUID(),
  idempotency_key: crypto.randomUUID(),
});
type CreateTaskCommand = Extract<TaskRequest, { operation: 'create' }>;
const defaultCreateProperties = {
  status: 'todo' as Task['status'],
  priority: 0,
  due_date: '',
  tags: [] as string[],
  matter_id: '',
};
function check(result: TaskResponse) {
  if (!result.ok) throw new Error(result.message);
  return result;
}

function BodyEditor({
  task,
  initial,
  onSaved,
  onDirty,
  disabled = false,
  reviewDock,
  reviewSaving,
  onReviewSaving,
}: {
  task: Task;
  initial: number[] | null;
  onSaved(task: Task, state: number[]): void;
  onDirty(dirty: boolean): void;
  disabled?: boolean;
  reviewDock: HTMLElement | null;
  reviewSaving: boolean;
  onReviewSaving(value: boolean): void;
}) {
  const [doc] = useState(() => {
    const d = new Y.Doc();
    if (initial) Y.applyUpdate(d, Uint8Array.from(initial));
    return d;
  });
  const [revision, setRevision] = useState(task.body_revision);
  const [status, setStatus] = useState('已保存到此设备');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const changes = useRef(0);
  const reviewHydrating = useRef(false);
  const editorReady = useRef(false);
  const pending = useRef<{ request: TaskRequest; sequence: number } | null>(null);
  const alive = useRef(true);
  const editor = useEditor(
    {
      injectCSS: false,
      editable: !task.document_archived_at && !disabled,
      extensions: localExtensions(doc),
      editorProps: {
        attributes: { 'aria-label': '成果正文', 'data-testid': 'body-editor', role: 'textbox' },
      },
      onCreate: () => {
        editorReady.current = true;
      },
      onUpdate: () => {
        if (!editorReady.current || reviewHydrating.current) return;
        changes.current++;
        setDirty(true);
        onDirty(true);
        setStatus('有未保存修改');
      },
    },
    [doc],
  );
  useEffect(() => {
    // 只切换可编辑性，不发出正文update，避免把属性锁定误记成正文修改。
    editor?.setEditable(!task.document_archived_at && !disabled && !reviewSaving, false);
  }, [editor, task.document_archived_at, disabled, reviewSaving]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queueMicrotask(() => {
        if (!alive.current) doc.destroy();
      });
    };
  }, [doc]);
  async function save() {
    if (!editor || busy || disabled || reviewSaving) return;
    setBusy(true);
    setStatus('正在保存…');
    const sequence = pending.current?.sequence ?? changes.current;
    const request: TaskRequest = pending.current?.request ?? {
      ...mutation(),
      operation: 'save',
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: revision,
      editor_schema: 1,
      state: Array.from(Y.encodeStateAsUpdate(doc)),
    };
    pending.current = { request, sequence };
    setHasPending(true);
    try {
      let result = await window.caselite.task(request);
      if (!result.ok && result.code === 'RESULT_UNKNOWN') {
        result = await window.caselite.task({
          protocol_version: 1,
          operation: 'status',
          idempotency_key: 'idempotency_key' in request ? request.idempotency_key : '',
        });
        if (!result.ok) throw new Error('保存结果尚未确认，请保留输入并点击核对保存结果。');
      }
      const saved = check(result).tasks[0];
      if (!alive.current) return;
      pending.current = null;
      setHasPending(false);
      setRevision(saved.body_revision);
      onSaved(saved, request.operation === 'save' ? request.state : []);
      const unchanged = sequence === changes.current;
      setDirty(!unchanged);
      onDirty(!unchanged);
      setStatus(unchanged ? '已保存到此设备' : '较早修订已保存，仍有未保存修改');
    } catch (error) {
      if (alive.current)
        setStatus(error instanceof Error ? error.message : '保存失败，输入已保留。');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="document">
      <div className="document-bar">
        <span>
          <Icon name="file" size={16} /> 内部沟通初稿 <small className="draft-badge">草稿</small>
        </span>
        <span>
          修订 <b data-testid="revision">{revision}</b>
        </span>
      </div>
      <EditorSurface editor={editor} mode="simple" />
      <footer>
        <span role="status" data-testid="save-status">
          {task.document_archived_at ? '文档已归档 · 只读' : status}
        </span>
        <button
          className="primary"
          data-testid="save-body"
          disabled={
            disabled ||
            reviewSaving ||
            !!task.document_archived_at ||
            busy ||
            (!dirty && !hasPending)
          }
          onClick={() => void save()}
        >
          {busy ? '保存中…' : hasPending ? '核对并保存' : '保存正文'}
        </button>
      </footer>
      <p className="caption">仅已确认保存的内容可在退出后恢复。当前成果尚未进行法律核验。</p>
      {reviewDock &&
        createPortal(
          <DocumentReview
            key={task.document_id}
            editor={editor}
            identity={{
              task_id: task.id,
              document_id: task.document_id,
              body_id: task.body_id,
              revision,
            }}
            blocked={disabled || !!task.document_archived_at || dirty || busy || hasPending}
            onApplyBusy={onReviewSaving}
            onSaved={({ task: saved, state }) => {
              reviewHydrating.current = true;
              try {
                Y.applyUpdate(doc, Uint8Array.from(state));
              } finally {
                reviewHydrating.current = false;
              }
              setRevision(saved.body_revision);
              setStatus('已保存到此设备');
              onSaved(saved, state);
            }}
          />,
          reviewDock,
        )}
    </section>
  );
}
function Workbench() {
  const [settingsReturn, setSettingsReturn] = useState<WorkspaceView>('home');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('系统设置');
  const [projectBackSlot, setProjectBackSlot] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<WorkspaceView>('home');
  const [collapsed, setCollapsed] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [agentPrompt, setAgentPrompt] = useState<RichDraft>(emptyDraft);
  const [projectView, setProjectView] = useState<ProjectViewState | null>(null);
  const [taskReturn, setTaskReturn] = useState<{ taskId: string; source: ProjectViewState } | null>(
    null,
  );
  const [taskListState, setTaskListState] = useState(initialTaskListState);
  const [reviewDocument, setReviewDocument] = useState<string | null>(null);
  const [reviewDock, setReviewDock] = useState<HTMLElement | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [detailTab, setDetailTab] = useState('内容');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [active, setActive] = useState<Task | null>(null);
  const [state, setState] = useState<number[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [createProperties, setCreateProperties] = useState(defaultCreateProperties);
  const [createTagDraft, setCreateTagDraft] = useState(false);
  const [createSource, setCreateSource] = useState<ProjectViewState | null>(null);
  const [projectOptions, setProjectOptions] = useState<Matter[]>([]);
  const [projectOptionsState, setProjectOptionsState] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );
  const [projectOptionsAttempt, setProjectOptionsAttempt] = useState(0);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState<RichDraft>(emptyDraft);
  const [objectiveState, setObjectiveState] = useState<number[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [propertiesBlocked, setPropertiesBlocked] = useState(false);
  const [reminderBlocked, setReminderBlocked] = useState(false);
  const [reminderTask, setReminderTask] = useState<string | null>(null);
  const [commentDirty, setCommentDirty] = useState(false);
  const [projectDirty, setProjectDirty] = useState(false);
  const [propertiesRead, setPropertiesRead] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const readSequence = useRef(0);
  const composing = useRef(false);
  const createRequest = useRef<CreateTaskCommand | null>(null);
  const listReadSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++listReadSequence.current;
    const r = check(await window.caselite.task({ operation: 'list', protocol_version: 1 }));
    if (sequence !== listReadSequence.current) return false;
    setTasks(r.tasks);
    return true;
  }, []);
  useEffect(() => {
    void refresh()
      .catch(() => setError('任务列表读取失败，请重试；原数据没有被修改。'))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    const refreshMaterials = () => {
      void refresh().catch(() => setError('材料已保存，任务列表刷新失败。'));
    };
    window.addEventListener('caselite:material-task-saved', refreshMaterials);
    return () => window.removeEventListener('caselite:material-task-saved', refreshMaterials);
  }, [refresh]);
  useEffect(() => {
    if (!creating) return;
    let current = true;
    void (async () => {
      try {
        const result = await window.caselite.catalog({ operation: 'list', protocol_version: 1 });
        if (!result.ok) throw new Error(result.message);
        if (!current) return;
        setProjectOptions(result.projects.filter((project) => !project.archived_at));
        setProjectOptionsState('ready');
      } catch {
        if (current) setProjectOptionsState('failed');
      }
    })();
    return () => {
      current = false;
    };
  }, [creating, projectOptionsAttempt]);
  const tagSuggestions = [...new Set(tasks.flatMap((task) => task.tags ?? []))];
  const createDirty =
    creating &&
    Boolean(
      title.trim() ||
      objective.state ||
      createProperties.status !== defaultCreateProperties.status ||
      createProperties.priority ||
      createProperties.due_date ||
      createProperties.tags.length ||
      createTagDraft ||
      createProperties.matter_id !== (createSource?.projectId ?? ''),
    );
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (
        dirty ||
        commentDirty ||
        projectDirty ||
        propertiesBlocked ||
        reminderBlocked ||
        busy ||
        uncertain ||
        reviewSaving ||
        agentPrompt.text.trim() ||
        createDirty
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [
    dirty,
    commentDirty,
    projectDirty,
    propertiesBlocked,
    reminderBlocked,
    busy,
    uncertain,
    createDirty,
    agentPrompt,
    reviewSaving,
  ]);
  function canLeave() {
    if (
      reviewSaving ||
      dirty ||
      commentDirty ||
      projectDirty ||
      propertiesBlocked ||
      reminderBlocked ||
      busy ||
      uncertain
    ) {
      setError('请先保存当前内容或核对提交结果，再离开当前页面。');
      return false;
    }
    if (createDirty) {
      setError('请先完成或取消当前新建表单。');
      return false;
    }
    return true;
  }
  function navigate(next: WorkspaceView) {
    if (!canLeave()) return;
    if (next === 'settings' && view !== 'settings') setSettingsReturn(view);
    readSequence.current++;
    setLoading(false);
    setView(next);
    if (next !== 'settings') setTaskReturn(null);
    if (next === 'tasks') setActive(null);
    setCreateTagDraft(false);
    setCreating(false);
    setError('');
  }
  function newTask(source: ProjectViewState | null = null) {
    if (!canLeave()) return;
    readSequence.current++;
    setLoading(false);
    setView('tasks');
    setTitle('');
    setObjective(emptyDraft());
    setProjectOptionsState('loading');
    setProjectOptions([]);
    setCreateProperties({ ...defaultCreateProperties, matter_id: source?.projectId ?? '' });
    setCreateSource(source);
    setReviewDocument(null);
    setCreating(true);
    setTaskReturn(null);
    setError('');
  }
  async function open(
    id: string,
    source: ProjectViewState | null = null,
    document = false,
    review = false,
  ) {
    if (!canLeave()) return;
    if (dirty) {
      setError('请先保存当前正文，再切换任务。');
      return;
    }
    const seq = ++readSequence.current;
    setLoading(true);
    setError('');
    try {
      const r = check(
        await window.caselite.task({ operation: 'read', protocol_version: 1, task_id: id }),
      );
      if (seq === readSequence.current) {
        const task = r.tasks[0];
        if (task?.id !== id) throw new Error('读取结果与目标任务不符，请重试。');
        if (
          source?.documentId &&
          (task.document_id !== source.documentId ||
            task.matter_id !== source.projectId ||
            task.document_archived_at)
        )
          throw new Error('文档已归档或已离开来源项目，请重新打开项目查看。');
        // 只有当前读取成功才提交返回来源；迟到/失败读取不能污染下一次导航。
        setTaskReturn(source ? { taskId: id, source } : null);
        if (source) setProjectView(source);
        setActive(task);
        setReviewDocument(review ? task.document_id : null);
        setState(r.state);
        setObjectiveState(r.objective_state ?? null);
        setView('tasks');
        setDetailTab(source?.documentId || document ? '成果正文' : '内容');
        setCreateTagDraft(false);
        setCreating(false);
      }
    } catch (e) {
      if (seq === readSequence.current) setError(e instanceof Error ? e.message : '读取失败');
    } finally {
      if (seq === readSequence.current) setLoading(false);
    }
  }
  function cancelCreate() {
    if (busy || createRequest.current) return;
    if (createSource) {
      setProjectView(createSource);
      setView('projects');
    }
    setCreateTagDraft(false);
    setCreating(false);
    setError('');
  }
  async function create(mode: 'submit' | 'retry') {
    if (busy || createTagDraft || (mode === 'retry' && !createRequest.current)) return;
    const original = createRequest.current;

    setBusy(true);
    setError('');
    const command = createRequest.current ?? {
      ...mutation(),
      operation: 'create' as const,
      title,
      objective: objective.text,
      status: createProperties.status,
      priority: createProperties.priority,
      due_date: createProperties.due_date || null,
      ...(createProperties.tags.length ? { tags: createProperties.tags } : {}),
      ...(createProperties.matter_id ? { matter_id: createProperties.matter_id } : {}),
      ...(objective.state ? { objective_state: objective.state } : {}),
    };
    createRequest.current = command;
    const lookup = () =>
      window.caselite.task({
        operation: 'status',
        protocol_version: 1,
        idempotency_key: command.idempotency_key,
      });
    try {
      // 未确认的提交先查原键，仅在用户选择重试且查无回执时重发同一请求。
      let response = original ? await lookup() : await window.caselite.task(command);
      const replay = original && mode === 'retry' && !response.ok && response.code === 'NOT_FOUND';
      if (replay) response = await window.caselite.task(command);
      if ((!original || replay) && !response.ok && response.code === 'RESULT_UNKNOWN') {
        setUncertain(true);
        response = await lookup();
        if (!response.ok) throw new Error('创建结果尚未确认，请核对或重试原提交。');
      } else if (!response.ok) {
        if (
          !original ||
          (replay && (response.code === 'NOT_FOUND' || response.code === 'INVALID_REQUEST'))
        ) {
          createRequest.current = null;
          setUncertain(false);
        }
        throw new Error(response.message);
      }
      const r = check(response);
      const saved = r.tasks[0];
      if (
        r.receipt !== command.idempotency_key ||
        r.tasks.length !== 1 ||
        !saved ||
        JSON.stringify(saved.tags ?? []) !== JSON.stringify(command.tags ?? []) ||
        saved.matter_id !== (command.matter_id ?? null)
      )
        throw new Error('创建回执与原提交不符，请核对原提交。');
      setUncertain(false);
      createRequest.current = null;
      setTaskReturn(
        createSource
          ? {
              taskId: saved.id,
              source: { ...createSource, returnTaskId: saved.id },
            }
          : null,
      );
      setActive(saved);
      setState(null);
      setObjectiveState(command.objective_state ?? null);
      setView('tasks');
      setDetailTab('内容');
      setCreateTagDraft(false);
      setCreating(false);
      setTitle('');
      setObjective(emptyDraft());
      void refresh().catch(() => setError('任务已创建，列表刷新失败；请重试列表，不要重复创建。'));
    } catch (e) {
      setUncertain(Boolean(createRequest.current));
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }
  const resetTask = () => {
    if (!canLeave()) return;
    readSequence.current++;
    setLoading(false);
    setActive(null);
    if (reviewDocument === active?.document_id) setView('documents');
    setReviewDocument(null);
    if (taskReturn && taskReturn.taskId === active?.id) {
      setProjectView(taskReturn.source);
      setView('projects');
    }
    setTaskReturn(null);
    setError('');
  };
  const acceptTaskProperties = (saved: Task, description: number[] | null) => {
    setTasks((rows) =>
      rows.map((row) => (row.id === saved.id && row.version <= saved.version ? saved : row)),
    );
    if (active?.id === saved.id) {
      setActive(saved);
      setObjectiveState(description);
      // 属性动作只在正文/说明干净时准入；重读说明刷新其版本，普通保存ACK不重挂载编辑器。
      setPropertiesRead((epoch) => epoch + 1);
    }
    void refresh().catch(() => setError('任务属性已保存，列表刷新失败，请重试列表。'));
  };
  const documentEntry = reviewDocument !== null && reviewDocument === active?.document_id;
  const documentReview = documentEntry && detailTab === '成果正文';
  return (
    <ModelSettingsNavigation.Provider
      value={() => {
        if (!canLeave()) return;
        setSettingsSection('模型');
        navigate('settings');
      }}
    >
      <WorkspaceShell
        view={view === 'tasks' && documentEntry ? 'documents' : view}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(!collapsed)}
        onNavigate={navigate}
        projectBackSlot={setProjectBackSlot}
        tasks={tasks}
        favorites={favorites}
        agentDraft={Boolean(agentPrompt.text.trim())}
        onOpen={(id) => void open(id)}
      >
        {error && (
          <div className="error" role="alert">
            {error}
            <button
              onClick={() => void refresh().catch(() => setError('读取仍失败，请检查本地存储。'))}
            >
              重试列表
            </button>
            <button className="icon-button" aria-label="关闭提示" onClick={() => setError('')}>
              ×
            </button>
          </div>
        )}
        {creating ? (
          <form
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            className="create-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!composing.current) void create('submit');
            }}
          >
            <header className="create-form-header">
              <div className="create-form-context">
                <span className="create-workspace-icon">
                  <Icon name="check" size={15} />
                </span>
                <span>本地工作区</span>
                <Icon name="chevron" size={13} />
                <h1>新建任务</h1>
              </div>
              <button
                type="button"
                className="create-close"
                aria-label="取消新建任务"
                disabled={busy || uncertain}
                onClick={cancelCreate}
              >
                ×
              </button>
            </header>
            <div className="create-form-body">
              <label className="create-title-label">
                <span className="sr-only">任务名称</span>
                <input
                  data-testid="task-title"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                  }}
                  required
                  maxLength={160}
                  disabled={busy || uncertain}
                  placeholder="任务标题"
                />
              </label>
              <div className="create-objective">
                <span id="task-content-label" className="sr-only">
                  任务内容
                </span>
                <DraftEditor
                  key={creating ? 'create-content' : 'closed'}
                  value={objective}
                  label="任务内容"
                  testId="task-objective"
                  disabled={busy || uncertain}
                  onChange={(value) => {
                    setObjective(value);
                  }}
                  placeholder="添加说明…"
                />
                {objective.text.length > 4000 && (
                  <p role="alert" className="caption">
                    超过4000字符，请精简后创建；输入仍保留。
                  </p>
                )}
              </div>
              <fieldset className="task-create-properties" disabled={busy || uncertain}>
                <legend>任务属性</legend>
                <label>
                  <span>状态</span>
                  <select
                    aria-label="任务状态"
                    value={createProperties.status}
                    onChange={(e) =>
                      setCreateProperties({
                        ...createProperties,
                        status: e.target.value as Task['status'],
                      })
                    }
                  >
                    {Object.entries(taskStatusNames).map(([value, name]) => (
                      <option key={value} value={value}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>优先级</span>
                  <select
                    aria-label="任务优先级"
                    value={createProperties.priority}
                    onChange={(e) =>
                      setCreateProperties({
                        ...createProperties,
                        priority: Number(e.target.value),
                      })
                    }
                  >
                    {Object.entries(taskPriorityNames).map(([value, name]) => (
                      <option key={value} value={value}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>普通截止日期</span>
                  <input
                    type="date"
                    aria-label="普通截止日期"
                    min="0001-01-01"
                    max="9999-12-31"
                    value={createProperties.due_date}
                    onChange={(e) =>
                      setCreateProperties({ ...createProperties, due_date: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span>所属项目</span>
                  <select
                    aria-label="所属项目"
                    value={createProperties.matter_id}
                    disabled={projectOptionsState === 'loading'}
                    onChange={(e) =>
                      setCreateProperties({ ...createProperties, matter_id: e.target.value })
                    }
                  >
                    <option value="">独立任务</option>
                    {createProperties.matter_id &&
                      !projectOptions.some((p) => p.id === createProperties.matter_id) && (
                        <option value={createProperties.matter_id}>
                          {projectOptionsState === 'loading'
                            ? '正在读取所选项目…'
                            : '所选项目暂不可用'}
                        </option>
                      )}
                    {projectOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
                <TaskTags
                  tags={createProperties.tags}
                  onDraft={setCreateTagDraft}
                  suggestions={tagSuggestions}
                  onChange={(tags) => setCreateProperties({ ...createProperties, tags })}
                />
                {projectOptionsState !== 'ready' && (
                  <p role="status">
                    {projectOptionsState === 'loading' ? '正在读取项目…' : '项目列表读取失败。'}
                    {projectOptionsState === 'failed' && (
                      <button
                        type="button"
                        onClick={() => {
                          setProjectOptionsState('loading');
                          setProjectOptions([]);
                          setProjectOptionsAttempt((n) => n + 1);
                        }}
                      >
                        重读项目列表
                      </button>
                    )}
                  </p>
                )}
              </fieldset>
            </div>
            <footer className="create-form-footer">
              {uncertain && (
                <button type="button" disabled={busy} onClick={() => void create('retry')}>
                  重试原创建请求
                </button>
              )}
              <span className="create-form-spacer" />
              <button type="button" disabled={busy || uncertain} onClick={cancelCreate}>
                取消
              </button>
              <button
                className="primary"
                disabled={busy || createTagDraft || !title.trim() || objective.text.length > 4000}
                data-testid="create-task"
              >
                {busy ? '创建中…' : uncertain ? '核对创建结果' : '创建任务'}
              </button>
            </footer>
          </form>
        ) : loading && view !== 'projects' ? (
          <div className="loading-state" role="status">
            正在读取本地任务…
          </div>
        ) : view === 'projects' ? (
          <ProjectCatalog
            tasks={tasks}
            initialView={projectView}
            backSlot={projectBackSlot}
            navigationPending={loading}
            onOpen={(id, source) => void open(id, source)}
            onNewTask={newTask}
            onDirty={setDirty}
            onChanged={async () => {
              try {
                return await refresh();
              } catch {
                setError('数据已保存，任务列表刷新失败，请重新读取。');
                return false;
              }
            }}
          />
        ) : view === 'home' ? (
          <AgentHome
            prompt={agentPrompt}
            onPrompt={setAgentPrompt}
            onNavigate={navigate}
            tasks={tasks}
            onOpen={(id) => void open(id)}
          />
        ) : view === 'agent-history' ? (
          <AgentHistory
            tasks={tasks}
            onBack={() => navigate('home')}
            onOpen={(id) => void open(id)}
          />
        ) : view === 'tasks' && active ? (
          <section
            className="task-detail"
            data-layout="three-column"
            data-active-task={active.id}
            data-task-tab={detailTab === '内容' ? 'content' : undefined}
          >
            <div className="task-layout">
              <div className="task-work-area" aria-label="阅读与编辑工作区">
                <div className="page-topline">
                  <div>
                    <button
                      className="icon-button"
                      aria-label={
                        documentEntry
                          ? '返回文档列表'
                          : taskReturn?.taskId === active.id
                            ? '返回来源项目'
                            : '返回任务列表'
                      }
                      data-testid="back-to-tasks"
                      onClick={resetTask}
                    >
                      <Icon name="back" size={16} />
                    </button>
                    <button className="breadcrumb-button" onClick={resetTask}>
                      {documentEntry
                        ? '文档'
                        : taskReturn?.taskId === active.id
                          ? '来源项目'
                          : '任务'}
                    </button>
                    <Icon name="chevron" size={13} />
                    {active.matter_title && (
                      <>
                        <span data-testid="task-project-context">{active.matter_title}</span>
                        <Icon name="chevron" size={13} />
                      </>
                    )}
                    <span>{active.title}</span>
                  </div>
                </div>

                <div className="task-reminder-entry">
                  <button
                    type="button"
                    aria-expanded={reminderTask === active.id}
                    disabled={propertiesBlocked || reminderBlocked}
                    onClick={() => setReminderTask(reminderTask === active.id ? null : active.id)}
                  >
                    本机提醒
                  </button>
                  {reminderTask === active.id && (
                    <ReminderEditor
                      taskId={active.id}
                      disabled={
                        dirty ||
                        commentDirty ||
                        projectDirty ||
                        busy ||
                        uncertain ||
                        propertiesBlocked
                      }
                      onBlocked={setReminderBlocked}
                    />
                  )}
                </div>
                <div className="project-tabs detail-tabs" role="tablist" aria-label="任务栏目">
                  {['内容', '成果正文', '材料'].map((t) => (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={detailTab === t}
                      data-testid={t === '成果正文' ? 'task-result-tab' : undefined}
                      onClick={() => {
                        if (detailTab !== t && canLeave()) setDetailTab(t);
                      }}
                    >
                      {t === '材料' ? '材料阅读' : t}
                      {t === '成果正文' && <small>1</small>}
                    </button>
                  ))}
                </div>

                <div className="task-title">
                  <span className="task-symbol">
                    <Icon name="check" size={23} />
                  </span>
                  <div>
                    <h1>{active.title}</h1>
                    <button
                      type="button"
                      className="favorite-toggle"
                      data-testid="toggle-favorite"
                      aria-label={favorites.includes(active.id) ? '取消收藏任务' : '收藏任务'}
                      aria-pressed={favorites.includes(active.id)}
                      onClick={() =>
                        setFavorites((ids) =>
                          ids.includes(active.id)
                            ? ids.filter((id) => id !== active.id)
                            : [...ids, active.id],
                        )
                      }
                    >
                      <Icon name="star" size={15} />
                    </button>
                  </div>
                </div>
                {detailTab === '成果正文' ? (
                  <BodyEditor
                    key={active.body_id}
                    task={active}
                    initial={state}
                    onDirty={setDirty}
                    reviewDock={documentReview ? reviewDock : null}
                    reviewSaving={reviewSaving}
                    onReviewSaving={setReviewSaving}
                    disabled={projectDirty || propertiesBlocked || reminderBlocked}
                    onSaved={(t, savedState) => {
                      setActive(t);
                      setState(savedState);
                      void refresh().catch(() => setError('正文已保存，列表刷新失败。'));
                    }}
                  />
                ) : detailTab === '内容' ? (
                  <div className="task-content-overview" key={active.id}>
                    <TaskContentEditor
                      key={active.id + ':' + propertiesRead}
                      task={active}
                      initial={objectiveState}
                      onDirty={setDirty}
                      disabled={
                        commentDirty || projectDirty || propertiesBlocked || reminderBlocked
                      }
                      onSaved={(saved, bytes) => {
                        setActive(saved);
                        setObjectiveState(bytes);
                        void refresh().catch(() => setError('任务内容已保存，列表刷新失败。'));
                      }}
                    />
                    <section className="task-detail-section">
                      <h2>活动</h2>
                      <ActivityList
                        scope={{ type: 'task', id: active.id }}
                        refresh={String(active.version) + ':' + active.body_revision}
                        disabled={
                          dirty ||
                          commentDirty ||
                          projectDirty ||
                          propertiesBlocked ||
                          reminderBlocked
                        }
                        onTask={(id) => void open(id, taskReturn?.source)}
                        compact
                        readOnly
                      />
                    </section>
                    <section className="task-detail-section project-discussion" aria-label="评论">
                      <h2>评论</h2>
                      <DiscussionFeed
                        scope={{ kind: 'task_comment', task_id: active.id }}
                        refresh={active.matter_id}
                        archived={false}
                        disabled={dirty || projectDirty || propertiesBlocked || reminderBlocked}
                        onDirty={setCommentDirty}
                        compose
                      />
                    </section>
                  </div>
                ) : (
                  <section className="project-tab-empty">
                    <Icon name="folder" size={30} />
                    <h2>任务材料</h2>
                    <p>当前版本尚未接入材料导入。你可以先编写和保存成果正文。</p>
                  </section>
                )}
              </div>
              {documentReview ? (
                <aside className="task-inspector" ref={setReviewDock} aria-label="文档审阅侧栏" />
              ) : (
                <TaskInspector
                  key={active.id}
                  task={active}
                  projectDisabled={
                    dirty ||
                    commentDirty ||
                    propertiesBlocked ||
                    reminderBlocked ||
                    busy ||
                    uncertain
                  }
                  propertiesDisabled={
                    dirty || commentDirty || projectDirty || reminderBlocked || busy || uncertain
                  }
                  reminderEditing={reminderBlocked || dirty || commentDirty || projectDirty}
                  onPropertiesBlocked={setPropertiesBlocked}
                  onTaskChanged={acceptTaskProperties}
                  suggestions={tagSuggestions}
                  assigneeSuggestions={tasks.flatMap(({ assignee }) =>
                    assignee ? [assignee] : [],
                  )}
                  onProjectDirty={setProjectDirty}
                  onProjectChanged={acceptTaskProperties}
                />
              )}
            </div>
          </section>
        ) : view === 'reminders' ? (
          <ReminderInbox onOpen={(id) => void open(id)} onBlocked={setPropertiesBlocked} />
        ) : view === 'documents' || view === 'knowledge' ? (
          <DocumentLibrary
            key={view}
            library={view === 'knowledge'}
            onOpen={(id) => void open(id, null, true, view === 'documents')}
            onDirty={setDirty}
          />
        ) : view === 'tasks' ? (
          <RecordList
            key={view}
            tasks={tasks}
            viewState={taskListState}
            onViewState={setTaskListState}
            onOpen={(id) => void open(id)}
            onNew={() => newTask()}
            propertiesBlocked={propertiesBlocked}
            projectDirty={projectDirty}
            onProjectDirty={setProjectDirty}
            onPropertiesBlocked={setPropertiesBlocked}
            onTaskChanged={acceptTaskProperties}
          />
        ) : view === 'finance' || view === 'tools' || view === 'whiteboard' ? (
          <section className="workspace-placeholder">
            <h1>{{ finance: '财务', tools: '工具', whiteboard: '白板' }[view]}</h1>
            <div className="table-empty">
              {
                {
                  finance: '这里还没有财务记录。',
                  tools: '这里还没有可用工具。',
                  whiteboard: '这里还没有白板。',
                }[view]
              }
            </div>
          </section>
        ) : view === 'settings' ? (
          <SettingsView
            section={settingsSection}
            onSection={setSettingsSection}
            onBack={() => {
              if (settingsReturn === 'tasks' && active)
                void open(active.id, taskReturn?.taskId === active.id ? taskReturn.source : null);
              else navigate(settingsReturn);
            }}
          />
        ) : (
          <div>请选择导航入口。</div>
        )}
      </WorkspaceShell>
    </ModelSettingsNavigation.Provider>
  );
}
export default function App() {
  return new URLSearchParams(window.location.search).has('engineering') ? (
    <EngineeringApp />
  ) : (
    <AppearanceProvider>
      <Workbench />
    </AppearanceProvider>
  );
}
