import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  PDF_VIEWER_REQUIRED_CSP_DIRECTIVES,
  assertPdfViewerControlledBytes,
  clampPdfViewerPage,
  exportArtifactPdfViewerBinding,
  isForbiddenPdfViewerDocumentSource,
  materialPdfViewerBinding,
  pdfViewerSourceBindingSchema,
} from '@caselite/contracts';

const material = {
  id: randomUUID(),
  asset_version_id: randomUUID(),
  sha256: 'a'.repeat(64),
  bytes: 128,
  page_count: 3,
};

it('rejects URL, path and traversal document sources for the renderer host', () => {
  for (const value of [
    'https://example.com/sample.pdf',
    'file:///etc/passwd',
    'data:application/pdf;base64,abc',
    '../fixtures/leak.pdf',
    '',
  ]) {
    expect(isForbiddenPdfViewerDocumentSource(value)).toBe(true);
  }
  expect(isForbiddenPdfViewerDocumentSource(new Uint8Array([37, 80, 68, 70]))).toBe(false);
});

it('binds page and byte length to a fixed source identity', () => {
  const binding = materialPdfViewerBinding(material, 2);
  expect(binding).toMatchObject({ source_id: material.id, initial_page: 2, byte_length: 128 });
  expect(() => assertPdfViewerControlledBytes(binding, new Uint8Array(64))).toThrow(/byte/);
  assertPdfViewerControlledBytes(binding, new Uint8Array(128));
  expect(clampPdfViewerPage(binding, 3)).toBe(3);
  expect(() => clampPdfViewerPage(binding, 4)).toThrow(/page/);
});

it('rejects forged binding metadata and keeps export preview bounded', () => {
  for (const extra of [
    { sha256: 'not-a-digest' },
    { byte_length: 0 },
    { page_count: 0 },
    { initial_page: 9, page_count: 2 },
    { preload: true },
    { path: '/tmp/sample.pdf' },
  ]) {
    expect(
      pdfViewerSourceBindingSchema.safeParse({ ...materialPdfViewerBinding(material), ...extra })
        .success,
    ).toBe(false);
  }
  const exportId = randomUUID();
  const snapshotId = randomUUID();
  const binding = exportArtifactPdfViewerBinding({
    id: exportId,
    snapshot_id: snapshotId,
    sha256: 'b'.repeat(64),
    bytes: 512,
  });
  expect(binding.source_id).toBe(exportId);
  expect(() =>
    exportArtifactPdfViewerBinding({
      id: exportId,
      snapshot_id: snapshotId,
      sha256: null,
      bytes: 512,
    }),
  ).toThrow(/ready/);
});

it('keeps renderer CSP and processing host aligned with the PDF viewer isolation profile', () => {
  const forge = readFileSync('apps/desktop/forge.config.mjs', 'utf8');
  const html = readFileSync('apps/desktop/src/renderer/index.html', 'utf8');
  const processor = readFileSync('apps/desktop/src/main/adapters/pdf-processor.ts', 'utf8');
  for (const directive of PDF_VIEWER_REQUIRED_CSP_DIRECTIVES) {
    expect(forge).toContain(directive);
    expect(html).toContain(directive);
  }
  expect(processor).toContain("partition: 'caselite-pdf-processing'");
  expect(processor).not.toContain('MAIN_WINDOW_PRELOAD');
  expect(processor).toMatch(/nodeIntegration:\s*false/);
});
