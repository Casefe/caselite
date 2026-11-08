import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createTaskApplication } from '../../packages/application/src/task-application';

const request = () => ({
  protocol_version: 1,
  operation: 'create_snapshot',
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
  task_id: randomUUID(),
  document_id: randomUUID(),
  body_id: randomUUID(),
  expected_revision: 1,
  expected_metadata_version: 1,
  expected_task_version: 1,
  note: '合成核对稿',
});
it('rejects renderer body, actor, source and workspace forgery before the shared port', () => {
  const execute = vi.fn(),
    app = createTaskApplication({ execute });
  for (const patch of [
    { state: [1] },
    { workspace_id: 'other' },
    { created_by: 'lawyer' },
    { kind: 'confirmed' },
    { source_refs: [] },
    { expected_revision: 0 },
    { expected_metadata_version: -1 },
    { note: 'x'.repeat(201) },
    { note: 'a\0b' },
  ])
    expect(app.execute({ ...request(), ...patch })).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  expect(execute).not.toHaveBeenCalled();
});
it('classifies fixed-version read errors separately from transaction failures', () => {
  const app = createTaskApplication({
    execute() {
      throw new Error('synthetic storage failure');
    },
  });
  const create = request();
  expect(app.execute(create)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
  expect(
    app.execute({
      protocol_version: 1,
      operation: 'list_snapshots',
      task_id: create.task_id,
      document_id: create.document_id,
      offset: 0,
    }),
  ).toMatchObject({ ok: false, code: 'READ_FAILED' });
  expect(
    app.execute({
      protocol_version: 1,
      operation: 'read_snapshot',
      task_id: create.task_id,
      document_id: create.document_id,
      snapshot_id: randomUUID(),
    }),
  ).toMatchObject({ ok: false, code: 'READ_FAILED' });
});
