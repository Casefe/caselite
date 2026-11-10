import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow, WebContents } from 'electron';
import { createAppearanceApplication } from '@caselite/application';
import { APPEARANCE_INITIAL_CHANNEL, type Theme } from '@caselite/contracts';
const state = vi.hoisted(() => ({
  initial: undefined as
    | undefined
    | ((
        event: { sender: unknown; senderFrame: unknown; returnValue?: unknown },
        ...args: unknown[]
      ) => void),
  command: undefined as undefined | ((event: unknown, input: unknown) => unknown),
  windows: [] as unknown[],
  native: { themeSource: 'system' },
}));
vi.mock('electron', () => ({
  ipcMain: {
    on: (_: string, h: typeof state.initial) => {
      state.initial = h;
    },
    handle: (_: string, h: typeof state.command) => {
      state.command = h;
    },
  },
  nativeTheme: state.native,
  BrowserWindow: { getAllWindows: () => state.windows },
}));
import { registerDesktopWindowCapabilities } from './ipc/window-capabilities';
import { createWindowAppearance, appearanceBackground } from './window-appearance';
import { registerAppearanceIpc } from './ipc/register-appearance-ipc';
import { createAppearancePreferences } from './adapters/appearance-preferences';
const fakeWindow = () => {
  const window = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), {
      mainFrame: { url: 'file:///workbench.html' },
      isDestroyed: () => false,
    }),
    isDestroyed: () => false,
    setBackgroundColor: vi.fn(),
  }) as unknown as BrowserWindow;
  registerDesktopWindowCapabilities(window, 'workbench', 'file:///workbench.html');
  return window;
};
beforeEach(() => {
  state.windows = [];
  state.native.themeSource = 'system';
});
describe('appearance first frame and native confirmation', () => {
  it('uses the real preference owner for a fresh dark seed and an explicitly saved light seed', () => {
    const root = mkdtempSync(join(tmpdir(), 'caselite-appearance-seed-'));
    try {
      const preferences = createAppearancePreferences(root);
      const host = createWindowAppearance(createAppearanceApplication(preferences));
      const window = fakeWindow();
      host.attach(window);
      const event = {
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame,
        returnValue: undefined as unknown,
      };
      expect(host.snapshot().theme).toBe('dark');
      expect(state.native.themeSource).toBe('dark');
      state.initial!(event);
      expect(event.returnValue).toEqual({ ok: true, theme: 'dark' });
      expect(window.setBackgroundColor).toHaveBeenLastCalledWith(appearanceBackground('dark'));
      expect(existsSync(join(root, 'appearance-preferences.json'))).toBe(false);
      preferences.write('light');
      state.initial!(event);
      expect(event.returnValue).toEqual({ ok: true, theme: 'light' });
      expect(window.setBackgroundColor).toHaveBeenLastCalledWith(appearanceBackground('light'));
      expect(createAppearancePreferences(root).read()).toBe('light');
      window.emit('closed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('returns fresh read-only snapshots only to a managed main frame, including reload and corrupt data', () => {
    let theme: Theme = 'dark';
    let corrupt = false;
    const port = {
      read: () => {
        if (corrupt) throw new Error('corrupt');
        return theme;
      },
      write: vi.fn(),
    };
    const host = createWindowAppearance(createAppearanceApplication(port));
    expect(state.native.themeSource).toBe('dark');
    const window = fakeWindow();
    host.attach(window);
    const event = {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
      returnValue: undefined as unknown,
    };
    state.initial!(event);
    expect(event.returnValue).toEqual({ ok: true, theme: 'dark' });
    theme = 'light';
    state.initial!(event);
    expect(event.returnValue).toEqual({ ok: true, theme: 'light' });
    for (const bad of [
      { ...event, senderFrame: {} },
      { ...event, sender: {} },
      { ...event, senderFrame: null },
    ]) {
      state.initial!(bad);
      expect(bad.returnValue).toMatchObject({ ok: false });
    }
    state.initial!(event, { operation: 'set', theme: 'dark' });
    expect(event.returnValue).toMatchObject({ ok: false });
    corrupt = true;
    state.initial!(event);
    expect(event.returnValue).toMatchObject({ ok: false });
    expect(port.write).not.toHaveBeenCalled();
    window.emit('closed');
    corrupt = false;
    state.initial!(event);
    expect(event.returnValue).toMatchObject({ ok: false });
    expect(APPEARANCE_INITIAL_CHANNEL).toBe('caselite:appearance-initial:v1');
  });
  it('does not change native UI on save; confirms only matching disk state and one managed window', () => {
    let theme: Theme = 'dark';
    const port = {
      read: () => theme,
      write: (next: Theme) => {
        theme = next;
      },
    };
    const application = createAppearanceApplication(port),
      host = createWindowAppearance(application);
    const window = fakeWindow();
    host.attach(window);
    state.windows = [window];
    registerAppearanceIpc(application, host.confirm);
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    expect(
      state.command!(event, { protocol_version: 1, operation: 'set', theme: 'light' }),
    ).toEqual({ ok: true, theme: 'light' });
    expect(state.native.themeSource).toBe('dark');
    expect(window.setBackgroundColor).not.toHaveBeenCalled();
    expect(
      state.command!(event, { protocol_version: 1, operation: 'applied', theme: 'dark' }),
    ).toMatchObject({ ok: false });
    expect(
      state.command!(
        { ...event, senderFrame: {} },
        { protocol_version: 1, operation: 'applied', theme: 'light' },
      ),
    ).toMatchObject({ ok: false });
    expect(
      state.command!(event, {
        protocol_version: 1,
        operation: 'applied',
        theme: 'light',
        extra: true,
      }),
    ).toMatchObject({ ok: false });
    expect(state.native.themeSource).toBe('dark');
    expect(
      state.command!(event, { protocol_version: 1, operation: 'applied', theme: 'light' }),
    ).toEqual({ ok: true, theme: 'light' });
    expect(state.native.themeSource).toBe('light');
    expect(window.setBackgroundColor).toHaveBeenCalledWith(appearanceBackground('light'));
    host.attach(fakeWindow());
    expect(host.confirm(window.webContents as WebContents, 'dark')).toBe(false);
    expect(state.native.themeSource).toBe('light');
  });
});
