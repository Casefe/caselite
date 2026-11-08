import { writeFile } from 'node:fs/promises';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import {
  MATERIAL_CHANNEL,
  MATERIAL_DROP_CHANNEL,
  MATERIAL_PICK_CHANNEL,
  materialStageRequestSchema,
  materialResponseSchema,
  materialRequestSchema,
  materialKind,
} from '@caselite/contracts';
import type { createMaterialApplication } from '@caselite/application';
import { isTrustedDesktopSender } from './register-application-ipc';
export function registerMaterialIpc(app: ReturnType<typeof createMaterialApplication>) {
  const denied = { ok: false, code: 'FORBIDDEN', message: '当前页面无权读取材料。' };
  let selecting = false;
  ipcMain.handle(MATERIAL_CHANNEL, async (event, input: unknown) => {
    if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows())) return denied;
    const request = materialRequestSchema.safeParse(input);
    if (request.success && request.data.operation === 'save_original') {
      const read = { ...request.data, operation: 'read' as const };
      const first = await app.execute(read);
      const source = first.ok && first.materials.find((item) => item.id === read.source_id);
      if (!source || materialKind(source.name) !== 'docx') return denied;
      try {
        const choice = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender)!, {
          defaultPath: source.name,
          filters: [{ name: 'Word 原件副本', extensions: ['docx'] }],
        });
        if (choice.canceled || !choice.filePath) return { ok: true, materials: [] };
        const current = await app.execute(read);
        if (!current.ok || !current.data) return denied;
        await writeFile(choice.filePath, current.data, { flag: 'wx', mode: 0o600 });
        return { ok: true, materials: current.materials };
      } catch {
        return { ok: false, code: 'COPY_FAILED', message: '未保存原件副本，请选一个新文件名。' };
      }
    }
    return materialResponseSchema.parse(await app.execute(input));
  });
  for (const channel of [MATERIAL_PICK_CHANNEL, MATERIAL_DROP_CHANNEL])
    ipcMain.handle(channel, async (event, input: unknown) => {
      if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows())) return denied;
      const parsed = materialStageRequestSchema.safeParse(input);
      if (!parsed.success || (channel === MATERIAL_DROP_CHANNEL && !parsed.data.path))
        return denied;
      if (selecting)
        return { ok: false, code: 'BUSY', message: '正在读取另一份材料，请稍后重试。' };
      selecting = true;
      try {
        const { scope } = parsed.data;
        let path = parsed.data.path;
        if (channel === MATERIAL_PICK_CHANNEL) {
          const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
            properties: ['openFile'],
            filters: [{ name: '分析附件', extensions: ['pdf', 'docx'] }],
          });
          if (result.canceled) return { ok: true, materials: [], staged: null };
          path = result.filePaths[0];
        }
        return materialResponseSchema.parse(await app.stage(path!, scope));
      } catch {
        return { ok: false, code: 'UNAVAILABLE', message: '无法选择文件，请重试。' };
      } finally {
        selecting = false;
      }
    });
}
