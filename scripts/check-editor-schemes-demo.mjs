import { spawn, spawnSync, execFileSync } from 'node:child_process';
import {
  copyFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setInterval, clearInterval } from 'node:timers';

const root = resolve(import.meta.dirname, '..');
const recovery = process.argv.includes('--recovery');
if (
  recovery &&
  (!process.argv[2] ||
    process.argv[2].startsWith('--') ||
    !process.argv.includes('--synthetic-clipboard'))
)
  throw new Error(
    'Recovery requires an explicit private binary and Root synthetic clipboard handoff (--synthetic-clipboard)',
  );
const binary = resolve(
  process.argv[2] ?? 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite',
);
const isolated = mkdtempSync(join(tmpdir(), 'caselite-task-demo-editor-scheme-'));
const output = resolve(
  process.env.CASELITE_EDITOR_SCHEME_OUTPUT ?? 'artifacts/evidence/editor-schemes-demo',
);
mkdirSync(output, { recursive: true });
const phases = [];
const phaseNames = recovery
  ? ['save', 'unknown', 'late', 'copy', 'agent', 'read'].map(
      (name) => `editor-scheme-recovery-${name}`,
    )
  : ['editor-scheme-write', 'editor-scheme-read'];
async function runRecoveryPhase(phase) {
  const log = openSync(join(output, `${phase}.log`), 'w');
  let child;
  try {
    child = spawn(binary, [], {
      cwd: root,
      env: {
        ...process.env,
        CASELITE_TASK_DEMO: phase,
        CASELITE_TASK_DEMO_DIR: isolated,
        CASELITE_EDITOR_RECOVERY_CLIPBOARD: 'synthetic',
      },
      detached: true,
      stdio: ['ignore', log, log],
    });
  } finally {
    closeSync(log);
  }
  writeFileSync(
    join(output, `${phase}-owner.json`),
    JSON.stringify({ binary, isolated, pid: child.pid, phase }),
  );
  return new Promise((resolveResult) => {
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearInterval(observe);
      // 恢复失败保留准确测试进程与草稿交Root；不沿默认旧探针的强杀兜底。
      if (result.preservedPid) child.unref();
      resolveResult(result);
    };
    const deadline = setTimeout(
      () =>
        finish({
          status: null,
          signal: null,
          error: { code: 'RECOVERY_BUDGET_PRESERVED' },
          preservedPid: child.pid,
        }),
      60_000,
    );
    const observe = setInterval(() => {
      const failure = join(isolated, `${phase}-failure.json`);
      if (existsSync(failure))
        finish({
          status: null,
          signal: null,
          error: { code: 'RECOVERY_FAILED_PRESERVED' },
          preservedPid: child.pid,
        });
    }, 80);
    child.once('exit', (status, signal) => finish({ status, signal }));
    child.once('error', (error) => finish({ status: null, signal: null, error }));
  });
}
for (const phase of phaseNames) {
  const result = recovery
    ? await runRecoveryPhase(phase)
    : spawnSync(binary, [], {
        cwd: root,
        env: { ...process.env, CASELITE_TASK_DEMO: phase, CASELITE_TASK_DEMO_DIR: isolated },
        timeout: 60_000,
        killSignal: 'SIGKILL',
        encoding: 'utf8',
      });
  phases.push({
    phase,
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.code ?? null,
    ...(result.preservedPid
      ? { preservedPid: result.preservedPid, cleanup: 'ROOT_REQUIRED_NO_FORCED_QUIT' }
      : {}),
  });
  if (!recovery) writeFileSync(join(output, `${phase}.log`), result.stdout + result.stderr);
  for (const name of readdirSync(isolated).filter((name) => /\.(png|json|txt)$/.test(name)))
    copyFileSync(join(isolated, name), join(output, name));
  writeFileSync(
    join(output, 'result.json'),
    JSON.stringify({ status: 'NOT_COMPLETE', phases, isolated, binary }, null, 2),
  );
  if (result.status !== 0 || result.error)
    throw new Error(`Editor scheme ${phase} failed; inspect ${output}`);
  if (recovery) {
    const report = JSON.parse(readFileSync(join(isolated, `${phase}.json`), 'utf8'));
    if (report.status !== 'PASS_REAL' || report.phase !== phase)
      throw new Error(`Recovery ${phase} did not produce its own passing receipt`);
  }
  process.stdout.write(`${phase} passed.\n`);
}
const first = JSON.parse(
  readFileSync(
    join(output, recovery ? 'editor-scheme-recovery-agent.json' : 'editor-scheme-write.json'),
    'utf8',
  ),
);
const read = JSON.parse(
  readFileSync(
    join(output, recovery ? 'editor-scheme-recovery-read.json' : 'editor-scheme-read.json'),
    'utf8',
  ),
);
if (
  recovery
    ? first.status !== 'PASS_REAL' ||
      read.status !== 'PASS_REAL' ||
      first.taskId !== read.taskId ||
      first.revision !== read.revision ||
      first.stateSha256 !== read.stateSha256 ||
      JSON.stringify(first.runs) !== JSON.stringify(read.runs) ||
      first.realProviderCalls ||
      read.realProviderCalls
    : first.taskId !== read.taskId ||
      first.revision !== read.revision ||
      first.modelCalls ||
      read.modelCalls
)
  throw new Error('Editor scheme restart mismatch');
writeFileSync(
  join(output, 'result.json'),
  JSON.stringify(
    {
      status: 'PASS_REAL',
      phases,
      isolated,
      binary,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      }).trim(),
      trackedDiffSha256: createHash('sha256')
        .update(
          execFileSync('git', ['diff', 'HEAD'], {
            cwd: root,
            env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
          }),
        )
        .digest('hex'),
      appAsarSha256: createHash('sha256')
        .update(readFileSync(resolve(binary, '../../Resources/app.asar')))
        .digest('hex'),
      sample: 'synthetic documents only',
      network: 'HTTP(S) blocked',
      modelCalls: recovery ? read.runs.length : 0,
      ...(recovery
        ? {
            realProviderCalls: 0,
            syntheticProvider: 'MOCK_ONLY',
            syntheticRuns: read.runs.length,
            coldDatabaseAudit: 'NOT_RUN_ROOT_REQUIRED',
            nativeScope: 'guarded recovery only; IME NOT_RUN',
          }
        : {}),
      systemChineseIme: 'NOT_RUN',
      lawyerAcceptance: 'NOT_RUN',
    },
    null,
    2,
  ),
);
process.stdout.write(`Editor scheme native checks passed: ${output}\n`);
