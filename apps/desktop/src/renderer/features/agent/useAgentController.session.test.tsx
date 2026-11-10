// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentRequest, AgentRun } from '../../../preload/caselite-api';
import { useAgentController } from './useAgentController';

vi.mock('../../ui/useMaterials', () => ({
  useMaterials: () => ({ preview: async () => undefined, acknowledge() {} }),
}));
afterEach(cleanup);
const old = {
  id: 'old-home-run',
  scope: 'home',
  prompt: '上次打开的提问',
  output: '上次回答',
  status: 'succeeded',
  model: 'gpt-4.1-mini',
  provider: 'openai',
  sequence: 1,
  usage: null,
  message: '',
} as AgentRun;
const profile = {
  ok: true,
  model: 'gpt-4.1-mini',
  configured: true,
  providers: { openai: true, deepseek: false },
};
it('keeps startup history out of the fresh home conversation and preserves new runs across navigation', async () => {
  const stored = [old];
  const agent = vi.fn(async (request: AgentRequest) => {
    if (request.operation === 'start')
      stored.push({ ...old, id: request.run_id, prompt: request.prompt, output: '本次回答' });
    return { ...profile, runs: [...stored] };
  });
  window.caselite = { agent } as unknown as Window['caselite'];
  const view = renderHook(() => useAgentController({ scope: 'home', freshHomeSession: true }));
  await waitFor(() => expect(view.result.current.configured).toBe(true));
  expect(view.result.current.runs).toEqual([]);
  act(() => view.result.current.setDraft({ text: '这次打开的新提问', state: null }));
  await act(async () => {
    await view.result.current.send();
  });
  expect(view.result.current.runs.map((run) => run.prompt)).toEqual(['这次打开的新提问']);
  view.unmount();
  const returned = renderHook(() => useAgentController({ scope: 'home', freshHomeSession: true }));
  await waitFor(() => expect(returned.result.current.runs).toHaveLength(1));
  expect(returned.result.current.runs[0].prompt).toBe('这次打开的新提问');
  expect(stored.map((run) => run.prompt)).toEqual(['上次打开的提问', '这次打开的新提问']);
  expect(agent.mock.calls.filter(([request]) => request.operation === 'start')).toHaveLength(1);
});
it('preserves existing task conversations without applying the home startup filter', async () => {
  const run = { ...old, scope: 'task-1' };
  window.caselite = {
    agent: vi.fn(async () => ({ ...profile, runs: [run] })),
  } as unknown as Window['caselite'];
  const view = renderHook(() => useAgentController({ scope: 'task-1', freshHomeSession: true }));
  await waitFor(() => expect(view.result.current.runs).toEqual([run]));
});

it('reconciles an unknown home submission after remount without dispatching a second run', async () => {
  const stored = [old];
  let submitted = false;
  const agent = vi.fn(async (request: AgentRequest) => {
    if (request.operation === 'start') {
      submitted = true;
      stored.push({
        ...old,
        id: request.run_id,
        prompt: request.prompt,
        output: '已落盘的迟到回答',
      });
      throw new Error('模拟回执丢失');
    }
    return { ...profile, runs: submitted ? [...stored] : [old] };
  });
  window.caselite = { agent } as unknown as Window['caselite'];
  const first = renderHook(() => useAgentController({ scope: 'home', freshHomeSession: true }));
  await waitFor(() => expect(first.result.current.configured).toBe(true));
  act(() => first.result.current.setDraft({ text: '核对原运行身份', state: null }));
  await act(async () => {
    await first.result.current.send();
  });
  expect(first.result.current.unknown).toBe(true);
  const originalRequest = agent.mock.calls.find(([request]) => request.operation === 'start')![0];
  first.unmount();
  const returned = renderHook(() => useAgentController({ scope: 'home', freshHomeSession: true }));
  await waitFor(() => expect(returned.result.current.unknown).toBe(false));
  expect(returned.result.current.runs.map((run) => run.id)).toContain(
    'run_id' in originalRequest ? originalRequest.run_id : 'missing',
  );
  expect(returned.result.current.runs.some((run) => run.id === old.id)).toBe(false);
  expect(agent.mock.calls.filter(([request]) => request.operation === 'start')).toHaveLength(1);
});
