import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  handler: undefined as undefined | ((event: unknown, input: unknown) => Promise<unknown>),
  trusted: vi.fn(),
  picker: vi.fn(),
  scan: vi.fn(),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => ({}) },
  dialog: { showOpenDialog: mock.picker },
  ipcMain: {
    handle: (_name: string, handler: typeof mock.handler) => {
      mock.handler = handler;
    },
  },
}));
vi.mock('./window-capabilities', () => ({ isTrustedBusinessSender: mock.trusted }));
vi.mock('../adapters/material-batch-files', () => ({
  scanMaterialBatch: mock.scan,
  MaterialBatchSelectionError: class extends Error {},
}));
import { registerMaterialBatchIpc } from './register-material-batch-ipc';
beforeEach(() => {
  mock.trusted.mockReset().mockReturnValue(true);
  mock.picker.mockReset();
  mock.scan.mockReset();
});
const request = { protocol_version: 1, operation: 'pick', scope: 'home', mode: 'folder' };
it('does not open a picker after authorization is revoked while reading the current batch', async () => {
  const app = setup();
  app.execute.mockImplementationOnce(async () => {
    mock.trusted.mockReturnValue(false);
    return { ok: true, batch: null };
  });
  expect(await mock.handler!({ sender: {} }, request)).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
  });
  expect(mock.picker).not.toHaveBeenCalled();
  expect(app.create).not.toHaveBeenCalled();
});
function setup() {
  const application = {
    execute: vi.fn(async () => ({ ok: true, batch: null })),
    create: vi.fn(async () => ({ ok: true, batch: null })),
  };
  registerMaterialBatchIpc(
    application as unknown as Parameters<typeof registerMaterialBatchIpc>[0],
  );
  return application;
}
it('rejects forged fields and untrusted senders before touching the file picker', async () => {
  setup();
  expect(
    await mock.handler!({ sender: {} }, { ...request, path: '/private/customer' }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  mock.trusted.mockReturnValue(false);
  expect(await mock.handler!({ sender: {} }, request)).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
  });
  expect(mock.picker).not.toHaveBeenCalled();
});
it('rechecks the window after the native picker and releases its lock after revocation', async () => {
  const app = setup();
  mock.picker.mockImplementationOnce(async () => {
    mock.trusted.mockReturnValue(false);
    return { canceled: false, filePaths: ['/synthetic/folder'] };
  });
  expect(await mock.handler!({ sender: {} }, request)).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
  });
  expect(mock.scan).not.toHaveBeenCalled();
  expect(app.create).not.toHaveBeenCalled();
  mock.trusted.mockReturnValue(true);
  mock.picker.mockResolvedValueOnce({ canceled: true });
  expect(await mock.handler!({ sender: {} }, request)).toEqual({ ok: true, batch: null });
});
it('does not return raw filesystem failures or create a batch after a revoked scan', async () => {
  const app = setup();
  mock.picker.mockResolvedValue({ canceled: false, filePaths: ['/private/synthetic'] });
  mock.scan.mockRejectedValueOnce(new Error('ENOENT: /private/synthetic/client.pdf'));
  const result = await mock.handler!({ sender: {} }, request);
  expect(JSON.stringify(result)).not.toContain('/private');
  mock.scan.mockImplementationOnce(async () => {
    mock.trusted.mockReturnValue(false);
    return [];
  });
  expect(await mock.handler!({ sender: {} }, request)).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
  });
  expect(app.create).not.toHaveBeenCalled();
});
it('rejects a late create result after the requesting window loses trust', async () => {
  const app = setup();
  mock.picker.mockResolvedValue({ canceled: false, filePaths: ['/synthetic/folder'] });
  mock.scan.mockResolvedValue([]);
  app.create.mockImplementationOnce(async () => {
    mock.trusted.mockReturnValue(false);
    return { ok: true, batch: null };
  });
  expect(await mock.handler!({ sender: {} }, request)).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
  });
});
