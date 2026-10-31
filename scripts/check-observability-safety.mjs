import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const productionRoots = ['apps', 'packages'].map((directory) => resolve(repositoryRoot, directory));
const forbiddenLogging = /\bconsole\.(?:debug|info|log|warn|error)\s*\(/;
const excludedDirectories = new Set(['.webpack', 'node_modules', 'out']);

function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return excludedDirectories.has(entry.name) ? [] : collectSourceFiles(filePath);
    }
    return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [filePath] : [];
  });
}

const violations = productionRoots
  .flatMap(collectSourceFiles)
  .filter((filePath) => forbiddenLogging.test(readFileSync(filePath, 'utf8')))
  .map(
    (filePath) => `${relative(repositoryRoot, filePath)}: direct console logging is not permitted`,
  );

if (violations.length > 0) {
  console.error('Observability safety check failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log('Observability safety check passed: production code has no direct console logging.');
}
