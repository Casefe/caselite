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
    available: true,
    items: [],
    error: '',
    busy: false,
    staged: undefined,
    uploadingName: undefined,
    reading: null,
    selected: {},
    clearReading: vi.fn(),
    add: vi.fn(),
    errorMessage: vi.fn(),
    retry: vi.fn(),
    acknowledge: vi.fn(),
    cancelPreparation: vi.fn(),
    discard: vi.fn(),
    readReference: vi.fn(),
    select: vi.fn(),
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
it('restored incomplete staging offers retry and remove without claiming saved data', () => {
  const c = controller({ staged: { token: 'staged', name: '合同.pdf', bytes: 100 } });
  render(<PdfAttachments controller={c}>输入</PdfAttachments>);
  expect(screen.getByText(/上次附件尚未完成/)).toBeTruthy();
  fireEvent.click(screen.getByText('继续添加'));
  expect(c.retry).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('移除'));
  expect(c.discard).toHaveBeenCalledTimes(1);
  expect(c.add).not.toHaveBeenCalled();
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
