// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppearanceRequest, AppearanceResponse } from '../../preload/caselite-api';
import { AppearanceProvider, ThemeSetting } from './Appearance';

afterEach(cleanup);
describe('appearance selection', () => {
  it('changes theme only after save and offers a readback when the result is unknown', async () => {
    let current: 'light' | 'dark' = 'light';
    let fail = false;
    const appearance = vi.fn(async (request: AppearanceRequest): Promise<AppearanceResponse> => {
      if (request.operation === 'set') {
        if (fail) return { ok: false, message: '保存结果未知' };
        current = request.theme;
      }
      return { ok: true, theme: current };
    });
    window.caselite = { appearance } as unknown as Window['caselite'];
    render(
      <AppearanceProvider>
        <ThemeSetting />
      </AppearanceProvider>,
    );
    const dark = await screen.findByRole('button', { name: '深色' });
    await waitFor(() => expect((dark as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dark);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: '浅色' }));
    await screen.findByRole('alert');
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(screen.getByText('重新读取'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
