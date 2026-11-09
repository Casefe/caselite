import { spawnSync, execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const binary = resolve(
  process.argv[2] ?? 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite',
);
const isolated = mkdtempSync(join(tmpdir(), 'caselite-task-demo-editor-scheme-'));
const output = resolve(
  process.env.CASELITE_EDITOR_SCHEME_OUTPUT ?? 'artifacts/evidence/editor-schemes-demo',
);
mkdirSync(output, { recursive: true });
const phases = [];
for (const phase of ['editor-scheme-write', 'editor-scheme-read']) {
  const result = spawnSync(binary, [], {
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
  });
  writeFileSync(join(output, `${phase}.log`), result.stdout + result.stderr);
  for (const name of readdirSync(isolated).filter((name) => /\.(png|json|txt)$/.test(name)))
    copyFileSync(join(isolated, name), join(output, name));
  writeFileSync(
    join(output, 'result.json'),
    JSON.stringify({ status: 'NOT_COMPLETE', phases, isolated, binary }, null, 2),
  );
  if (result.status !== 0 || result.error)
    throw new Error(`Editor scheme ${phase} failed; inspect ${output}`);
  process.stdout.write(`${phase} passed.\n`);
}
const first = JSON.parse(readFileSync(join(output, 'editor-scheme-write.json'), 'utf8'));
const read = JSON.parse(readFileSync(join(output, 'editor-scheme-read.json'), 'utf8'));
if (
  first.taskId !== read.taskId ||
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
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      trackedDiffSha256: createHash('sha256')
        .update(execFileSync('git', ['diff', 'HEAD'], { cwd: root }))
        .digest('hex'),
      appAsarSha256: createHash('sha256')
        .update(readFileSync(resolve(binary, '../../Resources/app.asar')))
        .digest('hex'),
      sample: 'synthetic documents only',
      network: 'HTTP(S) blocked',
      modelCalls: 0,
      systemChineseIme: 'NOT_RUN',
      lawyerAcceptance: 'NOT_RUN',
    },
    null,
    2,
  ),
);
process.stdout.write(`Editor scheme native checks passed: ${output}\n`);
