import { spawnSync, execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..'),
  isolated = mkdtempSync(join(tmpdir(), 'caselite-task-demo-reminder-'));
const contents = process.env.CASELITE_FORGE_OUT_DIR
  ? resolve(process.env.CASELITE_FORGE_OUT_DIR, 'CaseLite-darwin-arm64/CaseLite.app/Contents')
  : join(root, 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents');
const output = join(root, 'artifacts/evidence/reminder-demo');
mkdirSync(output, { recursive: true });
const phases = [];
for (const phase of ['reminder-write', 'reminder-read']) {
  if (phase === 'reminder-read') {
    const at = Date.parse(
      JSON.parse(readFileSync(join(isolated, 'reminder-expected.json'), 'utf8')).restartAt,
    );
    while (Date.now() <= at + 1000)
      await new Promise((done) => setTimeout(done, Math.min(5000, at + 1001 - Date.now())));
  }
  const result = spawnSync(join(contents, 'MacOS/CaseLite'), [], {
    cwd: root,
    encoding: 'utf8',
    timeout: 90000,
    killSignal: 'SIGKILL',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      TZ: phase === 'reminder-write' ? 'Pacific/Kiritimati' : 'America/Los_Angeles',
      CASELITE_TASK_DEMO: phase,
      CASELITE_TASK_DEMO_DIR: isolated,
    },
  });
  phases.push({
    phase,
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.code ?? null,
    passed: result.status === 0 && !result.error,
  });
  writeFileSync(join(output, phase + '.log'), result.stdout + '\n' + result.stderr);
  writeFileSync(
    join(output, 'result.json'),
    JSON.stringify(
      {
        head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        tree: execFileSync('git', ['write-tree'], { cwd: root, encoding: 'utf8' }).trim(),
        dirty: !!execFileSync('git', ['status', '--porcelain'], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
        appAsarSha256: createHash('sha256')
          .update(readFileSync(join(contents, 'Resources/app.asar')))
          .digest('hex'),
        isolated,
        phases,
        status: phases.every((p) => p.passed) && phases.length === 2 ? 'PASS_REAL' : 'NOT_COMPLETE',
        realProviderDispatches: 0,
        notRun: [
          'physical suspend/resume',
          'system permission denial',
          'notification center retained history cleanup',
          'human acceptance',
        ],
      },
      null,
      2,
    ),
  );
  if (result.status !== 0 || result.error)
    throw new Error(`Reminder ${phase} failed; inspect ${isolated}`);
  process.stdout.write(`${phase} passed; isolated ${isolated}\n`);
}
for (const name of [
  'reminder-expected.json',
  'reminder-result.json',
  'reminder-normal.png',
  'reminder-canceled.png',
  'reminder-plan.png',
  'reminder-reopened.png',
  'reminder-return-task.png',
])
  if (existsSync(join(isolated, name))) copyFileSync(join(isolated, name), join(output, name));
process.stdout.write(`Reminder native verification completed: ${output}\n`);
