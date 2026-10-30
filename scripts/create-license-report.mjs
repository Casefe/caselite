import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const requireFromRepository = createRequire(resolve(repositoryRoot, 'package.json'));
const reportDirectory = resolve(repositoryRoot, 'artifacts/licenses');
const reportFile = resolve(reportDirectory, 'production-dependencies.json');
const workspaceManifests = ['package.json', 'apps/desktop/package.json'];
const visited = new Set();
const packages = [];
const unresolved = [];

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function resolveManifest(packageName) {
  try {
    return requireFromRepository.resolve(`${packageName}/package.json`);
  } catch {
    const entry = requireFromRepository.resolve(packageName);
    let directory = dirname(entry);
    while (directory.startsWith(repositoryRoot)) {
      const manifestFile = resolve(directory, 'package.json');
      try {
        const manifest = readJson(manifestFile);
        if (manifest.name === packageName) return manifestFile;
      } catch {
        // Continue upward until the installed package manifest is found.
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    throw new Error(`Cannot locate manifest for ${packageName}`);
  }
}

function visit(packageName) {
  let manifestFile;
  try {
    manifestFile = resolveManifest(packageName);
  } catch (error) {
    unresolved.push(`${packageName}: ${error.message}`);
    return;
  }

  const manifest = readJson(manifestFile);
  const identity = `${manifest.name}@${manifest.version}`;
  if (visited.has(identity)) return;
  visited.add(identity);

  packages.push({
    license: manifest.license ?? 'UNKNOWN',
    name: manifest.name,
    version: manifest.version,
  });

  for (const dependency of Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  }).sort()) {
    visit(dependency);
  }
}

for (const workspaceManifest of workspaceManifests) {
  const manifest = readJson(resolve(repositoryRoot, workspaceManifest));
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    visit(dependency);
  }
}

if (unresolved.length > 0) {
  console.error(
    'License report failed because installed production packages could not be resolved:',
  );
  for (const item of unresolved) console.error(`- ${item}`);
  process.exit(1);
}

mkdirSync(reportDirectory, { recursive: true });
writeFileSync(
  reportFile,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      packages: packages.sort((left, right) => left.name.localeCompare(right.name)),
      scope: 'Production dependencies reachable from root and apps/desktop manifests',
    },
    null,
    2,
  )}\n`,
);
console.log(
  `License report written to artifacts/licenses/production-dependencies.json (${packages.length} package(s)).`,
);
