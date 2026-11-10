import { expect, it, vi } from 'vitest';
import { defaultLocalPreferences, LOCAL_PREFERENCES_CHANNEL } from '@caselite/contracts';
const state = vi.hoisted(() => ({
  trusted: false,
  handlers: new Map<string, (event: unknown, input: unknown) => unknown>(),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (key: string, handler: (event: unknown, input: unknown) => unknown) =>
      state.handlers.set(key, handler),
  },
}));
vi.mock('./window-capabilities', () => ({ isTrustedBusinessSender: () => state.trusted }));
import { registerLocalPreferencesIpc } from './register-local-preferences-ipc';
it('rejects an untrusted frame before reaching the workspace and validates trusted output', () => {
  const execute = vi.fn(() => ({
    ok: true as const,
    preferences: defaultLocalPreferences,
    receipt: null,
  }));
  registerLocalPreferencesIpc({ execute });
  const invoke = state.handlers.get(LOCAL_PREFERENCES_CHANNEL)!;
  const request = { protocol_version: 1, operation: 'read' };
  expect(invoke({}, request)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(execute).not.toHaveBeenCalled();
  state.trusted = true;
  expect(invoke({}, request)).toMatchObject({ ok: true, preferences: defaultLocalPreferences });
  expect(execute).toHaveBeenCalledWith(request);
});
