// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task, TaskRequest } from '../preload/caselite-api';
import App from './App';

vi.mock('./ui/Appearance', () => ({
  AppearanceProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./editors/RichEditor', () => ({
  emptyDraft: () => ({ text: '', state: null }),
  localExtensions: () => [],
  useLocalDoc: () => null,
  EditorSurface: () => null,
  DraftEditor: () => null,
}));
vi.mock('./ui/Workspace', () => ({
  WorkspaceShell: ({
    children,
    topbar,
    onNavigate,
    onOpen,
    inspectorOpen,
  }: {
    children: ReactNode;
    topbar: ReactNode;
    onNavigate(view: string): void;
    onOpen(id: string): void;
    inspectorOpen: boolean;
  }) => (
    <div className="workbench" data-inspector-open={inspectorOpen}>
      {topbar}
      <button onClick={() => onNavigate('home')}>首页入口</button>
      <button onClick={() => onNavigate('tasks')}>任务入口</button>
      <button onClick={() => onNavigate('projects')}>项目入口</button>
      <button onClick={() => onNavigate('documents')}>文档入口</button>
      <button onClick={() => onNavigate('settings')}>设置入口</button>
      <button onClick={() => onOpen('A')}>打开任务A</button>
      <div id="workspace-page-content" className="workspace-main">
        {children}
      </div>
    </div>
  ),
}));
vi.mock('./ui/AgentHome', () => ({ default: () => <p>首页内容</p> }));
vi.mock('./ui/RecordList', () => ({
  initialTaskListState: { query: { scope: { type: 'workspace' } }, scroll: 0, selected: null },
  default: ({ onNew }: { onNew(): void }) => (
    <>
      <p>任务列表内容</p>
      <button onClick={onNew}>创建合成任务</button>
    </>
  ),
}));
vi.mock('./features/projects/ProjectCatalog', async () => {
  const { useChildPage } = await import('./shared/navigation/PageNavigation');
  return {
    default: function MockProjectCatalog({
      initialView,
    }: {
      initialView?: { projectId?: string };
    }) {
      const [projectId, setProjectId] = useState(initialView?.projectId ?? null);
      useChildPage(() => ({
        key: projectId ? 'projects:' + projectId : 'projects:list',
        title: projectId ? '项目P' : '项目',
        icon: 'folder',
        state: projectId ? { projectId } : null,
      }));
      return (
        <>
          <p>{projectId ? '项目P内容' : '项目列表内容'}</p>
          <button onClick={() => setProjectId('P')}>打开项目P</button>
        </>
      );
    },
  };
});
vi.mock('./ui/DocumentLibrary', async () => {
  const { useChildPage, usePageNavigation } = await import('./shared/navigation/PageNavigation');
  type DocumentState = {
    kind: 'documents';
    selection: {
      primary: string | null;
      secondary: string | null;
      active: 'primary';
      split: boolean;
    };
    reading: boolean;
    wide: boolean;
    versions: { primary: string | null; secondary: string | null };
    title: string;
  };
  return {
    default: function MockDocumentLibrary() {
      const navigation = usePageNavigation();
      const initial = navigation?.initial as DocumentState | null;
      const [page, setPage] = useState<DocumentState>(
        initial?.kind === 'documents'
          ? initial
          : {
              kind: 'documents',
              selection: { primary: null, secondary: null, active: 'primary', split: false },
              reading: false,
              wide: false,
              versions: { primary: null, secondary: null },
              title: '文档',
            },
      );
      useChildPage(() => ({
        key: page.selection.primary ? 'documents:' + page.selection.primary : 'documents:list',
        title: page.title,
        icon: 'file',
        state: page,
      }));
      return (
        <>
          <output aria-label="文档页状态">{JSON.stringify(page)}</output>
          {['A', 'B'].map((id) => (
            <button
              key={id}
              onClick={() =>
                setPage((old) => ({
                  ...old,
                  selection: { ...old.selection, primary: 'doc' + id },
                  reading: true,
                  title: '文档' + id,
                }))
              }
            >
              选择文档{id}
            </button>
          ))}
          <button
            onClick={() =>
              setPage((old) => ({
                ...old,
                selection: { ...old.selection, secondary: 'comparison', split: true },
                wide: true,
                versions: { primary: 'fixed-version', secondary: null },
              }))
            }
          >
            调整文档阅读状态
          </button>
        </>
      );
    },
  };
});
vi.mock('./ui/SettingsView', () => ({
  default: ({ onBack, onSection }: { onBack(): void; onSection(section: 'editor'): void }) => (
    <>
      <p>设置内容</p>
      <button onClick={() => onSection('editor')}>切换编辑器设置</button>
      <button onClick={onBack}>关闭设置</button>
    </>
  ),
}));
vi.mock('./ui/TaskAttachments', () => ({ default: () => null }));
vi.mock('./ui/ReminderEditor', () => ({ default: () => null }));
vi.mock('./features/projects/ActivityList', () => ({ default: () => null }));
vi.mock('./shared/discussion/DiscussionFeed', () => ({ DiscussionFeed: () => null }));
vi.mock('./ui/TaskInspector', () => ({
  default: function MockTaskInspector({
    onPropertiesBlocked,
    onProjectDirty,
  }: {
    onPropertiesBlocked(value: boolean): void;
    onProjectDirty(value: boolean): void;
  }) {
    const [draft, setDraft] = useState('');
    return (
      <aside className="task-inspector">
        <input
          aria-label="属性草稿"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            onProjectDirty(true);
          }}
        />
        <button onClick={() => onPropertiesBlocked(true)}>未知提交</button>
      </aside>
    );
  },
}));
vi.mock('./editors/TaskContentEditor', () => ({
  default: ({ onDirty }: { onDirty(value: boolean): void }) => (
    <>
      <input aria-label="正文草稿" onChange={() => onDirty(true)} />
      <button onClick={() => onDirty(false)}>合成正文保存确认</button>
    </>
  ),
}));
vi.mock('./features/documents/BodyEditor', () => ({ default: () => <p>成果正文内容</p> }));
vi.mock('./EngineeringApp', () => ({ default: () => null }));

const task = {
  id: 'A',
  title: '任务A',
  objective: '',
  body_revision: 1,
  document_id: 'docA',
  body_id: 'bodyA',
} as Task;
const createdTask = {
  ...task,
  id: '11111111-1111-4111-8111-111111111111',
  title: '合成创建任务',
  status: 'todo',
  priority: 0,
  assignee: '本人',
  due_date: null,
  start_date: null,
  matter_id: null,
  tags: [],
  version: 1,
  document_id: 'docSynthetic',
  body_id: 'bodySynthetic',
} as Task;
function setup() {
  const api = vi.fn(async (request: TaskRequest) =>
    request.operation === 'read'
      ? { ok: true, tasks: [task], state: null }
      : { ok: true, tasks: [task], state: null },
  );
  window.caselite = { task: api } as unknown as Window['caselite'];
  render(<App />);
  return api;
}
const button = (name: string) => screen.getByRole('button', { name, exact: true });
const pageTabs = () => within(screen.getByRole('tablist', { name: '打开的页面' }));
const tab = (name: string) => pageTabs().getByRole('tab', { name, exact: true });
const selected = () =>
  pageTabs()
    .getAllByRole('tab')
    .find((item) => item.getAttribute('aria-selected') === 'true')
    ?.getAttribute('aria-label');
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('records the project list once under its canonical page identity', async () => {
  setup();
  await screen.findByText('首页内容');
  fireEvent.click(button('项目入口'));
  await screen.findByText('项目列表内容');
  await waitFor(() => expect(selected()).toBe('项目'));
  fireEvent.click(button('最近访问'));
  const recent = screen.getByLabelText('最近访问页面');
  expect(
    within(recent)
      .getAllByRole('button')
      .filter((item) => item.textContent === '项目'),
  ).toHaveLength(1);
});

it('drops a completed creation notice before later editor dirty state', async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.removeAttribute('open');
    },
  });
  let created = false;
  const api = vi.fn(async (request: TaskRequest) => {
    if (request.operation === 'create') {
      created = true;
      return {
        ok: true,
        receipt: request.idempotency_key,
        tasks: [{ ...createdTask, title: request.title }],
        state: null,
      };
    }
    if (request.operation === 'read' && request.task_id === createdTask.id) {
      return { ok: true, tasks: [createdTask], state: null };
    }
    return { ok: true, tasks: created ? [createdTask] : [], state: null };
  });
  const material = vi.fn(async () => ({ ok: true, creation_draft: null }));
  window.caselite = {
    task: api,
    material,
    catalog: vi.fn(async () => ({ ok: true, projects: [], documents: [] })),
  } as unknown as Window['caselite'];

  render(<App />);
  await screen.findByText('首页内容');
  fireEvent.click(button('任务入口'));
  await screen.findByText('任务列表内容');
  fireEvent.click(button('创建合成任务'));
  const title = (await screen.findByLabelText('任务名称')) as HTMLInputElement;
  fireEvent.change(title, { target: { value: createdTask.title } });
  await waitFor(() => expect((button('创建任务') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button('增加页面'));
  expect(screen.getByRole('alert').textContent).toContain('请先完成或取消当前新建表单。');
  expect(title.value).toBe(createdTask.title);
  expect(pageTabs().getAllByRole('tab')).toHaveLength(1);

  fireEvent.click(button('创建任务'));
  const body = (await screen.findByLabelText('正文草稿')) as HTMLInputElement;
  expect(screen.queryByRole('dialog', { name: '新建任务' })).toBeNull();
  const create = api.mock.calls.find(([request]) => request.operation === 'create')![0];
  expect(api.mock.calls.filter(([request]) => request.operation === 'create')).toHaveLength(1);
  expect(
    api.mock.calls.some(
      ([request]) =>
        request.operation === 'read' &&
        request.task_id === createdTask.id &&
        create.operation === 'create',
    ),
  ).toBe(true);
  expect(screen.queryByRole('alert')).toBeNull();

  fireEvent.change(body, { target: { value: '新正文输入应保留' } });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(button('增加页面'));
  expect(pageTabs().getAllByRole('tab')).toHaveLength(1);
  expect(screen.getByLabelText('正文草稿')).toBe(body);
  expect(body.value).toBe('新正文输入应保留');
  expect(screen.getByRole('alert').textContent).toContain('请先保存当前内容或核对提交结果');
  fireEvent.click(button('合成正文保存确认'));
  fireEvent.click(button('首页入口'));
  await screen.findByText('首页内容');
  expect(screen.queryByLabelText('正文草稿')).toBeNull();
});

it('keeps each page tab history independent and orders recent pages by the actual target', async () => {
  setup();
  await screen.findByText('首页内容');
  fireEvent.click(button('任务入口'));
  await screen.findByText('任务列表内容');
  fireEvent.click(button('项目入口'));
  await screen.findByText('项目列表内容');
  fireEvent.click(button('后退'));
  await screen.findByText('任务列表内容');
  expect(selected()).toBe('任务');
  fireEvent.click(button('最近访问'));
  const recent = screen.getByLabelText('最近访问页面');
  expect(within(recent).getAllByRole('button')[0].textContent).toBe('任务');
  fireEvent.click(button('最近访问'));
  fireEvent.click(button('增加页面'));
  await screen.findByRole('heading', { name: '打开一个页面' });
  fireEvent.click(button('首页入口'));
  await screen.findByText('首页内容');
  fireEvent.click(tab('任务'));
  await screen.findByText('任务列表内容');
  fireEvent.click(button('前进'));
  await screen.findByText('项目列表内容');
  fireEvent.click(tab('首页'));
  await screen.findByText('首页内容');
  fireEvent.click(button('后退'));
  await screen.findByRole('heading', { name: '打开一个页面' });
  expect(pageTabs().getAllByRole('tab')).toHaveLength(2);
});

it('closes an inactive tab without rereading or remounting the current editor', async () => {
  const api = setup();
  await screen.findByText('首页内容');
  fireEvent.click(button('增加页面'));
  await screen.findByRole('heading', { name: '打开一个页面' });
  fireEvent.click(button('打开任务A'));
  await screen.findByLabelText('正文草稿');
  const editor = screen.getByLabelText('正文草稿');
  const reads = api.mock.calls.length;
  fireEvent.click(button('关闭页面：首页'));
  await waitFor(() => expect(pageTabs().getAllByRole('tab')).toHaveLength(1));
  expect(screen.getByLabelText('正文草稿')).toBe(editor);
  expect(api.mock.calls.length).toBe(reads);
});

it.each(['正文草稿', '属性草稿'])(
  'preserves %s through inspector folding and rejects tab add/close/navigation',
  async (label) => {
    setup();
    await screen.findByText('首页内容');
    fireEvent.click(button('打开任务A'));
    await screen.findByLabelText(label);
    const input = screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '不可丢失的输入' } });
    fireEvent.click(button('收起右侧属性栏'));
    expect(document.querySelector('.workbench')?.getAttribute('data-inspector-open')).toBe('false');
    fireEvent.click(button('展开右侧属性栏'));
    expect(screen.getByLabelText(label)).toBe(input);
    expect(input.value).toBe('不可丢失的输入');
    fireEvent.click(button('增加页面'));
    fireEvent.click(button('关闭页面：任务A'));
    fireEvent.click(button('后退'));
    expect(pageTabs().getAllByRole('tab')).toHaveLength(1);
    expect(selected()).toBe('任务A');
    expect(screen.getByLabelText(label)).toBe(input);
    expect(screen.getByRole('alert').textContent).toContain('请先保存');
  },
);

it('does not let an unknown mutation receipt escape by closing or changing tabs', async () => {
  setup();
  await screen.findByText('首页内容');
  fireEvent.click(button('打开任务A'));
  await screen.findByText('未知提交');
  fireEvent.click(button('未知提交'));
  fireEvent.click(button('增加页面'));
  fireEvent.click(button('关闭页面：任务A'));
  expect(pageTabs().getAllByRole('tab')).toHaveLength(1);
  expect(selected()).toBe('任务A');
  expect(screen.getByRole('alert').textContent).toContain('核对提交结果');
});

it('restores independent settings without reading an unrelated previously opened task', async () => {
  const api = setup();
  await screen.findByText('首页内容');
  fireEvent.click(button('打开任务A'));
  await screen.findByLabelText('正文草稿');
  fireEvent.click(button('首页入口'));
  await screen.findByText('首页内容');
  fireEvent.click(button('设置入口'));
  await screen.findByText('设置内容');
  fireEvent.click(button('增加页面'));
  await screen.findByRole('heading', { name: '打开一个页面' });
  api.mockClear();
  api.mockImplementation(async () => {
    throw new Error('old task unavailable');
  });
  fireEvent.click(tab('设置'));
  await screen.findByText('设置内容');
  expect(selected()).toBe('设置');
  expect(api).not.toHaveBeenCalled();
});

it.each(['A', 'B'])(
  'returns to the selected document %s after settings without reading or writing a task body',
  async (id) => {
    const api = setup();
    await screen.findByText('首页内容');
    fireEvent.click(button('打开任务A'));
    await screen.findByLabelText('正文草稿');
    fireEvent.click(button('文档入口'));
    fireEvent.click(await screen.findByRole('button', { name: '选择文档' + id }));
    fireEvent.click(button('调整文档阅读状态'));
    const before = screen.getByLabelText('文档页状态').textContent;
    await waitFor(() => expect(selected()).toBe('文档' + id));
    api.mockClear();
    fireEvent.click(button('设置入口'));
    await screen.findByText('设置内容');
    fireEvent.click(button('切换编辑器设置'));
    fireEvent.click(button('关闭设置'));
    await waitFor(() => expect(screen.getByLabelText('文档页状态').textContent).toBe(before));
    expect(selected()).toBe('文档' + id);
    expect(api).not.toHaveBeenCalled();
  },
);

it('keeps the existing task and project settings return paths', async () => {
  const api = setup();
  await screen.findByText('首页内容');
  fireEvent.click(button('打开任务A'));
  await screen.findByLabelText('正文草稿');
  api.mockClear();
  fireEvent.click(button('设置入口'));
  await screen.findByText('设置内容');
  fireEvent.click(button('关闭设置'));
  await screen.findByLabelText('正文草稿');
  expect(api.mock.calls.filter(([request]) => request.operation === 'read')).toEqual([
    [expect.objectContaining({ operation: 'read', task_id: 'A' })],
  ]);
  expect(api.mock.calls.every(([request]) => request.operation === 'read')).toBe(true);
  fireEvent.click(button('项目入口'));
  fireEvent.click(await screen.findByRole('button', { name: '打开项目P' }));
  await screen.findByText('项目P内容');
  api.mockClear();
  fireEvent.click(button('设置入口'));
  await screen.findByText('设置内容');
  fireEvent.click(button('关闭设置'));
  await screen.findByText('项目P内容');
  expect(api).not.toHaveBeenCalled();
});

it('reopens a closed page with the keyboard and keeps a page after closing the last tab', async () => {
  setup();
  await screen.findByText('首页内容');
  fireEvent.click(button('任务入口'));
  await screen.findByText('任务列表内容');
  fireEvent.keyDown(window, { key: 'w', metaKey: true });
  await screen.findByRole('heading', { name: '打开一个页面' });
  fireEvent.keyDown(window, { key: 'T', metaKey: true, shiftKey: true });
  await screen.findByText('任务列表内容');
  expect(pageTabs().getAllByRole('tab')).toHaveLength(2);
  expect(selected()).toBe('任务');
});

it('ignores a late history read after a normal sidebar navigation supersedes it', async () => {
  const api = setup();
  await screen.findByText('首页内容');
  fireEvent.click(button('打开任务A'));
  await screen.findByLabelText('正文草稿');
  fireEvent.click(button('增加页面'));
  await screen.findByRole('heading', { name: '打开一个页面' });
  let resolve!: (value: { ok: boolean; tasks: Task[]; state: null }) => void;
  api.mockImplementation((request) =>
    request.operation === 'read'
      ? new Promise((done) => {
          resolve = done;
        })
      : Promise.resolve({ ok: true, tasks: [task], state: null }),
  );
  fireEvent.click(tab('任务A'));
  fireEvent.click(button('项目入口'));
  await screen.findByText('项目列表内容');
  await act(async () => {
    resolve({ ok: true, tasks: [task], state: null });
  });
  await waitFor(() => expect(selected()).toBe('项目'));
  expect(screen.queryByLabelText('正文草稿')).toBeNull();
});

it('does not apply an old page scroll restoration after the sidebar opens another page', async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  setup();
  await screen.findByText('首页内容');
  const workspace = document.querySelector<HTMLElement>('.workspace-main')!;
  workspace.scrollTop = 128;
  fireEvent.click(button('增加页面'));
  await screen.findByRole('heading', { name: '打开一个页面' });
  fireEvent.click(tab('首页'));
  await screen.findByText('首页内容');
  fireEvent.click(button('项目入口'));
  await screen.findByText('项目列表内容');
  workspace.scrollTop = 7;
  act(() => {
    while (frames.length) frames.shift()!(0);
  });
  expect(workspace.scrollTop).toBe(7);
  expect(selected()).toBe('项目');
});

it('restores both zero and nonzero scroll on the persistent work area', async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const flush = () =>
    act(() => {
      while (frames.length) frames.shift()!(0);
    });
  setup();
  await screen.findByText('首页内容');
  const workspace = document.querySelector<HTMLElement>('.workspace-main')!;
  fireEvent.click(button('增加页面'));
  await screen.findByRole('heading', { name: '打开一个页面' });
  fireEvent.click(button('项目入口'));
  await screen.findByText('项目列表内容');
  workspace.scrollTop = 128;
  workspace.scrollLeft = 42;
  fireEvent.click(tab('首页'));
  await screen.findByText('首页内容');
  flush();
  expect(workspace.scrollTop).toBe(0);
  expect(workspace.scrollLeft).toBe(0);
  fireEvent.click(tab('项目'));
  await screen.findByText('项目列表内容');
  flush();
  expect(workspace.scrollTop).toBe(128);
  expect(workspace.scrollLeft).toBe(42);
});
