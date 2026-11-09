import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const repo = resolve(import.meta.dirname, '..');
const bundle = resolve(
  process.argv[2] ?? join(repo, 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app'),
);
const output = resolve(process.argv[3] ?? join(repo, 'artifacts/evidence/important-dates'));
const root = mkdtempSync(join(tmpdir(), 'caselite-task-demo-dev1825-'));
mkdirSync(output, { recursive: true });
cpSync(join(repo, 'tests/fixtures/important-dates'), join(root, 'fixtures'), { recursive: true });
execFileSync('codesign', ['--verify', '--deep', '--strict', bundle]);
const phases = [];
for (const phase of ['important-date-write', 'important-date-read']) {
  const result = spawnSync(join(bundle, 'Contents/MacOS/CaseLite'), [], {
    cwd: repo,
    env: { ...process.env, CASELITE_TASK_DEMO: phase, CASELITE_TASK_DEMO_DIR: root },
    encoding: 'utf8',
    timeout: 240000,
  });
  phases.push({
    phase,
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.message,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  writeFileSync(join(output, 'phases.json'), JSON.stringify(phases, null, 2));
  if (result.status !== 0) {
    cpSync(root, join(output, 'failed-profile'), { recursive: true });
    throw Error(`Important date native probe failed; preserved ${output}`);
  }
}
for (const name of [
  'important-date-write.json',
  'important-date-read.json',
  'important-date-records.json',
])
  cpSync(join(root, name), join(output, name));
writeFileSync(
  join(output, 'manifest.json'),
  JSON.stringify(
    {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
      bundle,
      asarSha256: createHash('sha256')
        .update(readFileSync(join(bundle, 'Contents/Resources/app.asar')))
        .digest('hex'),
      root,
      profile: join(root, 'userData'),
      model: 'MOCK_ONLY',
      realProviderCalls: 0,
      gui: 'NOT_RUN: root CUA owns manual acceptance',
      phases: phases.map((p) => ({ phase: p.phase, exitCode: p.exitCode })),
    },
    null,
    2,
  ),
);
console.log(
  `Important dates native IPC/file/SQLite/reopen passed. MOCK_ONLY Provider, 0 real calls. Evidence: ${output}`,
);
