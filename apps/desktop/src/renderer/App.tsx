import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import type { Task, TaskRequest, TaskResponse } from '../preload/caselite-api';
import EngineeringApp from './EngineeringApp';
import { WorkspaceShell, TaskTable, Icon, navigation, type WorkspaceView } from './ui/Workspace';
import ProjectPreview from './projects/ProjectPreview';
import TaskInspector from './ui/TaskInspector';

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
      extensions: [
        StarterKit.configure({ undoRedo: false, link: false }),
        Collaboration.configure({ document: doc }),
      ],
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
      <div className="toolbar">
        <button onClick={() => editor?.chain().focus().toggleBold().run()} aria-label="加粗">
          B
        </button>
        <button onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
          标题
        </button>
        <button onClick={() => editor?.chain().focus().toggleBulletList().run()}>列表</button>
        <button onClick={() => editor?.chain().focus().undo().run()}>撤销</button>
        <button onClick={() => editor?.chain().focus().redo().run()}>重做</button>
      </div>
      <EditorContent className="editor-surface" editor={editor} />
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
  const [view, setView] = useState<WorkspaceView>('home');
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [taskFilter, setTaskFilter] = useState('全部任务');
  const [detailTab, setDetailTab] = useState('成果正文');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [active, setActive] = useState<Task | null>(null);
  const [state, setState] = useState<number[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
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
      if (dirty || busy || uncertain || (creating && (title.trim() || objective.trim()))) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, busy, uncertain, creating, title, objective]);
  function canLeave() {
    if (dirty || busy || uncertain) {
      setError('请先保存当前内容或核对提交结果，再离开当前页面。');
      return false;
    }
    if (creating && (title.trim() || objective.trim())) {
      setError('请先完成或取消当前新建表单。');
      return false;
    }
    return true;
  }
  function navigate(next: WorkspaceView) {
    if (!canLeave()) return;
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
      objective,
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
      setView('tasks');
      setDetailTab('成果正文');
      setCreating(false);
      setTitle('');
      setObjective('');
      void refresh().catch(() => setError('任务已创建，列表刷新失败；请重试列表，不要重复创建。'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }
  const filtered = tasks.filter(
    (t) =>
      `${t.title} ${t.objective}`.toLowerCase().includes(search.toLowerCase()) &&
      (taskFilter === '全部任务' ||
        (taskFilter === '已写正文' ? t.body_revision > 0 : t.body_revision === 0)),
  );
  const saved = tasks.filter((t) => t.body_revision > 0).length;
  const viewLabel =
    view === 'settings' ? '设置' : navigation.find((item) => item.id === view)?.label;
  const resetTask = () => {
    if (!canLeave()) return;
    readSequence.current++;
    setLoading(false);
    setActive(null);
    setError('');
  };
  return (
    <WorkspaceShell
      view={view}
      collapsed={collapsed}
      onCollapse={() => setCollapsed(!collapsed)}
      onNavigate={navigate}
      onNew={newTask}
      tasks={tasks}
      onOpen={(id) => void open(id)}
      search={search}
      onSearch={(value) => {
        setSearch(value);
        if (!dirty && !creating && !busy) {
          readSequence.current++;
          setLoading(false);
          setView('tasks');
          setActive(null);
        }
      }}
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
          <label>
            工作目标
            <textarea
              data-testid="task-objective"
              value={objective}
              onChange={(e) => {
                setObjective(e.target.value);
                if (!busy) createRequest.current = null;
              }}
              maxLength={4000}
              disabled={busy || uncertain}
            />
          </label>
          <p className="caption">可直接开始，不需要先创建项目。</p>
          <button className="primary" disabled={busy || !title.trim()} data-testid="create-task">
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
        <ProjectPreview />
      ) : view === 'home' ? (
        <section className="home-view">
          <div className="page-topline">
            <span>个人工作区</span>
            <span className="quiet-label">
              <i className="local-dot" />
              离线可用
            </span>
          </div>
          <div className="welcome">
            <div>
              <p className="eyebrow">我的工作台</p>
              <h1>每一项工作，都有清晰的下一步。</h1>
              <p>从一个任务开始，整理思路、形成初稿，再回来继续。</p>
            </div>
            <button className="primary" onClick={newTask}>
              <Icon name="plus" size={16} />
              新建任务
            </button>
          </div>
          <div className="summary-grid">
            <button
              onClick={() => {
                navigate('tasks');
                setActive(null);
                setTaskFilter('全部任务');
              }}
            >
              <span>
                <Icon name="check" />
                我的任务
              </span>
              <strong>
                {tasks.length}
                <small>项</small>
              </strong>
              <p>当前本地工作区</p>
            </button>
            <button
              onClick={() => {
                navigate('documents');
                setActive(null);
              }}
            >
              <span>
                <Icon name="file" />
                已写正文
              </span>
              <strong>
                {saved}
                <small>份</small>
              </strong>
              <p>已保存至少一个正文修订</p>
            </button>
            <button onClick={() => navigate('projects')}>
              <span>
                <Icon name="folder" />
                项目工作区 <small className="sample-badge">示例</small>
              </span>
              <strong className="summary-preview">
                查看项目原型 <Icon name="chevron" />
              </strong>
              <p>概述、任务与属性</p>
            </button>
          </div>
          <section className="home-recent">
            <div className="section-title">
              <h2>最近的任务</h2>
              <button
                onClick={() => {
                  navigate('tasks');
                  setActive(null);
                }}
              >
                查看全部 <Icon name="chevron" size={13} />
              </button>
            </div>
            <TaskTable tasks={filtered.slice(0, 6)} onOpen={(id) => void open(id)} />
          </section>
          <div className="home-footer">
            <Icon name="file" />
            <div>
              <strong>先写下来，再逐步完善</strong>
              <p>无需项目或模型配置，也能完成一份可保存、可重开的初稿。</p>
            </div>
          </div>
        </section>
      ) : view === 'tasks' && active ? (
        <section className="task-detail" data-layout="three-column">
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
                我的任务
              </button>
              <Icon name="chevron" size={13} />
              <span>{active.title}</span>
            </div>
            <span className="label-tag">独立任务</span>
          </div>
          <div className="task-layout">
            <div className="task-work-area" aria-label="阅读与编辑工作区">
              <div className="task-title">
                <span className="task-symbol">
                  <Icon name="check" size={23} />
                </span>
                <div>
                  <small>任务 {active.id.slice(0, 4).toUpperCase()}</small>
                  <h1>{active.title}</h1>
                </div>
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
                <section className="goal-panel">
                  <h2>本次工作目标</h2>
                  <p>{active.objective || '尚未填写工作目标。'}</p>
                  <p className="caption">工作目标与成果正文分别保存。</p>
                </section>
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
        <section className="list-view">
          <div className="page-topline">
            <span>
              工作区 <Icon name="chevron" size={13} /> {viewLabel}
            </span>
            <span className="quiet-label">本地数据</span>
          </div>
          <div className="page-title">
            <div>
              <p className="eyebrow">{view === 'documents' ? '成果资料' : '个人工作'}</p>
              <h1>{viewLabel}</h1>
              <p>
                {view === 'documents'
                  ? '从关联任务打开成果，继续编辑同一份正文。'
                  : '每个任务都可以独立开始，按需组织到项目。'}
              </p>
            </div>
            <button className="primary" onClick={newTask}>
              <Icon name="plus" size={16} />
              新建任务
            </button>
          </div>
          <div className="view-toolbar">
            <div className="view-tabs">
              {['全部任务', '已写正文', '未写正文'].map((t) => (
                <button
                  key={t}
                  className={taskFilter === t ? 'current' : ''}
                  onClick={() => setTaskFilter(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <span className="list-count">{filtered.length} 项</span>
          </div>
          <TaskTable
            tasks={filtered}
            documents={view === 'documents'}
            onOpen={(id) => void open(id)}
          />
        </section>
      ) : view === 'settings' ? (
        <section className="settings-view">
          <div className="page-topline">个人工作区 / 设置</div>
          <div className="page-title">
            <div>
              <h1>工作区设置</h1>
              <p>先专注本地工作，按需要逐步配置更多能力。</p>
            </div>
          </div>
          <div className="settings-panel">
            <h2>个人本地工作区</h2>
            <dl>
              <dt>使用方式</dt>
              <dd>无需注册或登录</dd>
              <dt>任务与正文</dt>
              <dd>保存在此设备</dd>
              <dt>AI 配置</dt>
              <dd>当前未接入，不影响人工编辑</dd>
            </dl>
            <p className="caption">跨设备同步、备份恢复和团队协作将按后续功能开放。</p>
          </div>
        </section>
      ) : (
        <section className="future-view">
          <div className="page-topline">工作区 / {viewLabel}</div>
          <div className="project-tab-empty">
            <Icon name={view === 'calendar' ? 'calendar' : 'book'} size={34} />
            <h1>{viewLabel}</h1>
            <p>
              {view === 'calendar'
                ? '日历与日期提醒将在后续版本开放。'
                : '知识库与受控复用将在后续版本开放。'}
            </p>
            <button onClick={() => navigate('home')}>返回首页</button>
          </div>
        </section>
      )}
    </WorkspaceShell>
  );
}
export default function App() {
  return new URLSearchParams(window.location.search).has('engineering') ? (
    <EngineeringApp />
  ) : (
    <Workbench />
  );
}
