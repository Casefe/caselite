import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const isolated = mkdtempSync(join(tmpdir(), 'caselite-task-demo-navigation-'));
const output = join(root, 'artifacts/evidence/project-navigation-demo');
const app = join(root, 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app');
mkdirSync(output, { recursive: true });
const phases = [];
for (const mode of ['seed', 'write', 'read']) {
  const result = spawnSync(join(app, 'Contents/MacOS/CaseLite'), [], {
    cwd: root,
    env: {
      ...process.env,
      CASELITE_TASK_DEMO_DIR: isolated,
      CASELITE_TASK_DEMO: mode === 'seed' ? 'project-promote' : 'project-promote-read',
      CASELITE_PROJECT_NAVIGATION: mode === 'seed' ? '' : mode,
    },
    encoding: 'utf8',
    timeout: 90_000,
    killSignal: 'SIGKILL',
  });
  phases.push({ mode, exitCode: result.status, signal: result.signal, stderr: result.stderr });
  writeFileSync(
    join(output, 'result.json'),
    JSON.stringify(
      {
        status:
          result.status === 0 && mode === 'read'
            ? 'PASS_REAL'
            : result.status === 0
              ? 'NOT_COMPLETE'
              : 'FAIL',
        sourceTree: execFileSync('git', ['write-tree'], { cwd: root, encoding: 'utf8' }).trim(),
        isolated,
        phases,
        asarSha256: createHash('sha256')
          .update(readFileSync(join(app, 'Contents/Resources/app.asar')))
          .digest('hex'),
        network: 'HTTP(S) blocked by isolated Electron session',
        providerDispatches: 0,
        unverified: ['Human experience acceptance', 'System IME', 'Power loss'],
      },
      null,
      2,
    ),
  );
  if (result.status !== 0) process.exit(1);
}
