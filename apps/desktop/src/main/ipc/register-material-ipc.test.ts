import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  save: vi.fn(),
  write: vi.fn(),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => ({}) },
  dialog: { showSaveDialog: mock.save },
  ipcMain: {
    handle: (name: string, handler: (event: unknown, input: unknown) => Promise<unknown>) =>
      mock.handlers.set(name, handler),
  },
}));
vi.mock('node:fs/promises', () => ({ writeFile: mock.write }));
vi.mock('./register-application-ipc', () => ({ isTrustedDesktopSender: () => true }));
import { registerMaterialIpc } from './register-material-ipc';
import { MATERIAL_CHANNEL } from '@caselite/contracts';
const project = '11111111-1111-4111-8111-111111111111',
  source = '22222222-2222-4222-8222-222222222222';
const read = {
  ok: true,
  materials: [{ id: source, asset_version_id: source, sha256: 'a'.repeat(64), name: '合同.docx' }],
  data: new Uint8Array([80, 75]),
};
beforeEach(() => {
  mock.handlers.clear();
  mock.save.mockReset();
  mock.write.mockReset();
  mock.save.mockResolvedValue({ canceled: false, filePath: '/synthetic/合同副本.docx' });
  mock.write.mockResolvedValue(undefined);
});
function setup(execute: ReturnType<typeof vi.fn>) {
  registerMaterialIpc({ execute } as unknown as Parameters<typeof registerMaterialIpc>[0]);
  return () =>
    mock.handlers.get(MATERIAL_CHANNEL)!(
      { sender: {} },
      {
        protocol_version: 1,
        operation: 'save_project_original',
        project_id: project,
        source_id: source,
      },
    );
}
it('rechecks project scope after the save dialog and never writes after revocation', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce(read)
    .mockResolvedValueOnce({ ok: false, code: 'SCOPE', message: '移出' });
  const result = await setup(execute)();
  expect(result).toMatchObject({ ok: false });
  expect(execute.mock.calls.map(([r]) => r)).toEqual(
    [1, 2].map(() => ({
      protocol_version: 1,
      operation: 'read_project',
      project_id: project,
      source_id: source,
    })),
  );
  expect(mock.write).not.toHaveBeenCalled();
});
it('writes only reread fixed original bytes to a new file', async () => {
  const execute = vi.fn().mockResolvedValue(read);
  expect(await setup(execute)()).toMatchObject({ ok: true });
  expect(mock.write).toHaveBeenCalledWith('/synthetic/合同副本.docx', read.data, {
    flag: 'wx',
    mode: 0o600,
  });
});

it('rejects a changed original and releases the dialog lock without writing', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce(read)
    .mockResolvedValueOnce({
      ...read,
      materials: [{ ...read.materials[0], sha256: 'b'.repeat(64) }],
    })
    .mockResolvedValue(read);
  const save = setup(execute);
  expect(await save()).toMatchObject({ ok: false });
  expect(mock.write).not.toHaveBeenCalled();
  mock.save.mockResolvedValueOnce({ canceled: true });
  expect(await save()).toMatchObject({ ok: true });
  expect(mock.write).not.toHaveBeenCalled();
});
