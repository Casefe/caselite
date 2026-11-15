// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  AppearanceRequest,
  AppearanceResponse,
  SkinId,
  Theme,
} from '../../preload/caselite-api';
import { AppearanceProvider } from './Appearance';
import SkinSetting from './SkinSetting';
import { applyAppearanceTheme, readAppearanceSeed } from './appearance-theme';

afterEach(() => {
  cleanup();
  delete window.caseliteAppearance;
  delete document.documentElement.dataset.skin;
});

it('uses the full synchronous snapshot and removes skin on explicit legacy reset', () => {
  window.caseliteAppearance = { ok: true, theme: 'dark', skin: 'pine' };
  const seed = readAppearanceSeed();
  applyAppearanceTheme(seed.theme, seed.skin);
  expect(seed).toEqual({ ready: true, theme: 'dark', skin: 'pine' });
  expect(document.documentElement.dataset.skin).toBe('pine');
  applyAppearanceTheme('dark');
  expect(document.documentElement.dataset.skin).toBeUndefined();
});

it('offers exactly four styles, persists before display, preserves style on color changes and resets explicitly', async () => {
  let theme: Theme = 'light';
  let skin: SkinId | undefined;
  let resolveSave!: (value: AppearanceResponse) => void;
  const appearance = vi.fn((r: AppearanceRequest): Promise<AppearanceResponse> => {
    if (r.operation === 'set_skin') {
      skin = r.skin;
      return new Promise((resolve) => {
        resolveSave = resolve;
      });
    }
    if (r.operation === 'set') theme = r.theme;
    if (r.operation === 'reset_skin') skin = undefined;
    return Promise.resolve({ ok: true, theme, ...(skin ? { skin } : {}) });
  });
  window.caselite = { appearance } as unknown as Window['caselite'];
  render(
    <AppearanceProvider>
      <SkinSetting />
    </AppearanceProvider>,
  );
  await screen.findByText('尚未选择新增风格，继续沿用原版外观。');
  await waitFor(() =>
    expect(screen.getByRole('group', { name: '选择皮肤风格' }).closest('fieldset')?.disabled).toBe(
      false,
    ),
  );
  expect(
    screen.getByRole('group', { name: '选择皮肤风格' }).querySelectorAll('button'),
  ).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: /深海效率/ }));
  expect(document.documentElement.dataset.skin).toBeUndefined();
  expect(screen.getByRole('group', { name: '选择皮肤风格' }).closest('fieldset')?.disabled).toBe(
    true,
  );
  resolveSave({ ok: true, theme, skin });
  await waitFor(() =>
    expect(screen.getByRole('group', { name: '选择皮肤风格' }).closest('fieldset')?.disabled).toBe(
      false,
    ),
  );
  expect(document.documentElement.dataset.skin).toBe('deep-sea');
  fireEvent.click(screen.getByRole('button', { name: '暗黑' }));
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  expect(document.documentElement.dataset.skin).toBe('deep-sea');
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '恢复原版风格' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: '恢复原版风格' }));
  await waitFor(() => expect(document.documentElement.dataset.skin).toBeUndefined());
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(
    appearance.mock.calls.some(
      ([r]) => r.operation === 'applied' && r.skin === 'deep-sea' && r.theme === 'dark',
    ),
  ).toBe(true);
});

it('does not replay an unknown skin write and recovers the committed value by read', async () => {
  let skin: SkinId | undefined;
  const appearance = vi.fn(async (r: AppearanceRequest): Promise<AppearanceResponse> => {
    if (r.operation === 'set_skin') {
      skin = r.skin;
      return { ok: false, message: '回执未知' };
    }
    return { ok: true, theme: 'light', ...(skin ? { skin } : {}) };
  });
  window.caselite = { appearance } as unknown as Window['caselite'];
  render(
    <AppearanceProvider>
      <SkinSetting />
    </AppearanceProvider>,
  );
  const group = await screen.findByRole('group', { name: '选择皮肤风格' });
  await waitFor(() => expect(group.closest('fieldset')?.disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /松绿审阅/ }));
  await screen.findByRole('alert');
  expect(document.documentElement.dataset.skin).toBeUndefined();
  expect(group.closest('fieldset')?.disabled).toBe(true);
  fireEvent.click(screen.getByText('重新读取'));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(document.documentElement.dataset.skin).toBe('pine');
  expect(appearance.mock.calls.filter(([r]) => r.operation === 'set_skin')).toHaveLength(1);
});

it('rejects a native confirmation for another skin and keeps changes locked until readback', async () => {
  window.caseliteAppearance = { ok: true, theme: 'dark', skin: 'paper' };
  let mismatch = true;
  const appearance = vi.fn(async (r: AppearanceRequest): Promise<AppearanceResponse> => ({
    ok: true,
    theme: 'dark',
    skin: r.operation === 'applied' && mismatch ? 'pine' : 'paper',
  }));
  window.caselite = { appearance } as unknown as Window['caselite'];
  render(
    <AppearanceProvider>
      <SkinSetting />
    </AppearanceProvider>,
  );
  await screen.findByRole('alert');
  expect(screen.getByRole('group', { name: '选择皮肤风格' }).closest('fieldset')?.disabled).toBe(
    true,
  );
  mismatch = false;
  fireEvent.click(screen.getByText('重新读取'));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(document.documentElement.dataset.skin).toBe('paper');
});
