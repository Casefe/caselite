// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task } from '../../../preload/caselite-api';
import { useTaskCompletion } from './useTaskCompletion';

const task: Task = {
  id: 'completion-task',
  title: '合成完成任务',
  objective: '',
  status: 'todo',
  priority: 0,
  due_date: null,
  version: 3,
  matter_id: null,
  document_id: 'doc',
  body_id: 'body',
  body_revision: 0,
  editor_schema: 1,
  updated_at: '2030-01-01',
};
const saved = { ...task, status: 'done' as const, version: 4 };
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup(handler: ReturnType<typeof vi.fn>, onChanged = vi.fn()) {
  Object.defineProperty(window, 'caselite', { configurable: true, value: { task: handler } });
  const hook = renderHook(() => useTaskCompletion({ disabled: false, onChanged }));
  return { ...hook, onChanged };
}
const fail = (code: string) => ({ ok: false, code, message: code });

it('locks synchronously and accepts only matching receipt then reads current task', async () => {
  let release!: (v: unknown) => void;
  const handler = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValueOnce({ ok: true, tasks: [saved], objective_state: [7] });
  const { result, onChanged } = setup(handler);
  act(() => {
    result.current.complete(task);
    result.current.complete(task);
  });
  expect(handler).toHaveBeenCalledTimes(1);
  const command = handler.mock.calls[0]![0];
  expect(command).toMatchObject({
    operation: 'change_status',
    task_id: task.id,
    expected_version: 3,
    status: 'done',
  });
  await act(async () => release({ ok: true, tasks: [saved], receipt: command.idempotency_key }));
  await waitFor(() => expect(result.current.blocked).toBe(false));
  expect(onChanged).toHaveBeenCalledWith(saved, [7]);
  expect(handler.mock.calls.map(([r]) => r.operation)).toEqual(['change_status', 'read']);
});

function Harness({ onChanged = vi.fn() }: { onChanged?: ReturnType<typeof vi.fn> }) {
  const completion = useTaskCompletion({ disabled: false, onChanged });
  return (
    <>
      <button onClick={() => completion.complete(task)}>完成</button>
      {completion.feedback}
    </>
  );
}

it.each(['RESULT_UNKNOWN', 'READ_FAILED', 'throw'])(
  'queries original key after %s and never repeats confirmed write',
  async (code) => {
    let key = '';
    const handler = vi.fn().mockImplementation(async (request) => {
      if (request.operation === 'change_status') {
        key = request.idempotency_key;
        if (code === 'throw') throw Error('transport');
        return fail(code);
      }
      if (request.operation === 'status') return { ok: true, receipt: key, tasks: [saved] };
      return { ok: true, tasks: [saved] };
    });
    Object.defineProperty(window, 'caselite', { configurable: true, value: { task: handler } });
    render(<Harness />);
    fireEvent.click(screen.getByText('完成'));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByText('核对原完成操作'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(handler.mock.calls.map(([r]) => r.operation)).toEqual([
      'change_status',
      'status',
      'read',
    ]);
    expect(handler.mock.calls[1]![0].idempotency_key).toBe(key);
  },
);

it('only resends the identical command after status explicitly returns NOT_FOUND', async () => {
  const handler = vi
    .fn()
    .mockResolvedValueOnce(fail('RESULT_UNKNOWN'))
    .mockResolvedValueOnce(fail('NOT_FOUND'))
    .mockImplementationOnce(async (command) => ({
      ok: true,
      receipt: command.idempotency_key,
      tasks: [saved],
    }))
    .mockResolvedValueOnce({ ok: true, tasks: [saved] });
  Object.defineProperty(window, 'caselite', { configurable: true, value: { task: handler } });
  render(<Harness />);
  fireEvent.click(screen.getByText('完成'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('核对原完成操作'));
  await waitFor(() => expect(handler).toHaveBeenCalledTimes(4));
  expect(handler.mock.calls[0]![0]).toEqual(handler.mock.calls[2]![0]);
});

it('keeps read phase after confirmed save and refresh failure without querying or writing again', async () => {
  const handler = vi
    .fn()
    .mockImplementation(async (request) =>
      request.operation === 'change_status'
        ? { ok: true, receipt: request.idempotency_key, tasks: [saved] }
        : { ok: true, tasks: [saved] },
    );
  Object.defineProperty(window, 'caselite', { configurable: true, value: { task: handler } });
  const onChanged = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<Harness onChanged={onChanged} />);
  fireEvent.click(screen.getByText('完成'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('重新读取任务和列表'));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(handler.mock.calls.map(([r]) => r.operation)).toEqual(['change_status', 'read', 'read']);
});

it('conflict reads latest version and requires a fresh explicit action instead of automatic overwrite', async () => {
  const current = { ...task, version: 5, status: 'in_progress' };
  const handler = vi
    .fn()
    .mockResolvedValueOnce(fail('CONFLICT'))
    .mockResolvedValueOnce({ ok: true, tasks: [current] });
  Object.defineProperty(window, 'caselite', { configurable: true, value: { task: handler } });
  const onChanged = vi.fn();
  render(<Harness onChanged={onChanged} />);
  fireEvent.click(screen.getByText('完成'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('重新读取任务和列表'));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(handler.mock.calls.map(([r]) => r.operation)).toEqual(['change_status', 'read']);
  expect(onChanged).toHaveBeenCalledWith(current, null);
});

it('does not accept mismatched receipts or allow completed/canceled task writes', async () => {
  const handler = vi.fn().mockResolvedValue({ ok: true, tasks: [saved], receipt: 'wrong' });
  const { result, onChanged } = setup(handler);
  act(() => {
    result.current.complete(saved);
    result.current.complete({ ...task, status: 'canceled' });
  });
  expect(handler).not.toHaveBeenCalled();
  await act(async () => result.current.complete(task));
  expect(result.current.blocked).toBe(true);
  expect(onChanged).not.toHaveBeenCalled();
  expect(handler).toHaveBeenCalledTimes(1);
});
