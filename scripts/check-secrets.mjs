import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const executable = resolve(repositoryRoot, 'node_modules/.bin/secretlint');
const excludedPrefixes = [
  '.git/',
  'artifacts/',
  'coverage/',
  'node_modules/',
  'playwright-report/',
];

function repositoryFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .filter((file) => !excludedPrefixes.some((prefix) => file.startsWith(prefix)))
    .filter((file) => !readFileSync(resolve(repositoryRoot, file)).includes(0));
}

function scan(files, label, { expectFailure = false } = {}) {
  const result = spawnSync(executable, files, {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (expectFailure && result.status === 0) {
    console.error(`Secret scan configuration error: ${label} was not rejected.`);
    process.exitCode = 1;
  } else if (!expectFailure && result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    console.error(`Secret scan failed for ${label}.`);
    process.exitCode = 1;
  }
  return result.status;
}

const selfTestDirectory = mkdtempSync(resolve(tmpdir(), 'caselite-secretlint-'));
try {
  const fakeToken = ['ghp', 'A'.repeat(36)].join('_');
  const fakeTokenFile = resolve(selfTestDirectory, 'fake-token.txt');
  writeFileSync(fakeTokenFile, `token=${fakeToken}\n`, 'utf8');
  if (scan([fakeTokenFile], 'the deliberate fake-token self-test', { expectFailure: true }) !== 0) {
    console.log('Secret scan self-test passed: a generated fake token was rejected.');
  }
} finally {
  rmSync(selfTestDirectory, { force: true, recursive: true });
}

if (process.exitCode) process.exit(process.exitCode);

const files = repositoryFiles();
if (files.length === 0) {
  console.error('Secret scan configuration error: no repository files were selected.');
  process.exit(1);
}

if (scan(files, 'repository files') === 0) {
  console.log(
    `Secret scan passed: ${files.length} text repository file(s) checked with Secretlint.`,
  );
}
