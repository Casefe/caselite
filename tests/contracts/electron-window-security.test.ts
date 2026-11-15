import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeElectronSources,
  checkElectronSecurity,
} from '../../scripts/check-electron-security.mjs';

const file = 'apps/desktop/src/main/synthetic-window.ts';
const safe = `import { BrowserWindow } from 'electron';
const window = new BrowserWindow({webPreferences: {
  contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false,
}});
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('will-navigate', (event) => event.preventDefault());
window.webContents.on('will-redirect', (event) => event.preventDefault());
window.webContents.on('will-attach-webview', (event) => event.preventDefault());`;
const analyze = (source: string, name = file) => analyzeElectronSources([{ file: name, source }]);
const ipc = (body: string) => `import { ipcMain } from 'electron';
import { isTrustedBusinessSender } from './ipc/window-capabilities';
ipcMain.handle('synthetic', (event, input) => { ${body} });`;

describe('production Electron window security gate', () => {
  it('passes current production consumers and exposes bounded manual coverage', () => {
    const report = checkElectronSecurity();
    expect(report.violations).toEqual([]);
    expect(
      report.inventory.filter((entry: { kind: string }) => entry.kind === 'BrowserWindow'),
    ).toHaveLength(4);
    expect(report.inventory.some((entry: { kind: string }) => entry.kind === 'IPC-handle')).toBe(
      true,
    );
    expect(report.manualReview.join('\n')).toMatch(/injected isTrustedSender/);
    expect(report.manualReview.join('\n')).toMatch(/runtime preferences/);
    expect(report.manualReview.join('\n')).toMatch(/engineering\/demo/);
  });

  it('uses actual property values, including duplicate overrides, rather than safe strings', () => {
    expect(analyze(safe).violations).toEqual([]);
    for (const [key, good, bad] of [
      ['contextIsolation', 'true', 'false'],
      ['sandbox', 'true', 'false'],
      ['nodeIntegration', 'false', 'true'],
      ['webSecurity', 'true', 'false'],
      ['webviewTag', 'false', 'true'],
    ]) {
      const changed = safe.replace(`${key}: ${good}`, `${key}: ${bad}`) + `\n// ${key}: ${good}`;
      expect(analyze(changed).violations.join('\n'), key).toContain(`webPreferences.${key}`);
      expect(
        analyze(
          safe.replace('webviewTag: false,', `webviewTag: false, ${key}: ${bad},`),
        ).violations.join('\n'),
        key,
      ).toContain(`webPreferences.${key}`);
    }
  });

  it('blocks missing, computed, spread and factory-derived preferences conservatively', () => {
    for (const source of [
      safe.replace('sandbox: true,', ''),
      safe.replace('sandbox: true', 'sandbox: policy()'),
      safe.replace('sandbox: true', "['sandbox']: true"),
      safe.replace('sandbox: true', '...policy'),
      safe
        .replace('webPreferences: {', '...factory(), webPreferences: {')
        .replace('}});', '}, ...factory()});'),
      `import { BrowserWindow } from 'electron'; new BrowserWindow(factory());`,
    ])
      expect(analyze(source).violations.length).toBeGreaterThan(0);
  });

  it('finds aliased and namespace Electron constructors but ignores comment decoys', () => {
    expect(
      analyze(
        safe
          .replace('BrowserWindow }', 'BrowserWindow as Window }')
          .replace('new BrowserWindow', 'new Window'),
      ).violations,
    ).toEqual([]);
    expect(
      analyze(
        safe
          .replace(
            "import { BrowserWindow } from 'electron';",
            "import * as electron from 'electron';",
          )
          .replace('new BrowserWindow', 'new electron.BrowserWindow'),
      ).violations,
    ).toEqual([]);
    expect(analyze('// new BrowserWindow({nodeIntegration: true});').inventory).toEqual([]);
    expect(
      analyze(
        safe.replace('sandbox: true', 'sandbox: false'),
        'apps/desktop/src/main/new-demo.ts',
      ).violations.join('\n'),
    ).toContain('webPreferences.sandbox');
  });

  it('rejects new preload consumers, paths and dynamic production preload substitutions', () => {
    expect(
      analyze(
        safe.replace(
          'contextIsolation: true,',
          "preload: '/tmp/arbitrary.js', contextIsolation: true,",
        ),
      ).violations.join('\n'),
    ).toContain('unapproved preload');
    const main = 'apps/desktop/src/main/index.ts';
    expect(analyze(safe, main).violations.join('\n')).toContain('preload missing or dynamic');
    expect(
      analyze(
        safe.replace(
          'contextIsolation: true,',
          'preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY, contextIsolation: true,',
        ),
        main,
      ).violations,
    ).toEqual([]);
    expect(
      analyze(
        safe.replace('contextIsolation: true,', 'preload: factory(), contextIsolation: true,'),
        main,
      ).violations.join('\n'),
    ).toContain('preload');
  });

  it('requires executable unconditional navigation and popup denial for that window', () => {
    for (const source of [
      safe.replace(
        'window.webContents.setWindowOpenHandler',
        "window.loadURL('synthetic://entry'); window.webContents.setWindowOpenHandler",
      ),
      safe.replace("action: 'deny'", "action: 'allow'"),
      safe.replace("action: 'deny'", 'action: deny'),
      safe
        .replace('() => ({ action:', '() => ({ ...policy, action:')
        .replace("'deny' }))", "'deny', ...policy }))"),
      safe.replace(
        '(event) => event.preventDefault()',
        '(event) => allowed && event.preventDefault()',
      ),
      safe.replace("window.webContents.on('will-redirect'", "other.webContents.on('will-redirect'"),
      safe.replace(
        "window.webContents.on('will-redirect', (event) => event.preventDefault());",
        "// window.webContents.on('will-redirect', (event) => event.preventDefault());",
      ),
    ])
      expect(analyze(source).violations.length).toBeGreaterThan(0);
  });

  it('checks the effective popup handler in registration order and rejects later relaxation', () => {
    const register = (action: string) =>
      `window.webContents.setWindowOpenHandler(() => ({ action: ${action} }));`;
    const deny = register("'deny'");
    const allow = register("'allow'");
    const load = "window.loadURL('synthetic://entry');";
    for (const update of [
      allow,
      register('policy'),
      'window.webContents.setWindowOpenHandler(factory());',
    ]) {
      expect(
        analyze(safe.replace(deny, `${deny}\n${update}`) + `\n${load}`).violations.join('\n'),
      ).toContain('effective deny-only');
    }
    expect(analyze(safe.replace(deny, `${allow}\n${deny}`) + `\n${load}`).violations).toEqual([]);
    expect(analyze(safe.replace(deny, `${deny}\n${deny}`) + `\n${load}`).violations).toEqual([]);
    expect(analyze(safe + `\n${load}\n${allow}`).violations.join('\n')).toContain(
      'effective deny-only',
    );
    expect(analyze(safe + `\n${load}\n${deny}`).violations).toEqual([]);
    expect(analyze(safe.replace(deny, '') + `\n${load}\n${deny}`).violations.join('\n')).toContain(
      'effective deny-only',
    );
  });

  it('rejects explicit blanket Session permission/resource grants and permission resets', () => {
    for (const source of [
      'session.setPermissionRequestHandler((_web, _permission, callback) => callback(true));',
      'session.setPermissionCheckHandler(() => true);',
      'session.setPermissionRequestHandler((_w,_p,callback) => { callback(true); });',
      'session.webRequest.onBeforeRequest({urls: ["*://*/*"]}, (details, callback) => { callback({cancel: false}); });',
      'session.setPermissionRequestHandler(null);',
      'session.setPermissionCheckHandler(null);',
      'session.webRequest.onBeforeRequest((details, callback) => callback({cancel: false}));',
    ])
      expect(analyze(source).violations.length).toBeGreaterThan(0);
    expect(
      analyze(
        'session.setPermissionCheckHandler(() => false); session.setPermissionRequestHandler((_w,_p,callback) => callback(false));',
      ).violations,
    ).toEqual([]);
    expect(analyze('session.webRequest.onBeforeRequest(null);').violations).toEqual([]);
    const conditional = analyze('session.setPermissionCheckHandler(() => policy());');
    expect(conditional.manualReview.join('\n')).toContain('conditional session policy');
  });

  it('rejects missing, decoy, conditional, late and non-returning IPC sender guards', () => {
    expect(
      analyze(
        ipc(
          'if (!isTrustedBusinessSender(event)) return denied; return application.execute(input);',
        ),
      ).violations,
    ).toEqual([]);
    expect(
      analyze(
        ipc(
          'if (!isTrustedBusinessSender(event)) return denied; return application.execute(input);',
        ).replace('(event, input)', '(event, input, isTrustedBusinessSender)'),
      ).violations.join('\n'),
    ).toContain('IPC first statement');
    expect(
      analyze(
        ipc(
          'if (!isTrustedBusinessSender(event)) return denied; return application.execute(input);',
        ).replace('./ipc/window-capabilities', './fake/window-capabilities'),
      ).violations.join('\n'),
    ).toContain('IPC first statement');
    for (const body of [
      'return application.execute(input); // isTrustedBusinessSender(event)',
      'if (isTrustedBusinessSender(event)) log(); return application.execute(input);',
      'if (!isTrustedBusinessSender(event)) log(); return application.execute(input);',
      'if (enabled && !isTrustedBusinessSender(event)) return denied; return application.execute(input);',
      'application.execute(input); if (!isTrustedBusinessSender(event)) return denied;',
      'if (!isTrustedBusinessSender(other)) return denied; return application.execute(input);',
      '',
    ])
      expect(analyze(ipc(body)).violations.join('\n')).toContain('IPC first statement');
  });

  it('rejects generic ipcRenderer exposure independently of formatting', () => {
    for (const source of [
      `import {contextBridge, ipcRenderer} from 'electron'; contextBridge.exposeInMainWorld( 'raw', ipcRenderer );`,
      `import {contextBridge, ipcRenderer as raw} from 'electron'; contextBridge['exposeInMainWorld']('raw', raw);`,
      `contextBridge.exposeInMainWorld(\n'ipcRenderer', anything);`,
    ])
      expect(analyze(source).violations.join('\n')).toContain('generic ipcRenderer exposure');
  });

  it('scans new nested production files while preserving the original low-cost baseline', () => {
    const root = mkdtempSync(join(tmpdir(), 'caselite-electron-security-'));
    const put = (name: string, body: string) => {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), body);
    };
    try {
      for (const name of [
        'apps/desktop/forge.config.mjs',
        'apps/desktop/src/renderer/index.html',
        'apps/desktop/src/main/index.ts',
        'apps/desktop/src/preload/index.ts',
      ])
        put(name, readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8'));
      expect(checkElectronSecurity(root).violations).toEqual([]);
      put(file, safe.replace('sandbox: true', 'sandbox: false'));
      expect(checkElectronSecurity(root).violations.join('\n')).toContain('webPreferences.sandbox');
      put(file, safe);
      expect(checkElectronSecurity(root).violations).toEqual([]);
      put('apps/desktop/src/renderer/index.html', '<!-- no CSP -->');
      expect(checkElectronSecurity(root).violations.join('\n')).toContain('missing default-src');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
