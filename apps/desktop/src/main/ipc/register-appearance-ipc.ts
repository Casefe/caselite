import { BrowserWindow, ipcMain } from 'electron';
import {
  APPEARANCE_CHANNEL,
  appearanceResponseSchema,
  type AppearanceResponse,
} from '@caselite/contracts';
import type { createAppearanceApplication } from '@caselite/application';
import { isTrustedDesktopSender } from './register-application-ipc';

export function registerAppearanceIpc(application: ReturnType<typeof createAppearanceApplication>) {
  ipcMain.handle(APPEARANCE_CHANNEL, (event, input): AppearanceResponse => {
    if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows()))
      return { ok: false, message: '当前页面无权访问外观设置。' };
    return appearanceResponseSchema.parse(application.execute(input));
  });
}
