import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

import { createOfflineProbeApplication, createSpikeApplication } from '@caselite/application';
import { openOfflineProbePort, openToolchainProbe, toolchainProbe } from '@caselite/local-db';

import { isTrustedDesktopSender, registerApplicationIpc } from './ipc/register-application-ipc';

function reportStartupFailure(): void {
  // Keep internal paths and stack traces out of user-facing errors.
  dialog.showErrorBox('CaseLite 启动失败', '无法加载工程骨架页面。请关闭应用并检查本地构建配置。');
  app.quit();
}

async function createWindow(
  show = true,
  pdfWorkerFault?: 'missing' | 'mismatch',
): Promise<BrowserWindow> {
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

  const entry = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
  if (pdfWorkerFault) entry.searchParams.set('caselite-pdf-worker-fault', pdfWorkerFault);
  await window.loadURL(entry.toString());
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

function registerIpcSpike(offlineProbe?: ReturnType<typeof createOfflineProbeApplication>): void {
  registerApplicationIpc({
    ipcMain,
    offlineProbe,
    application: createSpikeApplication({
      authorization: {
        // DEV-1578 has no identity store yet. The composition root is the only place
        // allowed to make this temporary, explicit test policy.
        canAct: async () => true,
      },
      createId: randomUUID,
      now: () => new Date().toISOString(),
    }),
    isTrustedSender: (event) => isTrustedDesktopSender(event, BrowserWindow.getAllWindows()),
  });
}

function denyUnrequestedDesktopCapabilities(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (event) => event.preventDefault());
}

function validatedIntegrationRoot(): string {
  const supplied = process.env.CASELITE_INTEGRATION_DIR;
  if (!supplied) throw new Error('Missing integration test directory');
  const root = realpathSync(supplied);
  const temporaryRoot = realpathSync(tmpdir());
  if (
    !root.startsWith(`${temporaryRoot}${sep}`) ||
    !basename(root).startsWith('caselite-integration-')
  ) {
    throw new Error('Integration test directory is outside the temporary root');
  }
  return root;
}

// The same packaged application exercises PDF Worker and renderer → preload →
// validated IPC → Application → SQLite. The runner owns and later deletes its
// isolated temporary directory; no customer file or database is opened.
async function runOfflineIntegrationProbe(phase: 'write' | 'read'): Promise<void> {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^https?:/i.test(details.url) });
  });
  const databasePath = join(validatedIntegrationRoot(), '中文 路径', 'probe.sqlite');
  const migrationsFolder = join(process.resourcesPath, 'migrations');
  const suppliedFault = process.env.CASELITE_INTEGRATION_WORKER_FAULT;
  if (suppliedFault && suppliedFault !== 'missing' && suppliedFault !== 'mismatch') {
    throw new Error('Unknown integration PDF Worker fault');
  }
  const workerFault = suppliedFault as 'missing' | 'mismatch' | undefined;
  const port = openOfflineProbePort(databasePath, migrationsFolder);
  let window: BrowserWindow | undefined;
  let rendererGone = false;
  let stage = 'window';
  try {
    registerIpcSpike(createOfflineProbeApplication(port));
    window = await createWindow(false, workerFault);
    window.webContents.on('render-process-gone', () => {
      rendererGone = true;
    });
    const evaluate = (source: string): Promise<unknown> =>
      window!.webContents.executeJavaScript(source);
    const waitFor = async (predicate: string): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await evaluate(predicate)) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error('Integrated PDF probe timed out');
    };

    await evaluate("document.querySelector('button')?.click()");
    if (workerFault) {
      stage = `worker-${workerFault}`;
      await waitFor(
        `window.__caselitePdfNativeWorker === ${workerFault === 'mismatch'} && Boolean(document.querySelector('#pdf-fixture')) && document.querySelector('.pdf-spike-page [role=alert]')?.textContent?.includes('无法打开')`,
      );
      stage = `worker-${workerFault}-db`;
      const preserved = (await evaluate(
        "window.caselite.offlineProbe({ protocol_version: 1, action: 'read', record_id: 'dev-1566-synthetic' })",
      )) as { ok: boolean; value?: { stored_value: string | null } };
      if (!preserved.ok || preserved.value?.stored_value !== 'offline-integration-verified') {
        throw new Error('Synthetic database record changed after PDF Worker failure');
      }
      process.stdout.write(`CaseLite packaged offline integration worker-${workerFault} passed.\n`);
      return;
    }
    stage = 'pdf-worker-and-text';
    await waitFor(
      "window.__caselitePdfNativeWorker === true && document.querySelector('[aria-label=\"PDF 页码\"]')?.textContent?.includes('1 / 1') && document.querySelector('canvas')?.width > 0 && document.querySelector('.react-pdf__Page__textContent')?.textContent?.includes('合同')",
    );

    stage = 'pdf-two-page-first';
    await evaluate(
      "document.querySelector('#pdf-fixture').value = '2'; document.querySelector('#pdf-fixture').dispatchEvent(new Event('change', { bubbles: true }))",
    );
    await waitFor(
      "document.querySelector('[aria-label=\"PDF 页码\"]')?.textContent?.includes('1 / 2') && document.querySelector('.react-pdf__Page__textContent')?.textContent?.includes('ALPHA-001')",
    );
    stage = 'pdf-two-page-second';
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '下一页')?.click()",
    );
    await waitFor(
      "document.querySelector('[aria-label=\"PDF 页码\"]')?.textContent?.includes('2 / 2') && document.querySelector('.react-pdf__Page__textContent')?.textContent?.includes('BETA-002') && !document.querySelector('.react-pdf__Page__textContent')?.textContent?.includes('ALPHA-001')",
    );
    stage = 'pdf-select-text';
    await evaluate(
      "(() => { const layer = document.querySelector('.react-pdf__Page__textContent'); const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(layer); selection.removeAllRanges(); selection.addRange(range); Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '查看选中文字')?.click(); })()",
    );
    await waitFor(
      "Array.from(document.querySelectorAll('p')).some((p) => p.textContent?.startsWith('选中：') && p.textContent?.includes('BETA-002'))",
    );
    stage = 'pdf-restore-first';
    await evaluate(
      "document.querySelector('#pdf-fixture').value = '0'; document.querySelector('#pdf-fixture').dispatchEvent(new Event('change', { bubbles: true }))",
    );
    await waitFor(
      "document.querySelector('[aria-label=\"PDF 页码\"]')?.textContent?.includes('1 / 1') && document.querySelector('.react-pdf__Page__textContent')?.textContent?.includes('合同')",
    );

    // The packaged renderer must expose the fixed preload method before the
    // first invoke; PDF rendering alone does not prove that the bridge loaded.
    stage = 'preload-api';
    await waitFor("typeof window.caselite?.offlineProbe === 'function'");

    // A malformed DTO must be rejected by main before touching the database.
    stage = 'invalid-ipc';
    let invalid: unknown;
    try {
      invalid = await evaluate(
        "window.caselite.offlineProbe({ protocol_version: 1, action: 'write', record_id: 'outside-test', value: 'invalid' })",
      );
    } catch {
      stage = 'invalid-ipc-call-rejected';
      throw new Error('Malformed IPC probe could not complete');
    }
    const invalidCode = (invalid as { error?: { code?: string } })?.error?.code;
    if (invalidCode !== 'INVALID_REQUEST') {
      stage = `invalid-ipc-${invalidCode?.toLowerCase() ?? 'no-error-code'}`;
      throw new Error('Malformed IPC request was not rejected');
    }

    const request = {
      protocol_version: 1,
      action: phase,
      record_id: 'dev-1566-synthetic',
      ...(phase === 'write' ? { value: 'offline-integration-verified' } : {}),
    };
    stage = `sqlite-${phase}`;
    const result = (await evaluate(`window.caselite.offlineProbe(${JSON.stringify(request)})`)) as {
      ok: boolean;
      value?: { stored_value: string | null; migration_count: number };
    };
    if (
      !result.ok ||
      result.value?.stored_value !== 'offline-integration-verified' ||
      result.value?.migration_count !== 1
    ) {
      throw new Error('Packaged IPC/SQLite readback or migration count failed');
    }

    // Both a corrupt PDF and a missing local resource must fail without
    // changing the already committed synthetic SQLite record.
    for (const index of ['3', '4']) {
      stage = `pdf-error-${index}`;
      await evaluate(
        `document.querySelector('#pdf-fixture').value = '${index}'; document.querySelector('#pdf-fixture').dispatchEvent(new Event('change', { bubbles: true }))`,
      );
      await waitFor(
        `document.querySelector('#pdf-fixture')?.value === '${index}' && document.querySelector('.pdf-spike-page [role=alert]')?.textContent?.includes('无法打开')`,
      );
      stage = `pdf-recover-${index}`;
      await evaluate(
        "document.querySelector('#pdf-fixture').value = '0'; document.querySelector('#pdf-fixture').dispatchEvent(new Event('change', { bubbles: true }))",
      );
      await waitFor(
        "document.querySelector('#pdf-fixture')?.value === '0' && !document.querySelector('[role=alert]') && document.querySelector('canvas')?.width > 0 && document.querySelector('.react-pdf__Page__textContent')?.textContent?.includes('合同')",
      );
    }
    stage = 'readback-after-failure';
    const afterFailure = (await evaluate(
      "window.caselite.offlineProbe({ protocol_version: 1, action: 'read', record_id: 'dev-1566-synthetic' })",
    )) as { ok: boolean; value?: { stored_value: string | null } };
    if (!afterFailure.ok || afterFailure.value?.stored_value !== 'offline-integration-verified') {
      throw new Error('Synthetic database record changed after PDF failure');
    }
    process.stdout.write(`CaseLite packaged offline integration ${phase} passed.\n`);
  } catch {
    process.stderr.write(`CaseLite offline integration failed at ${stage}.\n`);
    process.stderr.write(`CaseLite offline renderer gone: ${rendererGone}.\n`);
    if (window && !window.isDestroyed()) {
      try {
        const state = (await window.webContents.executeJavaScript(
          "({ fixture: document.querySelector('#pdf-fixture')?.value ?? null, alert: Boolean(document.querySelector('[role=alert]')), main: Boolean(document.querySelector('main')), canvas: Boolean(document.querySelector('canvas')?.width), text: Boolean(document.querySelector('.react-pdf__Page__textContent')?.textContent) })",
        )) as {
          fixture: string | null;
          alert: boolean;
          main: boolean;
          canvas: boolean;
          text: boolean;
        };
        process.stderr.write(
          `CaseLite offline PDF state: fixture=${state.fixture}, alert=${state.alert}, main=${state.main}, canvas=${state.canvas}, text=${state.text}.\n`,
        );
      } catch {
        process.stderr.write('CaseLite offline PDF state unavailable.\n');
      }
    }
    throw new Error('Packaged offline integration probe failed');
  } finally {
    window?.destroy();
    port.close();
  }
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
    denyUnrequestedDesktopCapabilities();
    if (
      process.env.CASELITE_INTEGRATION_PHASE === 'write' ||
      process.env.CASELITE_INTEGRATION_PHASE === 'read'
    ) {
      await runOfflineIntegrationProbe(process.env.CASELITE_INTEGRATION_PHASE);
      app.exit(0);
      return;
    }
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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow().catch(reportStartupFailure);
      }
    });

    await createWindow();
  })
  .catch(() => {
    if (
      process.env.CASELITE_DB_PROBE === '1' ||
      process.env.CASELITE_PDF_PROBE === '1' ||
      process.env.CASELITE_INTEGRATION_PHASE
    ) {
      process.stderr.write('CaseLite packaged probe failed.\n');
      app.exit(1);
      return;
    }
    reportStartupFailure();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
