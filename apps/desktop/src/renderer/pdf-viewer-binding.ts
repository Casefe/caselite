import type { Material } from '../preload/caselite-api';

const MATERIAL_MAX_BYTES = 20 * 1024 * 1024;
const MATERIAL_MAX_PAGES = 200;
const digest = /^[a-f0-9]{64}$/;

export type PdfViewerSourceBinding = {
  source_id: string;
  asset_version_id: string;
  sha256: string;
  byte_length: number;
  page_count: number;
  initial_page: number;
};

function assertBinding(binding: PdfViewerSourceBinding) {
  if (!binding.source_id || !binding.asset_version_id)
    throw new Error('Invalid PDF viewer source identity');
  if (!digest.test(binding.sha256)) throw new Error('Invalid PDF viewer digest');
  if (
    !Number.isInteger(binding.byte_length) ||
    binding.byte_length < 1 ||
    binding.byte_length > MATERIAL_MAX_BYTES
  )
    throw new Error('Invalid PDF viewer byte length');
  if (
    !Number.isInteger(binding.page_count) ||
    binding.page_count < 1 ||
    binding.page_count > MATERIAL_MAX_PAGES
  )
    throw new Error('Invalid PDF viewer page count');
  if (
    !Number.isInteger(binding.initial_page) ||
    binding.initial_page < 1 ||
    binding.initial_page > MATERIAL_MAX_PAGES ||
    binding.initial_page > binding.page_count
  )
    throw new Error('Initial page exceeds fixed source page count');
}

export function materialPdfViewerBinding(
  material: Partial<Pick<Material, 'id' | 'asset_version_id' | 'sha256' | 'bytes' | 'page_count'>>,
  initialPage = 1,
): PdfViewerSourceBinding | null {
  if (!material.id || !material.sha256 || !material.bytes) return null;
  const binding = {
    source_id: material.id,
    asset_version_id: material.asset_version_id ?? material.id,
    sha256: material.sha256,
    byte_length: material.bytes,
    page_count: Math.max(material.page_count ?? 1, 1),
    initial_page: initialPage,
  };
  try {
    assertBinding(binding);
    return binding;
  } catch {
    return null;
  }
}

export function exportArtifactPdfViewerBinding(
  record: Pick<
    { id: string; snapshot_id: string; sha256: string | null; bytes: number | null },
    'id' | 'snapshot_id' | 'sha256' | 'bytes'
  >,
  initialPage = 1,
): PdfViewerSourceBinding {
  if (!record.sha256 || !record.bytes) throw new Error('Export artifact is not ready');
  const binding = {
    source_id: record.id,
    asset_version_id: record.snapshot_id,
    sha256: record.sha256,
    byte_length: record.bytes,
    page_count: 1,
    initial_page: initialPage,
  };
  assertBinding(binding);
  return binding;
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
