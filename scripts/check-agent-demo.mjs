import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'caselite-task-demo-agent-'));
const binary = join(
  root,
  'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite',
);
const result = spawnSync(binary, [], {
  cwd: root,
  env: { ...process.env, CASELITE_TASK_DEMO: 'agent', CASELITE_TASK_DEMO_DIR: dir },
  encoding: 'utf8',
  timeout: 60_000,
});
if (result.status !== 0) throw new Error(`Agent demo failed: ${dir}; ${result.stderr}`);
const out = join(root, 'artifacts/evidence/agent-demo');
mkdirSync(out, { recursive: true });
for (const file of ['agent-home.png', 'agent-sidebar.png', 'agent-result.json'])
  copyFileSync(join(dir, file), join(out, file));
writeFileSync(
  join(out, 'result.json'),
  JSON.stringify(
    {
      ...JSON.parse(readFileSync(join(dir, 'agent-result.json'))),
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      dirty: Boolean(
        execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
      ),
      isolatedDirectory: dir,
    },
    null,
    2,
  ),
);
process.stdout.write('Packaged assistant-ui / Pi synthetic-provider demo passed.\n');
