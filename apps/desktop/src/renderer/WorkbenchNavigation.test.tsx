// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContext, useState } from 'react';
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
      <button onClick={() => onNavigate('calendar')}>日历入口</button>
      <button onClick={() => onNavigate('tasks')}>全局入口</button>
      <button onClick={() => onNavigate('settings')}>设置入口</button>
      <button onClick={() => onOpen('B')}>全局B</button>
      {children}
    </>
  ),
}));
vi.mock('./features/projects/ProjectCatalog', () => ({
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
    content,
  }: {
    content?: React.ReactNode;
    onProjectDirty(v: boolean): void;
    onPropertiesBlocked(v: boolean): void;
  }) => (
    <>
      {content}
      <input aria-label="未保存草稿" onChange={() => onProjectDirty(true)} />
      <button onClick={() => onPropertiesBlocked(true)}>未知提交</button>
    </>
  ),
}));
vi.mock('./features/calendar/CalendarView', () => ({
  default: function Calendar({
    inspector,
    onOpen,
    blocked,
  }: {
    inspector: React.ReactNode;
    onOpen(id: string): void;
    blocked: boolean;
  }) {
    const [showClosed, setShowClosed] = useState(false);
    const [page, setPage] = useState(0);
    return (
      <div>
        <input
          aria-label="显示已完成"
          type="checkbox"
          checked={showClosed}
          onChange={(e) => setShowClosed(e.target.checked)}
        />
        <button onClick={() => setPage(page + 1)}>日历下一页</button>
        <span>
          日历分页{page}；日期计数{showClosed ? 5 : 4}
        </span>
        <button disabled={blocked} onClick={() => onOpen('A')}>
          日历A
        </button>
        {inspector}
      </div>
    );
  },
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

it('keeps the calendar inspector compact and opens original Task content through the existing detail route', async () => {
  setup();
  await screen.findByText('首页');
  fireEvent.click(screen.getByText('日历入口'));
  fireEvent.click(screen.getByText('日历A'));
  const content = await screen.findByRole('button', { name: '打开任务内容' });
  expect(screen.queryByTestId('save-task-content')).toBeNull();
  expect(screen.queryByRole('button', { name: '本机提醒' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'A' })).toBeTruthy();
  fireEvent.click(content);
  await waitFor(() =>
    expect(document.querySelector('[data-active-task]')?.getAttribute('data-active-task')).toBe(
      'A',
    ),
  );
  expect(screen.getByTestId('save-task-content')).toBeTruthy();
});

it('preserves the mounted calendar filters, count and page while a Task read is pending and succeeds', async () => {
  let complete!: (v: unknown) => void;
  setup(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await screen.findByText('首页');
  fireEvent.click(screen.getByText('日历入口'));
  fireEvent.click(screen.getByLabelText('显示已完成'));
  fireEvent.click(screen.getByText('日历下一页'));
  fireEvent.click(screen.getByText('日历A'));
  expect(screen.getByText('日历分页1；日期计数5')).toBeTruthy();
  expect((screen.getByText('日历A') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => complete(result('A')));
  await screen.findByRole('button', { name: '打开任务内容' });
  expect((screen.getByLabelText('显示已完成') as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText('日历分页1；日期计数5')).toBeTruthy();
});
