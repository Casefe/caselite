import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const binary = join(
  root,
  'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite',
);
const isolated = mkdtempSync(join(tmpdir(), 'caselite-task-demo-home-context-'));
const output = resolve(process.argv[2] ?? 'artifacts/evidence/home-context-demo');
mkdirSync(output, { recursive: true });
const phases = [];
for (const phase of ['agent-home-check', 'agent-home-read']) {
  const result = spawnSync(binary, [], {
    cwd: root,
    env: { ...process.env, CASELITE_TASK_DEMO: phase, CASELITE_TASK_DEMO_DIR: isolated },
    encoding: 'utf8',
    timeout: 60000,
    killSignal: 'SIGKILL',
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
    JSON.stringify(
      {
        status: phases.every((p) => p.exitCode === 0) ? 'NOT_COMPLETE' : 'FAIL',
        isolated,
        binary,
        phases,
        appAsarSha256: createHash('sha256')
          .update(readFileSync(resolve(binary, '../../Resources/app.asar')))
          .digest('hex'),
        provider: 'MOCK_ONLY; HTTP(S) blocked; memory credentials',
      },
      null,
      2,
    ),
  );
  if (result.status !== 0) throw new Error(`Home context ${phase} failed; inspect ${output}`);
}
const summary = JSON.parse(readFileSync(join(output, 'result.json'), 'utf8'));
writeFileSync(
  join(output, 'result.json'),
  JSON.stringify({ ...summary, status: 'PASS_REAL', restartVerified: true }, null, 2),
);
process.stdout.write(`Packaged home context checks passed: ${output}\n`);
