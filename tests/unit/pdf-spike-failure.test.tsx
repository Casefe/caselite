// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PdfSpike from '../../apps/desktop/src/renderer/PdfSpike';

vi.mock('react-pdf', async () => {
  const { useEffect } = await import('react');
  return {
    pdfjs: {
      GlobalWorkerOptions: {},
      PDFWorker: class {
        promise = Promise.resolve();
        port = null;
        destroy() {}
      },
    },
    Document: ({
      file,
      children,
      onLoadSuccess,
      onLoadError,
    }: {
      file: string;
      children: ReactNode;
      onLoadSuccess: (result: { numPages: number }) => void;
      onLoadError: () => void;
    }) => {
      useEffect(() => {
        if (file.includes('damaged.pdf') || file.includes('not-present.pdf')) {
          onLoadError();
        } else {
          onLoadSuccess({ numPages: 1 });
        }
      }, [file, onLoadError, onLoadSuccess]);
      return <div>{children}</div>;
    },
    Page: () => <div>合成 PDF 页面</div>,
  };
});

afterEach(cleanup);

describe('PDF failure recovery', () => {
  it.each([
    ['损坏 PDF（预期报错）', '3'],
    ['缺失 PDF（预期报错）', '4'],
  ])('shows an error for %s and still permits a valid sample', async (_label, index) => {
    render(<PdfSpike />);
    const selector = screen.getByLabelText('测试样本') as HTMLSelectElement;

    fireEvent.change(selector, { target: { value: index } });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'PDF 文件损坏或不存在，无法打开。请选择其他测试样本。',
    );
    expect(selector.value).toBe(index);

    fireEvent.change(selector, { target: { value: '0' } });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText('合成 PDF 页面')).toBeTruthy();
  });
});
