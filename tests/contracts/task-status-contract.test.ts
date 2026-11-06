import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTaskApplication } from '../../packages/application/src/task-application';
import { taskRequestSchema, taskResponseSchema } from '../../packages/contracts/src/task';

const identity = () => ({
  protocol_version: 1,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
it('rejects forged status fields before the Task port and preserves legacy request digests', () => {
  const execute = vi.fn();
  const app = createTaskApplication({ execute });
  const valid = {
    ...identity(),
    operation: 'change_status',
    task_id: randomUUID(),
    expected_version: 1,
    status: 'done',
  };
  for (const patch of [
    { status: 'approved' },
    { status: null },
    { expected_version: 0 },
    { workspace: 'other' },
    { actor: 'forged' },
    { objective: 'overwrite' },
  ]) {
    expect(app.execute({ ...valid, ...patch })).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  }
  expect(execute).not.toHaveBeenCalled();
  const legacy = { ...identity(), operation: 'create', title: '合成旧请求', objective: '' };
  expect(taskRequestSchema.parse(legacy)).toEqual(legacy);
});

it('adds only a response default when decoding a pre-status receipt', () => {
  const old = {
    ok: true,
    tasks: [
      {
        id: randomUUID(),
        title: '合成旧回执',
        objective: '',
        matter_id: null,
        version: 1,
        document_id: randomUUID(),
        body_id: randomUUID(),
        body_revision: 0,
        editor_schema: 1,
        updated_at: '2026-11-01',
      },
    ],
    state: null,
    receipt: randomUUID(),
  };
  expect(taskResponseSchema.parse(old)).toMatchObject({ tasks: [{ status: 'todo' }] });
  expect('status' in old.tasks[0]).toBe(false);
});
