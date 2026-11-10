import { writeFile } from 'node:fs/promises';
import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
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
import { isTrustedBusinessSender } from './window-capabilities';
export function registerMaterialIpc(
  app: ReturnType<typeof createMaterialApplication>,
  camera?: {
    prepare(contents: WebContents): Promise<boolean>;
    revoke(contents: WebContents): void;
  },
) {
  const denied = { ok: false, code: 'FORBIDDEN', message: '当前页面无权读取材料。' };
  let selecting = false;
  ipcMain.handle(MATERIAL_CHANNEL, async (event, input: unknown) => {
    if (!isTrustedBusinessSender(event)) return denied;
    const request = materialRequestSchema.safeParse(input);
    if (
      request.success &&
      (request.data.operation === 'camera_permission' || request.data.operation === 'camera_revoke')
    ) {
      if (request.data.operation === 'camera_revoke') {
        camera?.revoke(event.sender);
        return { ok: true, materials: [] };
      }
      if (!camera || !app.canCapture(request.data.scope))
        return { ok: false, code: 'SCOPE', message: '当前范围不能拍照，请核对任务或项目状态。' };
      const allowed = await camera.prepare(event.sender);
      if (!allowed || !isTrustedBusinessSender(event) || !app.canCapture(request.data.scope)) {
        camera.revoke(event.sender);
        return {
          ok: false,
          code: 'CAMERA_UNAVAILABLE',
          message: '未获摄像头许可，可选择拍好的照片。',
        };
      }
      return { ok: true, materials: [] };
    }

    if (
      request.success &&
      (request.data.operation === 'save_original' ||
        request.data.operation === 'save_project_original')
    ) {
      const read =
        request.data.operation === 'save_project_original'
          ? { ...request.data, operation: 'read_project' as const }
          : { ...request.data, operation: 'read' as const };
      if (selecting) return { ok: false, code: 'BUSY', message: '请先完成当前文件选择。' };
      selecting = true;
      try {
        const first = await app.execute(read);
        if (!isTrustedBusinessSender(event)) return denied;
        if (!first.ok) return first;
        const source = first.materials.find((item) => item.id === read.source_id);
        if (!source || materialKind(source.name) !== 'docx') return denied;
        const choice = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender)!, {
          defaultPath: source.name,
          filters: [{ name: 'Word 原件副本', extensions: ['docx'] }],
        });
        if (choice.canceled || !choice.filePath) return { ok: true, materials: [] };
        if (!isTrustedBusinessSender(event)) return denied;
        const current = await app.execute(read);
        if (!isTrustedBusinessSender(event)) return denied;
        if (!current.ok) return current;
        if (
          !current.data ||
          !current.materials.some(
            (item) =>
              item.id === source.id &&
              item.asset_version_id === source.asset_version_id &&
              item.sha256 === source.sha256,
          )
        )
          return denied;
        await writeFile(choice.filePath, current.data, { flag: 'wx', mode: 0o600 });
        if (!isTrustedBusinessSender(event)) return denied;
        return { ok: true, materials: current.materials };
      } catch {
        return { ok: false, code: 'COPY_FAILED', message: '未保存原件副本，请选一个新文件名。' };
      } finally {
        selecting = false;
      }
    }
    const result = await app.execute(input);
    if (!isTrustedBusinessSender(event)) return denied;
    return materialResponseSchema.parse(result);
  });
  for (const channel of [MATERIAL_PICK_CHANNEL, MATERIAL_DROP_CHANNEL])
    ipcMain.handle(channel, async (event, input: unknown) => {
      if (!isTrustedBusinessSender(event)) return denied;
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
          if (!isTrustedBusinessSender(event)) return denied;
          if (result.canceled) return { ok: true, materials: [], staged: null };
          path = result.filePaths[0];
        }
        const result = await app.stage(path!, scope);
        if (!isTrustedBusinessSender(event)) return denied;
        return materialResponseSchema.parse(result);
      } catch {
        return { ok: false, code: 'UNAVAILABLE', message: '无法选择文件，请重试。' };
      } finally {
        selecting = false;
      }
    });
}
