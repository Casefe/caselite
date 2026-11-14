// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentRun, Task } from '../../preload/caselite-api';
import ActiveAgents from './ActiveAgents';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each(['rejected', 'unknown'] as const)(
  'keeps a %s stop scoped to the original Run without automatically retrying',
  async (failure) => {
    vi.useFakeTimers();
    const run = {
      id: 'cancel-original',
      scope: 'task-original',
      status: 'running',
      prompt: '合成停止核对',
      output: '保留部分输出',
      model: 'gpt-4.1-mini',
    } as AgentRun;
    let ended = false;
    const agent = vi.fn(async (request: { operation: string }) => {
      if (request.operation === 'cancel') {
        if (failure === 'unknown') throw new Error('receipt lost');
        return { ok: false, code: 'RESULT_UNKNOWN', message: '停止未确认，请核对。' };
      }
      return { ok: true, runs: ended ? [] : [run] };
    });
    window.caselite = { agent } as unknown as Window['caselite'];
    const changed = vi.fn(),
      selected = vi.fn();
    render(
      <ActiveAgents tasks={[]} onOpen={vi.fn()} onStateChange={changed} onSelectRun={selected} />,
    );
    await act(async () => {});
    expect(changed).toHaveBeenLastCalledWith([run]);
    fireEvent.click(screen.getByRole('button', { name: /合成停止核对.*任务对话/ }));
    expect(selected).toHaveBeenCalledWith(run);
    fireEvent.click(screen.getByRole('button', { name: '停止', exact: true }));
    await act(async () => {});
    expect(agent).toHaveBeenCalledWith({
      protocol_version: 1,
      operation: 'cancel',
      scope: run.scope,
      run_id: run.id,
    });
    expect(screen.getByRole('alert').textContent).toMatch(/停止.*核对/);
    expect(
      (screen.getByRole('button', { name: '停止', exact: true }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(agent.mock.calls.filter(([request]) => request.operation === 'cancel')).toHaveLength(1);
    expect(screen.getByText('保留部分输出')).toBeTruthy();
    ended = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(changed).toHaveBeenLastCalledWith([]);
    expect(screen.queryByText('保留部分输出')).toBeNull();
  },
);

it('publishes unknown status and removes cached active state on a failed poll', async () => {
  vi.useFakeTimers();
  let fail = false;
  const run = {
    id: 'active',
    scope: 'home',
    status: 'running',
    prompt: '当前问题',
    output: '',
  } as AgentRun;
  window.caselite = {
    agent: vi.fn(async () =>
      fail ? { ok: false, message: 'offline' } : { ok: true, runs: [run] },
    ),
  } as unknown as Window['caselite'];
  const changed = vi.fn();
  render(<ActiveAgents tasks={[]} onOpen={vi.fn()} onStateChange={changed} />);
  await act(async () => {});
  expect(changed).toHaveBeenLastCalledWith([run]);
  fail = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(changed).toHaveBeenLastCalledWith(null);
  expect(screen.queryByText('当前问题')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('状态更新失败');
});
it('polls real state, opens details and original Task, hides stale state on error and clears ended Runs', async () => {
  vi.useFakeTimers();
  let runs = [
    {
      id: 'r1',
      scope: 't1',
      status: 'running',
      prompt: '合成合同审查',
      message: '正在生成',
      output: '进度一',
      model: 'gpt-4.1-mini',
    } as AgentRun,
  ];
  let fail = false;
  const agent = vi.fn(async (request: { operation: string }) => {
    expect(request.operation).toBe('active_runs');
    if (fail) throw new Error('offline');
    return { ok: true, runs };
  });
  window.caselite = { agent } as unknown as Window['caselite'];
  const onOpen = vi.fn();
  render(<ActiveAgents tasks={[{ id: 't1', title: '原任务' } as Task]} onOpen={onOpen} />);
  expect(screen.getByRole('status').textContent).toContain('正在读取');
  await act(async () => {});
  expect(screen.getByText('1 运行中')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /合成合同审查.*原任务/ }));
  expect(screen.getByText('进度一')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '打开所属任务' }));
  expect(onOpen).toHaveBeenCalledWith('t1');
  runs = [{ ...runs[0], output: '进度二' }];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByText('进度二')).toBeTruthy();
  fail = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByRole('alert').textContent).toContain('状态更新失败');
  expect(screen.queryByText('1 运行中')).toBeNull();
  expect(screen.queryByText('进度二')).toBeNull();
  fail = false;
  runs = [];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByText('暂无运行中的智能体')).toBeTruthy();
  expect(agent.mock.calls.every((args) => args.length === 1)).toBe(true);
  expect(agent).toHaveBeenLastCalledWith({ protocol_version: 1, operation: 'active_runs' });
  cleanup();
  const calls = agent.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(agent).toHaveBeenCalledTimes(calls);
});

it('uses committed callbacks after rerender while keeping one active-state polling loop', async () => {
  vi.useFakeTimers();
  const run = {
    id: 'callback-run',
    scope: 'home',
    status: 'running',
    prompt: '核对回调',
    message: '处理中',
    output: '',
  } as AgentRun;
  const agent = vi.fn(async () => ({ ok: true, runs: [run] }));
  window.caselite = { agent } as unknown as Window['caselite'];
  const firstState = vi.fn(),
    nextState = vi.fn(),
    firstSelect = vi.fn(),
    nextSelect = vi.fn();
  const view = render(
    <ActiveAgents
      tasks={[]}
      onOpen={vi.fn()}
      onStateChange={firstState}
      onSelectRun={firstSelect}
    />,
  );
  await act(async () => {});
  expect(agent).toHaveBeenCalledTimes(1);
  expect(firstState).toHaveBeenCalledExactlyOnceWith([run]);
  view.rerender(
    <ActiveAgents tasks={[]} onOpen={vi.fn()} onStateChange={nextState} onSelectRun={nextSelect} />,
  );
  expect(agent).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: /核对回调/ }));
  expect(nextSelect).toHaveBeenCalledExactlyOnceWith(run);
  expect(firstSelect).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(agent).toHaveBeenCalledTimes(2);
  expect(nextState).toHaveBeenCalledExactlyOnceWith([run]);
  expect(firstState).toHaveBeenCalledTimes(1);
});
