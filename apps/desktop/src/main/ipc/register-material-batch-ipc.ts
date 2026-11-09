import { BrowserWindow, dialog, ipcMain } from 'electron';
import {
  MATERIAL_BATCH_CHANNEL,
  materialBatchRequestSchema,
  materialBatchResponseSchema,
} from '@caselite/contracts';
import type { createMaterialBatchApplication } from '@caselite/application';
import { isTrustedDesktopSender } from './register-application-ipc';
import { scanMaterialBatch, MaterialBatchSelectionError } from '../adapters/material-batch-files';

export function registerMaterialBatchIpc(app: ReturnType<typeof createMaterialBatchApplication>) {
  let selecting = false;
  const denied = { ok: false, code: 'FORBIDDEN', message: '当前页面无权导入材料。' };
  ipcMain.handle(MATERIAL_BATCH_CHANNEL, async (event, input: unknown) => {
    if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows())) return denied;
    const parsed = materialBatchRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'INVALID_REQUEST', message: '批次请求无效。' };
    const request = parsed.data;
    try {
      if (request.operation === 'pick') {
        if (selecting) return { ok: false, code: 'BUSY', message: '请先完成当前文件选择。' };
        const available = await app.execute({ ...request, operation: 'list' });
        if (!available.ok) return available;
        if (available.batch) return { ok: false, code: 'BUSY', message: '请先处理当前批次。' };
        selecting = true;
        try {
          const choice = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
            properties:
              request.mode === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
            ...(request.mode === 'files'
              ? { filters: [{ name: '分析材料', extensions: ['pdf', 'docx'] }] }
              : {}),
          });
          if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows())) return denied;
          if (choice.canceled) return { ok: true, batch: null };
          const entries = await scanMaterialBatch(choice.filePaths, request.mode === 'folder');
          if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows())) return denied;
          const result = await app.create(
            request.scope,
            request.mode === 'folder' ? '文件夹材料' : '所选材料',
            entries,
          );
          if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows())) return denied;
          return materialBatchResponseSchema.parse(result);
        } finally {
          selecting = false;
        }
      }
      const result = await app.execute(request);
      if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows())) return denied;
      return materialBatchResponseSchema.parse(result);
    } catch (error) {
      return {
        ok: false,
        code: 'UNAVAILABLE',
        message:
          error instanceof MaterialBatchSelectionError
            ? error.message
            : '未完成材料操作，请重新读取当前批次；已保存原件保留。',
      };
    }
  });
}
