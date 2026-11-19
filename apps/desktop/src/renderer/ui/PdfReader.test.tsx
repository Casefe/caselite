// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { materialPdfViewerBinding } from '../pdf-viewer-binding';
import PdfReader from './PdfReader';

vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: () => <div>mock document</div>,
  Page: () => <div>mock page</div>,
}));

afterEach(cleanup);

describe('PdfReader source binding', () => {
  it('blocks byte length drift before PDF.js opens the document', () => {
    const binding = materialPdfViewerBinding({
      id: randomUUID(),
      asset_version_id: randomUUID(),
      sha256: 'a'.repeat(64),
      bytes: 8,
      page_count: 1,
    });
    render(
      <PdfReader
        name="合成合同.pdf"
        bytes={new Uint8Array(4)}
        binding={binding}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/byte/i);
    expect(screen.queryByText('mock document')).toBeNull();
  });
});
