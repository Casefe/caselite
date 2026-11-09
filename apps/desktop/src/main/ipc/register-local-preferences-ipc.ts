import { BrowserWindow, ipcMain } from 'electron';
import {
  LOCAL_PREFERENCES_CHANNEL,
  localPreferencesResponseSchema,
  type LocalPreferencesResponse,
} from '@caselite/contracts';
import type { createLocalPreferencesApplication } from '@caselite/application';
import { isTrustedDesktopSender } from './register-application-ipc';
export function registerLocalPreferencesIpc(
  application: ReturnType<typeof createLocalPreferencesApplication>,
) {
  ipcMain.handle(LOCAL_PREFERENCES_CHANNEL, (event, input): LocalPreferencesResponse => {
    if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows()))
      return { ok: false, code: 'FORBIDDEN', message: '当前页面无权访问本地个人设置。' };
    return localPreferencesResponseSchema.parse(application.execute(input));
  });
}
