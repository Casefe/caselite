import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { randomUUID } from 'node:crypto';

import { createSpikeApplication } from '@caselite/application';

import { registerApplicationIpc } from './ipc/register-application-ipc';

function reportStartupFailure(): void {
  // Keep internal paths and stack traces out of user-facing errors.
  dialog.showErrorBox('CaseLite 启动失败', '无法加载工程骨架页面。请关闭应用并检查本地构建配置。');
  app.quit();
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    title: 'CaseLite',
    show: false,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
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

  await window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  if (!window.isDestroyed()) window.show();
}

function registerIpcSpike(): void {
  registerApplicationIpc({
    ipcMain,
    application: createSpikeApplication({
      authorization: {
        // DEV-1578 has no identity store yet. The composition root is the only place
        // allowed to make this temporary, explicit test policy.
        canAct: async () => true,
      },
      createId: randomUUID,
      now: () => new Date().toISOString(),
    }),
    isTrustedSender: (event) => event.senderFrame?.url === MAIN_WINDOW_WEBPACK_ENTRY,
  });
}

app
  .whenReady()
  .then(async () => {
    registerIpcSpike();
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on('will-download', (event) => event.preventDefault());

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow().catch(reportStartupFailure);
      }
    });

    await createWindow();
  })
  .catch(reportStartupFailure);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
