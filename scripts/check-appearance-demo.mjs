import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'caselite-task-demo-appearance-'));
const binary = join(
  root,
  'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite',
);
const phases = [];
for (const phase of ['appearance-write', 'appearance-read']) {
  const result = spawnSync(binary, [], {
    cwd: root,
    env: { ...process.env, CASELITE_TASK_DEMO: phase, CASELITE_TASK_DEMO_DIR: dir },
    encoding: 'utf8',
    timeout: 60000,
    killSignal: 'SIGKILL',
  });
  phases.push({ phase, exitCode: result.status, signal: result.signal });
  if (result.status !== 0) throw new Error(`Appearance ${phase} failed: ${dir}; ${result.stderr}`);
}
const out = join(root, 'artifacts/evidence/appearance-demo');
mkdirSync(out, { recursive: true });
for (const file of [
  'home-default-dark.png',
  'settings-light.png',
  'settings-dark.png',
  'home-dark.png',
  'assistant-dark.png',
  'settings-light-restored.png',
  'task-light.png',
])
  copyFileSync(join(dir, file), join(out, file));
writeFileSync(
  join(out, 'result.json'),
  JSON.stringify(
    {
      phases,
      isolatedDirectory: dir,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      dirty: Boolean(
        execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
      ),
      network: 'HTTP(S) blocked; synthetic task only',
    },
    null,
    2,
  ),
);
process.stdout.write('Packaged appearance theme switch and restart passed.\n');
