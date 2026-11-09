import { z } from 'zod';
import { materialScopeSchema, MATERIAL_MAX_BYTES } from './material';

export const MATERIAL_BATCH_CHANNEL = 'caselite:material-batch:v1';
// 与现有单轮最多16份选材一致；批次保存不扩大单文件和后续模型的预算。
export const MATERIAL_BATCH_MAX_FILES = 16;
export const MATERIAL_BATCH_MAX_BYTES = MATERIAL_BATCH_MAX_FILES * MATERIAL_MAX_BYTES;
export const MATERIAL_BATCH_MAX_DEPTH = 8;
export const materialBatchItemSchema = z.object({
  token: z.string().uuid(),
  relative_name: z.string().min(1).max(4096),
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  state: z.enum(['pending', 'staged', 'saved', 'failed', 'skipped', 'cancelled']),
  message: z.string().max(1000),
});
export const materialBatchSchema = z.object({
  id: z.string().uuid(),
  scope: materialScopeSchema,
  task_id: z.string().uuid().optional(),
  title: z.string().min(1).max(500),
  state: z.enum(['ready', 'running', 'paused', 'finished', 'dismissed']),
  items: z.array(materialBatchItemSchema).min(1).max(MATERIAL_BATCH_MAX_FILES),
});
const base = { protocol_version: z.literal(1), scope: materialScopeSchema };
export const materialBatchRequestSchema = z.discriminatedUnion('operation', [
  z.object({ ...base, operation: z.literal('pick'), mode: z.enum(['files', 'folder']) }).strict(),
  z.object({ ...base, operation: z.literal('list') }).strict(),
  z
    .object({
      ...base,
      operation: z.enum(['run', 'pause', 'discard', 'dismiss']),
      batch_id: z.string().uuid(),
    })
    .strict(),
]);
export const materialBatchResponseSchema = z.union([
  z.object({ ok: z.literal(true), batch: materialBatchSchema.nullable() }).strict(),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }).strict(),
]);
export type MaterialBatch = z.infer<typeof materialBatchSchema>;
export type MaterialBatchItem = z.infer<typeof materialBatchItemSchema>;
export type MaterialBatchRequest = z.infer<typeof materialBatchRequestSchema>;
export type MaterialBatchResponse = z.infer<typeof materialBatchResponseSchema>;
