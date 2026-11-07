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
  priority: 0,
  due_date: null,
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
function show(
  task: Task,
  catalog: (request: TaskRequest) => Promise<TaskResponse>,
  freezeProps = false,
) {
  window.caselite = { task: catalog } as unknown as Window['caselite'];
  const changed = vi.fn(),
    blocked = vi.fn();
  function Host() {
    const [current, setCurrent] = useState(task);
    return (
      <TaskProperties
        task={current}
        disabled={false}
        groupTags
        suggestions={['既有标签']}
        onBlocked={blocked}
        onChanged={(next, state) => {
          changed(next, state);
          if (!freezeProps) setCurrent(next);
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
  await waitFor(() =>
    expect((screen.getByLabelText('任务状态') as HTMLSelectElement).value).toBe('canceled'),
  );
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
  fireEvent.click(await screen.findByText('核对并重试原提交'));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
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
  fireEvent.click(await screen.findByText('核对并重试原提交'));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(mutations).toHaveLength(2);
  expect(mutations[0]).toEqual(mutations[1]);
});

it('keeps the proposed state after a rolled-back write and never marks it as already saved', async () => {
  const task = initial();
  show(task, async () => ({ ok: false, code: 'WRITE_FAILED', message: '存储写入失败' }));
  select();
  await screen.findByText('存储写入失败');
  expect((screen.getByLabelText('任务状态') as HTMLSelectElement).value).toBe('done');
  expect(screen.getByText('重试保存')).toBeTruthy();
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
  fireEvent.click(await screen.findByText('重读已保存任务属性'));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
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
  await screen.findByText('提交回执与任务不一致，请核对原提交。');
  expect(changed).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(1);
  expect(screen.getByText('核对并重试原提交')).toBeTruthy();
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

// 延续既有回归标识。点选自动保存允许排队，但同一任务的写入不能重叠。
it('edits ordinary attributes together, clears the date, and prevents overlapping status drafts', async () => {
  const task = initial();
  let current = task;
  let confirm!: () => void;
  const api = vi.fn(async (request: TaskRequest): Promise<TaskResponse> => {
    if (request.operation === 'change_status') {
      await new Promise<void>((resolve) => {
        confirm = resolve;
      });
      current = { ...current, status: request.status, version: 2 };
      return response(current, request.idempotency_key);
    }
    if (request.operation === 'update_attributes') {
      expect(request.expected_version).toBe(current.version);
      current = {
        ...current,
        priority: request.priority,
        due_date: request.due_date,
        tags: request.tags,
        version: current.version + 1,
      };
      return response(current, request.idempotency_key);
    }
    return response(current);
  });
  const { blocked } = show(task, api, true);
  select();
  fireEvent.change(screen.getByLabelText('任务优先级'), { target: { value: '2' } });
  const input = screen.getByLabelText('普通截止日期') as HTMLInputElement;
  fireEvent.input(input, { target: { value: '2024-02-29' } });
  expect(api).toHaveBeenCalledTimes(1);
  await act(async () => confirm());
  expect(current.version).toBe(3);
  expect((screen.getByLabelText('任务状态') as HTMLSelectElement).value).toBe('done');
  expect(blocked).toHaveBeenLastCalledWith(true);
  fireEvent.blur(input);
  await waitFor(() => expect(blocked).toHaveBeenLastCalledWith(false));
  expect(current).toMatchObject({
    version: 4,
    due_date: '2024-02-29',
    priority: 2,
    status: 'done',
  });
  fireEvent.click(screen.getByText('清空截止日期'));
  await waitFor(() => expect(blocked).toHaveBeenLastCalledWith(false));
  expect(current).toMatchObject({ version: 5, due_date: null, priority: 2 });
});

it('blocks incomplete native date input instead of treating it as an explicit clear', () => {
  const api = vi.fn();
  const { blocked } = show({ ...initial(), due_date: '2026-01-01' }, api);
  const input = screen.getByLabelText('普通截止日期') as HTMLInputElement;
  fireEvent.compositionStart(input);
  fireEvent.input(input, { target: { value: '' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.blur(input);
  expect(api).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.blur(input);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(blocked).toHaveBeenLastCalledWith(true);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input.value).toBe('2026-01-01');
  expect(blocked).toHaveBeenLastCalledWith(false);
  expect(api).not.toHaveBeenCalled();
});

it('stops queued edits when read-back observes an intervening version', async () => {
  const task = initial();
  let finish!: () => void;
  const api = vi.fn(async (request: TaskRequest): Promise<TaskResponse> => {
    if (request.operation === 'change_status') {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return response({ ...task, status: 'done', version: 2 }, request.idempotency_key);
    }
    return response({ ...task, status: 'done', priority: 4, version: 3 });
  });
  show(task, api);
  select();
  fireEvent.change(screen.getByLabelText('任务优先级'), { target: { value: '1' } });
  await act(async () => finish());
  expect(screen.getByRole('alert').textContent).toContain('已有其他修改');
  expect((screen.getByLabelText('任务优先级') as HTMLSelectElement).value).toBe('1');
  expect(api.mock.calls.map(([r]) => r.operation)).toEqual(['change_status', 'read']);
});

it('retains unadded label text during composition and only writes after a deliberate add or remove', async () => {
  let current = initial();
  const api = vi.fn(async (request: TaskRequest): Promise<TaskResponse> => {
    if (request.operation !== 'update_attributes') return response(current);
    current = { ...current, tags: request.tags, version: current.version + 1 };
    return response(current, request.idempotency_key);
  });
  const { blocked } = show(current, api);
  const addLabel = () => screen.getByRole('button', { name: '添加标签' });
  expect(screen.queryByLabelText('新标签')).toBeNull();
  fireEvent.click(addLabel());
  const input = screen.getByLabelText('新标签');
  expect(document.activeElement).toBe(input);
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '合成标签' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(api).not.toHaveBeenCalled();
  expect(blocked).toHaveBeenLastCalledWith(true);
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(blocked).toHaveBeenLastCalledWith(false));
  expect(current.tags).toEqual(['合成标签']);
  expect(screen.queryByLabelText('新标签')).toBeNull();
  expect(document.activeElement).toBe(addLabel());
  fireEvent.click(addLabel());
  const duplicate = screen.getByLabelText('新标签');
  fireEvent.change(duplicate, { target: { value: ' 合成标签 ' } });
  const calls = api.mock.calls.length;
  fireEvent.keyDown(duplicate, { key: 'Enter' });
  expect(api).toHaveBeenCalledTimes(calls);
  expect(blocked).toHaveBeenLastCalledWith(true);
  fireEvent.keyDown(duplicate, { key: 'Escape' });
  expect(screen.queryByLabelText('新标签')).toBeNull();
  expect(blocked).toHaveBeenLastCalledWith(false);
  fireEvent.click(addLabel());
  fireEvent.change(screen.getByLabelText('选择已使用的任务标签'), {
    target: { value: '既有标签' },
  });
  await waitFor(() => expect(blocked).toHaveBeenLastCalledWith(false));
  expect(current.tags).toEqual(['合成标签', '既有标签']);
  expect(screen.queryByLabelText('新标签')).toBeNull();
  fireEvent.click(addLabel());
  fireEvent.change(screen.getByLabelText('新标签'), { target: { value: '待取消' } });
  fireEvent.click(screen.getByRole('button', { name: '取消标签输入' }));
  expect(blocked).toHaveBeenLastCalledWith(false);
  expect(screen.queryByLabelText('新标签')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '移除标签 合成标签' }));
  await waitFor(() => expect(blocked).toHaveBeenLastCalledWith(false));
  expect(current.tags).toEqual(['既有标签']);
});

it('retains the exact date/priority request through unknown delivery and rejects mismatched attribute receipts', async () => {
  const task = { ...initial(), priority: 2, tags: ['原标签'] };
  const committed = { ...task, due_date: '2026-01-01', version: 2 };
  const later = { ...committed, priority: 4, due_date: null, version: 3 };
  const requests: TaskRequest[] = [];
  let missing = false;
  const api = vi.fn(async (request: TaskRequest): Promise<TaskResponse> => {
    if (request.operation === 'update_attributes') {
      requests.push(request);
      return requests.length === 1
        ? { ok: false, code: 'RESULT_UNKNOWN', message: '未核实' }
        : response(committed, request.idempotency_key);
    }
    if (request.operation === 'status')
      return missing
        ? { ok: false, code: 'NOT_FOUND', message: '无回执' }
        : response({ ...committed, due_date: '2026-01-02' }, request.idempotency_key);
    return response(later);
  });
  const { changed } = show(task, api);
  const input = screen.getByLabelText('普通截止日期');
  fireEvent.input(input, { target: { value: '2026-01-01' } });
  fireEvent.blur(input);
  fireEvent.click(await screen.findByText('核对并重试原提交'));
  await screen.findByText('提交回执与任务不一致，请核对原提交。');
  expect((input as HTMLInputElement).disabled).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  missing = true;
  fireEvent.click(screen.getByText('核对并重试原提交'));
  await waitFor(() => expect(changed).toHaveBeenCalledWith(later, null));
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]).toMatchObject({ priority: 2, due_date: '2026-01-01', tags: ['原标签'] });
});
