import { z } from 'zod';
const id = z.string().uuid();
const version = z.number().int().positive();
const bytes = z.array(z.number().int().min(0).max(255)).min(1).max(2_000_000);
const base = { protocol_version: z.literal(1) };
const mutation = { ...base, request_id: id, idempotency_key: id };
export const matterSchema = z.object({
  id,
  title: z.string(),
  status: z.enum(['planned', 'active', 'done']),
  version,
  archived_at: z.string().nullable(),
  body_id: id,
  body_revision: z.number().int().nonnegative(),
  editor_schema: z.literal(1),
  updated_at: z.string(),
  task_count: z.number().int().nonnegative(),
});
export const catalogDocumentSchema = z.object({
  id,
  task_id: id,
  title: z.string(),
  matter_id: id.nullable(),
  body_id: id,
  body_revision: z.number().int().nonnegative(),
  version,
  archived_at: z.string().nullable(),
  collection: z.string(),
  tags: z.array(z.string()),
  favorite: z.boolean(),
  in_library: z.boolean(),
  updated_at: z.string(),
});
export const catalogRequestSchema = z.discriminatedUnion('operation', [
  z.object({ ...base, operation: z.literal('list') }).strict(),
  z.object({ ...base, operation: z.literal('read_project'), id }).strict(),
  z.object({ ...base, operation: z.literal('status'), idempotency_key: id }).strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('create_project'),
      title: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('promote_task'),
      task_id: id,
      expected_version: version,
      title: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('update_project'),
      id,
      expected_version: version,
      title: z.string().trim().min(1).max(160),
      status: z.enum(['planned', 'active', 'done']),
      expected_body_revision: z.number().int().nonnegative(),
      state: bytes.optional(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('archive_project'),
      id,
      expected_version: version,
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('assign_task'),
      task_id: id,
      expected_version: version,
      matter_id: id.nullable(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('archive_document'),
      id,
      expected_version: version,
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('organize_document'),
      id,
      expected_version: version,
      collection: z.string().trim().max(80),
      tags: z.array(z.string().trim().min(1).max(40)).max(20),
      favorite: z.boolean(),
      in_library: z.boolean(),
    })
    .strict(),
]);
export const catalogResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    projects: z.array(matterSchema),
    documents: z.array(catalogDocumentSchema),
    state: bytes.nullable(),
    target_id: id.nullable(),
    receipt: id.nullable(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      'INVALID_REQUEST',
      'NOT_FOUND',
      'CONFLICT',
      'FORBIDDEN',
      'UNAVAILABLE',
      'RESULT_UNKNOWN',
    ]),
    message: z.string(),
  }),
]);
export const CATALOG_CHANNEL = 'caselite:catalog:v1';
export type CatalogRequest = z.infer<typeof catalogRequestSchema>;
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;
export type Matter = z.infer<typeof matterSchema>;
export type CatalogDocument = z.infer<typeof catalogDocumentSchema>;
