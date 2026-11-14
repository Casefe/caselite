// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentRequest, AgentResponse, AgentRun } from '../../preload/caselite-api';
import AgentHome from './AgentHome';
import type { RichDraft } from '../editors/editor-state';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.mock('../editors/RichEditor', () => ({ emptyDraft: () => ({ text: '', state: null }) }));
vi.mock('../features/calendar/ImportantSchedules', () => ({ default: () => <p>日程</p> }));
vi.mock('react-resizable-panels', async () => {
  const React = await import('react');
  return {
    Group: ({ children, groupRef }: { children: ReactNode; groupRef: React.Ref<unknown> }) => {
      React.useImperativeHandle(groupRef, () => ({ setLayout() {} }));
      return <div>{children}</div>;
    },
    Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Separator: () => null,
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each(['empty', 'failed'] as const)(
  'marks an owned live Run unverified after active %s and failed home read, then recovers the same identity',
  async (activeFailure) => {
    vi.useFakeTimers();
    let run: AgentRun | undefined;
    let readFails = false,
      activeFails = false;
    const profile = {
      ok: true,
      model: 'gpt-4.1-mini',
      providers: { openai: true, deepseek: false },
      configured: true,
      runs: [],
    } as AgentResponse;
    const agent = vi.fn(async (request: AgentRequest): Promise<AgentResponse> => {
      if (request.operation === 'start') {
        run = {
          id: request.run_id,
          scope: request.scope,
          prompt: request.prompt,
          output: '已接收部分回答',
          provider: 'openai',
          model: 'gpt-4.1-mini',
          status: 'running',
          sequence: 1,
          message: '处理中',
          usage: null,
        };
        return { ...profile, runs: [run] } as AgentResponse;
      }
      if (request.operation === 'active_runs')
        return activeFails
          ? activeFailure === 'failed'
            ? { ok: false, code: 'RESULT_UNKNOWN', message: '活动清单不可读' }
            : ({ ...profile, runs: [] } as AgentResponse)
          : ({ ...profile, runs: run?.status === 'running' ? [run] : [] } as AgentResponse);
      if (request.operation === 'read') {
        if (readFails) throw new Error('home read unavailable');
        return { ...profile, runs: run ? [run] : [] } as AgentResponse;
      }
      return profile;
    });
    window.caselite = {
      agent,
      catalog: vi.fn(async () => ({ ok: true, projects: [], documents: [] })),
    } as unknown as Window['caselite'];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Harness() {
      const [prompt, setPrompt] = useState<RichDraft>({ text: '', state: null });
      return (
        <QueryClientProvider client={client}>
          <AgentHome
            prompt={prompt}
            onPrompt={setPrompt}
            onNavigate={vi.fn()}
            tasks={[]}
            onOpen={vi.fn()}
          />
        </QueryClientProvider>
      );
    }
    const view = render(<Harness />);
    await act(async () => {});
    const input = screen.getByTestId('agent-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '本次首页发起' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await act(async () => {});
    expect(run).toBeDefined();
    const originalId = run!.id;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(view.container.querySelector('.assistant-generating')).toBeTruthy();
    fireEvent.change(input, { target: { value: '未发送的下一轮中文草稿' } });
    readFails = activeFails = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(
      view.container.querySelector('.assistant-generating, .assistant-run-status.running'),
    ).toBeNull();
    // 辅助信息栏保留隐藏子树；这里只核对当前消息标题和可见的运行状态。
    const verifying = screen.getByText('运行状态待核对', {
      selector: '.assistant-message-heading .assistant-verifying',
    });
    expect(verifying.closest('[hidden], [inert]')).toBeNull();
    const unverifiedStatus = view.container.querySelector('.assistant-run-status.unverified');
    expect(unverifiedStatus?.textContent).toContain('运行状态待核对，已保留接收的内容。');
    expect(unverifiedStatus?.closest('[hidden], [inert]')).toBeNull();
    expect(screen.getByText(/运行状态暂不可核对/)).toBeTruthy();
    expect(screen.getByText('已接收部分回答')).toBeTruthy();
    expect((screen.getByRole('button', { name: '停止生成' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(input.value).toBe('未发送的下一轮中文草稿');
    expect(run!.status).toBe('running');
    expect(agent.mock.calls.filter(([request]) => request.operation === 'start')).toHaveLength(1);
    expect(agent.mock.calls.some(([request]) => request.operation === 'cancel')).toBe(false);
    readFails = activeFails = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(view.container.querySelector('.assistant-generating')).toBeTruthy();
    expect(screen.queryByText(/运行状态暂不可核对/)).toBeNull();
    expect(
      view.container.querySelector('.assistant-verifying, .assistant-run-status.unverified'),
    ).toBeNull();
    expect((screen.getByRole('button', { name: '停止生成' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    run = { ...run!, status: 'succeeded', output: '经原范围回读的完成回答', message: '已完成' };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText('经原范围回读的完成回答')).toBeTruthy();
    expect(view.container.querySelector('.assistant-generating')).toBeNull();
    expect(screen.getByTestId('agent-input')).toBe(input);
    expect(input.value).toBe('未发送的下一轮中文草稿');
    expect(run.id).toBe(originalId);
    expect(agent.mock.calls.filter(([request]) => request.operation === 'start')).toHaveLength(1);
  },
);
