import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { taskRequestSchema, taskResponseSchema } from '../../packages/contracts/src';
it('allows only scoped snapshot Word requests; renderer cannot submit body, paths, identity, hashes or another converter', () => {
  const command = {
    protocol_version: 1,
    operation: 'export_snapshot',
    request_id: randomUUID(),
    idempotency_key: randomUUID(),
    task_id: randomUUID(),
    document_id: randomUUID(),
    snapshot_id: randomUUID(),
    format: 'docx',
  };
  expect(taskRequestSchema.safeParse(command).success).toBe(true);
  for (const extra of [
    { path: '/tmp/escape.docx' },
    { state: [1] },
    { html: '<p>x</p>' },
    { actor: 'admin' },
    { sha256: 'a'.repeat(64) },
    { format: 'pdf' },
    { converter: 'other' },
  ])
    expect(taskRequestSchema.safeParse({ ...command, ...extra }).success).toBe(false);
  expect(
    taskResponseSchema.safeParse({
      ok: true,
      tasks: [],
      state: null,
      receipt: null,
      exports: [
        {
          id: randomUUID(),
          snapshot_id: randomUUID(),
          format: 'docx',
          converter: 'docx-9.15.3-v1',
          status: 'ready',
          sha256: 'oops',
          bytes: 1,
          created_at: new Date().toISOString(),
        },
      ],
    }).success,
  ).toBe(false);
});
