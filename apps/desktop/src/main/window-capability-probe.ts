import { BrowserWindow } from 'electron';
import { registerTaskIpc } from './ipc/register-task-ipc';
import { registerDesktopWindowCapabilities } from './ipc/window-capabilities';

// 仅由已验证隔离目录的离线工程入口调用；合成Application不接业务库/凭据/Provider。
export async function runWindowCapabilityProbe(trusted: BrowserWindow) {
  const started = Date.now();
  const checkpoint = (stage: string) =>
    process.stdout.write(`CaseLite window capability ${stage}: ${Date.now() - started}ms.\n`);
  let calls = 0;
  registerTaskIpc({
    execute() {
      calls++;
      return { ok: true, tasks: [], state: null, receipt: null };
    },
  });
  const createAuxiliary = () => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-redirect', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    return window;
  };
  let other = createAuxiliary();
  const entry = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
  entry.searchParams.set('engineering', '1');
  const invoke = (window: BrowserWindow) =>
    window.webContents.executeJavaScript(
      "window.caselite.task({ protocol_version: 1, operation: 'list' })",
    ) as Promise<{ ok: boolean; code?: string }>;
  try {
    // 故意使用同一入口和桥接，验证辅助窗即使误配preload仍会被Main拒绝。
    await other.loadURL(entry.toString());
    checkpoint('auxiliary-loaded');
    if ((await invoke(other)).code !== 'FORBIDDEN' || calls !== 0)
      throw new Error('Unregistered window reached business application');
    const revoke = registerDesktopWindowCapabilities(other, 'consent', MAIN_WINDOW_WEBPACK_ENTRY);
    if ((await invoke(other)).code !== 'FORBIDDEN' || calls !== 0)
      throw new Error('Consent window reached business application');
    revoke();
    if (!(await invoke(trusted)).ok || Number(calls) !== 1)
      throw new Error('Workbench business access failed');
    checkpoint('roles-checked');
    const loaded = new Promise<void>((resolve) =>
      trusted.webContents.once('did-finish-load', () => resolve()),
    );
    trusted.webContents.reload();
    await loaded;
    if (!(await invoke(trusted)).ok || Number(calls) !== 2)
      throw new Error('Workbench reload lost business access');
    checkpoint('reload-checked');
    registerDesktopWindowCapabilities(other, 'workbench', MAIN_WINDOW_WEBPACK_ENTRY);
    if (!(await invoke(other)).ok || Number(calls) !== 3)
      throw new Error('Host registration did not grant business access');
    // 宿主导航离开固定入口后，回到同一URL也不能自动恢复已经撤销的能力。
    await other.loadURL('about:blank');
    await other.loadURL(entry.toString());
    if ((await invoke(other)).code !== 'FORBIDDEN' || Number(calls) !== 3)
      throw new Error('Navigation restored revoked business access');
    checkpoint('navigation-checked');
    other.destroy();
    other = createAuxiliary();
    await other.loadURL(entry.toString());
    if ((await invoke(other)).code !== 'FORBIDDEN' || Number(calls) !== 3)
      throw new Error('Replacement window inherited business access');
    registerDesktopWindowCapabilities(other, 'workbench', MAIN_WINDOW_WEBPACK_ENTRY);
    if (!(await invoke(other)).ok || Number(calls) !== 4)
      throw new Error('Replacement registration failed');
    checkpoint('replacement-checked');
    process.stdout.write(
      'CaseLite window capability probe passed: auxiliary denied, consent denied, navigation revoked, replacement denied until registered, workbench and reload accepted; Provider0.\n',
    );
  } finally {
    if (!other.isDestroyed()) other.destroy();
  }
}
