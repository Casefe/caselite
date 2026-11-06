// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PdfAttachments, { validatePdfFile } from './PdfAttachments';
import { pageRange, type MaterialController } from './useMaterials';
vi.mock('./PdfReader', () => ({
  default: ({ name }: { name: string }) => <div>阅读：{name}</div>,
}));
afterEach(cleanup);
function controller(extra: Partial<MaterialController> = {}): MaterialController {
  return {
    canNewHome: true,
    available: true,
    items: [],
    error: '',
    busy: false,
    staged: null,
    reading: null,
    selected: {},
    signature: '',
    clearReading: vi.fn(),
    add: vi.fn(),
    errorMessage: vi.fn(),
    commit: vi.fn(),
    discard: vi.fn(),
    read: vi.fn(),
    process: vi.fn(),
    cancel: vi.fn(),
    restore: vi.fn(),
    newHome: vi.fn(),
    select: vi.fn(),
    range: vi.fn(),
    preview: vi.fn(),
    ...extra,
  };
}
const pdf = { name: '合同.pdf', size: 100 } as File;
it('sends only a real single-file drop to the controlled port and preserves the editor', () => {
  const c = controller(),
    view = render(
      <PdfAttachments controller={c}>
        <textarea defaultValue="工作要求" />
      </PdfAttachments>,
    );
  fireEvent.drop(view.container.firstChild!, { dataTransfer: { files: [pdf] } });
  expect(c.add).toHaveBeenCalledWith(pdf);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('工作要求');
  fireEvent.drop(view.container.firstChild!, { dataTransfer: { files: [pdf, pdf] } });
  expect(c.errorMessage).toHaveBeenCalledWith('每次添加一份 PDF，可多次添加。');
  expect(c.add).toHaveBeenCalledTimes(1);
});
it('staging offers explicit commit and cancel without claiming saved data', () => {
  const c = controller({ staged: { token: 'staged', name: '合同.pdf', bytes: 100 } });
  render(<PdfAttachments controller={c}>输入</PdfAttachments>);
  expect(screen.getByText(/待导入/)).toBeTruthy();
  fireEvent.click(screen.getByText('取消导入'));
  expect(c.discard).toHaveBeenCalledTimes(1);
  expect(c.commit).not.toHaveBeenCalled();
});
it('does not accept drops while an AI request is pending', () => {
  const c = controller(),
    view = render(
      <PdfAttachments controller={c} disabled>
        输入
      </PdfAttachments>,
    );
  fireEvent.drop(view.container.firstChild!, { dataTransfer: { files: [pdf] } });
  expect(c.add).not.toHaveBeenCalled();
});
it('validates file budget and explicit page ranges without silently broadening selection', () => {
  expect(validatePdfFile({ name: 'bad.txt', size: 10 })).toContain('仅支持 PDF');
  expect(validatePdfFile({ name: 'big.pdf', size: 30 * 1024 * 1024 })).toContain('20 MB');
  expect(pageRange('1-3,5', 5)).toEqual([1, 2, 3, 5]);
  expect(pageRange('1-9', 5)).toBeNull();
  expect(pageRange('2-1', 5)).toBeNull();
  expect(pageRange('', 3)).toEqual([1, 2, 3]);
});
