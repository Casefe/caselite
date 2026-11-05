import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'caselite-task-demo-'));
const binary = join(
  root,
  'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite',
);
const phases = [];
for (const phase of ['write', 'crash', 'read']) {
  const result = spawnSync(binary, [], {
    cwd: root,
    env: { ...process.env, CASELITE_TASK_DEMO: phase, CASELITE_TASK_DEMO_DIR: dir },
    encoding: 'utf8',
    timeout: 60_000,
  });
  phases.push({
    phase,
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  if (phase === 'crash' ? result.signal !== 'SIGKILL' : result.status !== 0) {
    writeFileSync(join(dir, 'failure.json'), JSON.stringify(phases, null, 2));
    throw new Error(`Task ${phase} failed; inspect ${dir}/failure.json`);
  }
}
const out = join(root, 'artifacts/evidence/task-body-demo');
mkdirSync(out, { recursive: true });
for (const name of [
  'write.png',
  'read.png',
  'expected.json',
  'home.png',
  'projects-list.png',
  'projects-board.png',
  'project-overview.png',
  'project-task.png',
  'task-list.png',
  'three-column-ai.png',
  'three-column-compact.png',
  'layout.json',
  'notion-slash.png',
  'notion-agent.png',
  'task-content.png',
  'project-editors.png',
])
  copyFileSync(join(dir, name), join(out, name));
writeFileSync(
  join(out, 'result.json'),
  JSON.stringify(
    {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      dirty:
        execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
          .length > 0,
      isolatedDirectory: dir,
      phases,
      network: 'HTTP(S) blocked by test session; physical network not disconnected',
      passed: true,
      unverified: [
        'Human UI acceptance',
        'Project persistence: example UI only',
        'IME OS keyboard candidate selection',
        'Power loss or device loss',
        'OCR/BYOK/Word/PDF',
      ],
    },
    null,
    2,
  ),
);
process.stdout.write(`Task UI create/save + process SIGKILL/restart passed; evidence ${out}\n`);
