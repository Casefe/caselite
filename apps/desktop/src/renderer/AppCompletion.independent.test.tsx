// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task, TaskRequest } from '../preload/caselite-api';
import App from './App';
import { ModelSettingsNavigation } from './shared/navigation/ModelSettingsNavigation';
vi.mock('@tiptap/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tiptap/react')>()),
  useEditor: () => null,
}));
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
vi.mock('./ui/Workspace', async (original) => ({
  ...(await original<typeof import('./ui/Workspace')>()),
  Icon: () => null,
  WorkspaceShell: ({
    children,
    onNavigate,
    onOpen,
    importantDatesCount,
  }: {
    children: React.ReactNode;
    onNavigate(v: string): void;
    onOpen(id: string): void;
    importantDatesCount?: number;
  }) => (
    <>
      <button onClick={() => onNavigate('projects')}>项目入口</button>
      <button onClick={() => onNavigate('calendar')}>日历入口</button>
      <output aria-label="日历导航计数">{importantDatesCount ?? '未读取'}</output>
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
vi.mock('./EngineeringApp', () => ({ default: () => null }));
afterEach(cleanup);

it('INDEPENDENT preserves completion recovery when the actual filtered page refresh fails', async () => {
  const t: Task = {
    id: 'completion-A',
    title: '确认刷新任务',
    objective: '',
    status: 'todo',
    priority: 0,
    due_date: null,
    version: 1,
    matter_id: null,
    document_id: 'doc-A',
    body_id: 'body-A',
    body_revision: 0,
    editor_schema: 1,
    updated_at: '2030-01-01',
  };
  const saved = { ...t, version: 2, status: 'done' as const };
  let committed = false;
  let failing = true;
  const api = vi.fn(async (r: TaskRequest) => {
    if (r.operation === 'calendar_query')
      return {
        ok: true,
        tasks: [],
        state: null,
        receipt: null,
        page: { offset: 0, total: 0, has_more: false },
      };
    if (r.operation === 'change_status') {
      committed = true;
      return { ok: true, tasks: [saved], state: null, receipt: r.idempotency_key };
    }
    if (r.operation === 'read') return { ok: true, tasks: [saved], state: null, receipt: null };
    if (r.operation === 'list') {
      if (r.query && committed && failing)
        return { ok: false, code: 'READ_FAILED', message: '独立反例：实际分页读取失败' };
      return {
        ok: true,
        tasks: [committed ? saved : t],
        state: null,
        receipt: null,
        page: { offset: 0, total: 1, has_more: false },
      };
    }
    throw Error('unexpected operation ' + r.operation);
  });
  window.caselite = {
    task: api,
    catalog: vi.fn(async () => ({
      ok: true,
      projects: [],
      documents: [],
      state: null,
      target_id: null,
      receipt: null,
    })),
  } as unknown as Window['caselite'];
  render(<App />);
  await screen.findByText('首页');
  fireEvent.click(screen.getByText('全局入口'));
  await screen.findByRole('button', { name: '完成任务：确认刷新任务' });
  fireEvent.click(screen.getByLabelText('选择多个任务'));
  fireEvent.click(screen.getByRole('checkbox', { name: '勾选任务：确认刷新任务' }));
  fireEvent.click(screen.getByRole('button', { name: '完成任务：确认刷新任务' }));
  await screen.findByText('独立反例：实际分页读取失败', { exact: false });
  expect(api.mock.calls.filter(([r]) => r.operation === 'change_status')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '重新读取任务和列表' })).toBeTruthy();
  expect((screen.getByRole('button', { name: '✓ 标记完成' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByLabelText('批量设置优先级') as HTMLSelectElement).disabled).toBe(true);
  failing = false;
  fireEvent.click(screen.getByRole('button', { name: '重新读取任务和列表' }));
  await screen.findByRole('button', { name: '已完成任务：确认刷新任务' });
  expect(api.mock.calls.filter(([r]) => r.operation === 'change_status')).toHaveLength(1);
  expect(api.mock.calls.filter(([r]) => r.operation === 'status')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: '重新读取任务和列表' })).toBeNull();
});

it('INDEPENDENT guards navigation and beforeunload during pending and unknown completion', async () => {
  const t: Task = {
    id: 'guard-A',
    title: '离开保护任务',
    objective: '',
    status: 'todo',
    priority: 0,
    due_date: null,
    version: 1,
    matter_id: null,
    document_id: 'doc-A',
    body_id: 'body-A',
    body_revision: 0,
    editor_schema: 1,
    updated_at: '2030-01-01',
  };
  let release!: (v: unknown) => void;
  const api = vi.fn(async (r: TaskRequest) => {
    if (r.operation === 'change_status')
      return new Promise((resolve) => {
        release = resolve;
      });
    return {
      ok: true,
      tasks: r.operation === 'calendar_query' ? [] : [t],
      state: null,
      receipt: null,
      page: { offset: 0, total: r.operation === 'calendar_query' ? 0 : 1, has_more: false },
    };
  });
  window.caselite = {
    task: api,
    catalog: vi.fn(async () => ({
      ok: true,
      projects: [],
      documents: [],
      state: null,
      target_id: null,
      receipt: null,
    })),
  } as unknown as Window['caselite'];
  render(<App />);
  await screen.findByText('首页');
  fireEvent.click(screen.getByText('全局入口'));
  await screen.findByRole('button', { name: '完成任务：离开保护任务' });
  fireEvent.click(screen.getByLabelText('选择多个任务'));
  fireEvent.click(screen.getByRole('checkbox', { name: '勾选任务：离开保护任务' }));
  fireEvent.click(screen.getByRole('button', { name: '完成任务：离开保护任务' }));
  await screen.findByText('正在确认任务完成…');
  expect((screen.getByRole('button', { name: '✓ 标记完成' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByLabelText('批量设置优先级') as HTMLSelectElement).disabled).toBe(true);
  for (const entry of ['项目入口', '日历入口', '设置入口', '全局B']) {
    fireEvent.click(screen.getByText(entry));
    expect(screen.getByRole('button', { name: '完成任务：离开保护任务' })).toBeTruthy();
  }
  const before = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(before);
  expect(before.defaultPrevented).toBe(true);
  await act(async () => release({ ok: false, code: 'RESULT_UNKNOWN', message: '原结果未知' }));
  await screen.findByText('核对原完成操作');
  expect((screen.getByRole('button', { name: '✓ 标记完成' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByLabelText('批量设置优先级') as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('日历入口'));
  expect(screen.getByRole('button', { name: '完成任务：离开保护任务' })).toBeTruthy();
  const unknown = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unknown);
  expect(unknown.defaultPrevented).toBe(true);
  expect(api.mock.calls.filter(([r]) => r.operation === 'change_status')).toHaveLength(1);
});
