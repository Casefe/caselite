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
  default: () => <p>任务列表内容</p>,
}));
vi.mock('./features/projects/ProjectCatalog', () => ({ default: () => <p>项目列表内容</p> }));
vi.mock('./ui/SettingsView', () => ({
  default: ({ onBack }: { onBack(): void }) => (
    <>
      <p>设置内容</p>
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
    <input aria-label="正文草稿" onChange={() => onDirty(true)} />
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
