import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { catalogDocumentSchema, catalogRequestSchema } from '../../packages/contracts/src/catalog';
const base = { protocol_version: 1, request_id: randomUUID(), idempotency_key: randomUUID() };
it('accepts only bounded personal create and exact save identities', () => {
  expect(
    catalogRequestSchema.safeParse({ ...base, operation: 'create_document', title: '独立文档' })
      .success,
  ).toBe(true);
  for (const title of ['', ' ', 'x'.repeat(161), '含\0字符'])
    expect(
      catalogRequestSchema.safeParse({ ...base, operation: 'create_document', title }).success,
    ).toBe(false);
  expect(
    catalogRequestSchema.safeParse({
      ...base,
      operation: 'create_document',
      title: '不暗建任务',
      task_id: randomUUID(),
    }).success,
  ).toBe(false);
  const save = {
    ...base,
    operation: 'save_document_body',
    document_id: randomUUID(),
    body_id: randomUUID(),
    expected_revision: 1,
    editor_schema: 1,
    state: [0, 0],
  };
  expect(catalogRequestSchema.safeParse(save).success).toBe(true);
  for (const patch of [
    { expected_revision: 0 },
    { editor_schema: 3 },
    { state: [] },
    { task_id: randomUUID() },
  ])
    expect(catalogRequestSchema.safeParse({ ...save, ...patch }).success).toBe(false);
});
it('keeps legacy Task responses compatible while enforcing personal and Task ownership as different branches', () => {
  const legacy = {
    id: randomUUID(),
    task_id: randomUUID(),
    title: '旧成果',
    matter_id: null,
    body_id: randomUUID(),
    body_revision: 1,
    version: 1,
    archived_at: null,
    collection: '',
    tags: [],
    favorite: false,
    in_library: false,
    updated_at: new Date().toISOString(),
  };
  expect(catalogDocumentSchema.parse(legacy)).toMatchObject({
    owner_kind: 'task',
    editor_schema: 1,
  });
  expect(catalogDocumentSchema.safeParse({ ...legacy, task_id: null }).success).toBe(false);
  expect(catalogDocumentSchema.safeParse({ ...legacy, owner_kind: 'personal' }).success).toBe(
    false,
  );
  expect(
    catalogDocumentSchema.safeParse({
      ...legacy,
      owner_kind: 'personal',
      task_id: null,
      matter_id: randomUUID(),
    }).success,
  ).toBe(false);
  expect(
    catalogDocumentSchema.safeParse({ ...legacy, owner_kind: 'personal', task_id: null }).success,
  ).toBe(true);
});
