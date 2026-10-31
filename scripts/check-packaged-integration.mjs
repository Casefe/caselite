import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('Packaged integration test requires macOS Apple Silicon');
}

const root = resolve(import.meta.dirname, '..');
const appContents = join(root, 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents');
const executable = join(appContents, 'MacOS/CaseLite');
const nativeModule = join(
  appContents,
  'Resources/app.asar.unpacked/.webpack/main/native_modules/prebuilds/darwin-arm64.node',
);
const migration = join(appContents, 'Resources/migrations/0000_peaceful_hercules.sql');
for (const file of [executable, nativeModule, migration]) {
  if (!existsSync(file)) throw new Error('Packaged integration prerequisite is missing');
}

const packageJson = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const desktop = packageJson('apps/desktop/package.json');
const localDb = packageJson('packages/local-db/package.json');
const lockHash = createHash('sha256')
  .update(readFileSync(join(root, 'pnpm-lock.yaml')))
  .digest('hex');
const evidence = {
  issue: 'DEV-1566',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  lockfileSha256: lockHash,
  versions: {
    electron: desktop.devDependencies.electron,
    forge: desktop.devDependencies['@electron-forge/cli'],
    react: desktop.dependencies.react,
    reactPdf: desktop.dependencies['react-pdf'],
    pdfjs: desktop.dependencies['pdfjs-dist'],
    drizzle: localDb.dependencies['drizzle-orm'],
    sqlite: localDb.dependencies['better-sqlite3'],
  },
  network:
    'All HTTP(S) requests are canceled inside the packaged Electron test session; physical network disconnection is not asserted.',
  phases: [],
  unverified: ['OS-level network disconnection and native installer/signature are manual checks.'],
};

const temporaryRoot = mkdtempSync(join(tmpdir(), 'caselite-integration-'));
mkdirSync(join(temporaryRoot, '中文 路径'));
let passed = false;
try {
  // The last restart uses a copy of the identical package under a Unicode
  // and space-bearing resource path; it is not a second build.
  const relocatedApp = join(temporaryRoot, '中文 应用');
  mkdirSync(relocatedApp);
  const relocatedBundle = join(relocatedApp, 'CaseLite.app');
  // macOS application bundles contain relative framework symlinks. Node's
  // cpSync rewrites them as absolute links into the original bundle.
  execFileSync('ditto', [join(appContents, '..'), relocatedBundle]);
  const frameworkLink = join(
    relocatedBundle,
    'Contents/Frameworks/Electron Framework.framework/Versions/Current',
  );
  if (!realpathSync(frameworkLink).startsWith(`${realpathSync(relocatedBundle)}${sep}`)) {
    throw new Error('Copied application framework link escapes the relocated bundle');
  }
  const relocatedExecutable = join(relocatedApp, 'CaseLite.app/Contents/MacOS/CaseLite');
  for (const [phase, binary, workerFault] of [
    ['write', executable, undefined],
    ['read', executable, undefined],
    ['read', relocatedExecutable, undefined],
    ['read', relocatedExecutable, 'missing'],
    ['read', relocatedExecutable, 'mismatch'],
  ]) {
    const result = spawnSync(binary, [], {
      cwd: root,
      env: {
        ...process.env,
        CASELITE_INTEGRATION_PHASE: phase,
        CASELITE_INTEGRATION_DIR: temporaryRoot,
        ...(workerFault ? { CASELITE_INTEGRATION_WORKER_FAULT: workerFault } : {}),
      },
      encoding: 'utf8',
      timeout: 45_000,
    });
    const success =
      !result.error &&
      result.status === 0 &&
      result.stdout.includes(
        `CaseLite packaged offline integration ${workerFault ? `worker-${workerFault}` : phase} passed.`,
      );
    const safeStage = (result.stderr ?? '')
      .split('\n')
      .find((line) => /^CaseLite offline integration failed at [a-z0-9-]+\.$/.test(line));
    const safePdfState = (result.stderr ?? '')
      .split('\n')
      .find((line) =>
        /^CaseLite offline PDF state: fixture=(?:[0-4]|null), alert=(?:true|false), main=(?:true|false), canvas=(?:true|false), text=(?:true|false)\.$/.test(
          line,
        ),
      );
    const safeRendererState = (result.stderr ?? '')
      .split('\n')
      .find((line) => /^CaseLite offline renderer gone: (?:true|false)\.$/.test(line));
    evidence.phases.push({
      phase,
      scenario: workerFault ? `pdf-worker-${workerFault}` : 'normal',
      packageLocation: binary === executable ? 'original' : 'unicode-space-copy',
      status: success ? 'passed' : 'failed',
      ...(safeStage ? { failureStage: safeStage } : {}),
      ...(safePdfState ? { failureState: safePdfState } : {}),
      ...(safeRendererState ? { rendererState: safeRendererState } : {}),
    });
    if (!success) {
      throw new Error(
        `Packaged offline integration ${phase} failed (exit=${result.status ?? 'none'}, signal=${result.signal ?? 'none'}). ${safeStage ?? ''} ${safeRendererState ?? ''} ${safePdfState ?? ''}`,
      );
    }
  }
  if (!existsSync(join(temporaryRoot, '中文 路径', 'probe.sqlite'))) {
    throw new Error('Synthetic SQLite file did not persist across app restarts');
  }
  passed = true;
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
  evidence.temporaryDataRemoved = !existsSync(temporaryRoot);
  evidence.status = passed ? 'passed' : 'failed';
  const evidencePath = join(root, 'artifacts/evidence/dev-1566-packaged-integration.json');
  mkdirSync(join(root, 'artifacts/evidence'), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

process.stdout.write('Packaged offline PDF + IPC + SQLite integration test passed.\n');
