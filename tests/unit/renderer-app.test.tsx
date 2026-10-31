// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../../apps/desktop/src/renderer/App';

vi.mock('../../apps/desktop/src/renderer/PdfSpike', () => ({
  default: () => {
    throw new Error('synthetic PDF test-page failure');
  },
}));

afterEach(cleanup);

describe('CaseLite engineering baseline', () => {
  it('shows that only the desktop engineering baseline is available', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'CaseLite 工程骨架' })).toBeTruthy();
    expect(screen.getByText(/尚未提供案件或正式文档处理功能/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开 PDF 测试页' })).toBeTruthy();
  });

  it('keeps the desktop shell visible when the PDF test page throws', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '打开 PDF 测试页' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'CaseLite 工程骨架' })).toBeTruthy();
  });
});
