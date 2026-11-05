import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import type { Task, TaskRequest, TaskResponse } from '../preload/caselite-api';
import EngineeringApp from './EngineeringApp';

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
  onSaved(task: Task): void;
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
      onSaved(saved);
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
        <span>内部沟通初稿</span>
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
      <EditorContent editor={editor} />
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
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, busy]);
  async function open(id: string) {
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
  return (
    <main className="workbench">
      <link rel="stylesheet" href={new URL('../task-workbench.css', window.location.href).href} />
      <aside>
        <div className="brand">
          CaseLite<span>个人法律工作台</span>
        </div>
        <button
          className="new-task"
          data-testid="new-task"
          onClick={() => {
            if (dirty) {
              setError('请先保存当前正文。');
              return;
            }
            setCreating(true);
            setError('');
          }}
        >
          ＋ 新建任务
        </button>
        <p className="nav-label">
          我的任务 <span>{tasks.length}</span>
        </p>
        <nav>
          {tasks.map((t) => (
            <button
              data-task-id={t.id}
              className={active?.id === t.id ? 'selected' : ''}
              key={t.id}
              onClick={() => void open(t.id)}
            >
              {t.title}
            </button>
          ))}
        </nav>
        <div className="local-note">
          ● 本地工作区
          <br />
          <small>无需账号 · 无需模型 Key</small>
        </div>
      </aside>
      <article>
        <header>
          <span>工作台 / {creating ? '新建任务' : (active?.title ?? '我的任务')}</span>
          <span className="device">仅此设备</span>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
            <button
              onClick={() => void refresh().catch(() => setError('读取仍失败，请检查本地存储。'))}
            >
              重试列表
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
            <h1>这次要完成什么？</h1>
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
          <div className="empty">正在读取本地任务…</div>
        ) : active ? (
          <>
            <section className="task-heading">
              <p className="eyebrow">独立任务</p>
              <h1>{active.title}</h1>
              <p>{active.objective || '从一份清晰的内部初稿开始。'}</p>
            </section>
            <BodyEditor
              key={active.body_id}
              task={active}
              initial={state}
              onDirty={setDirty}
              onSaved={(t) => {
                setActive(t);
                void refresh().catch(() => setError('正文已保存，列表刷新失败。'));
              }}
            />
          </>
        ) : (
          <section className="empty">
            <p className="eyebrow">从一件具体工作开始</p>
            <h1>把材料变成清晰的成果</h1>
            <p>
              新建任务，写下事实、矛盾与缺件。
              <br />
              保存后，可以随时回来继续。
            </p>
            <button className="primary" onClick={() => setCreating(true)}>
              创建第一个任务
            </button>
          </section>
        )}
      </article>
    </main>
  );
}
export default function App() {
  return new URLSearchParams(window.location.search).has('engineering') ? (
    <EngineeringApp />
  ) : (
    <Workbench />
  );
}
