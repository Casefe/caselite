import { spawnSync, execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  copyFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const repository = resolve(import.meta.dirname, '..');
const binary = resolve(
  process.argv[2] ?? 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite',
);
const output = process.env.CASELITE_PERFORMANCE_OUTPUT;
const namespace = '/Volumes/CASDEV/artifacts/dev1838-performance-20261109/';
if (
  !output ||
  !resolve(output).startsWith(namespace) ||
  dirname(resolve(output)) !== namespace.slice(0, -1)
)
  throw Error('Explicit fresh direct-child performance output required');
const dirty = execFileSync('git', ['status', '--porcelain'], {
  cwd: repository,
  encoding: 'utf8',
}).trim();
if (dirty) throw Error('Performance measurement requires a clean committed source tree');
mkdirSync(resolve(output));
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const binding = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  diffSha256: createHash('sha256')
    .update(execFileSync('git', ['diff', 'HEAD'], { cwd: repository }))
    .digest('hex'),
  asarSha256: hash(resolve(binary, '../../Resources/app.asar')),
  sourceFiles: Object.fromEntries(
    [
      'apps/desktop/src/main/index.ts',
      'apps/desktop/src/main/performance-demo.ts',
      'scripts/check-performance-demo.mjs',
      'tests/contracts/performance-demo.test.ts',
    ].map((file) => [file, hash(join(repository, file))]),
  ),
  binary,
  output,
  cpu: cpus()[0]?.model,
  memoryBytes: totalmem(),
  os: execFileSync('sw_vers', { encoding: 'utf8' }),
  cache: 'OS cache uncontrolled; first/repeated process launches, never claimed cold boot',
  phases: [],
};
writeFileSync(join(output, 'binding.json'), JSON.stringify(binding, null, 2));
for (const count of [10, 1000]) {
  const isolated = mkdtempSync(join(tmpdir(), 'caselite-task-demo-performance-'));
  const fixtures = [
    ['text.pdf', 'tests/fixtures/case-materials/development/contract-v1-text.pdf'],
    ['scan.pdf', 'tests/fixtures/case-materials/development/contract-v1-scan.pdf'],
    ['sample.docx', 'tests/fixtures/important-dates/08-律师工作会议-合成.docx'],
  ];
  for (const [name, source] of fixtures)
    copyFileSync(join(repository, source), join(isolated, name));
  writeFileSync(
    join(output, `${count}-fixtures.json`),
    JSON.stringify(
      fixtures.map(([name, source]) => ({ name, source, sha256: hash(join(repository, source)) })),
      null,
      2,
    ),
  );
  const phases = [
    'performance-seed',
    ...Array(5).fill('performance-start'),
    'performance-run',
    'performance-start',
  ];
  for (const [i, phase] of phases.entries()) {
    const result = spawnSync(binary, [], {
      cwd: repository,
      env: {
        ...process.env,
        CASELITE_TASK_DEMO: phase,
        CASELITE_TASK_DEMO_DIR: isolated,
        CASELITE_PERFORMANCE_COUNT: String(count),
        CASELITE_PERFORMANCE_START_NS: process.hrtime.bigint().toString(),
      },
      timeout: 300000,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
    });
    const label = `${count}-${i}-${phase}`;
    writeFileSync(join(output, label + '.log'), result.stdout + result.stderr);
    const files = readdirSync(isolated).filter((name) =>
      /^(performance-.*\.(json|png)|diagnostic\.txt)$/.test(name),
    );
    for (const name of files)
      copyFileSync(join(isolated, name), join(output, `${count}-${i}-${name}`));
    binding.phases.push({
      count,
      phase,
      iteration: i,
      isolated,
      exitCode: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
    });
    writeFileSync(join(output, 'binding.json'), JSON.stringify(binding, null, 2));
    process.stdout.write(`${label}: exit ${result.status}\n`);
    if (result.status !== 0 || result.error)
      throw Error(`Performance phase failed; inspect ${output}`);
  }
}
