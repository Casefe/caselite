import { runExportStyleDemo } from './export-style-demo';
import { performanceApplication, seedPerformance, runPerformance } from './performance-demo';
import { runFinanceDemo } from './finance-demo';
import { createDeliveryExportApplication } from '@caselite/application';
import { createDeliveryExportFiles } from './adapters/delivery-export-files';
import { createExportConfigurationResolver } from './adapters/export-configuration';
import { generateSnapshotPdf } from './adapters/pdf-export-processor';
import { generateSnapshotWord } from './adapters/word-export-processor';
import { runReminderDemo } from './reminder-demo';
import { startReminderScheduler } from './adapters/reminder-scheduler';
import { createReminderApplication } from '@caselite/application';
import { registerReminderIpc } from './ipc/register-task-ipc';
import { createRealDemoRuntime, runRealAgentDemo } from './agent-real-demo';
import {
  validateRealDemoLaunch,
  type RealDemoAuthorization,
  realDemoPdfHash,
  realDemoResumeId,
  inspectZeroDispatchResume,
} from './agent-real-policy';
import { syntheticDocxStream } from './agent-demo';
import { runMaterialDemo } from './material-demo';
import { createMaterialApplication } from '@caselite/application';
import { createMaterialBatchApplication } from '@caselite/application';
import { registerMaterialBatchIpc } from './ipc/register-material-batch-ipc';
import { validateMaterialBatchPath } from './adapters/material-batch-files';
import { runMaterialBatchDemo } from './material-batch-demo';
import { createDocxProcessor, readDocxSemanticHtml } from './adapters/docx-processor';
import { createMaterialFiles } from './adapters/material-files';
import { createMaterialScopeWritable } from './adapters/material-scope';
import { createPdfProcessor } from './adapters/pdf-processor';
import { createImageProcessor } from './adapters/image-processor';
import { createPhotoPermissionGate } from './adapters/photo-permission';
import { registerMaterialIpc } from './ipc/register-material-ipc';
import { runTaskDemo } from './task-demo';
import { runTypographyDemo } from './typography-demo';
import { runProjectDemo } from './project-demo';
import { runCustomerDemo, createSyntheticCustomerStream } from './customer-demo';
import { createCatalogQueryProbe, runCatalogQueryProbe } from './catalog-query-probe';
import { createTaskQueryProbe, runTaskQueryProbe } from './task-query-probe';
import { runTaskStatusDemo } from './task-status-demo';
import { runAppearanceDemo } from './appearance-demo';
import { runHomeContextDemo } from './home-context-demo';
import {
  runAgentDemo,
  runAgentHistoryProbe,
  syntheticAgentStream,
  syntheticReviewStream,
} from './agent-demo';
import { runDocumentReviewDemo, seedDocumentReview } from './document-review-demo';
import { runEditorInteractionDemo } from './editor-interaction-demo';
import { runEditorSchemeDemo } from './editor-scheme-demo';
import { documentReviewStore } from './document-review-store';
import { createCatalogApplication, createFinanceApplication } from '@caselite/application';
import { createAppearanceApplication } from '@caselite/application';
import { createAppearancePreferences } from './adapters/appearance-preferences';
import { registerAppearanceIpc } from './ipc/register-appearance-ipc';
import { createLegalConsentApplication } from '@caselite/application';
import { createLegalAcceptance, loadLegalBundle } from './adapters/legal-acceptance';
import { showLegalConsent } from './legal-consent-window';
import { observeLegalConsentDemo } from './legal-consent-demo';
import { createLocalPreferencesApplication } from '@caselite/application';
import { registerLocalPreferencesIpc } from './ipc/register-local-preferences-ipc';
import { createAgentApplication } from '@caselite/application';
import { createImportantDateApplication } from '@caselite/application';
import { runImportantDateDemo } from './important-date-demo';
import { syntheticImportantDateStream } from './important-date-mock';
import { createPiRuntime } from './adapters/pi-runtime';
import {
  runCredentialPreflight,
  readOnlyDemoCredentials,
  credentialFingerprints,
  credentialStatus,
} from './credential-preflight';
import { createAgentCredentials } from './adapters/agent-credentials';
import { registerAgentIpc } from './ipc/register-agent-ipc';
import {
  registerCatalogIpc,
  registerContactsIpc,
  registerFinanceIpc,
  registerTaskIpc,
} from './ipc/register-task-ipc';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  screen,
  session,
  shell,
  systemPreferences,
  type WebContents,
} from 'electron';
import { randomUUID, createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

import {
  createOfflineProbeApplication,
  createContactsApplication,
  createSpikeApplication,
  createTaskApplication,
} from '@caselite/application';
import {
  openOfflineProbePort,
  openToolchainProbe,
  integrationMigrations,
  toolchainProbe,
  openTaskStore,
} from '@caselite/local-db';

import { isTrustedDesktopSender, registerApplicationIpc } from './ipc/register-application-ipc';

function reportStartupFailure(): void {
  // Keep internal paths and stack traces out of user-facing errors.
  dialog.showErrorBox('CaseLite 启动失败', '无法加载工程骨架页面。请关闭应用并检查本地构建配置。');
  app.quit();
}

// 协议窗口到工作台之间可能短暂没有窗口；Windows/Linux不能因此提前退出。
let startingProductWindow = true;

async function createWindow(
  show = true,
  pdfWorkerFault?: 'missing' | 'mismatch',
): Promise<BrowserWindow> {
  // 以1080p工作区为设计基准；小屏按可用桌面缩放窗口尺寸，不缩放正文或降低像素清晰度。
  const available = screen.getPrimaryDisplay().workAreaSize;
  const window = new BrowserWindow({
    width: Math.min(1920, available.width),
    height: Math.min(1080, Math.max(480, available.height - 32)),
    useContentSize: true,
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
  if (process.env.CASELITE_PDF_PROBE === '1' || process.env.CASELITE_INTEGRATION_PHASE)
    entry.searchParams.set('engineering', '1');
  if (process.env.CASELITE_TASK_DEMO === 'preview') entry.searchParams.set('preview', '1');
  if (process.env.CASELITE_TASK_DEMO === 'delivery-preview')
    entry.searchParams.set('delivery-preview', '1');
  if (process.env.CASELITE_TASK_DEMO === 'credential-preflight-ui')
    entry.searchParams.set('audit-agent', '1');
  if (
    process.env.CASELITE_TASK_DEMO === 'agent-preview' ||
    process.env.CASELITE_TASK_DEMO?.startsWith('agent-home-') ||
    process.env.CASELITE_TASK_DEMO?.startsWith('project-agent-') ||
    process.env.CASELITE_TASK_DEMO?.startsWith('customer-') ||
    process.env.CASELITE_TASK_DEMO?.startsWith('document-review-') ||
    process.env.CASELITE_TASK_DEMO?.startsWith('editor-interaction-') ||
    process.env.CASELITE_TASK_DEMO?.startsWith('editor-scheme-') ||
    process.env.CASELITE_TASK_DEMO?.startsWith('export-style-') ||
    process.env.CASELITE_TASK_DEMO?.startsWith('performance-') ||
    process.env.CASELITE_TASK_DEMO?.startsWith('important-date-')
  )
    entry.searchParams.set('mock-agent', '1');
  if (pdfWorkerFault) entry.searchParams.set('caselite-pdf-worker-fault', pdfWorkerFault);
  await window.loadURL(entry.toString());
  startingProductWindow = false;
  credentialWindowLoaded();
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

function denyUnrequestedDesktopCapabilities() {
  const camera = createPhotoPermissionGate<WebContents>({
    trusted(contents) {
      const window = BrowserWindow.fromWebContents(contents);
      if (!window || window.isDestroyed() || contents.isDestroyed()) return false;
      try {
        const current = new URL(contents.getURL()),
          entry = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
        return (
          current.protocol === entry.protocol &&
          current.host === entry.host &&
          current.pathname === entry.pathname
        );
      } catch {
        return false;
      }
    },
    askSystem: () =>
      process.platform === 'darwin'
        ? systemPreferences.askForMediaAccess('camera')
        : Promise.resolve(false),
  });
  // 默认拒绝；仅可信主窗显式申请且系统同意的短时视频许可例外，不开放音频或其他权限。
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(camera.permits(contents, permission, details)),
  );
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    camera.permits(contents, permission, details),
  );
  session.defaultSession.on('will-download', (event) => event.preventDefault());
  app.on('web-contents-created', (_event, contents) => {
    if (contents.session !== session.defaultSession) {
      contents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      contents.session.setPermissionCheckHandler(() => false);
    }
  });
  return camera;
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

    // Exercise both DEV-1578 business commands in the actual packaged renderer,
    // preload, main IPC handler and Application. These are in-memory Spike results.
    stage = 'matter-ipc';
    const matterCommand = {
      request_id: '11111111-1111-4111-8111-111111111111',
      protocol_version: 1,
      workspace_id: 'dev-1578-synthetic',
      actor_id: 'synthetic-actor',
      device_id: 'synthetic-device',
      idempotency_key: '22222222-2222-4222-8222-222222222222',
      expected_version: 0,
      payload: { title: '合成事项' },
    };
    const matterResult = (await evaluate(
      `window.caselite.createMatter(${JSON.stringify(matterCommand)})`,
    )) as {
      ok: boolean;
      value?: {
        entity_id: string;
        local_save_status: string;
        domain_events: { event_type: string }[];
      };
    };
    if (
      !matterResult.ok ||
      matterResult.value?.local_save_status !== 'not-persisted' ||
      matterResult.value.domain_events[0]?.event_type !== 'matter.created'
    ) {
      throw new Error('CreateMatter packaged IPC returned an unexpected result');
    }
    stage = 'matter-idempotency';
    const matterReplay = await evaluate(
      `window.caselite.createMatter(${JSON.stringify({ ...matterCommand, request_id: '33333333-3333-4333-8333-333333333333' })})`,
    );
    if (JSON.stringify(matterReplay) !== JSON.stringify(matterResult)) {
      throw new Error('CreateMatter duplicate request produced another result');
    }

    stage = 'anchor-ipc';
    const anchorCommand = {
      ...matterCommand,
      request_id: '44444444-4444-4444-8444-444444444444',
      idempotency_key: '55555555-5555-4555-8555-555555555555',
      matter_id: matterResult.value.entity_id,
      payload: {
        source_version_id: 'synthetic-source-version',
        page_number: 1,
        quoted_text: '合成引文',
      },
    };
    const anchorResult = (await evaluate(
      `window.caselite.createAnchor(${JSON.stringify(anchorCommand)})`,
    )) as {
      ok: boolean;
      value?: { local_save_status: string; domain_events: { event_type: string }[] };
    };
    if (
      !anchorResult.ok ||
      anchorResult.value?.local_save_status !== 'not-persisted' ||
      anchorResult.value.domain_events[0]?.event_type !== 'anchor.created'
    ) {
      throw new Error('CreateAnchor packaged IPC returned an unexpected result');
    }
    stage = 'anchor-idempotency';
    const anchorReplay = await evaluate(
      `window.caselite.createAnchor(${JSON.stringify({ ...anchorCommand, request_id: '66666666-6666-4666-8666-666666666666' })})`,
    );
    if (JSON.stringify(anchorReplay) !== JSON.stringify(anchorResult)) {
      throw new Error('CreateAnchor duplicate request produced another result');
    }

    stage = 'old-command-protocol';
    const oldProtocol = (await evaluate(
      `window.caselite.createMatter(${JSON.stringify({ ...matterCommand, protocol_version: 0 })})`,
    )) as { error?: { code?: string } };
    if (oldProtocol.error?.code !== 'PROTOCOL_UNSUPPORTED') {
      throw new Error('Old business command protocol was not rejected');
    }
    stage = 'invalid-command';
    const invalidCommand = (await evaluate(
      `window.caselite.createAnchor(${JSON.stringify({ ...anchorCommand, payload: { ...anchorCommand.payload, quoted_text: '' } })})`,
    )) as { error?: { code?: string } };
    if (invalidCommand.error?.code !== 'INVALID_REQUEST') {
      throw new Error('Malformed business command was not rejected');
    }
    process.stdout.write('CaseLite real CreateMatter/CreateAnchor IPC accepted.\n');

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
      result.value?.migration_count !== integrationMigrations.length
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

const defaultCredentialRoot = app.getPath('userData');
let credentialWindowLoaded: () => void;
const credentialWindowReady = new Promise<void>((resolve) => {
  credentialWindowLoaded = resolve;
});
let realDemoAuthorization: RealDemoAuthorization | undefined;
let taskDemoRoot: string | undefined;
let taskDemoEvidenceRoot: string | undefined;
let realResumeAudit: ReturnType<typeof inspectZeroDispatchResume> | undefined;
const taskDemoPhase = process.env.CASELITE_TASK_DEMO;
if (taskDemoPhase) {
  if (
    ![
      'legal-accept',
      'legal-read',
      'legal-reject',
      'legal-close',
      'legal-write-failure',
      'legal-corrupt',
      'legal-update',
      'legal-preview',
      'legal-workbench',
      'delivery-preview',
      'document-review-preview',
      'document-review-write',
      'document-review-read',
      'editor-interaction-write',
      'editor-interaction-read',
      'editor-interaction-preview',
      'performance-seed',
      'performance-run',
      'performance-start',
      'export-style-write',
      'export-style-read',
      'export-style-preview',
      'editor-scheme-write',
      'editor-scheme-read',
      'editor-scheme-preview',
      'credential-preflight',
      'credential-preflight-ui',
      'task-status-write',
      'task-status-read',
      'reminder-write',
      'reminder-read',
      'reminder-preview',
      'real-agent',
      'real-agent-dry',
      'write',
      'read',
      'materials',
      'materials-read',
      'materials-batch',
      'materials-batch-read',
      'important-date-write',
      'important-date-read',
      'important-date-preview',
      'materials-docx',
      'materials-docx-table',
      'materials-docx-lists',
      'materials-docx-recovery',
      'materials-docx-preview',
      'materials-docx-reopen',
      'crash',
      'preview',
      'typography',
      'project-write',
      'project-agent-write',
      'project-agent-read',
      'project-read',
      'project-edit',
      'project-restore',
      'project-promote',
      'project-promote-read',
      'project-files',
      'project-files-read',
      'project-activity',
      'project-activity-read',
      'agent',
      'agent-preview',
      'agent-home-check',
      'agent-home-read',
      'agent-crash',
      'agent-read',
      'agent-credential-read',
      'agent-crash-synthetic',
      'agent-read-synthetic',
      'customer-write',
      'customer-read',
      'customer-preview',
      'finance-write',
      'finance-reverse',
      'finance-read',
      'finance-preview',
      'appearance-write',
      'appearance-read',
    ].includes(taskDemoPhase)
  )
    throw new Error('Invalid demo phase');
  const candidate = realpathSync(process.env.CASELITE_TASK_DEMO_DIR ?? '');
  if (
    !candidate.startsWith(realpathSync(tmpdir()) + sep) ||
    !basename(candidate).startsWith('caselite-task-demo-')
  )
    throw new Error('Demo directory must be isolated');
  if (taskDemoPhase === 'real-agent')
    realDemoAuthorization = validateRealDemoLaunch({
      directory: candidate,
      temporaryRoot: realpathSync(tmpdir()),
      approval: process.env.CASELITE_REAL_AGENT_APPROVAL,
      resume: process.env.CASELITE_REAL_AGENT_RESUME,
    });
  taskDemoRoot = candidate;
  taskDemoEvidenceRoot = candidate;
  const resume = process.env.CASELITE_REAL_AGENT_RESUME;
  if (
    resume !== undefined &&
    (resume !== realDemoResumeId || !taskDemoPhase.startsWith('real-agent'))
  )
    throw new Error('Invalid resume mode');
  if (resume) {
    realResumeAudit = inspectZeroDispatchResume(
      candidate,
      taskDemoPhase === 'real-agent-dry',
      realDemoAuthorization,
    );
    taskDemoEvidenceRoot = realpathSync(join(candidate, realDemoResumeId));
    if (taskDemoEvidenceRoot !== join(candidate, realDemoResumeId))
      throw new Error('Invalid resume evidence directory');
  }
  if (taskDemoPhase.startsWith('real-agent'))
    writeFileSync(
      join(taskDemoEvidenceRoot!, 'credential-origin.json'),
      JSON.stringify(
        {
          defaultUserData: defaultCredentialRoot,
          appName: app.getName(),
          isolatedUserData: join(candidate, 'userData'),
          credentialAccess:
            taskDemoPhase === 'real-agent'
              ? 'read-only existing Main Owner'
              : 'MOCK_ONLY no real credential access',
        },
        null,
        2,
      ),
    );
  const data = join(candidate, 'userData');
  const sessionData = join(candidate, 'sessionData');
  mkdirSync(data, { recursive: true });
  mkdirSync(sessionData, { recursive: true });
  app.setPath('userData', data);
  app.setPath('sessionData', sessionData);
}

// 产品工作区只允许一个活进程；临时离线探针使用独立数据，不持有产品锁。
const integrationPhase = process.env.CASELITE_INTEGRATION_PHASE;
const integrationProbe = integrationPhase === 'write' || integrationPhase === 'read';
if (integrationPhase !== undefined && !integrationProbe) app.exit(1);
const isolatedProbe =
  process.env.CASELITE_DB_PROBE === '1' ||
  process.env.CASELITE_PDF_PROBE === '1' ||
  integrationProbe;
const ownsWorkspace = isolatedProbe || app.requestSingleInstanceLock();
if (!ownsWorkspace) app.exit(0);
app.on('second-instance', () => {
  const existing = BrowserWindow.getAllWindows().find((window) =>
    window.webContents.getURL().startsWith(MAIN_WINDOW_WEBPACK_ENTRY),
  );
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
  }
});

app
  .whenReady()
  .then(async () => {
    const cameraPermission = denyUnrequestedDesktopCapabilities();
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
    if (taskDemoRoot && taskDemoPhase === 'credential-preflight') {
      // 只读正式凭据；在任何工作区/Runtime初始化前退出，不消费1650费用账本。
      const result = await runCredentialPreflight(defaultCredentialRoot, taskDemoRoot);
      app.exit(result.configured ? 0 : 2);
      return;
    }
    const taskRoot = app.getPath('userData');
    mkdirSync(taskRoot, { recursive: true });
    // 普通入口必须先确认协议；业务IPC、案件库、凭据和Agent都在确认后初始化。
    const accepted = await showLegalConsent(
      createLegalConsentApplication(
        createLegalAcceptance(taskRoot),
        loadLegalBundle(
          app.isPackaged
            ? join(process.resourcesPath, 'legal')
            : resolve(app.getAppPath(), '../../legal'),
        ),
      ),
      taskDemoRoot
        ? (window) => observeLegalConsentDemo(window, taskDemoRoot!, taskDemoPhase!)
        : undefined,
    );
    if (
      taskDemoRoot &&
      taskDemoPhase?.startsWith('legal-') &&
      taskDemoPhase !== 'legal-preview' &&
      taskDemoPhase !== 'legal-workbench'
    ) {
      writeFileSync(
        join(taskDemoRoot, taskDemoPhase + '.json'),
        JSON.stringify({
          accepted,
          businessDatabaseCreated: existsSync(join(taskRoot, 'caselite.sqlite')),
          acceptanceActor: 'synthetic harness; automated UI actions when prompting',
        }),
      );
      app.exit(0);
      return;
    }
    if (!accepted) {
      app.quit();
      return;
    }
    registerIpcSpike();
    registerAppearanceIpc(createAppearanceApplication(createAppearancePreferences(taskRoot)));
    if (taskDemoPhase === 'delivery-preview' && taskDemoRoot) {
      // 原型只使用合成内存状态；在初始化业务库、凭据和Agent前返回。
      session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: /^https?:/i.test(details.url) }),
      );
      await createWindow();
      return;
    }
    const taskStore = openTaskStore(
      join(taskRoot, 'caselite.sqlite'),
      app.isPackaged
        ? join(process.resourcesPath, 'migrations')
        : resolve(process.cwd(), '../../packages/local-db/migrations'),
    );
    if (
      realResumeAudit &&
      (taskStore.agentHistory.load().length || taskStore.materials.list('home').length)
    )
      throw new Error('Original zero-dispatch database is not empty');
    const performanceDemo = taskDemoPhase?.startsWith('performance-');
    const baseTasks = createTaskApplication(taskStore);
    const tasks = performanceDemo ? performanceApplication('task', baseTasks) : baseTasks;
    registerLocalPreferencesIpc(
      createLocalPreferencesApplication(taskStore.localPreferences, {
        database_file: join(taskRoot, 'caselite.sqlite'),
        output_directory: join(taskRoot, 'delivery-exports'),
      }),
    );
    const taskQueryProbe =
      taskDemoRoot &&
      taskDemoPhase === 'task-status-write' &&
      process.env.CASELITE_TASK_QUERY_PROBE === '1'
        ? createTaskQueryProbe(tasks)
        : undefined;
    const exportConfiguration = createExportConfigurationResolver();
    registerTaskIpc(
      createDeliveryExportApplication({
        task: taskQueryProbe?.application ?? tasks,
        store: taskStore.deliveryExports,
        files: createDeliveryExportFiles(
          join(taskRoot, 'delivery-exports'),
          (path) => shell.openPath(path),
          async (row) => {
            // 绑定发起时的原生窗口，避免无父级保存面板被工作台遮挡后留下等待中的调用。
            const owner = BrowserWindow.getFocusedWindow();
            if (!owner) throw new Error('No active export window');
            const result = await dialog.showSaveDialog(owner, {
              title: '另存交付副本',
              buttonLabel: '保存副本',
              defaultPath: join(app.getPath('documents'), `CaseLite-草稿-${row.id}.${row.format}`),
              filters: [{ name: row.format === 'pdf' ? 'PDF' : 'Word', extensions: [row.format] }],
              properties: ['createDirectory'],
            });
            return result.canceled ? null : (result.filePath ?? null);
          },
        ),
        configuration: exportConfiguration,
        render: async (snapshot, state, format, signal, converter, configuration) => {
          const fontData =
            configuration && format === 'pdf'
              ? await exportConfiguration.readFont(configuration)
              : undefined;
          if (configuration && format === 'docx') await exportConfiguration.verify(configuration);
          try {
            return await (format === 'pdf'
              ? generateSnapshotPdf(snapshot, state, signal, converter, configuration, fontData)
              : generateSnapshotWord(snapshot, state, signal, configuration));
          } catch (error) {
            // 仅校验过的临时合成探针留诊断；正式数据、凭据和正文不进入日志。
            if (taskDemoRoot && taskDemoPhase?.startsWith('export-style-'))
              writeFileSync(
                join(taskDemoRoot, 'export-render-error.json'),
                JSON.stringify(
                  {
                    format,
                    message: error instanceof Error ? error.message : 'UNKNOWN',
                    cause:
                      error instanceof Error && error.cause instanceof Error
                        ? error.cause.message
                        : undefined,
                  },
                  null,
                  2,
                ),
              );
            throw error;
          }
        },
        hash: (bytes) => createHash('sha256').update(bytes).digest('hex'),
      }),
    );
    const reminders = createReminderApplication(taskStore.reminders);
    const reminderScheduler = startReminderScheduler(
      reminders,
      createHash('sha256').update(taskRoot).digest('hex').slice(0, 24),
    );
    registerReminderIpc(reminders, reminderScheduler.tick);
    app.on('will-quit', reminderScheduler.stop);
    const baseCatalog = createCatalogApplication(taskStore.catalog);
    const catalog = performanceDemo ? performanceApplication('catalog', baseCatalog) : baseCatalog;
    const catalogQueryProbe =
      taskDemoRoot &&
      taskDemoPhase === 'task-status-write' &&
      process.env.CASELITE_CATALOG_QUERY_PROBE === '1'
        ? createCatalogQueryProbe(catalog)
        : undefined;
    registerCatalogIpc(catalogQueryProbe?.application ?? catalog);
    const baseFinance = createFinanceApplication(taskStore.finance);
    const finance = performanceDemo ? performanceApplication('finance', baseFinance) : baseFinance;
    const baseContacts = createContactsApplication(taskStore.contacts);
    const contacts = performanceDemo
      ? performanceApplication('contacts', baseContacts)
      : baseContacts;
    registerFinanceIpc(finance);
    registerContactsIpc(contacts);
    const materials = createMaterialApplication({
      store: taskStore.materials,
      files: createMaterialFiles(join(taskRoot, 'materials')),
      processor: createPdfProcessor(),
      docxProcessor: createDocxProcessor(),
      imageProcessor: createImageProcessor(),
      docxPreview: readDocxSemanticHtml,
      id: randomUUID,
      hash: (text) => createHash('sha256').update(text).digest('hex'),
      taskExists: (id) => tasks.execute({ protocol_version: 1, operation: 'read', task_id: id }).ok,
      scopeWritable: createMaterialScopeWritable({
        task: (scope) => taskStore.materials.task(scope),
        tasks,
        catalog: baseCatalog,
      }),
      createTask(token, name) {
        const result = tasks.execute({
          protocol_version: 1,
          operation: 'create',
          request_id: randomUUID(),
          idempotency_key: token,
          title: name.replace(/\.(pdf|docx|png|jpe?g)$/i, '').slice(0, 200) || '材料分析',
          objective: '',
        });
        if (!result.ok) throw new Error('Cannot create material task');
        return result.tasks[0].id;
      },
    });
    registerMaterialIpc(materials, cameraPermission);
    const materialBatches = createMaterialBatchApplication({
      store: taskStore.materials,
      materials,
      id: randomUUID,
      taskExists: (id) => tasks.execute({ protocol_version: 1, operation: 'read', task_id: id }).ok,
      validatePath: validateMaterialBatchPath,
    });
    registerMaterialBatchIpc(materialBatches);
    app.on('will-quit', () => materials.close());
    // 合成材料联调不访问系统凭据；仅在已验证的临时演示目录启用。
    let materialDemoModel: import('@caselite/contracts').AgentModel = 'gpt-4.1-mini';
    const materialDemoKeys = new Set(['openai', 'deepseek']);
    const credentialUi = taskDemoPhase === 'credential-preflight-ui';
    let credentialHttpAttempts = 0;
    let credentialRuntimeAttempts = 0;
    let credentialRefreshes = 0;
    const credentialBefore = credentialUi ? credentialFingerprints(defaultCredentialRoot) : null;
    if (credentialUi)
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const http = /^https?:/i.test(details.url);
        if (http) credentialHttpAttempts++;
        callback({ cancel: http });
      });
    const credentialStartedAt = Date.now();
    const credentialStages: {
      stage: string;
      state: string;
      failure?: string;
      elapsedMs: number;
    }[] = [];
    const recordCredentialStage =
      taskDemoRoot &&
      (taskDemoPhase?.startsWith('agent') ||
        taskDemoPhase?.startsWith('real-agent') ||
        credentialUi)
        ? (stage: string, state: string, failure?: string) => {
            credentialStages.push({
              stage,
              state,
              ...(failure ? { failure } : {}),
              elapsedMs: Date.now() - credentialStartedAt,
            });
            writeFileSync(
              join(taskDemoEvidenceRoot ?? taskDemoRoot!, 'credential-initialization.json'),
              JSON.stringify(credentialStages, null, 2),
            );
          }
        : undefined;
    const customerDemo = taskDemoPhase?.startsWith('customer-');
    const financeDemo = taskDemoPhase?.startsWith('finance-');
    if (financeDemo) materialDemoKeys.clear();
    const documentReviewDemo =
      taskDemoPhase?.startsWith('document-review-') ||
      taskDemoPhase?.startsWith('editor-interaction-') ||
      taskDemoPhase?.startsWith('editor-scheme-') ||
      taskDemoPhase?.startsWith('export-style-');
    let initialCredentialRead = Promise.resolve();
    const openSystemCredentials = async (root: string) => {
      let settled!: () => void;
      initialCredentialRead = new Promise<void>((resolve) => {
        settled = resolve;
      });
      return createAgentCredentials(root, recordCredentialStage, {
        afterWindowReady: credentialWindowReady,
        onSettled: settled,
      });
    };
    const baseAgentCredentials =
      taskDemoPhase?.startsWith('legal-') ||
      performanceDemo ||
      documentReviewDemo ||
      customerDemo ||
      financeDemo ||
      taskDemoPhase?.startsWith('reminder') ||
      taskDemoPhase?.startsWith('project-') ||
      taskDemoPhase?.startsWith('materials') ||
      taskDemoPhase?.startsWith('important-date-') ||
      taskDemoPhase === 'real-agent-dry' ||
      taskDemoPhase === 'agent-preview' ||
      taskDemoPhase?.startsWith('agent-home-') ||
      taskDemoPhase === 'typography' ||
      taskDemoPhase === 'agent-crash-synthetic' ||
      taskDemoPhase === 'agent-read-synthetic'
        ? {
            get: (provider = 'openai') =>
              materialDemoKeys.has(provider) ? 'synthetic-material-demo-only' : undefined,
            set: async (_key: string, provider = 'openai') => {
              materialDemoKeys.add(provider);
            },
            clear: async (provider = 'openai') => {
              materialDemoKeys.delete(provider);
            },
            getDefaultModel: () =>
              taskDemoPhase === 'real-agent-dry' ? ('deepseek-flash' as const) : materialDemoModel,
            setDefaultModel: async (model: typeof materialDemoModel) => {
              materialDemoModel = model;
            },
          }
        : taskDemoPhase === 'real-agent' || credentialUi
          ? readOnlyDemoCredentials(await openSystemCredentials(defaultCredentialRoot))
          : await openSystemCredentials(taskRoot);
    const recordCredentialUi = () => {
      if (!credentialUi || !taskDemoRoot) return;
      const after = credentialFingerprints(defaultCredentialRoot);
      writeFileSync(
        join(taskDemoRoot, 'credential-ui-state.json'),
        JSON.stringify(
          {
            ...credentialStatus(baseAgentCredentials),
            before: credentialBefore,
            after,
            unchanged: JSON.stringify(credentialBefore) === JSON.stringify(after),
            refreshes: credentialRefreshes,
            runtimeAttempts: credentialRuntimeAttempts,
            providerDispatches: 0,
            httpAttempts: credentialHttpAttempts,
            defaultUserData: defaultCredentialRoot,
            isolatedUserData: taskRoot,
            elapsedMs: Date.now() - credentialStartedAt,
          },
          null,
          2,
        ),
      );
    };
    const agentCredentials = credentialUi
      ? {
          ...baseAgentCredentials,
          async refresh() {
            if (!baseAgentCredentials.refresh) throw new Error('Credential refresh unavailable');
            await baseAgentCredentials.refresh();
            credentialRefreshes++;
            recordCredentialUi();
          },
        }
      : baseAgentCredentials;
    if (customerDemo || taskDemoPhase === 'agent' || taskDemoPhase === 'materials')
      await agentCredentials.set('sk-synthetic-openai');
    let historyReady = true;
    try {
      taskStore.agentHistory.recoverInterrupted();
    } catch {
      historyReady = false;
    }

    const importantDates = createImportantDateApplication(
      {
        ...taskStore.dates,
        preview: (id, scope) => taskStore.materials.preview(id, scope),
        source: taskStore.materials.fixed,
        configuration: taskStore.materials.configuration,
      },
      async (binding) => {
        for (const s of binding.sources) {
          const r = await materials.execute({
            protocol_version: 1,
            operation: 'read_fixed',
            scope: binding.task_id,
            source_id: s.source_id,
            derivation_id: s.derivation_id,
            asset_version_id: s.asset_version_id,
            sha256: s.sha256,
          });
          if (!r.ok) throw Error('Original verification failed');
        }
      },
    );
    const agent = createAgentApplication({
      contact: { exists: (id) => contacts.exists(id) },
      dates: importantDates,
      credentials: agentCredentials,
      copyOutput: (text) => clipboard.writeText(text),
      resolveContext: materials.resolveContext,
      project: taskStore.catalog.agentProject,
      page: taskStore.agentPage,
      review: documentReviewStore(taskStore, tasks),
      history: {
        ...taskStore.agentHistory,
        load() {
          if (!historyReady) throw new Error('History unavailable');
          return taskStore.agentHistory.load();
        },
      },
      runtime:
        taskDemoRoot && taskDemoPhase?.startsWith('real-agent')
          ? createRealDemoRuntime({
              directory: taskDemoEvidenceRoot!,
              budgetDirectory: taskDemoRoot,
              resumeAudit: realResumeAudit,
              authorization: realDemoAuthorization,
              model: agentCredentials.getDefaultModel(),
              dry: taskDemoPhase === 'real-agent-dry',
              runs: () => taskStore.agentHistory.load(),
              verifySource(run) {
                const sources = taskStore.materials.list('home');
                const source = sources[0];
                const preview = run.context_id
                  ? taskStore.materials.preview(run.context_id, 'home')
                  : undefined;
                if (preview)
                  writeFileSync(
                    join(taskDemoEvidenceRoot!, 'selected-input.json'),
                    JSON.stringify(
                      { runId: run.id, contextId: run.context_id, source, preview },
                      null,
                      2,
                    ),
                  );
                const attachment = run.attachments?.[0];
                return (
                  sources.length === 1 &&
                  source.sha256 === realDemoPdfHash &&
                  source.page_count === 1 &&
                  source.pages.length === 1 &&
                  source.status === 'ready' &&
                  preview?.selections.length === 1 &&
                  preview.selections[0].source_id === source.id &&
                  preview.selections[0].derivation_id === source.derivation_id &&
                  preview.sha256 === createHash('sha256').update(preview.payload).digest('hex') &&
                  run.scope === 'home' &&
                  Boolean(run.context_id) &&
                  run.attachments?.length === 1 &&
                  attachment?.source_id === source.id &&
                  attachment.task_id === source.task_id &&
                  attachment.pages.length === 1 &&
                  attachment.pages[0] === 1
                );
              },
            })
          : createPiRuntime(
              customerDemo
                ? createSyntheticCustomerStream(taskDemoRoot!)
                : taskDemoPhase?.startsWith('important-date-')
                  ? syntheticImportantDateStream
                  : performanceDemo
                    ? syntheticAgentStream
                    : documentReviewDemo
                      ? syntheticReviewStream
                      : financeDemo ||
                          taskDemoPhase === 'typography' ||
                          credentialUi ||
                          taskDemoPhase?.startsWith('reminder') ||
                          (taskDemoPhase?.startsWith('project-') &&
                            taskDemoPhase !== 'project-agent-write') ||
                          taskDemoPhase === 'task-status-write' ||
                          taskDemoPhase === 'task-status-read' ||
                          taskDemoPhase === 'agent-read' ||
                          taskDemoPhase === 'agent-credential-read' ||
                          taskDemoPhase === 'agent-read-synthetic' ||
                          taskDemoPhase === 'materials-read'
                        ? () => {
                            if (credentialUi) {
                              credentialRuntimeAttempts++;
                              recordCredentialUi();
                            }
                            writeFileSync(
                              join(taskDemoRoot!, 'unexpected-runtime.txt'),
                              'unexpected dispatch',
                            );
                            throw new Error('Unexpected restart dispatch');
                          }
                        : taskDemoPhase === 'materials' ||
                            taskDemoPhase?.startsWith('materials-docx')
                          ? (model, context, options) => {
                              writeFileSync(
                                join(taskDemoRoot!, 'material-pi-context.json'),
                                JSON.stringify(context, null, 2),
                              );
                              return taskDemoPhase?.startsWith('materials-docx')
                                ? syntheticDocxStream(model, context, options)
                                : syntheticAgentStream(model, context, options);
                            }
                          : taskDemoPhase === 'project-agent-write' ||
                              taskDemoPhase?.startsWith('agent')
                            ? syntheticAgentStream
                            : undefined,
            ),
      taskExists: (id) => tasks.execute({ protocol_version: 1, operation: 'read', task_id: id }).ok,
    });
    registerAgentIpc(agent);
    if (performanceDemo && taskDemoRoot) {
      if (taskDemoPhase === 'performance-seed')
        seedPerformance(taskDemoRoot, tasks, catalog, contacts, finance);
      else await runPerformance(() => createWindow(), taskDemoRoot, taskDemoPhase!);
      agent.release();
      materials.close();
      taskStore.close();
      app.exit(0);
      return;
    }
    app.on('will-quit', () => agent.release());
    if (taskDemoRoot && taskDemoPhase?.startsWith('important-date-')) {
      session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: /^https?:/i.test(details.url) }),
      );
      if (taskDemoPhase === 'important-date-preview') {
        const window = await createWindow();
        window.setTitle('CaseLite · 合成重要日期 · MOCK_ONLY');
        return;
      }
      try {
        await runImportantDateDemo(
          () => createWindow(false),
          taskDemoRoot,
          taskDemoPhase,
          materials,
        );
        agent.release();
        materials.close();
        taskStore.close();
        app.exit(0);
      } catch {
        agent.release();
        materials.close();
        taskStore.close();
        app.exit(1);
      }
      return;
    }
    if (taskDemoRoot && taskDemoPhase === 'typography') {
      try {
        await runTypographyDemo(() => createWindow(false), taskDemoRoot, tasks);
      } finally {
        agent.release();
        materials.close();
        taskStore.close();
      }
      app.exit(0);
      return;
    }
    if (documentReviewDemo && taskDemoRoot) {
      session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: /^https?:/i.test(details.url) }),
      );
      app.on('will-quit', () => taskStore.close());
      if (
        taskDemoPhase !== 'document-review-read' &&
        taskDemoPhase !== 'editor-interaction-read' &&
        taskDemoPhase !== 'editor-scheme-read' &&
        taskDemoPhase !== 'export-style-read' &&
        taskDemoPhase !== 'export-style-preview'
      )
        seedDocumentReview(tasks);
      if (taskDemoPhase?.startsWith('export-style-')) {
        await runExportStyleDemo(() => createWindow(), taskDemoRoot, taskDemoPhase, tasks);
        if (taskDemoPhase !== 'export-style-preview') app.exit(0);
        return;
      }
      if (
        taskDemoPhase === 'document-review-preview' ||
        taskDemoPhase === 'editor-interaction-preview' ||
        taskDemoPhase === 'editor-scheme-preview'
      ) {
        const window = await createWindow();
        if (taskDemoPhase === 'editor-scheme-preview')
          window.setTitle('CaseLite · Markdown / Word 验收 · 合成资料');
      } else {
        await (
          taskDemoPhase?.startsWith('editor-scheme-')
            ? runEditorSchemeDemo
            : taskDemoPhase?.startsWith('editor-interaction-')
              ? runEditorInteractionDemo
              : runDocumentReviewDemo
        )(
          () => createWindow(false),
          taskDemoRoot,
          taskDemoPhase!,
          tasks,
          taskStore.agentHistory.load,
        );
        app.exit(0);
      }
      return;
    }
    if (credentialUi) {
      const window = await createWindow();
      await initialCredentialRead;
      recordCredentialUi();
      window.setTitle('CaseLite · 系统凭据重读验收');
      return;
    }
    if (taskDemoRoot && taskDemoPhase?.startsWith('reminder')) {
      await runReminderDemo(() => createWindow(), taskDemoRoot, taskDemoPhase);
      if (taskDemoPhase !== 'reminder-preview') app.exit(0);
      return;
    }
    if (taskDemoRoot && taskDemoPhase?.startsWith('real-agent')) {
      if (taskDemoPhase === 'real-agent-dry')
        session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
          callback({ cancel: /^https?:/i.test(details.url) }),
        );
      await runRealAgentDemo(
        () => createWindow(),
        taskDemoEvidenceRoot!,
        taskDemoPhase === 'real-agent-dry',
        taskDemoRoot,
        initialCredentialRead,
      );
      if (taskDemoPhase === 'real-agent-dry') app.exit(0);
      return;
    }
    if (
      taskDemoRoot &&
      (taskDemoPhase === 'task-status-write' || taskDemoPhase === 'task-status-read')
    ) {
      if (catalogQueryProbe) {
        await runCatalogQueryProbe(
          () => createWindow(),
          taskDemoRoot,
          tasks,
          catalog,
          catalogQueryProbe.counts,
        );
      } else if (taskQueryProbe) {
        await runTaskQueryProbe(() => createWindow(), taskDemoRoot, tasks, taskQueryProbe.counts);
      } else await runTaskStatusDemo(() => createWindow(), taskDemoRoot, taskDemoPhase);
      app.exit(0);
      return;
    }
    if (taskDemoPhase === 'agent-preview')
      session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: /^https?:/i.test(details.url) }),
      );
    if (taskDemoRoot && taskDemoPhase?.startsWith('materials')) {
      session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: /^https?:/i.test(details.url) }),
      );
      if (taskDemoPhase.startsWith('materials-batch')) {
        await runMaterialBatchDemo(
          () => createWindow(),
          taskDemoRoot,
          taskDemoPhase,
          materialBatches,
        );
        app.exit(0);
        return;
      }
      if (taskDemoPhase.startsWith('materials-docx')) {
        // 测试包在宿主系统网络隔离下运行，不能只靠 Chromium 拦截。
        const denied = await new Promise<boolean>((resolve) => {
          const socket = createConnection({ host: '127.0.0.1', port: 9 });
          socket.once('error', (error: NodeJS.ErrnoException) => {
            resolve(error.code === 'EPERM' || error.code === 'EACCES');
          });
          socket.once('connect', () => {
            socket.destroy();
            resolve(false);
          });
          socket.setTimeout(1500, () => {
            socket.destroy();
            resolve(false);
          });
        });
        if (!denied) throw new Error('DOCX demo requires OS network isolation');
        writeFileSync(
          join(taskDemoRoot, 'network-' + taskDemoPhase + '.json'),
          JSON.stringify({ loopbackTCP: 'OS_DENIED', chromiumOffline: true }),
        );
        session.defaultSession.enableNetworkEmulation({ offline: true });
        if (taskDemoPhase === 'materials-docx-preview') {
          await createWindow();
          return;
        }
      }
      await runMaterialDemo(() => createWindow(), taskDemoRoot, taskDemoPhase);
      app.exit(0);
      return;
    }
    if (
      taskDemoRoot &&
      [
        'agent-crash',
        'agent-read',
        'agent-credential-read',
        'agent-crash-synthetic',
        'agent-read-synthetic',
      ].includes(taskDemoPhase ?? '')
    ) {
      await runAgentHistoryProbe(
        () => createWindow(),
        taskDemoRoot,
        taskDemoPhase!.startsWith('agent-crash') ? 'agent-crash' : taskDemoPhase!,
      );
      app.exit(0);
      return;
    }
    if (taskDemoRoot && taskDemoPhase === 'agent') {
      await runAgentDemo(() => createWindow(), taskDemoRoot);
      app.exit(0);
      return;
    }
    if (taskDemoRoot && taskDemoPhase?.startsWith('agent-home-')) {
      await runHomeContextDemo(() => createWindow(), taskDemoRoot, taskDemoPhase);
      app.exit(0);
      return;
    }
    if (
      taskDemoRoot &&
      (taskDemoPhase === 'appearance-write' || taskDemoPhase === 'appearance-read')
    ) {
      await runAppearanceDemo(() => createWindow(), taskDemoRoot, taskDemoPhase);
      app.exit(0);
      return;
    }
    app.on('will-quit', () => taskStore.close());
    if (taskDemoRoot && taskDemoPhase === 'legal-workbench') {
      session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: /^https?:/i.test(details.url) }),
      );
      const window = await createWindow();
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        ready = await window.webContents.executeJavaScript(
          "!!window.caselite && !window.caseliteLegal && !!document.querySelector('.workbench') && ['grid', 'flex'].includes(getComputedStyle(document.querySelector('.workbench')).display) && document.body.textContent.includes('首页') && !document.body.textContent.includes('正在读取本地任务')",
        );
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error('Workbench did not open after legal acceptance');
      const response = await window.webContents.executeJavaScript(
        "window.caselite.task({ protocol_version: 1, operation: 'list' })",
      );
      if (!response.ok) throw new Error('Workbench business IPC failed after acceptance');
      writeFileSync(
        join(taskDemoRoot, 'legal-workbench.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      writeFileSync(
        join(taskDemoRoot, 'legal-workbench.json'),
        JSON.stringify({
          accepted: true,
          workbenchVisible: ready,
          taskQueryOk: response.ok,
          businessDatabaseCreated: existsSync(join(taskRoot, 'caselite.sqlite')),
        }),
      );
      app.quit();
      return;
    }
    if (
      taskDemoRoot &&
      (taskDemoPhase === 'customer-write' ||
        taskDemoPhase === 'customer-read' ||
        taskDemoPhase === 'customer-preview')
    ) {
      await runCustomerDemo(createWindow, taskDemoRoot, taskDemoPhase);
      if (taskDemoPhase !== 'customer-preview') app.quit();
      return;
    }
    if (
      taskDemoRoot &&
      (taskDemoPhase === 'finance-write' ||
        taskDemoPhase === 'finance-reverse' ||
        taskDemoPhase === 'finance-read' ||
        taskDemoPhase === 'finance-preview')
    ) {
      await runFinanceDemo(createWindow, taskDemoRoot, taskDemoPhase);
      if (taskDemoPhase !== 'finance-preview') app.quit();
      return;
    }
    if (
      taskDemoRoot &&
      (taskDemoPhase === 'project-agent-write' ||
        taskDemoPhase === 'project-agent-read' ||
        taskDemoPhase === 'project-write' ||
        taskDemoPhase === 'project-read' ||
        taskDemoPhase === 'project-edit' ||
        taskDemoPhase === 'project-restore' ||
        taskDemoPhase === 'project-promote' ||
        taskDemoPhase === 'project-files' ||
        taskDemoPhase === 'project-files-read' ||
        taskDemoPhase === 'project-activity' ||
        taskDemoPhase === 'project-activity-read' ||
        taskDemoPhase === 'project-promote-read')
    ) {
      await runProjectDemo(
        () => createWindow(process.env.CASELITE_PROJECT_DEMO_BACKGROUND !== '1'),
        taskDemoRoot,
        taskDemoPhase,
      );
      app.exit(0);
      return;
    }
    if (
      taskDemoRoot &&
      taskDemoPhase &&
      taskDemoPhase !== 'preview' &&
      taskDemoPhase !== 'legal-preview' &&
      taskDemoPhase !== 'agent-preview'
    ) {
      await runTaskDemo(() => createWindow(), taskDemoRoot, taskDemoPhase);
      app.exit(0);
      return;
    }

    if (taskDemoPhase === 'preview') {
      session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: /^https?:/i.test(details.url) }),
      );
    }
    app.on('activate', () => {
      if (
        !BrowserWindow.getAllWindows().some((window) =>
          window.webContents.getURL().startsWith(MAIN_WINDOW_WEBPACK_ENTRY),
        )
      ) {
        void createWindow().catch(reportStartupFailure);
      }
    });

    await createWindow();
  })
  .catch((error: unknown) => {
    if (taskDemoRoot)
      writeFileSync(join(taskDemoEvidenceRoot ?? taskDemoRoot, 'diagnostic.txt'), String(error));
    if (
      process.env.CASELITE_DB_PROBE === '1' ||
      process.env.CASELITE_PDF_PROBE === '1' ||
      process.env.CASELITE_INTEGRATION_PHASE ||
      process.env.CASELITE_TASK_DEMO
    ) {
      process.stderr.write('CaseLite packaged probe failed.\n');
      app.exit(1);
      return;
    }
    reportStartupFailure();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !startingProductWindow) app.quit();
});
