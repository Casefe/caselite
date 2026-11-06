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
const phases = [];
const syntheticRecovery = process.argv.includes('--synthetic-recovery');
for (const phase of [
  'agent',
  syntheticRecovery ? 'agent-crash-synthetic' : 'agent-crash',
  syntheticRecovery ? 'agent-read-synthetic' : 'agent-read',
]) {
  const startedAt = Date.now();
  const result = spawnSync(binary, [], {
    cwd: root,
    env: { ...process.env, CASELITE_TASK_DEMO: phase, CASELITE_TASK_DEMO_DIR: dir },
    encoding: 'utf8',
    timeout: 60000,
    killSignal: 'SIGKILL',
  });
  phases.push({
    phase,
    exitCode: result.status,
    signal: result.signal,
    errorCode: result.error?.code ?? null,
    elapsedMs: Date.now() - startedAt,
  });
  writeFileSync(join(dir, 'agent-phases.json'), JSON.stringify(phases, null, 2));
  if (phase.startsWith('agent-crash') ? result.signal !== 'SIGKILL' : result.status !== 0)
    throw new Error(`Agent ${phase} demo failed: ${dir}; ${result.stderr}`);
}
const out = join(root, 'artifacts/evidence/agent-demo');
mkdirSync(out, { recursive: true });
for (const file of [
  'agent-home.png',
  'agent-phases.json',
  'agent-long-output.png',
  'agent-layout.json',
  'clipboard-check.json',
  'agent-sidebar.png',
  'deepseek-settings.png',
  'deepseek-sidebar.png',
  'deepseek-preview.png',
  'deepseek-home.png',
  'agent-result.json',
  'history-result.json',
  'agent-recovered.png',
])
  copyFileSync(join(dir, file), join(out, file));
writeFileSync(
  join(out, 'result.json'),
  JSON.stringify(
    {
      ...JSON.parse(readFileSync(join(dir, 'agent-result.json'))),
      phases,
      recoveryCredentials: syntheticRecovery
        ? 'MOCK_ONLY in-memory credentials'
        : 'real safeStorage adapter with synthetic Key',
      history: JSON.parse(readFileSync(join(dir, 'history-result.json'))),
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
