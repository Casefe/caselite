import { BrowserWindow, ipcMain, screen } from 'electron';
import {
  LEGAL_CONSENT_CHANNEL,
  legalConsentRequestSchema,
  legalConsentResponseSchema,
} from '@caselite/contracts';
import type { createLegalConsentApplication } from '@caselite/application';
import { isTrustedDesktopSender } from './ipc/register-application-ipc';

export async function showLegalConsent(
  application: ReturnType<typeof createLegalConsentApplication>,
  observe?: (window: BrowserWindow) => Promise<void>,
): Promise<boolean> {
  const initial = application.execute({ protocol_version: 1, operation: 'read' });
  if (initial.ok && initial.accepted) return true;
  const area = screen.getPrimaryDisplay().workAreaSize;
  const window = new BrowserWindow({
    width: Math.min(1040, area.width),
    height: Math.min(840, area.height - 32),
    minWidth: 640,
    minHeight: 480,
    title: 'CaseLite · 软件许可与使用协议',
    show: false,
    webPreferences: {
      preload: LEGAL_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  return new Promise<boolean>((resolve, reject) => {
    let finished = false;
    const finish = (accepted: boolean) => {
      if (finished) return;
      finished = true;
      ipcMain.removeHandler(LEGAL_CONSENT_CHANNEL);
      resolve(accepted);
      if (!window.isDestroyed()) window.destroy();
    };
    window.once('closed', () => finish(false));
    window.webContents.once('render-process-gone', () => finish(false));
    // 窗口尚未确认时不注册任何业务IPC；本通道只信任该窗口的主Frame。
    ipcMain.handle(LEGAL_CONSENT_CHANNEL, (event, input) => {
      if (finished || !isTrustedDesktopSender(event, [window]))
        return { ok: false, message: '当前页面无权确认软件协议。' };
      const request = legalConsentRequestSchema.safeParse(input);
      const response = legalConsentResponseSchema.parse(application.execute(input));
      if (
        request.success &&
        response.ok &&
        (request.data.operation === 'decline' ||
          (request.data.operation === 'accept' && response.accepted))
      )
        setTimeout(() => finish(response.accepted), 0);
      return response;
    });
    void window
      .loadURL(LEGAL_WINDOW_WEBPACK_ENTRY)
      .then(async () => {
        if (window.isDestroyed()) return;
        window.show();
        await observe?.(window);
      })
      .catch((error: unknown) => {
        ipcMain.removeHandler(LEGAL_CONSENT_CHANNEL);
        finished = true;
        if (!window.isDestroyed()) window.destroy();
        reject(error);
      });
  });
}
