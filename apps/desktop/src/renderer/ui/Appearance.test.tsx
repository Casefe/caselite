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

it('keeps the boot theme while the async read is delayed and hides the workbench on failed initialization', async () => {
  let resolveRead!: (value: AppearanceResponse) => void;
  window.caseliteAppearance = { ok: true, theme: 'dark' };
  document.documentElement.dataset.theme = 'dark';
  window.caselite = {
    appearance: vi.fn((r: AppearanceRequest) =>
      r.operation === 'read'
        ? new Promise<AppearanceResponse>((resolve) => {
            resolveRead = resolve;
          })
        : Promise.resolve({ ok: true, theme: 'dark' }),
    ),
  } as unknown as Window['caselite'];
  const view = render(
    <AppearanceProvider>
      <ThemeSetting />
    </AppearanceProvider>,
  );
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(screen.getByRole('button', { name: '深色' }).getAttribute('aria-pressed')).toBe('true');
  resolveRead({ ok: true, theme: 'dark' });
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '深色' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  view.unmount();
  window.caseliteAppearance = { ok: false, message: 'corrupt' };
  let recover = false;
  window.caselite = {
    appearance: vi.fn(async () =>
      recover ? { ok: true, theme: 'dark' } : { ok: false, message: '偏好无法读取' },
    ),
  } as unknown as Window['caselite'];
  render(
    <AppearanceProvider>
      <p>工作台正文</p>
    </AppearanceProvider>,
  );
  await screen.findByRole('alert');
  expect(screen.queryByText('工作台正文')).toBeNull();
  recover = true;
  fireEvent.click(screen.getByText('重新读取'));
  await screen.findByText('工作台正文');
});

it('keeps the old display on a committed write with unknown receipt and recovers by read without resubmission', async () => {
  delete window.caseliteAppearance;
  let current: 'light' | 'dark' = 'dark';
  const appearance = vi.fn(async (r: AppearanceRequest): Promise<AppearanceResponse> => {
    if (r.operation === 'set') {
      current = r.theme;
      return { ok: false, message: '回执未知' };
    }
    return { ok: true, theme: current };
  });
  window.caselite = { appearance } as unknown as Window['caselite'];
  render(
    <AppearanceProvider>
      <ThemeSetting />
    </AppearanceProvider>,
  );
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '浅色' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '浅色' }));
  await screen.findByRole('alert');
  expect(document.documentElement.dataset.theme).toBe('dark');
  fireEvent.click(screen.getByText('重新读取'));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(appearance.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
});

it('holds the change lock through native confirmation and requires explicit readback after failed confirmation', async () => {
  delete window.caseliteAppearance;
  let current: 'light' | 'dark' = 'light';
  let confirm!: (value: AppearanceResponse) => void;
  let delay = true;
  const appearance = vi.fn((r: AppearanceRequest): Promise<AppearanceResponse> => {
    if (r.operation === 'set') current = r.theme;
    if (r.operation === 'applied' && r.theme === 'dark' && delay)
      return new Promise((resolve) => {
        confirm = resolve;
      });
    return Promise.resolve({ ok: true, theme: current });
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
  fireEvent.click(dark);
  await waitFor(() => expect(confirm).toBeTypeOf('function'));
  expect((screen.getByRole('button', { name: '浅色' }) as HTMLButtonElement).disabled).toBe(true);
  expect(appearance.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
  confirm({ ok: false, message: '原生同步回执未知' });
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '浅色' }));
  expect(appearance.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
  delay = false;
  fireEvent.click(screen.getByText('重新读取'));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(document.documentElement.dataset.theme).toBe('dark');
});
