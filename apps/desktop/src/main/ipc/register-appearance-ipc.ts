import { ipcMain } from 'electron';
import {
  APPEARANCE_CHANNEL,
  appearanceRequestSchema,
  appearanceResponseSchema,
  type AppearanceResponse,
} from '@caselite/contracts';
import type { createAppearanceApplication } from '@caselite/application';
import { isTrustedBusinessSender } from './window-capabilities';

export function registerAppearanceIpc(
  application: ReturnType<typeof createAppearanceApplication>,
  onApplied?: (contents: Electron.WebContents, theme: 'light' | 'dark') => boolean,
) {
  ipcMain.handle(APPEARANCE_CHANNEL, (event, input): AppearanceResponse => {
    if (!isTrustedBusinessSender(event))
      return { ok: false, message: '当前页面无权访问外观设置。' };
    const result = appearanceResponseSchema.parse(application.execute(input));
    const request = appearanceRequestSchema.safeParse(input);
    if (result.ok && request.success && request.data.operation === 'applied') {
      if (!onApplied?.(event.sender, result.theme))
        return { ok: false, message: '无法同步窗口外观，请重新读取。' };
    }
    return result;
  });
}
