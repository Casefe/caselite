// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task } from '../../preload/caselite-api';
import AgentHistory from './AgentHistory';

afterEach(cleanup);
it('reads all accessible scopes and opens a task conversation', async () => {
  const agent = vi.fn(async (request: { scope: string }) => ({
    ok: true,
    runs: [
      {
        id: request.scope,
        scope: request.scope,
        prompt: `问题 ${request.scope}`,
        output: '回答',
        created_at: '2026-11-06T00:00:00Z',
      },
      {
        id: `date-${request.scope}`,
        scope: request.scope,
        purpose: 'important_dates',
        prompt: '专用日期提取',
        output: '{\"candidates\":[]}',
      },
    ],
  }));
  window.caselite = { agent } as unknown as Window['caselite'];
  const onOpen = vi.fn();
  render(
    <AgentHistory
      tasks={[{ id: 'task-1', title: '测试任务' } as Task]}
      onBack={vi.fn()}
      onOpen={onOpen}
    />,
  );
  expect(await screen.findByText('问题 home')).toBeTruthy();
  expect(screen.queryByText('专用日期提取')).toBeNull();
  expect(screen.queryByText(/candidates/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /问题 task-1/ }));
  expect(screen.getByText('回答')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '打开所属任务' }));
  expect(onOpen).toHaveBeenCalledWith('task-1');
  expect(agent.mock.calls.map(([request]) => request.scope)).toEqual(['home', 'task-1']);
});

it('reports a failed scope instead of presenting an incomplete list as complete', async () => {
  window.caselite = {
    agent: vi.fn(async () => ({ ok: false, message: 'failed' })),
  } as unknown as Window['caselite'];
  render(<AgentHistory tasks={[]} onBack={vi.fn()} onOpen={vi.fn()} />);
  expect((await screen.findByRole('alert')).textContent).toContain('读取失败');
});

it('shows more than five home conversations', async () => {
  window.caselite = {
    agent: vi.fn(async () => ({
      ok: true,
      runs: Array.from({ length: 6 }, (_, index) => ({
        id: `run-${index}`,
        scope: 'home',
        prompt: `历史 ${index}`,
        output: '回答',
      })),
    })),
  } as unknown as Window['caselite'];
  render(<AgentHistory tasks={[]} onBack={vi.fn()} onOpen={vi.fn()} />);
  expect(await screen.findByText('历史 5')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /历史 \d/ })).toHaveLength(6);
});
