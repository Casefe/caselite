import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const binary = resolve(
  process.argv[2] ?? 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite',
);
const expected = process.argv[3] ?? 'source-han-serif';
if (!['baseline', 'source-han-serif'].includes(expected)) throw new Error('Invalid expected font');
const output = resolve(
  process.env.CASELITE_TYPOGRAPHY_OUTPUT ?? 'artifacts/evidence/typography-demo',
);
const isolated = mkdtempSync(join(tmpdir(), 'caselite-task-demo-typography-'));
mkdirSync(output, { recursive: true });
const phases = [];
for (const phase of ['write', 'read']) {
  const result = spawnSync(binary, [], {
    cwd: root,
    env: {
      ...process.env,
      CASELITE_TASK_DEMO: 'typography',
      CASELITE_TASK_DEMO_DIR: isolated,
      CASELITE_TYPOGRAPHY_PHASE: phase,
      CASELITE_TYPOGRAPHY_FONT: expected,
    },
    timeout: 90_000,
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
  for (const name of readdirSync(isolated).filter((name) => /\.(json|png|txt)$/.test(name)))
    copyFileSync(join(isolated, name), join(output, name));
  writeFileSync(
    join(output, 'result.json'),
    JSON.stringify(
      {
        status: phases.every((entry) => entry.exitCode === 0) ? 'NOT_COMPLETE' : 'FAIL',
        isolated,
        binary,
        phases,
        appAsarSha256: createHash('sha256')
          .update(readFileSync(resolve(binary, '../../Resources/app.asar')))
          .digest('hex'),
      },
      null,
      2,
    ),
  );
  if (result.status !== 0 || result.error)
    throw new Error(`Typography ${phase} failed; inspect ${output}`);
  process.stdout.write(`Typography ${phase} passed.\n`);
}
const first = JSON.parse(readFileSync(join(output, 'typography-write.json')));
const reopened = JSON.parse(readFileSync(join(output, 'typography-read.json')));
if (
  first.taskId !== reopened.taskId ||
  first.revision !== reopened.revision ||
  first.pdfCanvasSha256 !== reopened.pdfCanvasSha256
)
  throw new Error('Typography restart mismatch');
const summary = JSON.parse(readFileSync(join(output, 'result.json')));
writeFileSync(
  join(output, 'result.json'),
  JSON.stringify(
    {
      ...summary,
      status: expected === 'baseline' ? 'BASELINE_OBSERVED' : 'PASS_REAL',
      restartVerified: true,
    },
    null,
    2,
  ),
);
process.stdout.write(`Typography native checks passed: ${output}\n`);
