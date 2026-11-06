// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task, TaskRequest, TaskResponse } from '../../preload/caselite-api';
import TaskProperties from './TaskProperties';

afterEach(cleanup);
const initial = (): Task => ({
  id: crypto.randomUUID(),
  title: '合成任务',
  objective: '',
  status: 'todo',
  version: 1,
  matter_id: null,
  document_id: crypto.randomUUID(),
  body_id: crypto.randomUUID(),
  body_revision: 0,
  editor_schema: 1,
  updated_at: '2026-11-07',
});
const response = (task: Task, receipt: string | null = null): TaskResponse => ({
  ok: true,
  tasks: [task],
  receipt,
  state: null,
});
function show(task: Task, catalog: (request: TaskRequest) => Promise<TaskResponse>) {
  window.caselite = { task: catalog } as unknown as Window['caselite'];
  const changed = vi.fn(),
    blocked = vi.fn();
  function Host() {
    const [current, setCurrent] = useState(task);
    return (
      <TaskProperties
        task={current}
        disabled={false}
        onBlocked={blocked}
        onChanged={(next, state) => {
          changed(next, state);
          setCurrent(next);
        }}
      />
    );
  }
  return { ...render(<Host />), changed, blocked };
}
const select = () =>
  fireEvent.change(screen.getByLabelText('任务状态'), { target: { value: 'done' } });

it('checks the committed receipt then reads the current object instead of projecting an old status snapshot', async () => {
  const task = initial(),
    current = { ...task, status: 'canceled' as const, version: 3 };
  const api = vi.fn(async (r: TaskRequest) =>
    r.operation === 'change_status'
      ? response({ ...task, status: 'done', version: 2 }, r.idempotency_key)
      : response(current),
  );
  const { changed } = show(task, api);
  select();
  fireEvent.click(screen.getByText('保存任务状态'));
  await screen.findByText('当前已保存：已取消');
  expect(changed).toHaveBeenCalledWith(current, null);
  expect(api.mock.calls.map(([r]) => r.operation)).toEqual(['change_status', 'read']);
});

it('queries a lost receipt with the original key, without dispatching the mutation a second time', async () => {
  const task = initial(),
    saved = { ...task, status: 'done' as const, version: 2 };
  let key = '';
  const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation === 'change_status') {
      key = r.idempotency_key;
      return { ok: false, code: 'RESULT_UNKNOWN', message: '回执丢失' };
    }
    return response(saved, r.operation === 'status' ? key : null);
  });
  show(task, api);
  select();
  fireEvent.click(screen.getByText('保存任务状态'));
  fireEvent.click(await screen.findByText('核对原状态提交'));
  await screen.findByText('当前已保存：已完成');
  expect(api.mock.calls.filter(([r]) => r.operation === 'change_status')).toHaveLength(1);
  expect(api.mock.calls.find(([r]) => r.operation === 'status')?.[0]).toMatchObject({
    idempotency_key: key,
  });
});

it('retains an unknown request after a missing receipt and retries only the same immutable request on explicit action', async () => {
  const task = initial(),
    saved = { ...task, status: 'done' as const, version: 2 };
  const mutations: TaskRequest[] = [];
  const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation === 'change_status') {
      mutations.push(r);
      return mutations.length === 1
        ? { ok: false, code: 'RESULT_UNKNOWN', message: '提交未核实' }
        : response(saved, r.idempotency_key);
    }
    if (r.operation === 'status') return { ok: false, code: 'NOT_FOUND', message: '尚未找到回执' };
    return response(saved);
  });
  show(task, api);
  select();
  fireEvent.click(screen.getByText('保存任务状态'));
  fireEvent.click(await screen.findByText('核对原状态提交'));
  await screen.findByText('尚未找到回执');
  expect((screen.getByLabelText('任务状态') as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('重试原状态请求'));
  await screen.findByText('当前已保存：已完成');
  expect(mutations).toHaveLength(2);
  expect(mutations[0]).toEqual(mutations[1]);
});

it('keeps the proposed state after a rolled-back write and never marks it as already saved', async () => {
  const task = initial();
  show(task, async () => ({ ok: false, code: 'WRITE_FAILED', message: '存储写入失败' }));
  select();
  fireEvent.click(screen.getByText('保存任务状态'));
  await screen.findByText('存储写入失败');
  expect((screen.getByLabelText('任务状态') as HTMLSelectElement).value).toBe('done');
  expect(screen.getByText('当前已保存：待办')).toBeTruthy();
  expect(screen.getByText('状态尚未保存')).toBeTruthy();
});

it('does not reissue a confirmed mutation when only the subsequent read fails', async () => {
  const task = initial(),
    saved = { ...task, status: 'done' as const, version: 2 };
  let reads = 0;
  const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation === 'change_status') return response(saved, r.idempotency_key);
    if (++reads === 1) throw new Error('synthetic unavailable read');
    return response(saved);
  });
  show(task, api);
  select();
  fireEvent.click(screen.getByText('保存任务状态'));
  fireEvent.click(await screen.findByText('重读已保存任务属性'));
  await screen.findByText('当前已保存：已完成');
  expect(reads).toBe(2);
  expect(api.mock.calls.filter(([r]) => r.operation === 'change_status')).toHaveLength(1);
});

it('rejects a wrong-object receipt without clearing the draft or reading a different target', async () => {
  const task = initial();
  const api = vi.fn(async (r: TaskRequest) =>
    response(
      { ...task, id: crypto.randomUUID(), status: 'done' as const, version: 2 },
      'idempotency_key' in r ? r.idempotency_key : null,
    ),
  );
  const { changed } = show(task, api);
  select();
  fireEvent.click(screen.getByText('保存任务状态'));
  await screen.findByText('提交回执与当前任务不一致，请核对原提交。');
  expect(changed).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(1);
  expect(screen.getByText('核对原状态提交')).toBeTruthy();
});

it('ignores a delayed receipt after the original Task properties unmounts', async () => {
  const task = initial();
  let finish!: (r: TaskResponse) => void;
  let command: TaskRequest | undefined;
  const api = vi.fn((r: TaskRequest) => {
    command = r;
    return new Promise<TaskResponse>((resolve) => {
      finish = resolve;
    });
  });
  const { unmount, changed } = show(task, api);
  select();
  fireEvent.click(screen.getByText('保存任务状态'));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () =>
    finish(
      response(
        { ...task, status: 'done', version: 2 },
        command && 'idempotency_key' in command ? command.idempotency_key : null,
      ),
    ),
  );
  expect(changed).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(1);
});
