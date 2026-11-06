import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const isolated = mkdtempSync(join(tmpdir(), 'caselite-task-demo-status-'));
const contents = process.env.CASELITE_FORGE_OUT_DIR
  ? resolve(process.env.CASELITE_FORGE_OUT_DIR, 'CaseLite-darwin-arm64/CaseLite.app/Contents')
  : join(root, 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents');
const output = join(root, 'artifacts/evidence/task-status-demo');
mkdirSync(output, { recursive: true });
const phases = [];
for (const phase of ['task-status-write', 'task-status-read']) {
  const result = spawnSync(join(contents, 'MacOS/CaseLite'), [], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    killSignal: 'SIGKILL',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      TZ: phase === 'task-status-write' ? 'Pacific/Kiritimati' : 'America/Los_Angeles',
      CASELITE_TASK_DEMO: phase,
      CASELITE_TASK_DEMO_DIR: isolated,
    },
  });
  const passed =
    phase === 'task-status-write'
      ? result.signal === 'SIGKILL' &&
        !result.error &&
        existsSync(join(isolated, 'task-status-expected.json')) &&
        existsSync(join(isolated, 'task-status-crash-ready.json')) &&
        JSON.parse(readFileSync(join(isolated, 'task-status-crash-ready.json'), 'utf8')).pid ===
          result.pid &&
        JSON.parse(readFileSync(join(isolated, 'task-status-crash-ready.json'), 'utf8'))
          .expectedSha256 ===
          createHash('sha256')
            .update(readFileSync(join(isolated, 'task-status-expected.json')))
            .digest('hex')
      : result.status === 0 &&
        !result.error &&
        existsSync(join(isolated, 'task-status-result.json'));
  phases.push({
    phase,
    exitCode: result.status,
    signal: result.signal,
    errorCode: result.error?.code ?? null,
    passed,
  });
  writeFileSync(
    join(output, 'result.json'),
    JSON.stringify(
      {
        head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        dirty: !!execFileSync('git', ['status', '--porcelain'], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
        appAsarSha256: createHash('sha256')
          .update(readFileSync(join(contents, 'Resources/app.asar')))
          .digest('hex'),
        isolated,
        phases,
        status: passed && phases.length === 2 ? 'PASS_REAL' : passed ? 'NOT_COMPLETE' : 'FAIL',
        network: 'HTTP(S) blocked in isolated session',
        realProviderDispatches: 0,
        unverified: ['System IME', 'Human experience acceptance', 'Power/device loss'],
      },
      null,
      2,
    ),
  );
  if (!passed) throw new Error(`Task status ${phase} failed; inspect ${isolated}`);
}
for (const name of [
  'task-status-expected.json',
  'task-status-result.json',
  'status-unsaved-body.png',
  'status-write-failed.png',
  'status-list-saved.png',
  'status-reopened.png',
])
  copyFileSync(join(isolated, name), join(output, name));
process.stdout.write(`Task status save/SIGKILL/reopen passed; evidence ${output}\n`);
