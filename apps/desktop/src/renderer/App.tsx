import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@tiptap/react';
import * as Y from 'yjs';
import type { Task, TaskRequest, TaskResponse } from '../preload/caselite-api';
import EngineeringApp from './EngineeringApp';
import { WorkspaceShell, Icon, type WorkspaceView } from './ui/Workspace';
import ProjectPreview from './projects/ProjectPreview';
import TaskInspector from './ui/TaskInspector';
import KnowledgeView from './ui/KnowledgeView';
import SettingsView, { ModelSettingsNavigation, type SettingsSection } from './ui/SettingsView';
import RecordList from './ui/RecordList';
import AgentHome from './ui/AgentHome';
import {
  DraftEditor,
  EditorSurface,
  emptyDraft,
  localExtensions,
  type RichDraft,
} from './editors/RichEditor';
import TaskContentEditor from './editors/TaskContentEditor';

const mutation = () => ({
  protocol_version: 1 as const,
  request_id: crypto.randomUUID(),
  idempotency_key: crypto.randomUUID(),
});
function check(result: TaskResponse) {
  if (!result.ok) throw new Error(result.message);
  return result;
}

function BodyEditor({
  task,
  initial,
  onSaved,
  onDirty,
}: {
  task: Task;
  initial: number[] | null;
  onSaved(task: Task, state: number[]): void;
  onDirty(dirty: boolean): void;
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
  const editorReady = useRef(false);
  const pending = useRef<{ request: TaskRequest; sequence: number } | null>(null);
  const alive = useRef(true);
  const editor = useEditor(
    {
      injectCSS: false,
      extensions: localExtensions(doc),
      editorProps: {
        attributes: { 'aria-label': '成果正文', 'data-testid': 'body-editor', role: 'textbox' },
      },
      onCreate: () => {
        editorReady.current = true;
      },
      onUpdate: () => {
        if (!editorReady.current) return;
        changes.current++;
        setDirty(true);
        onDirty(true);
        setStatus('有未保存修改');
      },
    },
    [doc],
  );
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
    if (!editor || busy) return;
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
          {status}
        </span>
        <button
          className="primary"
          data-testid="save-body"
          disabled={busy || (!dirty && !hasPending)}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : hasPending ? '核对并保存' : '保存正文'}
        </button>
      </footer>
      <p className="caption">仅已确认保存的内容可在退出后恢复。当前成果尚未进行法律核验。</p>
    </section>
  );
}
function Workbench() {
  const [settingsReturn, setSettingsReturn] = useState<WorkspaceView>('home');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('系统设置');
  const [view, setView] = useState<WorkspaceView>('home');
  const [collapsed, setCollapsed] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [agentPrompt, setAgentPrompt] = useState<RichDraft>(emptyDraft);
  const [taskFilter, setTaskFilter] = useState('全部任务');
  const [detailTab, setDetailTab] = useState('成果正文');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [active, setActive] = useState<Task | null>(null);
  const [state, setState] = useState<number[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState<RichDraft>(emptyDraft);
  const [objectiveState, setObjectiveState] = useState<number[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const readSequence = useRef(0);
  const composing = useRef(false);
  const createRequest = useRef<TaskRequest | null>(null);
  async function refresh() {
    const r = check(await window.caselite.task({ operation: 'list', protocol_version: 1 }));
    setTasks(r.tasks);
  }
  useEffect(() => {
    void window.caselite
      .task({ operation: 'list', protocol_version: 1 })
      .then((result) => setTasks(check(result).tasks))
      .catch(() => setError('任务列表读取失败，请重试；原数据没有被修改。'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (
        dirty ||
        busy ||
        uncertain ||
        agentPrompt.text.trim() ||
        (creating && (title.trim() || objective.text.trim()))
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, busy, uncertain, creating, title, objective, agentPrompt]);
  function canLeave() {
    if (dirty || busy || uncertain) {
      setError('请先保存当前内容或核对提交结果，再离开当前页面。');
      return false;
    }
    if (creating && (title.trim() || objective.text.trim())) {
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
    if (next === 'tasks') setActive(null);
    setCreating(false);
    setError('');
  }
  function newTask() {
    if (!canLeave()) return;
    readSequence.current++;
    setLoading(false);
    setView('tasks');
    setCreating(true);
    setError('');
  }
  async function open(id: string) {
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
        setActive(r.tasks[0]);
        setState(r.state);
        setObjectiveState(r.objective_state ?? null);
        setView('tasks');
        setDetailTab('成果正文');
        setCreating(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败');
    } finally {
      if (seq === readSequence.current) setLoading(false);
    }
  }
  async function create() {
    setBusy(true);
    setError('');
    const command = createRequest.current ?? {
      ...mutation(),
      operation: 'create' as const,
      title,
      objective: objective.text,
      ...(objective.state ? { objective_state: objective.state } : {}),
    };
    createRequest.current = command;
    try {
      let response = await window.caselite.task(command);
      if (!response.ok && response.code === 'RESULT_UNKNOWN') {
        setUncertain(true);
        response = await window.caselite.task({
          operation: 'status',
          protocol_version: 1,
          idempotency_key: 'idempotency_key' in command ? command.idempotency_key : '',
        });
        if (!response.ok) throw new Error('创建结果尚未确认，请保持原输入并再次核对。');
      } else if (!response.ok) {
        createRequest.current = null;
        setUncertain(false);
      }
      const r = check(response);
      setUncertain(false);
      createRequest.current = null;
      setActive(r.tasks[0]);
      setState(null);
      setObjectiveState(command.operation === 'create' ? (command.objective_state ?? null) : null);
      setView('tasks');
      setDetailTab('成果正文');
      setCreating(false);
      setTitle('');
      setObjective(emptyDraft());
      void refresh().catch(() => setError('任务已创建，列表刷新失败；请重试列表，不要重复创建。'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }
  const filtered = tasks.filter(
    (t) =>
      taskFilter === '全部任务' ||
      (taskFilter === '已写正文' ? t.body_revision > 0 : t.body_revision === 0),
  );
  const resetTask = () => {
    if (!canLeave()) return;
    readSequence.current++;
    setLoading(false);
    setActive(null);
    setError('');
  };
  return (
    <ModelSettingsNavigation.Provider
      value={() => {
        if (!canLeave()) return;
        setSettingsSection('模型');
        navigate('settings');
      }}
    >
      <WorkspaceShell
        view={view}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(!collapsed)}
        onNavigate={navigate}
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
              if (!composing.current) void create();
            }}
          >
            <p className="eyebrow">开始一次独立工作</p>
            <h1>新建独立任务</h1>
            <label>
              任务名称
              <input
                data-testid="task-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!busy) createRequest.current = null;
                }}
                required
                maxLength={160}
                disabled={busy || uncertain}
              />
            </label>
            <div className="create-objective">
              <label id="task-content-label">任务内容</label>
              <DraftEditor
                key={creating ? 'create-content' : 'closed'}
                value={objective}
                label="任务内容"
                testId="task-objective"
                disabled={busy || uncertain}
                onChange={(value) => {
                  setObjective(value);
                  if (!busy) createRequest.current = null;
                }}
                placeholder="输入目标和说明，使用 / 插入内容块…"
              />
              {objective.text.length > 4000 && (
                <p role="alert" className="caption">
                  超过4000字符，请精简后创建；输入仍保留。
                </p>
              )}
            </div>
            <p className="caption">可直接开始，不需要先创建项目。</p>
            <button
              className="primary"
              disabled={busy || !title.trim() || objective.text.length > 4000}
              data-testid="create-task"
            >
              {busy ? '创建中…' : uncertain ? '核对创建结果' : '创建任务'}
            </button>
            <button type="button" disabled={busy || uncertain} onClick={() => setCreating(false)}>
              取消
            </button>
          </form>
        ) : loading ? (
          <div className="loading-state" role="status">
            正在读取本地任务…
          </div>
        ) : view === 'projects' ? (
          <ProjectPreview onAgent={() => navigate('home')} />
        ) : view === 'home' ? (
          <AgentHome
            prompt={agentPrompt}
            onPrompt={setAgentPrompt}
            onStart={() => {
              if (!canLeave() || !agentPrompt.text.trim()) return;
              newTask();
              setTitle(agentPrompt.text.trim().split('\n')[0].slice(0, 60));
              setObjective(agentPrompt);
              setAgentPrompt(emptyDraft());
            }}
            tasks={tasks}
            onOpen={(id) => void open(id)}
          />
        ) : view === 'tasks' && active ? (
          <section className="task-detail" data-layout="three-column" data-active-task={active.id}>
            <div className="task-layout">
              <div className="task-work-area" aria-label="阅读与编辑工作区">
                <div className="page-topline">
                  <div>
                    <button
                      className="icon-button"
                      aria-label="返回任务列表"
                      data-testid="back-to-tasks"
                      onClick={resetTask}
                    >
                      <Icon name="back" size={16} />
                    </button>
                    <button className="breadcrumb-button" onClick={resetTask}>
                      任务
                    </button>
                    <Icon name="chevron" size={13} />
                    <span>{active.title}</span>
                  </div>
                </div>

                <div className="task-title">
                  <span className="task-symbol">
                    <Icon name="check" size={23} />
                  </span>
                  <div>
                    <small>任务 {active.id.slice(0, 4).toUpperCase()}</small>
                    <h1>{active.title}</h1>
                  </div>
                  <button
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
                <div className="project-tabs detail-tabs" role="tablist" aria-label="任务栏目">
                  {['成果正文', '任务目标', '材料'].map((t) => (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={detailTab === t}
                      onClick={() => {
                        if (detailTab !== t && canLeave()) setDetailTab(t);
                      }}
                    >
                      {t === '材料' ? '材料阅读' : t}
                      {t === '成果正文' && <small>1</small>}
                    </button>
                  ))}
                </div>

                {detailTab === '成果正文' ? (
                  <BodyEditor
                    key={active.body_id}
                    task={active}
                    initial={state}
                    onDirty={setDirty}
                    onSaved={(t, savedState) => {
                      setActive(t);
                      setState(savedState);
                      void refresh().catch(() => setError('正文已保存，列表刷新失败。'));
                    }}
                  />
                ) : detailTab === '任务目标' ? (
                  <TaskContentEditor
                    key={active.id}
                    task={active}
                    initial={objectiveState}
                    onDirty={setDirty}
                    onSaved={(saved, bytes) => {
                      setActive(saved);
                      setObjectiveState(bytes);
                      void refresh().catch(() => setError('任务内容已保存，列表刷新失败。'));
                    }}
                  />
                ) : (
                  <section className="project-tab-empty">
                    <Icon name="folder" size={30} />
                    <h2>任务材料</h2>
                    <p>当前版本尚未接入材料导入。你可以先编写和保存成果正文。</p>
                  </section>
                )}
              </div>
              <TaskInspector key={active.id} task={active} />
            </div>
          </section>
        ) : view === 'tasks' || view === 'documents' ? (
          <RecordList
            key={view}
            tasks={filtered}
            documents={view === 'documents'}
            filter={taskFilter}
            onFilter={setTaskFilter}
            onOpen={(id) => void open(id)}
          />
        ) : view === 'settings' ? (
          <SettingsView
            section={settingsSection}
            onSection={setSettingsSection}
            onBack={() => {
              if (settingsReturn === 'tasks' && active) void open(active.id);
              else navigate(settingsReturn);
            }}
          />
        ) : (
          <KnowledgeView onHome={() => navigate('home')} />
        )}
      </WorkspaceShell>
    </ModelSettingsNavigation.Provider>
  );
}
export default function App() {
  return new URLSearchParams(window.location.search).has('engineering') ? (
    <EngineeringApp />
  ) : (
    <Workbench />
  );
}
