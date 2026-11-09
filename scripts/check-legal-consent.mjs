import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const contents = join(root, 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents');
const binary = join(contents, 'MacOS/CaseLite');
const output = join(root, 'artifacts/evidence/dev-1844/native');
mkdirSync(output, { recursive: true });
for (const file of ['LICENSE.md', 'EULA.md']) {
  if (
    !readFileSync(join(contents, 'Resources/legal', file)).equals(
      readFileSync(join(root, 'legal', file)),
    )
  )
    throw new Error('Packaged legal text differs from canonical source');
}
const acceptedRoot = mkdtempSync(join(tmpdir(), 'caselite-task-demo-'));
const results = [];
for (const phase of [
  'legal-accept',
  'legal-read',
  'legal-update',
  'legal-reject',
  'legal-close',
  'legal-write-failure',
  'legal-corrupt',
  'legal-workbench',
]) {
  const directory = ['legal-accept', 'legal-read', 'legal-update'].includes(phase)
    ? acceptedRoot
    : mkdtempSync(join(tmpdir(), 'caselite-task-demo-'));
  const data = join(directory, 'userData');
  mkdirSync(data, { recursive: true });
  const receiptPath = join(data, 'legal-acceptance.json');
  let previous;
  if (phase === 'legal-read') previous = readFileSync(receiptPath, 'utf8');
  if (phase === 'legal-update') {
    const stale = JSON.parse(readFileSync(receiptPath, 'utf8'));
    stale.eula_sha256 = '0'.repeat(64);
    writeFileSync(receiptPath, JSON.stringify(stale));
  }
  if (phase === 'legal-corrupt') writeFileSync(receiptPath, '{broken-receipt');
  const result = spawnSync(binary, [], {
    cwd: root,
    env: { ...process.env, CASELITE_TASK_DEMO: phase, CASELITE_TASK_DEMO_DIR: directory },
    encoding: 'utf8',
    timeout: 45_000,
    killSignal: 'SIGKILL',
  });
  if (result.error || result.status !== 0) {
    writeFileSync(
      join(output, 'failure.json'),
      JSON.stringify(
        {
          phase,
          directory,
          status: result.status,
          error: result.error?.message,
          stderr: result.stderr,
        },
        null,
        2,
      ),
    );
    throw new Error(`Legal consent ${phase} failed`);
  }
  const value = JSON.parse(readFileSync(join(directory, `${phase}.json`), 'utf8'));
  const expectedAccepted = [
    'legal-accept',
    'legal-read',
    'legal-update',
    'legal-workbench',
  ].includes(phase);
  if (
    value.accepted !== expectedAccepted ||
    value.businessDatabaseCreated !== (phase === 'legal-workbench')
  )
    throw new Error(`Unexpected legal consent outcome: ${phase}`);
  if (expectedAccepted) {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    const sha = (file) =>
      createHash('sha256')
        .update(readFileSync(join(root, 'legal', file)))
        .digest('hex');
    if (receipt.license_sha256 !== sha('LICENSE.md') || receipt.eula_sha256 !== sha('EULA.md'))
      throw new Error('Accepted texts do not match the packaged documents');
  }
  if (phase === 'legal-read' && readFileSync(receiptPath, 'utf8') !== previous)
    throw new Error('Restart rewrote the acceptance time');
  if (['legal-reject', 'legal-close'].includes(phase) && existsSync(receiptPath))
    throw new Error('Decline or close created acceptance');
  if (phase === 'legal-corrupt' && readFileSync(receiptPath, 'utf8') !== '{broken-receipt')
    throw new Error('Corrupt acceptance was overwritten');
  for (const name of [
    'legal-before.png',
    'legal-ready.png',
    'legal-save-error.png',
    'legal-workbench.png',
  ])
    if (existsSync(join(directory, name)))
      copyFileSync(join(directory, name), join(output, `${phase}-${name}`));
  results.push({ phase, exitCode: result.status, ...value });
}
writeFileSync(
  join(output, 'result.json'),
  JSON.stringify(
    {
      status: 'PASS_REAL',
      scope:
        'Native Electron with isolated synthetic userData; automated clicks are not lawyer acceptance',
      packageTextsMatch: true,
      phases: results,
    },
    null,
    2,
  ),
);
process.stdout.write('CaseLite legal consent native checks passed: 8 isolated phases.\n');
