import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = {
  forge: 'apps/desktop/forge.config.mjs',
  html: 'apps/desktop/src/renderer/index.html',
  main: 'apps/desktop/src/main/index.ts',
  preload: 'apps/desktop/src/preload/index.ts',
};

const requiredFragments = {
  [files.forge]: [
    'FuseV1Options.RunAsNode]: false',
    'FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false',
    'FuseV1Options.EnableNodeCliInspectArguments]: false',
    'FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true',
    'FuseV1Options.OnlyLoadAppFromAsar]: true',
    "default-src 'none'",
    "connect-src 'none'",
  ],
  [files.html]: ["default-src 'none'", "connect-src 'none'", "script-src 'self'"],
  [files.main]: [
    'contextIsolation: true',
    'sandbox: true',
    'nodeIntegration: false',
    'webSecurity: true',
    'webviewTag: false',
    "setWindowOpenHandler(() => ({ action: 'deny' }))",
    "'will-navigate'",
    "'will-redirect'",
    "'will-attach-webview'",
    'setPermissionRequestHandler',
    'setPermissionCheckHandler',
    "'will-download'",
  ],
  [files.preload]: ['contextBridge.exposeInMainWorld', "'caselite'"],
};

const violations = [];
for (const [file, fragments] of Object.entries(requiredFragments)) {
  const source = readFileSync(resolve(repositoryRoot, file), 'utf8');
  for (const fragment of fragments) {
    if (!source.includes(fragment)) violations.push(`${file}: missing ${fragment}`);
  }
}

const preloadSource = readFileSync(resolve(repositoryRoot, files.preload), 'utf8');
if (preloadSource.includes("contextBridge.exposeInMainWorld('ipcRenderer'")) {
  violations.push(`${files.preload}: must not expose generic ipcRenderer`);
}

if (violations.length > 0) {
  console.error('Electron security baseline check failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    'Electron security baseline check passed: isolation, Fuses, CSP, navigation and permissions are fail-closed.',
  );
}
