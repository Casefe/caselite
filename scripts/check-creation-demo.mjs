import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] ?? join(root, 'artifacts/evidence/creation-demo'));
mkdirSync(output, { recursive: true });
const isolated = mkdtempSync(join(tmpdir(), 'caselite-task-demo-creation-'));
const build = process.env.CASELITE_FORGE_OUT_DIR ?? join(root, 'apps/desktop/out');
const app = resolve(build, 'CaseLite-darwin-arm64/CaseLite.app');
copyFileSync(
  join(root, 'tests/fixtures/important-dates/01-开庭传票-合成.pdf'),
  join(isolated, '合成合同.pdf'),
);
copyFileSync(
  join(root, 'tests/fixtures/important-dates/01-开庭传票-合成.docx'),
  join(isolated, '合成说明.docx'),
);
const phases = [];
for (const phase of ['task-views-creation-write', 'task-views-creation-read']) {
  const result = spawnSync(join(app, 'Contents/MacOS/CaseLite'), [], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    killSignal: 'SIGKILL',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      TZ: 'Asia/Shanghai',
      CASELITE_TASK_DEMO: phase,
      CASELITE_TASK_DEMO_DIR: isolated,
    },
  });
  const passed =
    result.status === 0 && !result.error && existsSync(join(isolated, phase + '.json'));
  phases.push({
    phase,
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.code,
    stdout: result.stdout,
    stderr: result.stderr,
    passed,
  });
  for (const file of readdirSync(isolated))
    if (/\.(?:png|txt|json)$/.test(file)) copyFileSync(join(isolated, file), join(output, file));
  writeFileSync(
    join(output, 'result.json'),
    JSON.stringify(
      {
        status: passed ? 'PASS_REAL' : 'FAIL',
        isolated,
        app,
        phases,
        filePickerSelection: 'INJECTED_SYNTHETIC_RESULT',
        physicalFileDialog: 'NOT_RUN',
        realProviderCalls: 0,
      },
      null,
      2,
    ),
  );
  if (!passed) process.exit(1);
}
const asarSha256 = createHash('sha256')
  .update(readFileSync(join(app, 'Contents/Resources/app.asar')))
  .digest('hex');
writeFileSync(
  join(output, 'result.json'),
  JSON.stringify(
    {
      status: 'PASS_REAL',
      isolated,
      app,
      asarSha256,
      phases,
      filePickerSelection: 'INJECTED_SYNTHETIC_RESULT',
      physicalFileDialog: 'NOT_RUN',
      realProviderCalls: 0,
    },
    null,
    2,
  ),
);
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const launcher = join(output, '打开日历创建验收.command');
writeFileSync(
  launcher,
  `#!/bin/zsh\nexport CASELITE_TASK_DEMO=task-views-creation-preview\nexport CASELITE_TASK_DEMO_DIR=${quote(isolated)}\nexec ${quote(join(app, 'Contents/MacOS/CaseLite'))}\n`,
);
chmodSync(launcher, 0o755);
process.stdout.write(
  `PASS_REAL: creation, original Task IDs, local attachments and normal restart. ${output}\n`,
);
