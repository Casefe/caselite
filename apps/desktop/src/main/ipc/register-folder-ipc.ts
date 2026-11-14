import { randomUUID } from 'node:crypto';
import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { FOLDER_CHANNEL, folderRequestSchema, folderResponseSchema } from '@caselite/contracts';
import type { FolderCaller, createPersonalMaterialApplication } from '@caselite/application';
import { isTrustedBusinessSender, onBusinessAccessRevoked } from './window-capabilities';

// 会话只消费既有窗口授权；不登记第二套窗口角色或持久化旧窗口代次。
export function registerFolderIpc(
  application: ReturnType<typeof createPersonalMaterialApplication>,
  workspace: string,
) {
  const sessions = new WeakMap<WebContents, { id: string; caller: FolderCaller }>();
  const denied = {
    ok: false as const,
    code: 'FORBIDDEN' as const,
    message: '当前页面无权读取文件夹。',
  };
  ipcMain.handle(FOLDER_CHANNEL, async (event, value: unknown) => {
    if (!isTrustedBusinessSender(event)) return denied;
    const request = folderRequestSchema.safeParse(value);
    if (!request.success) return { ok: false, code: 'INVALID_REQUEST', message: '请求格式无效。' };
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return denied;
    let session = sessions.get(event.sender);
    const caller: FolderCaller = {
      workspace,
      session: session?.id ?? randomUUID(),
      epoch: 0,
      window_id: window.id,
      assertCurrent: () => isTrustedBusinessSender(event),
    };
    if (!session) {
      session = { id: caller.session, caller };
      sessions.set(event.sender, session);
      const registered = session;
      onBusinessAccessRevoked(event, () => {
        if (sessions.get(event.sender) === registered) sessions.delete(event.sender);
        application.revokeCaller(registered.caller);
      });
    }
    try {
      const result = await application.execute(caller, request.data);
      if (!isTrustedBusinessSender(event)) return denied;
      return folderResponseSchema.parse(result);
    } catch {
      return {
        ok: false,
        code: 'RESULT_UNKNOWN',
        message: '暂时无法确认结果，请核对原请求。',
        request_id: 'request_id' in request.data ? request.data.request_id : undefined,
      };
    }
  });
}
let choosing = false;
export async function chooseFolder(
  caller: FolderCaller,
  defaultPath?: string,
): Promise<string | null> {
  if (!caller.assertCurrent()) throw new Error('STALE_CALLER');
  if (choosing) throw new Error('BUSY');
  const window = BrowserWindow.fromId(caller.window_id);
  if (!window || window.isDestroyed()) throw new Error('STALE_CALLER');
  choosing = true;
  try {
    const result = await dialog.showOpenDialog(window, {
      title: defaultPath ? '选择默认目录内的项目文件夹' : '选择默认文档目录',
      defaultPath,
      properties: ['openDirectory'],
    });
    if (!caller.assertCurrent()) throw new Error('STALE_CALLER');
    return result.canceled ? null : (result.filePaths[0] ?? null);
  } finally {
    choosing = false;
  }
}
