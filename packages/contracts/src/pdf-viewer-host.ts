import { z } from 'zod';
import { MATERIAL_MAX_BYTES, MATERIAL_MAX_PAGES } from './material';

const id = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);

// DEV-1863：前台 PDF 只能在无业务 preload 的宿主内消费固定来源字节，不得自行打开 file/http(s) 资源。
export const PDF_VIEWER_HOST_CHANNEL = 'caselite:pdf-viewer-host:v1';

export const PDF_VIEWER_HOST_ISOLATION = {
  exposesBusinessPreload: false,
  exposesNodeIntegration: false,
  allowsArbitraryDiskPaths: false,
  allowsRemoteResourceUrls: false,
  documentInput: 'controlled-bytes-only',
} as const;

export const PDF_VIEWER_REQUIRED_CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "object-src 'none'",
] as const;

const forbiddenSourcePattern = /^(https?:|file:|data:)/i;

export const pdfViewerSourceBindingSchema = z
  .object({
    source_id: id,
    asset_version_id: id,
    sha256: digest,
    byte_length: z.number().int().positive().max(MATERIAL_MAX_BYTES),
    page_count: z.number().int().positive().max(MATERIAL_MAX_PAGES),
    initial_page: z.number().int().positive().max(MATERIAL_MAX_PAGES),
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.initial_page > binding.page_count)
      context.addIssue({
        code: 'custom',
        message: 'Initial page exceeds fixed source page count',
      });
  });

export type PdfViewerSourceBinding = z.infer<typeof pdfViewerSourceBindingSchema>;

export function materialPdfViewerBinding(
  material: Pick<
    { id: string; asset_version_id: string; sha256: string; bytes: number; page_count: number },
    'id' | 'asset_version_id' | 'sha256' | 'bytes' | 'page_count'
  >,
  initialPage = 1,
): PdfViewerSourceBinding {
  return pdfViewerSourceBindingSchema.parse({
    source_id: material.id,
    asset_version_id: material.asset_version_id,
    sha256: material.sha256,
    byte_length: material.bytes,
    page_count: Math.max(material.page_count, 1),
    initial_page: initialPage,
  });
}

export function exportArtifactPdfViewerBinding(
  record: Pick<
    { id: string; snapshot_id: string; sha256: string | null; bytes: number | null },
    'id' | 'snapshot_id' | 'sha256' | 'bytes'
  >,
  initialPage = 1,
): PdfViewerSourceBinding {
  if (!record.sha256 || !record.bytes) throw new Error('Export artifact is not ready');
  return pdfViewerSourceBindingSchema.parse({
    source_id: record.id,
    asset_version_id: record.snapshot_id,
    sha256: record.sha256,
    byte_length: record.bytes,
    page_count: 1,
    initial_page: initialPage,
  });
}

export function isForbiddenPdfViewerDocumentSource(value: unknown): boolean {
  if (typeof value === 'string') {
    const source = value.trim();
    if (!source || forbiddenSourcePattern.test(source) || source.includes('..')) return true;
  }
  return false;
}

export function assertPdfViewerControlledBytes(
  binding: PdfViewerSourceBinding,
  bytes: Uint8Array,
): void {
  if (bytes.byteLength !== binding.byte_length)
    throw new Error('PDF viewer bytes length does not match fixed source');
  if (bytes.byteLength > MATERIAL_MAX_BYTES) throw new Error('PDF viewer byte budget exceeded');
}

export function clampPdfViewerPage(binding: PdfViewerSourceBinding, page: number): number {
  const clamped = Math.min(Math.max(1, page), binding.page_count);
  if (!Number.isInteger(page) || page !== clamped)
    throw new Error('PDF viewer page is outside the fixed source');
  return clamped;
}
