// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task, TaskRequest } from '../preload/caselite-api';
import App from './App';
import { ModelSettingsNavigation } from './shared/navigation/ModelSettingsNavigation';
vi.mock('@tiptap/react', () => ({ useEditor: () => null }));
vi.mock('./ui/Appearance', () => ({
  AppearanceProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./editors/RichEditor', () => ({
  emptyDraft: () => ({ text: '', state: null }),
  localExtensions: () => [],
  useLocalDoc: () => null,
  EditorSurface: () => <div />,
  DraftEditor: () => <div />,
}));
vi.mock('./ui/Workspace', () => ({
  Icon: () => null,
  WorkspaceShell: ({
    children,
    onNavigate,
    onOpen,
  }: {
    children: React.ReactNode;
    onNavigate(v: string): void;
    onOpen(id: string): void;
  }) => (
    <>
      <button onClick={() => onNavigate('projects')}>项目入口</button>
      <button onClick={() => onNavigate('tasks')}>全局入口</button>
      <button onClick={() => onNavigate('settings')}>设置入口</button>
      <button onClick={() => onOpen('B')}>全局B</button>
      {children}
    </>
  ),
}));
vi.mock('./projects/ProjectCatalog', () => ({
  default: ({
    onOpen,
    initialView,
  }: {
    onOpen(id: string, source: object): void;
    initialView?: { projectId: string };
  }) => (
    <div>
      <span>项目视图{initialView?.projectId}</span>
      <button onClick={() => onOpen('A', { projectId: 'P', section: 'tasks' })}>项目A</button>
    </div>
  ),
}));
vi.mock('./ui/TaskInspector', () => ({
  default: ({
    onProjectDirty,
    onPropertiesBlocked,
  }: {
    onProjectDirty(v: boolean): void;
    onPropertiesBlocked(v: boolean): void;
  }) => (
    <>
      <input aria-label="未保存草稿" onChange={() => onProjectDirty(true)} />
      <button onClick={() => onPropertiesBlocked(true)}>未知提交</button>
    </>
  ),
}));
vi.mock('./ui/SettingsView', () => {
  return {
    default: ({ onBack, section }: { onBack(): void; section: string }) => (
      <>
        <h2>{section}</h2>
        <button onClick={onBack}>关闭设置</button>
      </>
    ),
  };
});
vi.mock('./ui/AgentHome', () => ({
  default: function MockAgentHome() {
    const openSettings = useContext(ModelSettingsNavigation);
    return <button onClick={() => openSettings?.()}>首页</button>;
  },
}));
vi.mock('./ui/RecordList', () => ({
  initialTaskListState: {},
  default: () => <div>全局任务列表</div>,
}));
vi.mock('./EngineeringApp', () => ({ default: () => null }));
const task = (id: string) =>
  ({
    id,
    title: id,
    objective: '',
    body_revision: 1,
    document_id: 'doc' + id,
    body_id: 'body' + id,
  }) as Task;
const result = (id: string) => ({ ok: true, tasks: [task(id)], state: null });
function setup(read?: (id: string) => Promise<unknown>) {
  window.caselite = {
    task: vi.fn(async (r: TaskRequest) =>
      r.operation === 'read'
        ? read
          ? read(r.task_id)
          : result(r.task_id)
        : { ok: true, tasks: [task('A'), task('B')], state: null },
    ),
  } as unknown as Window['caselite'];
  render(<App />);
}
afterEach(cleanup);
async function projectTask() {
  await screen.findByText('首页');
  fireEvent.click(screen.getByText('项目入口'));
  fireEvent.click(screen.getByText('项目A'));
  await screen.findByRole('button', { name: '返回来源项目' });
}
it('opens AI and services directly from the model shortcut and returns to home', async () => {
  setup();
  fireEvent.click(await screen.findByText('首页'));
  await screen.findByRole('heading', { name: 'models' });
  fireEvent.click(screen.getByText('关闭设置'));
  await screen.findByText('首页');
});
it('keeps the source when settings rereads the same task and clears it on a global task open', async () => {
  setup();
  await projectTask();
  fireEvent.click(screen.getByTestId('task-result-tab'));
  fireEvent.click(screen.getByText('设置入口'));
  fireEvent.click(screen.getByText('关闭设置'));
  await screen.findByRole('button', { name: '返回来源项目' });
  expect(screen.getByTestId('task-result-tab').getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByTestId('back-to-tasks'));
  await screen.findByText('项目视图P');
  fireEvent.click(screen.getByText('全局B'));
  await screen.findByRole('button', { name: '返回任务列表' });
  fireEvent.click(screen.getByTestId('back-to-tasks'));
  await screen.findByText('全局任务列表');
});
it.each(['draft', 'unknown'])(
  'blocks return and preserves the mounted task for %s',
  async (mode) => {
    setup();
    await projectTask();
    fireEvent.click(screen.getByTestId('task-result-tab'));
    if (mode === 'draft')
      fireEvent.change(screen.getByLabelText('未保存草稿'), { target: { value: '不得丢失' } });
    else fireEvent.click(screen.getByText('未知提交'));
    fireEvent.click(screen.getByTestId('back-to-tasks'));
    await screen.findByText(/请先保存当前内容或核对提交结果/);
    expect(document.querySelector('[data-active-task]')?.getAttribute('data-active-task')).toBe(
      'A',
    );
    if (mode === 'draft')
      expect((screen.getByLabelText('未保存草稿') as HTMLInputElement).value).toBe('不得丢失');
  },
);
it('ignores a late project task success after a global navigation', async () => {
  let resolve!: (v: unknown) => void;
  setup(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await screen.findByText('首页');
  fireEvent.click(screen.getByText('项目入口'));
  fireEvent.click(screen.getByText('项目A'));
  fireEvent.click(screen.getByText('全局入口'));
  await act(async () => resolve(result('A')));
  await screen.findByText('全局任务列表');
  expect(screen.queryByRole('button', { name: '返回来源项目' })).toBeNull();
});
it('does not let a late project failure overwrite a newer task', async () => {
  let reject!: (e: Error) => void;
  setup((id) =>
    id === 'A'
      ? new Promise((_, r) => {
          reject = r;
        })
      : Promise.resolve(result('B')),
  );
  await screen.findByText('首页');
  fireEvent.click(screen.getByText('项目入口'));
  fireEvent.click(screen.getByText('项目A'));
  fireEvent.click(screen.getByText('全局B'));
  await screen.findByRole('button', { name: '返回任务列表' });
  await act(async () => reject(new Error('迟到错误')));
  await waitFor(() => expect(screen.queryByText('迟到错误')).toBeNull());
  expect(document.querySelector('[data-active-task]')?.getAttribute('data-active-task')).toBe('B');
});
