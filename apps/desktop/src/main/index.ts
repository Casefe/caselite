import { runFinanceDemo } from './finance-demo';
import { runReminderDemo } from './reminder-demo';
import { startReminderScheduler } from './adapters/reminder-scheduler';
import { createReminderApplication } from '@caselite/application';
import { registerReminderIpc } from './ipc/register-task-ipc';
import { createRealDemoRuntime, runRealAgentDemo } from './agent-real-demo';
import {
  realDemoId,
  realDemoPdfHash,
  realDemoResumeId,
  inspectZeroDispatchResume,
} from './agent-real-policy';
import { runMaterialDemo } from './material-demo';
import { createMaterialApplication } from '@caselite/application';
import { createMaterialFiles } from './adapters/material-files';
import { createPdfProcessor } from './adapters/pdf-processor';
import { registerMaterialIpc } from './ipc/register-material-ipc';
import { runTaskDemo } from './task-demo';
import { runProjectDemo } from './project-demo';
import { createTaskQueryProbe, runTaskQueryProbe } from './task-query-probe';
import { runTaskStatusDemo } from './task-status-demo';
import { runAppearanceDemo } from './appearance-demo';
import {
  runAgentDemo,
  runAgentHistoryProbe,
  syntheticAgentStream,
  syntheticReviewStream,
} from './agent-demo';
import { runDocumentReviewDemo, seedDocumentReview } from './document-review-demo';
import { documentReviewStore } from './document-review-store';
import { createCatalogApplication, createFinanceApplication } from '@caselite/application';
import { createAppearanceApplication } from '@caselite/application';
import { createAppearancePreferences } from './adapters/appearance-preferences';
import { registerAppearanceIpc } from './ipc/register-appearance-ipc';
import { createAgentApplication } from '@caselite/application';
import { createPiRuntime } from './adapters/pi-runtime';
import {
  runCredentialPreflight,
  readOnlyDemoCredentials,
  credentialFingerprints,
  credentialStatus,
} from './credential-preflight';
import { createAgentCredentials } from './adapters/agent-credentials';
import { registerAgentIpc } from './ipc/register-agent-ipc';
import { registerCatalogIpc, registerFinanceIpc, registerTaskIpc } from './ipc/register-task-ipc';
import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, session } from 'electron';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

import {
  createOfflineProbeApplication,
  createSpikeApplication,
  createTaskApplication,
} from '@caselite/application';
import {
  openOfflineProbePort,
  openToolchainProbe,
  toolchainProbe,
  openTaskStore,
} from '@caselite/local-db';

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
  if (
    process.env.CASELITE_TASK_DEMO === 'agent-preview' ||
    process.env.CASELITE_TASK_DEMO?.startsWith('project-agent-') ||
    process.env.CASELITE_TASK_DEMO?.startsWith('document-review-')
  )
    entry.searchParams.set('mock-agent', '1');
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
      result.value?.migration_count !== 16
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
let taskDemoRoot: string | undefined;
let taskDemoEvidenceRoot: string | undefined;
let realResumeAudit: ReturnType<typeof inspectZeroDispatchResume> | undefined;
const taskDemoPhase = process.env.CASELITE_TASK_DEMO;
if (taskDemoPhase) {
  if (
    ![
      'document-review-preview',
      'document-review-write',
      'document-review-read',
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
      'crash',
      'preview',
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
      'agent-crash',
      'agent-read',
      'agent-credential-read',
      'agent-crash-synthetic',
      'agent-read-synthetic',
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
  if (
    taskDemoPhase === 'real-agent' &&
    (candidate !== join(realpathSync(tmpdir()), 'caselite-task-demo-dev1650-real-20261106') ||
      process.env.CASELITE_REAL_AGENT_APPROVAL !== realDemoId)
  )
    throw new Error('Real validation requires the fixed approved run');
  taskDemoRoot = candidate;
  taskDemoEvidenceRoot = candidate;
  const resume = process.env.CASELITE_REAL_AGENT_RESUME;
  if (
    resume !== undefined &&
    (resume !== realDemoResumeId || !taskDemoPhase.startsWith('real-agent'))
  )
    throw new Error('Invalid resume mode');
  if (taskDemoPhase === 'real-agent' && !resume)
    throw new Error('Real validation requires reviewed zero-dispatch resume');
  if (resume) {
    realResumeAudit = inspectZeroDispatchResume(candidate, taskDemoPhase === 'real-agent-dry');
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
    if (taskDemoRoot && taskDemoPhase === 'credential-preflight') {
      // 只读正式凭据；在任何工作区/Runtime初始化前退出，不消费1650费用账本。
      const result = await runCredentialPreflight(defaultCredentialRoot, taskDemoRoot);
      app.exit(result.configured ? 0 : 2);
      return;
    }
    registerIpcSpike();
    const taskRoot = app.getPath('userData');
    mkdirSync(taskRoot, { recursive: true });
    registerAppearanceIpc(createAppearanceApplication(createAppearancePreferences(taskRoot)));
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
    const tasks = createTaskApplication(taskStore);
    const taskQueryProbe =
      taskDemoRoot &&
      taskDemoPhase === 'task-status-write' &&
      process.env.CASELITE_TASK_QUERY_PROBE === '1'
        ? createTaskQueryProbe(tasks)
        : undefined;
    registerTaskIpc(taskQueryProbe?.application ?? tasks);
    const reminders = createReminderApplication(taskStore.reminders);
    const reminderScheduler = startReminderScheduler(
      reminders,
      createHash('sha256').update(taskRoot).digest('hex').slice(0, 24),
    );
    registerReminderIpc(reminders, reminderScheduler.tick);
    app.on('will-quit', reminderScheduler.stop);
    registerCatalogIpc(createCatalogApplication(taskStore.catalog));
    registerFinanceIpc(createFinanceApplication(taskStore.finance));
    const materials = createMaterialApplication({
      store: taskStore.materials,
      files: createMaterialFiles(join(taskRoot, 'materials')),
      processor: createPdfProcessor(),
      id: randomUUID,
      hash: (text) => createHash('sha256').update(text).digest('hex'),
      taskExists: (id) => tasks.execute({ protocol_version: 1, operation: 'read', task_id: id }).ok,
      createTask(token, name) {
        const result = tasks.execute({
          protocol_version: 1,
          operation: 'create',
          request_id: randomUUID(),
          idempotency_key: token,
          title: name.replace(/\.pdf$/i, '').slice(0, 200) || '材料分析',
          objective: '',
        });
        if (!result.ok) throw new Error('Cannot create material task');
        return result.tasks[0].id;
      },
    });
    registerMaterialIpc(materials);
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
    const financeDemo = taskDemoPhase?.startsWith('finance-');
    if (financeDemo) materialDemoKeys.clear();
    const documentReviewDemo = taskDemoPhase?.startsWith('document-review-');
    const baseAgentCredentials =
      documentReviewDemo ||
      financeDemo ||
      taskDemoPhase?.startsWith('reminder') ||
      taskDemoPhase?.startsWith('project-') ||
      taskDemoPhase?.startsWith('materials') ||
      taskDemoPhase === 'real-agent-dry' ||
      taskDemoPhase === 'agent-preview' ||
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
          ? readOnlyDemoCredentials(
              await createAgentCredentials(defaultCredentialRoot, recordCredentialStage),
            )
          : await createAgentCredentials(taskRoot, recordCredentialStage);
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
    if (taskDemoPhase === 'agent' || taskDemoPhase === 'materials')
      await agentCredentials.set('sk-synthetic-openai');
    let historyReady = true;
    try {
      taskStore.agentHistory.recoverInterrupted();
    } catch {
      historyReady = false;
    }

    const agent = createAgentApplication({
      credentials: agentCredentials,
      copyOutput: (text) => clipboard.writeText(text),
      resolveContext: materials.resolveContext,
      project: taskStore.catalog.agentProject,
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
              documentReviewDemo
                ? syntheticReviewStream
                : financeDemo ||
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
                  : taskDemoPhase === 'materials'
                    ? (model, context, options) => {
                        writeFileSync(
                          join(taskDemoRoot!, 'material-pi-context.json'),
                          JSON.stringify(context, null, 2),
                        );
                        return syntheticAgentStream(model, context, options);
                      }
                    : taskDemoPhase === 'project-agent-write' || taskDemoPhase?.startsWith('agent')
                      ? syntheticAgentStream
                      : undefined,
            ),
      taskExists: (id) => tasks.execute({ protocol_version: 1, operation: 'read', task_id: id }).ok,
    });
    registerAgentIpc(agent);
    app.on('will-quit', () => agent.release());
    if (documentReviewDemo && taskDemoRoot) {
      session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: /^https?:/i.test(details.url) }),
      );
      app.on('will-quit', () => taskStore.close());
      if (taskDemoPhase !== 'document-review-read') seedDocumentReview(tasks);
      if (taskDemoPhase === 'document-review-preview') {
        await createWindow();
      } else {
        await runDocumentReviewDemo(
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
      recordCredentialUi();
      const window = await createWindow();
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
      );
      if (taskDemoPhase === 'real-agent-dry') app.exit(0);
      return;
    }
    if (
      taskDemoRoot &&
      (taskDemoPhase === 'task-status-write' || taskDemoPhase === 'task-status-read')
    ) {
      if (taskQueryProbe) {
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
    if (
      taskDemoRoot &&
      (taskDemoPhase === 'appearance-write' || taskDemoPhase === 'appearance-read')
    ) {
      await runAppearanceDemo(() => createWindow(), taskDemoRoot, taskDemoPhase);
      app.exit(0);
      return;
    }
    app.on('will-quit', () => taskStore.close());
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
  if (process.platform !== 'darwin') app.quit();
});
