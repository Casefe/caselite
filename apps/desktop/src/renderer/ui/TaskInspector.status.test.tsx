// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task, TaskRequest, TaskResponse } from '../../preload/caselite-api';
import TaskInspector from './TaskInspector';

vi.mock('./AgentPanel', () => ({ default: () => <div>合成AI栏目</div> }));
afterEach(cleanup);
// 沿用原回归标识。属性与 AI 同页后，折叠属性替代旧的切换动作。
it('retains the same status owner when AI-tab switching is attempted during draft, pending and unknown states', async () => {
  const task: Task = {
    id: crypto.randomUUID(),
    title: '合成侧栏任务',
    objective: '',
    status: 'todo',
    version: 1,
    matter_id: null,
    document_id: crypto.randomUUID(),
    body_id: crypto.randomUUID(),
    body_revision: 0,
    editor_schema: 1,
    updated_at: '2026-11-07',
  };
  let finish!: (r: TaskResponse) => void;
  let key = '';
  const saved = { ...task, status: 'done' as const, version: 2 };
  const api = vi.fn((r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation === 'change_status') {
      key = r.idempotency_key;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
    return Promise.resolve({
      ok: true,
      tasks: [saved],
      receipt: r.operation === 'status' ? key : null,
      state: null,
    });
  });
  window.caselite = { task: api } as unknown as Window['caselite'];
  const blocked = vi.fn();
  function Host() {
    const [current, setCurrent] = useState(task);
    return (
      <TaskInspector task={current} onPropertiesBlocked={blocked} onTaskChanged={setCurrent} />
    );
  }
  render(<Host />);
  const ai = screen.getByRole('region', { name: 'AI 对话' });
  const section = screen.getByText('属性', { selector: 'summary' }).closest('details')!;
  const collapseAndReopen = () => {
    section.open = false;
    expect(ai.querySelector('[inert]')).toBeTruthy();
    expect(blocked).toHaveBeenLastCalledWith(true);
    section.open = true;
    expect((screen.getByLabelText('任务状态') as HTMLSelectElement).value).toBe('done');
  };
  fireEvent.change(screen.getByLabelText('任务状态'), { target: { value: 'done' } });
  collapseAndReopen();
  fireEvent.click(screen.getByText('保存任务状态'));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  collapseAndReopen();
  await act(async () => finish({ ok: false, code: 'RESULT_UNKNOWN', message: '合成未知回执' }));
  collapseAndReopen();
  fireEvent.click(screen.getByText('核对原状态提交'));
  await screen.findByText('当前已保存：已完成');
  expect(api.mock.calls.find(([r]) => r.operation === 'status')?.[0]).toMatchObject({
    idempotency_key: key,
  });
  expect(api.mock.calls.filter(([r]) => r.operation === 'change_status')).toHaveLength(1);
  await waitFor(() => expect(ai.querySelector('[inert]')).toBeNull());
  expect(screen.getByText('合成AI栏目')).toBeTruthy();
});
