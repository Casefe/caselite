import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FolderCaller } from '@caselite/application';
const state = vi.hoisted(() => ({
  trusted: true,
  handlers: new Map<string, (event: unknown, value: unknown) => Promise<unknown>>(),
  revoked: undefined as (() => void) | undefined,
  chooser: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (event: unknown, value: unknown) => Promise<unknown>) =>
      state.handlers.set(name, fn),
  },
  BrowserWindow: {
    fromWebContents: () => ({ id: 7 }),
    fromId: () => ({ id: 7, isDestroyed: () => false }),
  },
  dialog: { showOpenDialog: (...args: unknown[]) => state.chooser(...args) },
}));
vi.mock('./window-capabilities', () => ({
  isTrustedBusinessSender: () => state.trusted,
  onBusinessAccessRevoked: (_event: unknown, listener: () => void) => {
    state.revoked = listener;
  },
}));
import { FOLDER_CHANNEL, type FolderResponse } from '@caselite/contracts';
import { chooseFolder, registerFolderIpc } from './register-folder-ipc';
beforeEach(() => {
  state.handlers.clear();
  state.trusted = true;
  state.revoked = undefined;
  state.chooser.mockReset();
});
const request = { protocol_version: 1, operation: 'configuration', scope: { kind: 'workspace' } };
it('rejects untrusted child/consent senders before invoking the Application', async () => {
  const execute = vi.fn(),
    revokeCaller = vi.fn();
  registerFolderIpc({ execute, revokeCaller }, 'workspace');
  state.trusted = false;
  expect(await state.handlers.get(FOLDER_CHANNEL)!({ sender: {} }, request)).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
  });
  expect(execute).not.toHaveBeenCalled();
});
it('rejects public raw paths and authority fields before invoking the Application', async () => {
  const execute = vi.fn();
  registerFolderIpc({ execute, revokeCaller: vi.fn() }, 'workspace');
  expect(
    await state.handlers.get(FOLDER_CHANNEL)!(
      { sender: {} },
      { ...request, private_path: '/secret' },
    ),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  expect(execute).not.toHaveBeenCalled();
});
it('keeps the trusted window session stable and revokes session handles on navigation', async () => {
  const execute = vi
      .fn<(caller: FolderCaller, value: unknown) => Promise<FolderResponse>>()
      .mockResolvedValue({ ok: true, state: 'not_configured' }),
    revokeCaller = vi.fn();
  registerFolderIpc({ execute, revokeCaller }, 'workspace');
  const sender = {};
  await state.handlers.get(FOLDER_CHANNEL)!({ sender }, request);
  await state.handlers.get(FOLDER_CHANNEL)!({ sender }, request);
  const first = execute.mock.calls[0][0] as FolderCaller,
    second = execute.mock.calls[1][0] as FolderCaller;
  expect(first.session).toBe(second.session);
  expect(first.window_id).toBe(7);
  expect(first.workspace).toBe('workspace');
  state.revoked!();
  expect(revokeCaller).toHaveBeenCalledTimes(1);
  await state.handlers.get(FOLDER_CHANNEL)!({ sender }, request);
  expect((execute.mock.calls[2][0] as FolderCaller).session).not.toBe(first.session);
});
it('drops an Application reply after the original sender loses business permission', async () => {
  const execute = vi.fn(async (caller: FolderCaller) => {
    expect(caller.assertCurrent()).toBe(true);
    state.trusted = false;
    expect(caller.assertCurrent()).toBe(false);
    return { ok: true as const, state: 'not_configured' as const };
  });
  registerFolderIpc({ execute, revokeCaller: vi.fn() }, 'workspace');
  expect(await state.handlers.get(FOLDER_CHANNEL)!({ sender: {} }, request)).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
  });
});
it('does not accept a native directory result after caller revocation', async () => {
  const caller: FolderCaller = {
    workspace: 'workspace',
    session: randomUUID(),
    epoch: 0,
    window_id: 7,
    assertCurrent: () => state.trusted,
  };
  state.chooser.mockImplementation(async () => {
    state.trusted = false;
    return { canceled: false, filePaths: ['/private/secret'] };
  });
  await expect(chooseFolder(caller)).rejects.toThrow('STALE_CALLER');
});
