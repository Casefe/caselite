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

async function createWindow(show = true): Promise<BrowserWindow> {
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
  if (show && !window.isDestroyed()) window.show();
  return window;
}

// A fixed, synthetic-only packaged check. It uses Electron's own renderer and
// does not enable remote debugging or expose an arbitrary renderer IPC method.
async function runPdfProbe(): Promise<void> {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^https?:/i.test(details.url) });
  });
  const window = await createWindow(false);
  const evaluate = (source: string): Promise<unknown> =>
    window.webContents.executeJavaScript(source);
  const waitFor = async (predicate: string): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate(predicate)) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('PDF probe timed out');
  };

  let stage = 'initialization';
  try {
    await evaluate("document.querySelector('button')?.click()");
    stage = 'worker-and-text-page';
    await waitFor(
      "window.__caselitePdfNativeWorker === true && document.querySelector('[aria-label=\"PDF 页码\"]')?.textContent?.includes('1 / 1') && document.querySelector('canvas')?.width > 0 && document.querySelector('.react-pdf__Page__textContent')?.textContent?.includes('合同')",
    );
    await evaluate(
      "document.querySelector('#pdf-fixture').value = '1'; document.querySelector('#pdf-fixture').dispatchEvent(new Event('change', { bubbles: true }))",
    );
    stage = 'scanned-page';
    await waitFor(
      "document.querySelector('[aria-label=\"PDF 页码\"]')?.textContent?.includes('1 / 1') && document.querySelector('canvas')?.width > 0 && !document.querySelector('.react-pdf__Page__textContent')",
    );
    await evaluate(
      "document.querySelector('#pdf-fixture').value = '2'; document.querySelector('#pdf-fixture').dispatchEvent(new Event('change', { bubbles: true }))",
    );
    stage = 'repeated-text-page-one';
    await waitFor(
      "document.querySelector('[aria-label=\"PDF 页码\"]')?.textContent?.includes('1 / 2') && document.querySelector('canvas')?.width > 0",
    );
    await evaluate(
      "[...document.querySelectorAll('button')].find((button) => button.textContent === '下一页')?.click()",
    );
    stage = 'repeated-text-page-two';
    await waitFor(
      "document.querySelector('[aria-label=\"PDF 页码\"]')?.textContent?.includes('2 / 2') && document.querySelector('.react-pdf__Page__textContent')?.textContent?.includes('BETA-002')",
    );
    process.stdout.write('CaseLite packaged offline PDF probe passed.\n');
  } catch {
    process.stderr.write(`CaseLite PDF probe failed at ${stage}.\n`);
    try {
      const state = (await evaluate(
        "({ nativeWorker: window.__caselitePdfNativeWorker ?? null, canvas: Boolean(document.querySelector('canvas')?.width), text: Boolean(document.querySelector('.react-pdf__Page__textContent')?.textContent), error: Boolean(document.querySelector('[role=alert]')) })",
      )) as { nativeWorker: boolean | null; canvas: boolean; text: boolean; error: boolean };
      process.stderr.write(
        `CaseLite PDF probe state: nativeWorker=${state.nativeWorker}, canvas=${state.canvas}, text=${state.text}, error=${state.error}.\n`,
      );
    } catch {
      process.stderr.write('CaseLite PDF probe state unavailable.\n');
    }
    throw new Error('PDF compatibility probe failed');
  } finally {
    window.destroy();
  }
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
    if (process.env.CASELITE_PDF_PROBE === '1') {
      await runPdfProbe();
      app.exit(0);
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
    if (process.env.CASELITE_DB_PROBE === '1' || process.env.CASELITE_PDF_PROBE === '1') {
      process.stderr.write('CaseLite packaged probe failed.\n');
      app.exit(1);
      return;
    }
    reportStartupFailure();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
