import { spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const binary =
  process.argv[2] ??
  join(root, 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite');
const dir = mkdtempSync(join(tmpdir(), 'caselite-task-demo-'));
copyFileSync(
  join(root, 'tests/fixtures/case-materials/development/contract-v1-text.pdf'),
  join(dir, 'text.pdf'),
);
copyFileSync(
  join(root, 'tests/fixtures/case-materials/development/contract-v1-scan.pdf'),
  join(dir, 'scan.pdf'),
);
const phases = [];
for (const phase of ['materials', 'materials-read']) {
  const r = spawnSync(binary, [], {
    cwd: root,
    env: { ...process.env, CASELITE_TASK_DEMO: phase, CASELITE_TASK_DEMO_DIR: dir },
    encoding: 'utf8',
    timeout: 180000,
  });
  phases.push({ phase, status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr });
  writeFileSync(join(dir, 'phases.json'), JSON.stringify(phases, null, 2));
  if (r.status !== 0) {
    console.error(`Material demo failed: ${dir}`);
    process.exit(1);
  }
}
const out = join(root, 'artifacts/evidence/material-chat-demo');
mkdirSync(out, { recursive: true });
for (const file of [
  'pdf-drop-staged.png',
  'pdf-text-reader.png',
  'chat-preparing.png',
  'chat-visual-analysis.png',
  'chat-message-reader.png',
  'chat-local-fallback.png',
  'materials-reopened.png',
  'task-body-saved.png',
  'task-body-reopened.png',
  'vision-pi-context.json',
  'material-pi-context.json',
  'materials-write.json',
  'materials-read.json',
  'phases.json',
])
  copyFileSync(join(dir, file), join(out, file));
const before = JSON.parse(readFileSync(join(dir, 'materials-write.json'), 'utf8')),
  after = JSON.parse(readFileSync(join(dir, 'materials-read.json'), 'utf8'));
if (JSON.stringify(before.ids) !== JSON.stringify(after.ids))
  throw new Error('Restart source identity mismatch');
console.log(
  `PASS_REAL local PDF drop/import/Vision/restart. Evidence ${out}; isolated data ${dir}. Pi dispatch MOCK_ONLY; real Provider NOT_RUN.`,
);
