import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const isolated = mkdtempSync(join(tmpdir(), 'caselite-task-demo-project-'));
const lifecycle = process.argv.includes('--lifecycle');
const promotion = process.argv.includes('--promote');
const output = join(
  root,
  'artifacts/evidence',
  promotion ? 'project-promotion-demo' : lifecycle ? 'project-lifecycle-demo' : 'project-demo',
);
mkdirSync(output, { recursive: true });
const phases = [];
const requestedPhases = promotion
  ? ['project-promote', 'project-promote-read']
  : lifecycle
    ? ['project-write', 'project-edit', 'project-restore']
    : ['project-write', 'project-read'];
for (const phase of requestedPhases) {
  const result = spawnSync(
    join(root, 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite'),
    [],
    {
      cwd: root,
      env: { ...process.env, CASELITE_TASK_DEMO: phase, CASELITE_TASK_DEMO_DIR: isolated },
      encoding: 'utf8',
      timeout: 45_000,
      killSignal: 'SIGKILL',
    },
  );
  phases.push({ phase, exitCode: result.status, signal: result.signal, stderr: result.stderr });
  writeFileSync(
    join(output, 'result.json'),
    JSON.stringify(
      {
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        dirty:
          execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
            .length > 0,
        appAsarSha256: createHash('sha256')
          .update(
            readFileSync(
              join(
                root,
                'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/Resources/app.asar',
              ),
            ),
          )
          .digest('hex'),
        isolated,
        phases,
        network: 'HTTP(S) blocked in the test session; physical network remains connected',
        status: phases.some((p) => p.exitCode !== 0)
          ? 'FAIL'
          : phases.length === requestedPhases.length
            ? 'PASS_REAL'
            : 'NOT_COMPLETE',
        unverified: [
          'Human experience acceptance',
          'System IME candidate selection',
          'Power or device loss',
        ],
      },
      null,
      2,
    ),
  );
  if (result.status !== 0) throw new Error(`Project ${phase} failed; inspect ${isolated}`);
}
for (const name of promotion
  ? [
      'project-from-task.png',
      'project-task-linked.png',
      'project-original-task-reopened.png',
      'project-overview-summary.png',
      'project-sections.png',
      'promotion-expected.json',
    ]
  : [
      'project-create.png',
      'project-created.png',
      'project-reopened.png',
      'project-expected.json',
      ...(lifecycle ? ['project-edited.png', 'project-archived.png', 'project-restored.png'] : []),
    ])
  copyFileSync(join(isolated, name), join(output, name));
process.stdout.write(`Project create/reopen passed; evidence ${output}\n`);
