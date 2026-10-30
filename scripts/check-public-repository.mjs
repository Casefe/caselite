import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: repositoryRoot,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean);

const filenameViolation = /(^|\/)\.env(?:\.|$)/;
const secretPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
];
const violations = [];

for (const file of repositoryFiles) {
  if (filenameViolation.test(file) && file !== '.env.example') {
    violations.push(`${file}: tracked environment file`);
    continue;
  }

  const content = readFileSync(resolve(repositoryRoot, file), 'utf8');
  if (secretPatterns.some((pattern) => pattern.test(content))) {
    violations.push(`${file}: probable credential material`);
  }
}

if (violations.length > 0) {
  console.error('Public-repository safety check failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Public-repository safety check passed: ${repositoryFiles.length} repository file(s) scanned.`,
  );
  console.log(
    'This is a minimal deterministic guard, not a replacement for a dedicated secret scanner.',
  );
}
