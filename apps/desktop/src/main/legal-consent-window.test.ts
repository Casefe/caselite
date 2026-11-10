import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLegalConsentApplication } from '@caselite/application';
import { LEGAL_CONSENT_CHANNEL, type LegalBundle, type LegalReceipt } from '@caselite/contracts';

type FakeWindow = {
  webContents: { mainFrame: unknown };
  destroy(): void;
  isDestroyed(): boolean;
};
const state = vi.hoisted(() => ({
  windows: [] as FakeWindow[],
  handlers: new Map<string, (event: unknown, input: unknown) => unknown>(),
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    BrowserWindow: class extends EventEmitter {
      destroyed = false;
      webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: 'file:///legal.html' },
        isDestroyed: () => false,
        setWindowOpenHandler: vi.fn(),
      });
      constructor() {
        super();
        state.windows.push(this);
      }
      isDestroyed() {
        return this.destroyed;
      }
      destroy() {
        this.destroyed = true;
        this.emit('closed');
      }
      show() {}
      async loadURL() {}
    },
    ipcMain: {
      handle: (c: string, h: (event: unknown, input: unknown) => unknown) =>
        state.handlers.set(c, h),
      removeHandler: (c: string) => state.handlers.delete(c),
    },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1200, height: 900 } }) },
  };
});
import { showLegalConsent } from './legal-consent-window';

const bundle: LegalBundle = {
  effective_date: '2026-11-09',
  document_set_hash: 'a'.repeat(64),
  documents: [
    { id: 'license', title: '许可', text: '全文', sha256: 'b'.repeat(64) },
    { id: 'eula', title: '协议', text: '全文', sha256: 'c'.repeat(64) },
  ],
};
const request = {
  protocol_version: 1,
  operation: 'accept',
  document_set_hash: bundle.document_set_hash,
  confirmed: true,
  reviewed_documents: ['license', 'eula'],
};
beforeEach(() => {
  state.windows.length = 0;
  state.handlers.clear();
  vi.stubGlobal('LEGAL_WINDOW_WEBPACK_ENTRY', 'file:///legal.html');
  vi.stubGlobal('LEGAL_WINDOW_PRELOAD_WEBPACK_ENTRY', '/legal-preload.js');
});
describe('startup legal window boundary', () => {
  it('rejects another window and subframes; only its main frame can persist and unlock', async () => {
    let receipt: LegalReceipt | null = null;
    const port = {
      read: () => receipt,
      write: vi.fn((r: LegalReceipt) => {
        receipt = r;
      }),
    };
    const pending = showLegalConsent(createLegalConsentApplication(port, bundle));
    const window = state.windows[0];
    const handle = state.handlers.get(LEGAL_CONSENT_CHANNEL)!;
    for (const event of [
      { sender: {}, senderFrame: window.webContents.mainFrame },
      { sender: window.webContents, senderFrame: {} },
      { sender: window.webContents, senderFrame: null },
    ])
      expect(handle(event, request)).toMatchObject({ ok: false });
    expect(port.write).not.toHaveBeenCalled();
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    expect(handle(event, { ...request, confirmed: false })).toMatchObject({ ok: false });
    expect(handle(event, request)).toMatchObject({ ok: true, accepted: true });
    expect(await pending).toBe(true);
    expect(state.handlers.has(LEGAL_CONSENT_CHANNEL)).toBe(false);
    expect(window.isDestroyed()).toBe(true);
  });
  it('does not unlock on close or failed storage and removes the temporary channel', async () => {
    const port = {
      read: () => null,
      write: () => {
        throw new Error('unwritable');
      },
    };
    const pending = showLegalConsent(createLegalConsentApplication(port, bundle));
    const window = state.windows[0];
    expect(
      state.handlers.get(LEGAL_CONSENT_CHANNEL)!(
        { sender: window.webContents, senderFrame: window.webContents.mainFrame },
        request,
      ),
    ).toMatchObject({ ok: false });
    expect(window.isDestroyed()).toBe(false);
    window.destroy();
    expect(await pending).toBe(false);
    expect(state.handlers.size).toBe(0);
  });
});
