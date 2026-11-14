// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentRequest, AgentResponse, AgentRun } from '../../preload/caselite-api';
import AgentHome from './AgentHome';

// 这里验证首页状态、身份与稳定子树；真实分栏尺寸和点击命中由 Electron 验收。
vi.mock('react-resizable-panels', async () => {
  const React = await import('react');
  return {
    Group: ({ children, groupRef }: { children: ReactNode; groupRef: React.Ref<unknown> }) => {
      React.useImperativeHandle(groupRef, () => ({ setLayout: vi.fn() }));
      return <div>{children}</div>;
    },
    Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Separator: () => null,
  };
});
const projection = vi.hoisted(() => ({ runs: [] as AgentRun[], mounts: 0 }));
vi.mock('./AgentPanel', async () => {
  const React = await import('react');
  return {
    default: function MockAgentPanel({
      editorRef,
      onDraft,
      onConversationChange,
      onHomeViewState,
      hideMessages,
      otherRunActive,
      otherRunStatusUnknown,
    }: {
      editorRef: React.Ref<{ append(text: string): void }>;
      onDraft(value: { text: string; state: null }): void;
      onConversationChange(value: boolean): void;
      onHomeViewState(value: { runs: AgentRun[] }): void;
      hideMessages: boolean;
      otherRunActive: boolean;
      otherRunStatusUnknown: boolean;
    }) {
      React.useEffect(() => {
        projection.mounts++;
      }, []);
      React.useEffect(() => {
        onHomeViewState({ runs: projection.runs });
      }, [onHomeViewState]);
      React.useImperativeHandle(editorRef, () => ({
        append: (text: string) => onDraft({ text, state: null }),
      }));
      return (
        <div
          data-testid="live-agent"
          data-hide-messages={hideMessages}
          data-busy={otherRunActive}
          data-unknown={otherRunStatusUnknown}
        >
          <textarea data-testid="agent-input" aria-label="演示草稿" />
          <button onClick={() => onConversationChange(true)}>模拟进入对话</button>
          <button onClick={() => onHomeViewState({ runs: [...projection.runs] })}>
            回读同一运行
          </button>
          <button
            onClick={() => onHomeViewState({ runs: [...projection.runs, makeRun('new-id')] })}
          >
            新运行回执
          </button>
        </div>
      );
    },
    AgentRunReadOnly: ({ run }: { run: AgentRun }) => (
      <section aria-label="只读运行记录">
        {run.output || run.message}
        <span>{run.status}</span>
      </section>
    ),
  };
});
vi.mock('../features/calendar/ImportantSchedules', () => ({
  default: ({ onCalendar }: { onCalendar(): void }) => (
    <button onClick={onCalendar}>重要日程</button>
  ),
}));
function makeRun(id = 'r1', patch: Partial<AgentRun> = {}): AgentRun {
  return {
    id,
    scope: 'home',
    prompt: `问题-${id}`,
    output: `回答-${id}`,
    model: 'gpt-4.1-mini',
    provider: 'openai',
    status: 'succeeded',
    sequence: 1,
    message: '已完成',
    usage: null,
    ...patch,
  };
}
const profile = {
  ok: true,
  runs: [],
  model: 'gpt-4.1-mini',
  configured: true,
  providers: { openai: true, deepseek: false },
} as AgentResponse;
function api(handler?: (request: AgentRequest) => AgentResponse | Promise<AgentResponse>) {
  const agent = vi.fn(async (request: AgentRequest) => (handler ? handler(request) : profile));
  const catalog = vi.fn(async () => ({
    ok: true,
    projects: [
      { id: 'p1', title: '示例项目', archived_at: null, task_count: 2 },
      { id: 'p2', title: '已归档项目', archived_at: '2026-01-01', task_count: 0 },
    ],
    documents: [],
    state: null,
    target_id: null,
    receipt: null,
  }));
  window.caselite = { agent, catalog } as unknown as Window['caselite'];
  return { agent, catalog };
}
function renderHome(extra: Partial<Parameters<typeof AgentHome>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    prompt: { text: '', state: null },
    onPrompt: vi.fn(),
    onNavigate: vi.fn(),
    tasks: [],
    onOpen: vi.fn(),
    onOpenProject: vi.fn(),
    ...extra,
  };
  const view = rtlRender(
    <QueryClientProvider client={client}>
      <AgentHome {...props} />
    </QueryClientProvider>,
  );
  return { ...view, props };
}
beforeEach(() => {
  projection.runs = [];
  projection.mounts = 0;
  vi.stubGlobal('innerWidth', 1200);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shows current projects and fills a prompt without navigating from shortcuts', async () => {
  const { agent, catalog } = api();
  const { props, container } = renderHome();
  await screen.findByText('暂无运行中的智能体');
  fireEvent.click(await screen.findByRole('button', { name: '示例项目' }));
  expect(props.onOpenProject).toHaveBeenCalledWith('p1');
  expect(screen.queryByText('已归档项目')).toBeNull();
  expect(catalog).toHaveBeenCalledWith({
    protocol_version: 1,
    operation: 'list',
    project_properties: true,
  });
  const headings = [...screen.getByLabelText('Agent 目录').querySelectorAll('h3')].map((item) =>
    item.textContent?.trim(),
  );
  expect(headings).toEqual(['置顶', '项目', '最近对话']);
  fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
  expect(props.onPrompt).toHaveBeenCalledWith(
    expect.objectContaining({ text: expect.stringContaining('拟定任务') }),
  );
  expect(props.onNavigate).not.toHaveBeenCalled();
  for (const name of ['创建项目', '生成文书', '合同审查', '法律研究'])
    expect(screen.getByRole('button', { name })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '全部历史对话' }));
  fireEvent.click(screen.getByRole('button', { name: '展开重要日程' }));
  fireEvent.click(screen.getByRole('button', { name: '重要日程', exact: true }));
  expect(vi.mocked(props.onNavigate).mock.calls).toEqual([['agent-history'], ['calendar']]);
  expect(
    container.querySelector('.agent-topline, .home-conversation-toolbar, .home-topbar'),
  ).toBeNull();
  expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
});

it('places the only directory and running controls in topbar slots and preserves the live input through all panels', async () => {
  api();
  const leftSlot = document.createElement('div'),
    rightSlot = document.createElement('div');
  document.body.append(leftSlot, rightSlot);
  const view = renderHome({ leftSlot, rightSlot });
  try {
    await screen.findByText('暂无运行中的智能体');
    const input = screen.getByLabelText('演示草稿') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '保留待发送草稿' } });
    expect(within(leftSlot).getByRole('button', { name: '收起 Agent 目录' })).toBeTruthy();
    expect(within(rightSlot).getByRole('button', { name: '收起进行中的智能体' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '模拟进入对话' }));
    fireEvent.click(screen.getByRole('button', { name: '收起 Agent 目录' }));
    fireEvent.click(screen.getByRole('button', { name: '展开 Agent 目录' }));
    for (const name of ['本轮材料', '成果', '重要日程', '对话信息']) {
      fireEvent.click(screen.getByRole('button', { name: `展开${name}` }));
      fireEvent.click(screen.getByRole('button', { name: '收起辅助面板' }));
    }
    fireEvent.click(screen.getByRole('button', { name: '收起进行中的智能体' }));
    fireEvent.click(screen.getByRole('button', { name: '展开进行中的智能体' }));
    expect(screen.getByLabelText('演示草稿')).toBe(input);
    expect(input.value).toBe('保留待发送草稿');
    expect(projection.mounts).toBe(1);
    expect(screen.getAllByRole('button', { name: /Agent 目录/ })).toHaveLength(1);
    expect(view.container.querySelector('.home-conversation-toolbar')).toBeNull();
  } finally {
    view.unmount();
    leftSlot.remove();
    rightSlot.remove();
  }
});

it('shows stored rounds, opens details, and sends only a pin command', async () => {
  const run = makeRun('stored', { scope: 'task-origin' });
  const { agent } = api(
    (request) =>
      ({
        ...profile,
        runs:
          request.operation === 'active_runs'
            ? []
            : [{ ...run, pinned: request.operation === 'pin_history' }],
      }) as AgentResponse,
  );
  renderHome();
  const historyOpen = await screen.findByRole('button', { name: run.prompt, exact: true });
  expect(historyOpen.classList.contains('home-history-open')).toBe(true);
  fireEvent.click(historyOpen);
  expect(await screen.findByText(run.output)).toBeTruthy();
  expect(screen.getByLabelText('只读运行记录').closest('.home-history-detail')).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: '演示草稿' })).toBeNull();
  expect(screen.getByTestId('live-agent')).toBeTruthy();
  const pin = screen.getByRole('button', { name: `置顶：${run.prompt}` });
  expect(pin.classList.contains('home-history-pin')).toBe(true);
  fireEvent.click(pin);
  await screen.findByRole('button', { name: `取消置顶：${run.prompt}` });
  expect(agent).toHaveBeenCalledWith({
    protocol_version: 1,
    operation: 'read',
    scope: 'task-origin',
  });
  expect(agent.mock.calls.map(([request]) => request.operation).sort()).toEqual(
    ['active_runs', 'history', 'pin_history', 'read'].sort(),
  );
});

it('new conversation retains the draft and waits for a genuinely new Run ID rather than a repeated nonempty list', async () => {
  projection.runs = [makeRun('existing')];
  api();
  renderHome();
  const input = screen.getByLabelText('演示草稿') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '已有草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(screen.getByTestId('live-agent').dataset.hideMessages).toBe('true');
  expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByRole('button', { name: '回读同一运行' }));
  expect(screen.getByTestId('live-agent').dataset.hideMessages).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '新运行回执' }));
  expect(screen.getByTestId('live-agent').dataset.hideMessages).toBe('false');
  expect(input.value).toBe('已有草稿');
  expect(projection.mounts).toBe(1);
});

it('prefers a real cross-scope active Run, then verifies its terminal state and hides stale running after read failure', async () => {
  vi.useFakeTimers();
  const running = makeRun('foreign', {
    scope: 'task-origin',
    status: 'running',
    output: '真实进度',
  });
  let active: AgentRun[] = [running];
  let stored: AgentRun[] = [running];
  let fail = false;
  const { agent } = api((request) => {
    if (request.operation === 'active_runs') return { ...profile, runs: active } as AgentResponse;
    if (request.operation === 'read')
      return fail
        ? { ok: false, code: 'RESULT_UNKNOWN', message: '原范围暂不可读' }
        : ({ ...profile, runs: stored } as AgentResponse);
    return profile;
  });
  renderHome();
  await act(async () => {});
  expect(screen.getByLabelText('只读运行记录').textContent).toContain('真实进度');
  expect(screen.queryByRole('textbox', { name: '演示草稿' })).toBeNull();
  expect(screen.getByTestId('live-agent').dataset.busy).toBe('true');
  active = [];
  stored = [{ ...running, status: 'succeeded', output: '终态回答' }];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByLabelText('只读运行记录').textContent).toContain('终态回答');
  expect(screen.queryByText('真实进度')).toBeNull();
  // 再选历史时，旧记录不能在失败回执后继续显示 running。
  fail = true;
  fireEvent.click(screen.getByRole('button', { name: '新对话' }));
  active = [running];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  fireEvent.click(screen.getByRole('button', { name: /问题-foreign.*任务对话/ }));
  await act(async () => {});
  expect(screen.getByRole('alert').textContent).toContain('原范围暂不可读');
  expect(screen.queryByLabelText('只读运行记录')).toBeNull();
  expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
});

it('shows project read errors with retry rather than presenting cached rows as a successful catalog', async () => {
  api();
  let fail = true;
  window.caselite.catalog = vi.fn(async () => {
    if (fail) throw new Error('offline');
    return { ok: true, projects: [], documents: [], state: null, target_id: null, receipt: null };
  }) as Window['caselite']['catalog'];
  renderHome();
  await screen.findByText(/项目读取失败/);
  expect(screen.queryByText('示例项目')).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByText('暂无项目');
});

it('uses compact overlays without remounting the composer and restores directory control focus on Escape', async () => {
  vi.stubGlobal('innerWidth', 600);
  api();
  renderHome();
  await screen.findByText('暂无对话');
  const input = screen.getByLabelText('演示草稿');
  const toggle = screen.getByRole('button', { name: '展开 Agent 目录' });
  fireEvent.click(toggle);
  const directory = screen.getByLabelText('Agent 目录');
  expect(directory.dataset.overlay).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '展开本轮材料' }));
  expect(directory.hidden).toBe(false);
  input.focus();
  fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
  expect(directory.hidden).toBe(false);
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(directory.hidden).toBe(true);
  expect(document.activeElement).toBe(toggle);
  expect(screen.getByLabelText('演示草稿')).toBe(input);
  expect(projection.mounts).toBe(1);
});

it('isolates historical Run attachments from the unsent home material draft', async () => {
  const run = makeRun('attached', {
    scope: 'task-origin',
    attachments: [
      { source_id: 'history-source', task_id: 'task-origin', name: '历史原件.pdf', pages: [1] },
    ],
  });
  api(
    (request) =>
      ({ ...profile, runs: request.operation === 'active_runs' ? [] : [run] }) as AgentResponse,
  );
  window.caselite.material = vi.fn(async () => ({
    ok: true,
    materials: [],
    staged: { token: 'draft-token', name: '未发送材料.pdf', bytes: 100 },
  })) as Window['caselite']['material'];
  renderHome();
  fireEvent.click(screen.getByRole('button', { name: '展开本轮材料' }));
  const auxiliary = screen.getByLabelText('首页辅助面板');
  await within(auxiliary).findByText(/未发送材料.pdf/);
  fireEvent.click(await screen.findByRole('button', { name: run.prompt, exact: true }));
  await within(auxiliary).findByText('历史原件.pdf');
  expect(within(auxiliary).queryByText(/未发送材料.pdf/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(within(auxiliary).getByText(/未发送材料.pdf/)).toBeTruthy();
  expect(within(auxiliary).queryByText('历史原件.pdf')).toBeNull();
});

it('keeps an older home-scope active Run guarded when the fresh live session does not own it', async () => {
  const older = makeRun('older-home', { status: 'running' });
  const { agent } = api(
    (request) =>
      ({ ...profile, runs: request.operation === 'history' ? [] : [older] }) as AgentResponse,
  );
  renderHome();
  await screen.findByLabelText('只读运行记录');
  fireEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(screen.getByTestId('live-agent').dataset.busy).toBe('true');
  expect(projection.mounts).toBe(1);
  expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
});

it('distinguishes delayed and rejected material lists from a verified empty draft and recovers the original source', async () => {
  vi.useFakeTimers();
  api();
  let rejectInitial: (error: Error) => void = () => {};
  const initial = new Promise<never>((_resolve, reject) => {
    rejectInitial = reject;
  });
  let recovered = false,
    verifiedEmpty = false;
  const source = '91919191-9191-4191-8191-919191919191';
  const material = vi.fn(async () =>
    verifiedEmpty
      ? { ok: true, materials: [], staged: null }
      : recovered
        ? {
            ok: true,
            materials: [],
            staged: {
              token: source,
              restore_source_id: source,
              name: '原标识恢复材料.pdf',
              bytes: 100,
            },
          }
        : initial,
  );
  window.caselite.material = material as Window['caselite']['material'];
  renderHome();
  fireEvent.click(screen.getByRole('button', { name: '展开本轮材料' }));
  const auxiliary = screen.getByLabelText('首页辅助面板');
  expect(within(auxiliary).getByText('正在读取本轮材料…')).toBeTruthy();
  expect(within(auxiliary).queryByText('本轮未添加材料')).toBeNull();
  await act(async () => {
    rejectInitial(new Error('list offline'));
  });
  expect(within(auxiliary).getByRole('alert').textContent).toContain('材料列表暂不可核对');
  expect(within(auxiliary).queryByText('本轮未添加材料')).toBeNull();
  recovered = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  const original = within(auxiliary).getByText(/原标识恢复材料.pdf/);
  expect(original.getAttribute('data-home-material-source')).toBe(source);
  expect(within(auxiliary).queryByRole('alert')).toBeNull();
  expect(material).toHaveBeenLastCalledWith({
    protocol_version: 1,
    operation: 'list',
    scope: 'home',
  });
  verifiedEmpty = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(within(auxiliary).getByText('本轮未添加材料')).toBeTruthy();
  expect(within(auxiliary).queryByText(/原标识恢复材料.pdf/)).toBeNull();
});

it('shows the original interrupted history message before expanding it without reviving a Run or adding a composer', async () => {
  const interrupted = makeRun('reopened-interrupted', {
    status: 'interrupted',
    message: '上次运行被中断',
    output: '重开后保留的部分回答',
    pinned: true,
  });
  const { agent } = api(
    (request) =>
      ({
        ...profile,
        runs: request.operation === 'active_runs' ? [] : [interrupted],
      }) as AgentResponse,
  );
  const { container } = renderHome();
  const message = await screen.findByText('上次运行被中断');
  expect(screen.getByLabelText('Agent 目录').contains(message)).toBe(true);
  expect(message.classList.contains('interrupted')).toBe(true);
  expect(message.getAttribute('data-run-id')).toBe(interrupted.id);
  expect(message.getAttribute('data-run-scope')).toBe(interrupted.scope);
  expect(screen.queryByLabelText('只读运行记录')).toBeNull();
  expect(container.querySelector('.assistant-run-status.running')).toBeNull();
  expect(
    screen
      .getByRole('button', { name: `取消置顶：${interrupted.prompt}` })
      .getAttribute('aria-pressed'),
  ).toBe('true');
  expect(
    agent.mock.calls.some(
      ([request]) => request.operation === 'start' || request.operation === 'cancel',
    ),
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: interrupted.prompt, exact: true }));
  const record = await screen.findByLabelText('只读运行记录');
  expect(record.textContent).toContain(interrupted.output);
  expect(record.querySelector('form, textarea')).toBeNull();
  expect(screen.queryByRole('textbox', { name: '演示草稿' })).toBeNull();
  expect(container.querySelector('.assistant-run-status.running')).toBeNull();
  expect(
    agent.mock.calls.every(([request]) =>
      ['active_runs', 'history', 'read'].includes(request.operation),
    ),
  ).toBe(true);
});

it('does not present a running history snapshot as confirmed activity when active is empty and its scope read fails', async () => {
  const snapshot = makeRun('unverified-history', {
    status: 'running',
    message: '旧读取中的运行状态',
  });
  const { agent } = api((request) =>
    request.operation === 'read'
      ? { ok: false, code: 'RESULT_UNKNOWN', message: '原运行暂不可核对' }
      : ({ ...profile, runs: request.operation === 'history' ? [snapshot] : [] } as AgentResponse),
  );
  const { container } = renderHome();
  const row = await screen.findByRole('button', { name: snapshot.prompt, exact: true });
  await screen.findByText('暂无运行中的智能体');
  expect(container.querySelector('.assistant-run-status.running')).toBeNull();
  expect(screen.queryByText(snapshot.message)).toBeNull();
  fireEvent.click(row);
  await screen.findByText(/原运行暂不可核对/);
  expect(screen.queryByLabelText('只读运行记录')).toBeNull();
  expect(container.querySelector('.assistant-run-status.running')).toBeNull();
  expect(
    agent.mock.calls.some(
      ([request]) => request.operation === 'start' || request.operation === 'cancel',
    ),
  ).toBe(false);
});
