import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const isolated = mkdtempSync(join(tmpdir(), 'caselite-task-demo-three-views-'));
const build = process.env.CASELITE_FORGE_OUT_DIR ?? join(root, 'apps/desktop/out');
const app = resolve(build, 'CaseLite-darwin-arm64/CaseLite.app');
const output = resolve(process.argv[2] ?? join(root, 'artifacts/evidence/task-three-views'));
mkdirSync(output, { recursive: true });
copyFileSync(
  join(root, 'tests/fixtures/important-dates/01-开庭传票-合成.pdf'),
  join(isolated, '合同示例.pdf'),
);
copyFileSync(
  join(root, 'tests/fixtures/important-dates/01-开庭传票-合成.docx'),
  join(isolated, '沟通记录示例.docx'),
);
const phases = [];
for (const phase of ['task-views-write', 'task-views-read']) {
  const r = spawnSync(join(app, 'Contents/MacOS/CaseLite'), [], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    killSignal: 'SIGKILL',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      TZ: phase === 'task-views-write' ? 'Asia/Shanghai' : 'America/Los_Angeles',
      CASELITE_TASK_DEMO: phase,
      CASELITE_TASK_DEMO_DIR: isolated,
    },
  });
  const ok = r.status === 0 && !r.error && existsSync(join(isolated, phase + '.json'));
  phases.push({
    phase,
    exitCode: r.status,
    signal: r.signal,
    error: r.error?.code,
    stdout: r.stdout,
    stderr: r.stderr,
    passed: ok,
  });
  writeFileSync(join(output, 'execution.json'), JSON.stringify({ isolated, app, phases }, null, 2));
  if (!ok)
    throw Error(`Task views ${phase} failed. Inspect ${isolated} and ${output}/execution.json`);
}
for (const name of [
  '01-task-summary.png',
  '02-task-create.png',
  '03-task-detail.png',
  '04-task-dates.png',
  '05-task-reminder.png',
  '06-task-detail-narrow.png',
  'task-views-write.json',
  'task-views-read.json',
  'task-views-expected.json',
])
  copyFileSync(join(isolated, name), join(output, name));
const hash = createHash('sha256')
  .update(readFileSync(join(app, 'Contents/Resources/app.asar')))
  .digest('hex');
writeFileSync(
  join(output, 'result.json'),
  JSON.stringify(
    {
      status: 'PASS_REAL',
      scope:
        'Synthetic native Electron/typed IPC/SQLite interactions and normal restart; not physical IME or lawyer acceptance',
      isolated,
      app,
      asarSha256: hash,
      phases,
      realProviderCalls: 0,
    },
    null,
    2,
  ),
);
process.stdout.write(
  `PASS_REAL: task summary, create, details, range, reminder, attachments, comment and normal restart. Evidence: ${output}\n`,
);
