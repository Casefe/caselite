import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { DeliverySnapshot } from '@caselite/contracts';
const fake = vi.hoisted(() => {
  const window = {
    loadURL: vi.fn(),
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      executeJavaScript: vi.fn(),
      printToPDF: vi.fn(),
    },
  };
  const session = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    on: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() },
  };
  const constructor = vi.fn(function (options: unknown) {
    void options;
    return window;
  });
  return { window, session, constructor };
});
vi.mock('electron', () => ({
  BrowserWindow: fake.constructor,
  session: { fromPartition: () => fake.session },
}));
import { generateSnapshotPdf } from './pdf-export-processor';
const snapshot = {
  title: '合成合同',
  source_refs: [],
  id: '12345678-1234-4234-8234-123456789012',
  body_revision: 1,
  content_sha256: 'a'.repeat(64),
} as DeliverySnapshot;
function state() {
  const doc = new Y.Doc(),
    p = new Y.XmlElement('paragraph'),
    t = new Y.XmlText();
  t.insert(0, '付款十日');
  p.insert(0, [t]);
  doc.getXmlFragment('default').insert(0, [p]);
  const value = Array.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return value;
}
beforeEach(() => {
  vi.clearAllMocks();
  fake.window.loadURL.mockResolvedValue(undefined);
  fake.window.webContents.executeJavaScript.mockResolvedValue(true);
  fake.window.webContents.printToPDF.mockResolvedValue(Buffer.from('%PDF-synthetic-port'));
});
afterEach(() => vi.useRealTimers());
it('uses an isolated sandboxed print window with denied network and closes it after mocked output', async () => {
  await expect(generateSnapshotPdf(snapshot, state())).resolves.toBeInstanceOf(Uint8Array);
  expect(fake.constructor.mock.calls[0]?.[0]).toMatchObject({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  });
  const policy = fake.session.webRequest.onBeforeRequest.mock.calls[0][0];
  const result = vi.fn();
  policy({ url: 'https://example.com' }, result);
  expect(result).toHaveBeenCalledWith({ cancel: true });
  expect(fake.window.webContents.printToPDF).toHaveBeenCalledWith(
    expect.objectContaining({ pageSize: 'A4', generateTaggedPDF: true }),
  );
  expect(fake.window.destroy).toHaveBeenCalledOnce();
});
it('does not print when the fixed font is unavailable and closes the window', async () => {
  fake.window.webContents.executeJavaScript.mockResolvedValueOnce(false);
  await expect(generateSnapshotPdf(snapshot, state())).rejects.toThrow('PDF_FONT_UNAVAILABLE');
  expect(fake.window.webContents.printToPDF).not.toHaveBeenCalled();
  expect(fake.window.destroy).toHaveBeenCalledOnce();
});
it('closes a hung print on cancellation and on timeout without returning PDF bytes', async () => {
  const controller = new AbortController();
  fake.window.webContents.printToPDF.mockImplementationOnce(() => new Promise(() => {}));
  const running = generateSnapshotPdf(snapshot, state(), controller.signal);
  await vi.waitFor(() => expect(fake.window.webContents.printToPDF).toHaveBeenCalled());
  const rejected = expect(running).rejects.toThrow('cancelled');
  controller.abort();
  await rejected;
  expect(fake.window.destroy).toHaveBeenCalledOnce();
  vi.useFakeTimers();
  fake.window.webContents.printToPDF.mockImplementationOnce(() => new Promise(() => {}));
  const timed = generateSnapshotPdf(snapshot, state());
  const timeout = expect(timed).rejects.toThrow('timeout');
  await vi.advanceTimersByTimeAsync(15001);
  await timeout;
  expect(fake.window.destroy).toHaveBeenCalledTimes(2);
});
