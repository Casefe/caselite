import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { beforeEach, expect, it, vi } from 'vitest';
import { createAgentApplication } from '@caselite/application';
import {
  AGENT_CHANNEL,
  TASK_CHANNEL,
  FINANCE_CHANNEL,
  CATALOG_CHANNEL,
  CONTACTS_CHANNEL,
  REMINDER_CHANNEL,
  APPEARANCE_CHANNEL,
  LOCAL_PREFERENCES_CHANNEL,
  MATERIAL_CHANNEL,
  MATERIAL_PICK_CHANNEL,
  MATERIAL_DROP_CHANNEL,
  MATERIAL_BATCH_CHANNEL,
} from '@caselite/contracts';
const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => unknown>(),
  dialog: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, input: unknown) => unknown) =>
      state.handlers.set(channel, fn),
  },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: vi.fn() },
  dialog: { showOpenDialog: state.dialog, showSaveDialog: state.dialog },
}));
import { registerDesktopWindowCapabilities } from './window-capabilities';
import {
  registerTaskIpc,
  registerFinanceIpc,
  registerCatalogIpc,
  registerReminderIpc,
  registerContactsIpc,
} from './register-task-ipc';
import { registerAgentIpc } from './register-agent-ipc';
import { registerAppearanceIpc } from './register-appearance-ipc';
import { registerLocalPreferencesIpc } from './register-local-preferences-ipc';
import { registerMaterialIpc } from './register-material-ipc';
import { registerMaterialBatchIpc } from './register-material-batch-ipc';

const entry = 'file:///synthetic/workbench.html';
function windowFixture() {
  const webContents = Object.assign(new EventEmitter(), {
    id: 7,
    mainFrame: { url: entry },
    isDestroyed: () => false,
  });
  const window = Object.assign(new EventEmitter(), {
    webContents,
    isDestroyed: () => false,
  }) as unknown as BrowserWindow;
  return {
    window,
    webContents,
    event: () => ({ sender: webContents, senderFrame: webContents.mainFrame }),
  };
}
beforeEach(() => {
  state.handlers.clear();
  state.dialog.mockClear();
});

it('rejects auxiliary and consent windows at every production business entry before touching Application', async () => {
  const execute = vi.fn(),
    changed = vi.fn(),
    allowed = vi.fn();
  const app = { execute, executeForOwner: execute, release: vi.fn() };
  registerTaskIpc(app);
  registerFinanceIpc(app as unknown as Parameters<typeof registerFinanceIpc>[0]);
  registerCatalogIpc(app as unknown as Parameters<typeof registerCatalogIpc>[0]);
  registerReminderIpc(app as unknown as Parameters<typeof registerReminderIpc>[0], changed);
  registerContactsIpc(app as unknown as Parameters<typeof registerContactsIpc>[0], allowed);
  registerAgentIpc(app as unknown as Parameters<typeof registerAgentIpc>[0]);
  registerAppearanceIpc(app as unknown as Parameters<typeof registerAppearanceIpc>[0]);
  registerLocalPreferencesIpc(app as unknown as Parameters<typeof registerLocalPreferencesIpc>[0]);
  registerMaterialIpc(app as unknown as Parameters<typeof registerMaterialIpc>[0]);
  registerMaterialBatchIpc(app as unknown as Parameters<typeof registerMaterialBatchIpc>[0]);
  const channels = [
    TASK_CHANNEL,
    FINANCE_CHANNEL,
    CATALOG_CHANNEL,
    CONTACTS_CHANNEL,
    REMINDER_CHANNEL,
    AGENT_CHANNEL,
    APPEARANCE_CHANNEL,
    LOCAL_PREFERENCES_CHANNEL,
    MATERIAL_CHANNEL,
    MATERIAL_PICK_CHANNEL,
    MATERIAL_DROP_CHANNEL,
    MATERIAL_BATCH_CHANNEL,
  ];
  expect([...state.handlers.keys()].sort()).toEqual([...channels].sort());
  const w = windowFixture();
  for (const consent of [false, true]) {
    if (consent) registerDesktopWindowCapabilities(w.window, 'consent', entry);
    for (const channel of channels)
      expect(
        await state.handlers.get(channel)!(w.event(), { protocol_version: 1, operation: 'read' }),
      ).toMatchObject({ ok: false });
  }
  expect(execute).not.toHaveBeenCalled();
  expect(state.dialog).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  expect(allowed).not.toHaveBeenCalled();
  w.window.emit('closed');
});

it('rejects a late task response after reload and permits the next document request', async () => {
  const w = windowFixture();
  registerDesktopWindowCapabilities(w.window, 'workbench', entry);
  const response = { ok: true as const, tasks: [], state: null, receipt: null };
  let finish!: (result: typeof response) => void;
  const execute = vi.fn(
    () =>
      new Promise<typeof response>((resolve) => {
        finish = resolve;
      }),
  );
  registerTaskIpc({ execute });
  const call = state.handlers.get(TASK_CHANNEL)!;
  const pending = call(w.event(), { protocol_version: 1, operation: 'list' });
  expect(execute).toHaveBeenCalledTimes(1);
  w.webContents.emit('did-start-navigation', {}, entry, false, true);
  finish(response);
  expect(await pending).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  const next = call(w.event(), { protocol_version: 1, operation: 'list' });
  finish(response);
  expect(await next).toEqual(response);
  expect(execute).toHaveBeenCalledTimes(2);
  w.window.emit('closed');
});

const agentRequest = () => ({
  protocol_version: 1,
  operation: 'start',
  scope: 'home',
  run_id: crypto.randomUUID(),
  prompt: '合成安全测试',
  confirmed: true,
});
const credentials = {
  get: () => 'synthetic-only',
  set() {},
  clear() {},
  getDefaultModel: () => 'gpt-4.1-mini' as const,
  setDefaultModel() {},
};

it.each(['reload', 'render-process-gone', 'destroyed', 'explicit', 'replace'])(
  'does not dispatch an agent request prepared across %s',
  async (reason) => {
    const w = windowFixture();
    const revoke = registerDesktopWindowCapabilities(w.window, 'workbench', entry);
    let resolveContext!: (text: string) => void;
    const runtime = { start: vi.fn(() => ({ cancel: vi.fn() })) };
    const app = createAgentApplication({
      credentials,
      runtime,
      taskExists: () => false,
      resolveContext: vi.fn(() => new Promise<string>((resolve) => (resolveContext = resolve))),
    });
    registerAgentIpc(app);
    const pending = state.handlers.get(AGENT_CHANNEL)!(w.event(), {
      ...agentRequest(),
      context_id: crypto.randomUUID(),
    });
    expect(resolveContext).toBeTypeOf('function');
    if (reason === 'reload') w.webContents.emit('did-start-navigation', {}, entry, false, true);
    else if (reason === 'explicit') revoke();
    else if (reason === 'replace') registerDesktopWindowCapabilities(w.window, 'workbench', entry);
    else w.webContents.emit(reason);
    resolveContext('合成材料');
    expect(await pending).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(runtime.start).not.toHaveBeenCalled();
    w.window.emit('closed');
  },
);

it('cancels active work on document replacement and tracks the next document independently', async () => {
  const w = windowFixture();
  registerDesktopWindowCapabilities(w.window, 'workbench', entry);
  const cancel = vi.fn();
  const runtime = { start: vi.fn(() => ({ cancel })) };
  registerAgentIpc(createAgentApplication({ credentials, runtime, taskExists: () => false }));
  const call = state.handlers.get(AGENT_CHANNEL)!;
  expect(await call(w.event(), agentRequest())).toMatchObject({ ok: true });
  w.webContents.emit('did-start-navigation', {}, entry + '#section', true, true);
  w.webContents.emit('did-start-navigation', {}, 'about:blank', false, false);
  expect(cancel).not.toHaveBeenCalled();
  w.webContents.emit('did-start-navigation', {}, entry, false, true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(await call(w.event(), agentRequest())).toMatchObject({ ok: true });
  expect(runtime.start).toHaveBeenCalledTimes(2);
  w.webContents.emit('render-process-gone');
  expect(cancel).toHaveBeenCalledTimes(2);
  w.window.emit('closed');
});
