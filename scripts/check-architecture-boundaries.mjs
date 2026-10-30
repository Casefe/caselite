import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rendererRoot = resolve(repositoryRoot, 'apps/desktop/src/renderer');
const fixture = resolve(
  repositoryRoot,
  'tests/fixtures/architecture-boundaries/renderer-imports-node.ts',
);

const forbiddenRendererPackages = new Set([
  'electron',
  'better-sqlite3',
  'drizzle-orm',
  '@caselite/application',
  '@caselite/domain',
  '@caselite/files',
  '@caselite/local-db',
]);

const forbiddenNodeBuiltins = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) return collectTypeScriptFiles(absolutePath);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
    }),
  );
  return nested.flat();
}

function importedSpecifiers(source) {
  const expressions = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return expressions.flatMap((expression) =>
    [...source.matchAll(expression)].map((match) => match[1]),
  );
}

function isForbiddenRendererSpecifier(specifier) {
  if (specifier.startsWith('node:')) return true;
  if (forbiddenNodeBuiltins.has(specifier)) return true;
  if (forbiddenRendererPackages.has(specifier)) return true;
  return [...forbiddenRendererPackages].some((packageName) =>
    specifier.startsWith(`${packageName}/`),
  );
}

async function findViolations(filePath) {
  const source = await readFile(filePath, 'utf8');
  return importedSpecifiers(source)
    .filter(isForbiddenRendererSpecifier)
    .map(
      (specifier) =>
        `${relative(repositoryRoot, filePath)} imports forbidden module "${specifier}"`,
    );
}

const rendererFiles = await collectTypeScriptFiles(rendererRoot);
const rendererViolations = (await Promise.all(rendererFiles.map(findViolations))).flat();
const fixtureViolations = await findViolations(fixture);

if (fixtureViolations.length === 0) {
  console.error(
    'Architecture check configuration error: the deliberate renderer violation was not detected.',
  );
  process.exitCode = 1;
} else if (rendererViolations.length > 0) {
  console.error('Architecture boundary violations found:');
  for (const violation of rendererViolations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Architecture boundary check passed: ${rendererFiles.length} renderer source file(s) scanned.`,
  );
  console.log(`Deliberate negative fixture detected: ${fixtureViolations[0]}`);
}
