import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MATERIAL_MAX_CONTEXT } from '@caselite/contracts';
import {
  PDF_WORKER_CONTENT_SECURITY_POLICY,
  assertPdfWorkerEntry,
  bindPdfReading,
  openFixedPdfSource,
  pdfViewerResourceAllowed,
  pdfWorkerPageExpression,
} from './pdf-viewer-host';

const entry = 'file:///synthetic/renderer/pdf_worker/index.html';
const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
const lockedPolicy =
  "default-src 'none'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'";

describe('untrusted PDF viewer host', () => {
  it('locks the worker CSP and does not add eval, inline script, network, or wildcards', () => {
    const html = readFileSync(new URL('../renderer/pdf-worker.html', import.meta.url), 'utf8');
    expect(PDF_WORKER_CONTENT_SECURITY_POLICY).toBe(lockedPolicy);
    expect(html).toContain(`content="${lockedPolicy}"`);
    const directives = Object.fromEntries(
      lockedPolicy.split(';').map((part) => {
        const [name, ...rest] = part.trim().split(' ');
        return [name, rest.join(' ')];
      }),
    );
    expect(directives).toMatchObject({
      'default-src': "'none'",
      'script-src': "'self'",
      'worker-src': "'self' blob:",
      'connect-src': "'self'",
      'img-src': "'self' data: blob:",
      'object-src': "'none'",
      'base-uri': "'none'",
      'form-action': "'none'",
    });
    for (const forbidden of ['unsafe-eval', 'unsafe-inline', 'https:', 'http:', '*'])
      expect(lockedPolicy).not.toContain(forbidden);
  });

  it('allows only the fixed file entry, its bundle resources, blob, and data', () => {
    const allowed = [
      entry,
      'file:///synthetic/renderer/pdf_worker/index.js',
      'file:///synthetic/renderer/pdf-resources/cmaps/78-EUC-H.bcmap',
      'file:///synthetic/renderer/pdf-resources/standard_fonts/FoxitSerif.pfb',
      'file:///synthetic/renderer/pdf-resources/wasm/openjpeg.wasm',
      'blob:null/8b3c7a0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
      'data:image/png;base64,aaaa',
    ];
    const denied = [
      'https://evil.example/pixel.png',
      'http://localhost/pdf_worker/index.html',
      'http://127.0.0.1:3000/pdf-resources/cmaps/a.bcmap',
      'file:///etc/passwd',
      'file:///synthetic/renderer/pdf_worker/../../etc/passwd',
      'file:///synthetic/renderer-evil/secret.pdf',
      'file://user:pass@/synthetic/renderer/pdf_worker/index.html',
      'javascript:alert(1)',
      'chrome://settings',
    ];
    for (const url of allowed) expect(pdfViewerResourceAllowed(entry, url), url).toBe(true);
    for (const url of denied) expect(pdfViewerResourceAllowed(entry, url), url).toBe(false);
  });

  it('rejects a remote or credentialed worker entry before a window exists', () => {
    expect(assertPdfWorkerEntry(entry).protocol).toBe('file:');
    expect(assertPdfWorkerEntry('http://localhost:3000/pdf_worker').hostname).toBe('localhost');
    expect(() => assertPdfWorkerEntry('https://evil.example/pdf_worker/index.html')).toThrow(
      'PDF_VIEWER_ENTRY',
    );
    expect(() =>
      assertPdfWorkerEntry('file://user:pass@/synthetic/renderer/pdf_worker/index.html'),
    ).toThrow('PDF_VIEWER_ENTRY');
    expect(() => assertPdfWorkerEntry('not a url')).toThrow('PDF_VIEWER_ENTRY');
  });

  it('binds page and selection to the opened byte identity', () => {
    const source = openFixedPdfSource(bytes, 2, '12345678-1234-4234-8234-123456789abc');
    const version = source.source_version_id ?? '';
    const other = openFixedPdfSource(Uint8Array.from([1, 2, 3, 4]), 2, version);
    expect(other.asset_sha256).not.toBe(source.asset_sha256);
    const bound = bindPdfReading(source, {
      asset_sha256: source.asset_sha256,
      source_version_id: source.source_version_id,
      page: 2,
      quote: '付款十日',
    });
    expect(bound).toEqual({
      asset_sha256: source.asset_sha256,
      source_version_id: source.source_version_id,
      page: 2,
      quote: '付款十日',
    });
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(bound)).toBe(true);
    expect(() => {
      (bound as { page: number }).page = 1;
    }).toThrow(TypeError);
    expect(() =>
      bindPdfReading(source, {
        asset_sha256: other.asset_sha256,
        source_version_id: source.source_version_id,
        page: 2,
        quote: '付款十日',
      }),
    ).toThrow('PDF_SOURCE_MISMATCH');
    expect(() =>
      bindPdfReading(source, {
        asset_sha256: source.asset_sha256,
        source_version_id: '12345678-1234-4234-8234-123456789abd',
        page: 2,
        quote: '付款十日',
      }),
    ).toThrow('PDF_SOURCE_MISMATCH');
    expect(() =>
      bindPdfReading(source, {
        asset_sha256: source.asset_sha256,
        source_version_id: source.source_version_id,
        page: 3,
        quote: '付款十日',
      }),
    ).toThrow('PDF_PAGE_MISSING');
    expect(() =>
      bindPdfReading(source, {
        asset_sha256: source.asset_sha256,
        source_version_id: source.source_version_id,
        page: 1,
        quote: '',
      }),
    ).toThrow('PDF_SELECTION_REJECTED');
    expect(() =>
      bindPdfReading(source, {
        asset_sha256: source.asset_sha256,
        source_version_id: source.source_version_id,
        page: 1,
        quote: '甲'.repeat(MATERIAL_MAX_CONTEXT + 1),
      }),
    ).toThrow('PDF_SELECTION_REJECTED');
    expect(
      bindPdfReading(source, {
        asset_sha256: source.asset_sha256,
        source_version_id: source.source_version_id,
        page: 1,
        quote: '甲'.repeat(MATERIAL_MAX_CONTEXT),
      }).quote,
    ).toHaveLength(MATERIAL_MAX_CONTEXT);
  });

  it('builds the worker page call only from a safe integer and a boolean literal', () => {
    expect(pdfWorkerPageExpression(2, false)).toBe('window.caselitePdfWorker.page(2,false)');
    expect(pdfWorkerPageExpression(1, true)).toBe('window.caselitePdfWorker.page(1,true)');
    for (const page of [0, 1.5, Number.NaN, 201])
      expect(() => pdfWorkerPageExpression(page, false)).toThrow('PDF_PAGE_MISSING');
    expect(() => pdfWorkerPageExpression('1);alert(1)' as unknown as number, false)).toThrow(
      'PDF_PAGE_MISSING',
    );
    expect(() => pdfWorkerPageExpression(1, 'true' as unknown as boolean)).toThrow(
      'PDF_PAGE_MISSING',
    );
  });
});
