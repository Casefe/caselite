import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createSpikeApplication } from '@caselite/application';
import { openToolchainProbe, toolchainProbe } from '@caselite/local-db';

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

function runLocalDatabaseProbe(): void {
  const directory = mkdtempSync(join(tmpdir(), 'caselite-electron-db-'));
  const databasePath = join(directory, 'probe.sqlite');
  const migrationsFolder = app.isPackaged
    ? join(process.resourcesPath, 'migrations')
    : resolve(process.cwd(), '../../packages/local-db/migrations');

  try {
    const first = openToolchainProbe(databasePath, migrationsFolder);
    try {
      first.db.insert(toolchainProbe).values({ id: 'synthetic', value: 'verified' }).run();
    } finally {
      first.sqlite.close();
    }
    const second = openToolchainProbe(databasePath, migrationsFolder);
    try {
      const result = second.sqlite
        .prepare('SELECT value FROM toolchain_probe WHERE id = ?')
        .get('synthetic');
      if (JSON.stringify(result) !== JSON.stringify({ value: 'verified' })) {
        throw new Error('Local database probe did not read back its synthetic value');
      }
    } finally {
      second.sqlite.close();
    }
    process.stdout.write('CaseLite SQLite/Drizzle Electron probe passed.\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

app
  .whenReady()
  .then(async () => {
    if (process.env.CASELITE_DB_PROBE === '1') {
      runLocalDatabaseProbe();
      app.quit();
      return;
    }
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
  .catch(() => {
    if (process.env.CASELITE_DB_PROBE === '1') {
      process.stderr.write('CaseLite SQLite/Drizzle Electron probe failed.\n');
      app.exit(1);
      return;
    }
    reportStartupFailure();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
