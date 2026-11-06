import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTaskApplication } from '../../packages/application/src/task-application';
import { taskRequestSchema, taskResponseSchema } from '../../packages/contracts/src/task';

const valid = {
  protocol_version: 1,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
  operation: 'update_attributes',
  task_id: randomUUID(),
  expected_version: 1,
  priority: 0,
  due_date: null,
};
it('rejects malformed ordinary dates, incomplete attributes and forged ownership before the port', () => {
  const execute = vi.fn();
  const app = createTaskApplication({ execute });
  for (const patch of [
    { priority: -1 },
    { priority: 5 },
    { priority: 1.5 },
    { priority: '1' },
    { due_date: '2026-02-29' },
    { due_date: '1900-02-29' },
    { due_date: '2026-04-31' },
    { due_date: '0000-01-01' },
    { due_date: '2026-01-01T00:00:00Z' },
    { due_date: '' },
    { due_date: undefined },
    { priority: undefined },
    { workspace_id: 'forged' },
    { status: 'done' },
    { expected_version: 0 },
  ])
    expect(app.execute({ ...valid, ...patch })).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  expect(execute).not.toHaveBeenCalled();
  for (const due_date of [null, '0001-01-01', '2000-02-29', '2024-02-29', '9999-12-31'])
    expect(taskRequestSchema.parse({ ...valid, due_date })).toEqual({ ...valid, due_date });
});
it('preserves old request contents and supplies defaults only when decoding historical receipts', () => {
  for (const operation of ['create', 'update']) {
    const old = {
      protocol_version: 1,
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
      operation,
      title: '合成旧请求',
      objective: '',
      ...(operation === 'update' ? { task_id: randomUUID(), expected_version: 1 } : {}),
    };
    expect(taskRequestSchema.parse(old)).toEqual(old);
  }
  const old = {
    ok: true,
    tasks: [
      {
        id: randomUUID(),
        title: '合成旧回执',
        objective: '',
        status: 'done',
        matter_id: null,
        version: 2,
        document_id: randomUUID(),
        body_id: randomUUID(),
        body_revision: 0,
        editor_schema: 1,
        updated_at: '2026-11-07',
      },
    ],
    state: null,
    receipt: randomUUID(),
  };
  expect(taskResponseSchema.parse(old)).toMatchObject({
    tasks: [{ status: 'done', priority: 0, due_date: null }],
  });
  expect('priority' in old.tasks[0]).toBe(false);
});
