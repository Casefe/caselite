// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentRun, Task } from '../../preload/caselite-api';
import ActiveAgents from './ActiveAgents';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
