import { z } from 'zod';
import { agentModelSchema } from './agent';

export const MATERIAL_CHANNEL = 'caselite:material:v1';
export const MATERIAL_PICK_CHANNEL = 'caselite:material-pick:v1';
export const MATERIAL_DROP_CHANNEL = 'caselite:material-drop:v1';
export const MATERIAL_MAX_BYTES = 20 * 1024 * 1024;
export const MATERIAL_FILE_EXTENSIONS = ['pdf', 'docx', 'png', 'jpg', 'jpeg'] as const;
export const CREATION_ATTACHMENT_LIMIT = 16;
export const MATERIAL_MAX_PAGES = 200;
export const MATERIAL_MAX_CONTEXT = 32_000;
export type MaterialKind = 'pdf' | 'docx' | 'image';
export function materialKind(name: string): MaterialKind | undefined {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (!name.includes('.')) return;
  if (ext === 'pdf' || ext === 'docx') return ext;
  if (['png', 'jpg', 'jpeg'].includes(ext)) return 'image';
}
export function materialLocation(name: string, page: number) {
  const kind = materialKind(name);
  if (kind === 'docx') return `Word 提取段 ${page}`;
  if (kind === 'image') return '照片';
  return `物理页 ${page}`;
}
const id = z.string().uuid();
export const creationDraftRecordSchema = z
  .object({
    id,
    state: z.enum(['open', 'bound', 'finished', 'discarded']),
    tokens: z.array(id).max(CREATION_ATTACHMENT_LIMIT),
    task_id: id.optional(),
  })
  .strict();
export type CreationDraftRecord = z.infer<typeof creationDraftRecordSchema>;
export const creationAttachmentDraftSchema = creationDraftRecordSchema.extend({
  files: z
    .array(
      z
        .object({
          token: id,
          name: z.string(),
          bytes: z.number().int().positive(),
          saved: z.boolean(),
        })
        .strict(),
    )
    .max(CREATION_ATTACHMENT_LIMIT),
});
export type CreationAttachmentDraft = z.infer<typeof creationAttachmentDraftSchema>;
export const materialScopeSchema = z.union([z.literal('home'), id]);
export const materialStageRequestSchema = z
  .object({
    scope: materialScopeSchema,
    path: z.string().min(1).max(4096).optional(),
  })
  .strict();
export type MaterialScope = z.infer<typeof materialScopeSchema>;
export const textPageSchema = z.object({
  page: z.number().int().positive().max(MATERIAL_MAX_PAGES),
  text: z.string().max(100_000),
  origin: z.enum(['pdf_text', 'docx_text', 'ocr_candidate', 'needs_ocr', 'failed']),
  docx_review: z.object({ revisions: z.boolean(), comments: z.boolean() }).optional(),
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
  z.strictObject({ ...base, operation: z.literal('creation_resume') }),
  z.strictObject({ ...base, operation: z.literal('creation_open') }),
  z.strictObject({ ...base, operation: z.literal('creation_read') }),
  z.strictObject({ ...base, operation: z.literal('creation_remove'), token: id }),
  z.strictObject({ ...base, operation: z.literal('creation_discard') }),
  z.strictObject({ ...base, operation: z.literal('creation_bind'), task_id: id }),
  z.strictObject({ ...base, operation: z.literal('creation_finish') }),
  z.strictObject({ ...base, operation: z.literal('camera_permission') }),
  z.strictObject({ ...base, operation: z.literal('photo_ticket') }),
  z.strictObject({ ...base, operation: z.literal('camera_revoke') }),
  z.strictObject({
    ...base,
    operation: z.literal('capture_photo'),
    token: id,
    bytes: z
      .instanceof(Uint8Array)
      .refine((value) => value.length >= 8 && value.length <= 8 * 1024 * 1024),
  }),
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
  z.strictObject({
    ...base,
    operation: z.literal('read_fixed'),
    source_id: id,
    derivation_id: id,
    asset_version_id: id,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({ ...base, operation: z.literal('save_original'), source_id: id }).strict(),
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('save_project_original'),
      project_id: id,
      source_id: id,
    })
    .strict(),
  z.object({ ...base, operation: z.literal('docx_semantic_preview'), source_id: id }).strict(),
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
      text_only: z.literal(true).optional(),
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
    creation_draft: creationAttachmentDraftSchema.nullable().optional(),
    creation_warning: z.string().optional(),
    staged: stagedPdfSchema.nullable().optional(),
    capture_token: id.optional(),
    data: z.instanceof(Uint8Array).optional(),
    preview: materialPreviewSchema.optional(),
    docx_semantic: z
      .object({
        html: z.string().min(1).max(1_000_000),
        warningCount: z.number().int().nonnegative(),
      })
      .optional(),
  }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
]);
export type MaterialResponse = z.infer<typeof materialResponseSchema>;
