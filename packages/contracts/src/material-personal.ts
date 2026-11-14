import { z } from 'zod';
import { MATERIAL_MAX_BYTES, MATERIAL_MAX_PAGES, textPageSchema } from './material';

export const personalMaterialHeaderSchema = z.strictObject({
  id: z.string().uuid(),
  owner_kind: z.literal('personal'),
  asset_version_id: z.string().uuid(),
  name: z.string().min(1).max(512),
  kind: z.enum(['pdf', 'docx', 'image']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(MATERIAL_MAX_BYTES),
  page_count: z.number().int().positive().max(MATERIAL_MAX_PAGES),
  derivation_id: z.string().uuid(),
  status: z.enum(['ready', 'needs_ocr']),
});
export type PersonalMaterialHeader = z.infer<typeof personalMaterialHeaderSchema>;
export const personalMaterialSchema = personalMaterialHeaderSchema
  .extend({
    pages: z.array(textPageSchema).max(MATERIAL_MAX_PAGES),
  })
  .refine(
    (source) =>
      source.pages.length === source.page_count &&
      source.pages.every((page, i) => page.page === i + 1 && page.origin !== 'failed') &&
      (source.status === 'needs_ocr') === source.pages.some((page) => page.origin === 'needs_ocr'),
    { message: '固定副本的页数、页序和提取状态不一致。' },
  );
export type PersonalMaterial = z.infer<typeof personalMaterialSchema>;
