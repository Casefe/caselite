import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const testsRoot = resolve(repositoryRoot, 'tests');
const negativeFixture = resolve(
  repositoryRoot,
  'tests/fixtures/test-integrity/contains-test-skip.fixture.ts',
);
const disallowedModifier = /\b(?:describe|it|test)\.(?:only|skip|todo)\s*\(/g;

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const filePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'fixtures' ? [] : collectTestFiles(filePath);
      }
      return /\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name) ? [filePath] : [];
    }),
  );
  return nested.flat();
}

async function findModifiers(filePath) {
  const source = await readFile(filePath, 'utf8');
  return [...source.matchAll(disallowedModifier)].map(
    (match) => `${relative(repositoryRoot, filePath)} contains ${match[0].trim()}`,
  );
}

const testFiles = await collectTestFiles(testsRoot);
const violations = (await Promise.all(testFiles.map(findModifiers))).flat();
const fixtureViolations = await findModifiers(negativeFixture);

if (fixtureViolations.length === 0) {
  console.error(
    'Test-integrity configuration error: the deliberate skip fixture was not detected.',
  );
  process.exitCode = 1;
} else if (violations.length > 0) {
  console.error('Disallowed test modifiers found:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Test-integrity check passed: ${testFiles.length} test file(s) scanned.`);
  console.log(`Deliberate negative fixture detected: ${fixtureViolations[0]}`);
}
