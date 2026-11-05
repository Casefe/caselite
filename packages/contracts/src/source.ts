import { z } from 'zod';

// DEV-1579设计合同；没有注册IPC或创建表，实际文件消费者仍须校验权限及字节。
const id = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const coordinate = z.number().finite();
export const readyAssetSchema = z
  .object({
    asset_version_id: id,
    sha256: digest,
    bytes: z.number().int().positive().safe(),
    media_type: z.literal('application/pdf'),
    state: z.literal('ready'),
  })
  .strict();

export const sourceVersionSchema = z
  .object({
    source_version_id: id,
    task_id: id,
    asset_version_id: id,
    asset_sha256: digest,
    title: z.string().trim().min(1).max(500),
    page_count: z.number().int().positive().max(100_000),
  })
  .strict();

export const pdfPageGeometrySchema = z
  .object({
    page_index: z.number().int().nonnegative(),
    display_label: z.string().max(64),
    crop_box: z.tuple([coordinate, coordinate, coordinate, coordinate]),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    user_unit: z.number().positive().finite(),
  })
  .strict()
  .refine((page) => page.crop_box[2] > page.crop_box[0] && page.crop_box[3] > page.crop_box[1], {
    message: 'Invalid PDF crop box',
  });

const quad = z.tuple([
  coordinate,
  coordinate,
  coordinate,
  coordinate,
  coordinate,
  coordinate,
  coordinate,
  coordinate,
]);
const convexQuad = (points: number[]) => {
  const corners = [0, 2, 6, 4].map((index) => [points[index], points[index + 1]]);
  const turns = corners.map((a, index) => {
    const b = corners[(index + 1) % 4];
    const c = corners[(index + 2) % 4];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  });
  return turns.every((value) => value > 0) || turns.every((value) => value < 0);
};
export const pdfAnchorSchema = z
  .object({
    anchor_id: id,
    source_version_id: id,
    locator_version: z.literal(1),
    locator_granularity: z.enum(['text', 'region', 'page']),
    page: pdfPageGeometrySchema,
    quads: z.array(quad).max(1000),
    quote: z.string().min(1).max(32_000),
    prefix: z.string().max(1000),
    suffix: z.string().max(1000),
    text_origin: z.enum(['pdf_text', 'ocr_candidate']),
    text_derivation_id: id.nullable(),
  })
  .strict()
  .superRefine((anchor, context) => {
    if (anchor.text_origin === 'ocr_candidate' && anchor.text_derivation_id === null)
      context.addIssue({ code: 'custom', message: 'OCR candidate requires a fixed derivation' });
    if (
      (anchor.text_origin === 'pdf_text' && anchor.locator_granularity !== 'text') ||
      (anchor.text_origin === 'ocr_candidate' && anchor.locator_granularity === 'text')
    )
      context.addIssue({
        code: 'custom',
        message: 'Unverified OCR cannot claim exact text location',
      });
    if (
      anchor.locator_granularity === 'page' ? anchor.quads.length !== 0 : anchor.quads.length === 0
    )
      context.addIssue({ code: 'custom', message: 'Geometry must match the declared granularity' });
    if (anchor.quads.some((points) => !convexQuad(points)))
      context.addIssue({ code: 'custom', message: 'Degenerate or crossed PDF quad' });
    const [left, bottom, right, top] = anchor.page.crop_box;
    if (
      anchor.quads.some((points) =>
        points.some((value, index) =>
          index % 2 === 0 ? value < left || value > right : value < bottom || value > top,
        ),
      )
    )
      context.addIssue({ code: 'custom', message: 'Geometry is outside the fixed page crop box' });
  });

// SourceRef是稳定引用值；不因此建立第二source_refs真源。
export const sourceRefSchema = z.object({ source_version_id: id, anchor_id: id }).strict();
export const sourceResolutionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('resolved'), anchor: pdfAnchorSchema }).strict(),
  z
    .object({
      status: z.literal('unresolved'),
      reason: z.enum([
        'FORBIDDEN',
        'SOURCE_MISSING',
        'VERSION_MISMATCH',
        'FORMAT_UNSUPPORTED',
        'PAGE_MISSING',
        'QUOTE_MISMATCH',
        'AMBIGUOUS',
        'OCR_REQUIRED',
      ]),
    })
    .strict(),
]);
export type ReadyAsset = z.infer<typeof readyAssetSchema>;
export type SourceVersion = z.infer<typeof sourceVersionSchema>;
export type PdfAnchor = z.infer<typeof pdfAnchorSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
