// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PdfAttachments from './PdfAttachments';
vi.mock('./PdfReader', () => ({
  default: ({ name }: { name: string }) => <div>阅读：{name}</div>,
}));
afterEach(cleanup);
const pdf = (name = '合同.pdf') =>
  ({
    name,
    size: 12,
    arrayBuffer: async () => new TextEncoder().encode('%PDF-1.7\n').buffer,
  }) as File;
it('adds a dropped PDF, opens it, and removes only that attachment', async () => {
  const view = render(
    <PdfAttachments>
      <textarea aria-label="要求" />
    </PdfAttachments>,
  );
  fireEvent.drop(view.container.firstChild!, { dataTransfer: { files: [pdf()] } });
  await screen.findByText('合同.pdf');
  expect(screen.getByText('暂存 · 尚未保存或发送给 AI')).toBeTruthy();
  fireEvent.click(screen.getByText('合同.pdf'));
  await screen.findByText('阅读：合同.pdf');
  fireEvent.click(screen.getByLabelText('移除 合同.pdf'));
  expect(screen.queryByText('合同.pdf')).toBeNull();
});
it('rejects multi-file drops and unsupported files without silently ignoring an item', async () => {
  const view = render(<PdfAttachments>输入</PdfAttachments>);
  fireEvent.drop(view.container.firstChild!, { dataTransfer: { files: [pdf(), pdf()] } });
  expect(screen.getByRole('alert').textContent).toContain('每次添加一份');
  fireEvent.drop(view.container.firstChild!, { dataTransfer: { files: [pdf('a.docx')] } });
  expect(screen.getByRole('alert').textContent).toContain('仅支持 PDF');
});
it('rejects a renamed non-PDF and preserves the editor', async () => {
  const view = render(
    <PdfAttachments>
      <textarea defaultValue="工作要求" />
    </PdfAttachments>,
  );
  fireEvent.drop(view.container.firstChild!, {
    dataTransfer: { files: [{ ...pdf(), arrayBuffer: async () => new Uint8Array([0]).buffer }] },
  });
  await screen.findByRole('alert');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('工作要求');
  expect(screen.queryByLabelText('本次材料')).toBeNull();
});
it('discards a late read result after cancellation', async () => {
  let finish!: (value: ArrayBuffer) => void;
  const view = render(<PdfAttachments>输入</PdfAttachments>);
  fireEvent.drop(view.container.firstChild!, {
    dataTransfer: {
      files: [
        {
          ...pdf(),
          arrayBuffer: () =>
            new Promise<ArrayBuffer>((resolve) => {
              finish = resolve;
            }),
        },
      ],
    },
  });
  fireEvent.click(screen.getByText('取消读取'));
  finish(new TextEncoder().encode('%PDF-1.7').buffer);
  await waitFor(() => expect(screen.queryByText('合同.pdf')).toBeNull());
});
