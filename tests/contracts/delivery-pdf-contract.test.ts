import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { taskRequestSchema, deliveryExportSchema } from '../../packages/contracts/src';
it('accepts scoped PDF operations while rejecting paths, raw body and mismatched converters', () => {
  const scope = {
    protocol_version: 1,
    task_id: randomUUID(),
    document_id: randomUUID(),
    snapshot_id: randomUUID(),
  };
  const create = {
    ...scope,
    operation: 'export_snapshot',
    request_id: randomUUID(),
    idempotency_key: randomUUID(),
    format: 'pdf',
  };
  expect(taskRequestSchema.safeParse(create).success).toBe(true);
  for (const extra of [
    { path: '/tmp/x.pdf' },
    { state: [1] },
    { html: '<script>' },
    { converter: 'other' },
    { format: 'rtf' },
  ])
    expect(taskRequestSchema.safeParse({ ...create, ...extra }).success).toBe(false);
  expect(
    taskRequestSchema.safeParse({
      ...scope,
      operation: 'cancel_export',
      idempotency_key: create.idempotency_key,
    }).success,
  ).toBe(true);
  expect(
    taskRequestSchema.safeParse({
      ...scope,
      operation: 'save_export',
      export_id: randomUUID(),
      format: 'pdf',
    }).success,
  ).toBe(true);
  const row = {
    id: randomUUID(),
    snapshot_id: scope.snapshot_id,
    format: 'pdf',
    converter: 'electron-45.1.0-pdf-v1',
    status: 'ready',
    sha256: 'a'.repeat(64),
    bytes: 100,
    created_at: new Date().toISOString(),
  };
  expect(deliveryExportSchema.safeParse(row).success).toBe(true);
  expect(deliveryExportSchema.safeParse({ ...row, converter: 'docx-9.15.3-v1' }).success).toBe(
    false,
  );
});
