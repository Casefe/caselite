import { ipcMain, nativeTheme, type BrowserWindow, type WebContents } from 'electron';
import type { createAppearanceApplication } from '@caselite/application';
import {
  APPEARANCE_INITIAL_CHANNEL,
  appearanceResponseSchema,
  type Theme,
} from '@caselite/contracts';
import { isTrustedAppearanceSender } from './ipc/window-capabilities';

export const appearanceBackground = (theme: Theme) => (theme === 'dark' ? '#1c1c1f' : '#f7f7f8');

export function createWindowAppearance(
  application: ReturnType<typeof createAppearanceApplication>,
) {
  const windows = new Set<BrowserWindow>();
  const snapshot = () => {
    const result = application.execute({ protocol_version: 1, operation: 'read' });
    return { theme: result.ok ? result.theme : ('light' as Theme), result };
  };
  const initial = snapshot();
  nativeTheme.themeSource = initial.theme;
  // 只读首帧快照：每个文档加载都重新核对同一Owner，刷新不依赖过期URL或Renderer缓存。
  // 同步入口只做小型本机偏好读取，不能接业务库、凭据、网络或任何写入。
  ipcMain.on(APPEARANCE_INITIAL_CHANNEL, (event, ...args: unknown[]) => {
    try {
      const live = [...windows].filter((window) => !window.isDestroyed());
      if (args.length !== 0 || !isTrustedAppearanceSender(event)) {
        event.returnValue = { ok: false, message: '当前页面无权读取初始外观。' };
        return;
      }
      const next = snapshot();
      // 每次reload也先同步窗口底色；损坏偏好使用同色错误页，不伪造成功、不覆盖原文件。
      live
        .find((window) => window.webContents === event.sender)!
        .setBackgroundColor(appearanceBackground(next.theme));
      nativeTheme.themeSource = next.theme;
      event.returnValue = appearanceResponseSchema.parse(next.result);
    } catch {
      event.returnValue = { ok: false, message: '无法读取初始外观，请重新读取。' };
    }
  });
  return {
    snapshot,
    attach(window: BrowserWindow) {
      windows.add(window);
      window.once('closed', () => windows.delete(window));
    },
    confirm(contents: WebContents, theme: Theme) {
      const live = [...windows].filter((window) => !window.isDestroyed());
      // 当前产品只有一个主工作台；不能只改其他窗口底色而留下旧DOM。
      if (live.length !== 1 || live[0].webContents !== contents) return false;
      live[0].setBackgroundColor(appearanceBackground(theme));
      nativeTheme.themeSource = theme;
      return true;
    },
  };
}
