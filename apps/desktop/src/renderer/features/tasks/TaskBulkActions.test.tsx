// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task, TaskRequest } from '../../../preload/caselite-api';
import TaskBulkActions from './TaskBulkActions';
afterEach(cleanup);
const task: Task = {
  id: crypto.randomUUID(),
  title: '合成批量任务',
  objective: '',
  status: 'todo',
  priority: 2,
  due_date: '2030-11-12',
  start_date: '2030-11-10',
  version: 1,
  matter_id: null,
  document_id: crypto.randomUUID(),
  body_id: crypto.randomUUID(),
  body_revision: 0,
  editor_schema: 1,
  updated_at: '2030-11-10',
};
it('keeps one original identity through an unknown bulk result and never clears dates', async () => {
  const requests: TaskRequest[] = [],
    changed = vi.fn(),
    blocked = vi.fn();
  const saved = { ...task, status: 'done' as const, version: 2 };
  let first = true;
  window.caselite = {
    task: vi.fn(async (r: TaskRequest) => {
      requests.push(r);
      if (r.operation === 'change_status' && first) {
        first = false;
        return { ok: false, code: 'RESULT_UNKNOWN', message: '合成未知结果' };
      }
      return {
        ok: true,
        tasks: [r.operation === 'read' && first ? task : saved],
        receipt: r.operation === 'status' ? r.idempotency_key : null,
        state: null,
      };
    }),
  } as unknown as Window['caselite'];
  render(
    <TaskBulkActions
      tasks={[task]}
      selected={[task.id]}
      disabled={false}
      onSelection={vi.fn()}
      onBlocked={blocked}
      onChanged={changed}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /标记完成/ }));
  await screen.findByText('合成未知结果');
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByText('结束批量操作')).toBeNull();
  fireEvent.click(screen.getByText('核对并继续原操作'));
  await waitFor(() => expect(changed).toHaveBeenCalledWith(saved, null));
  const write = requests.find((r) => r.operation === 'change_status');
  expect(requests.filter((r) => r.operation === 'change_status')).toHaveLength(1);
  expect(requests.find((r) => r.operation === 'status')).toMatchObject({
    idempotency_key: write && 'idempotency_key' in write ? write.idempotency_key : null,
  });
  expect(blocked).toHaveBeenLastCalledWith(false);
});
