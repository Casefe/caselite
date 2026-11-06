import { z } from 'zod';
import { agentModelSchema } from './agent';

export const MATERIAL_CHANNEL = 'caselite:material:v1';
export const MATERIAL_PICK_CHANNEL = 'caselite:material-pick:v1';
export const MATERIAL_DROP_CHANNEL = 'caselite:material-drop:v1';
export const MATERIAL_MAX_BYTES = 20 * 1024 * 1024;
export const MATERIAL_MAX_PAGES = 200;
export const MATERIAL_MAX_CONTEXT = 32_000;
const id = z.string().uuid();
export const materialScopeSchema = z.union([z.literal('home'), id]);
export const materialStageRequestSchema = z
  .object({ scope: materialScopeSchema, path: z.string().min(1).max(4096).optional() })
  .strict();
export type MaterialScope = z.infer<typeof materialScopeSchema>;
export const textPageSchema = z.object({
  page: z.number().int().positive().max(MATERIAL_MAX_PAGES),
  text: z.string().max(100_000),
  origin: z.enum(['pdf_text', 'ocr_candidate', 'needs_ocr', 'failed']),
  // 首版只承诺物理页回看；区域结果留作定位证据，不伪装逐字核验。
  blocks: z
    .array(
      z.object({
        text: z.string().max(20_000),
        box: z.array(z.number().finite()).length(4),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(5000),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number(),
});
export type TextPage = z.infer<typeof textPageSchema>;
export const materialSchema = z.object({
  id,
  task_id: id,
  asset_version_id: id,
  name: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
  page_count: z.number().int().nonnegative(),
  derivation_id: id.nullable(),
  status: z.enum([
    'imported',
    'processing',
    'ready',
    'needs_ocr',
    'cancelled',
    'interrupted',
    'failed',
  ]),
  pages: z.array(textPageSchema).max(MATERIAL_MAX_PAGES),
});
export type Material = z.infer<typeof materialSchema>;
export const stagedPdfSchema = z.object({
  token: id,
  restore_source_id: id.optional(),
  name: z.string(),
  bytes: z.number().int().positive(),
});
const base = { protocol_version: z.literal(1), scope: materialScopeSchema };
export const materialSelectionSchema = z
  .object({
    source_id: id,
    pages: z
      .array(z.number().int().positive().max(MATERIAL_MAX_PAGES))
      .min(1)
      .max(MATERIAL_MAX_PAGES),
  })
  .strict();
export const materialRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('list_project'),
      project_id: id,
    })
    .strict(),
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('read_project'),
      project_id: id,
      source_id: id,
    })
    .strict(),
  z.object({ ...base, operation: z.literal('list') }).strict(),
  z.object({ ...base, operation: z.literal('cancel_prepare') }).strict(),
  z.object({ ...base, operation: z.literal('commit'), token: id }).strict(),
  z.object({ ...base, operation: z.literal('discard'), token: id }).strict(),
  z.object({ ...base, operation: z.literal('read'), source_id: id }).strict(),
  z
    .object({
      ...base,
      operation: z.literal('process'),
      source_id: id,
      ocr: z.boolean(),
      force: z.boolean().optional(),
    })
    .strict(),
  z.object({ ...base, operation: z.literal('cancel'), source_id: id }).strict(),
  z.object({ ...base, operation: z.literal('restore'), source_id: id, token: id }).strict(),
  z.object({ ...base, operation: z.literal('new_home') }).strict(),
  z
    .object({
      ...base,
      operation: z.literal('preview'),
      instruction: z.string().trim().min(1).max(4000),
      model: agentModelSchema,
      selected: z.array(materialSelectionSchema).min(1).max(16),
      automatic: z.boolean().optional(),
    })
    .strict(),
]);
export type MaterialRequest = z.infer<typeof materialRequestSchema>;
export const materialPreviewSchema = z.object({
  id,
  task_id: id,
  instruction: z.string(),
  model: agentModelSchema,
  payload: z.string().max(MATERIAL_MAX_CONTEXT),
  sha256: z.string(),
  images: z
    .array(
      z.object({
        source_id: id,
        page: z.number().int().positive(),
        sha256: z.string(),
        configuration: z.string(),
      }),
    )
    .max(12)
    .optional(),
  selections: z.array(
    z.object({ source_id: id, derivation_id: id, name: z.string(), pages: z.array(z.number()) }),
  ),
});
export type MaterialPreview = z.infer<typeof materialPreviewSchema>;
export const materialResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    materials: z.array(materialSchema),
    staged: stagedPdfSchema.nullable().optional(),
    data: z.instanceof(Uint8Array).optional(),
    preview: materialPreviewSchema.optional(),
  }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
]);
export type MaterialResponse = z.infer<typeof materialResponseSchema>;
