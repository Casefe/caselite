// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from '../../apps/desktop/src/renderer/App';

describe('CaseLite engineering baseline', () => {
  it('shows that only the desktop engineering baseline is available', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'CaseLite 工程骨架' })).toBeTruthy();
    expect(screen.getByText(/尚未提供案件或文档处理功能/)).toBeTruthy();
  });
});
