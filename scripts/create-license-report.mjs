import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const reportDirectory = resolve(repositoryRoot, 'artifacts/licenses');
const reportFile = resolve(reportDirectory, 'production-dependencies.json');
const workspaceManifestFiles = [
  resolve(repositoryRoot, 'package.json'),
  resolve(repositoryRoot, 'apps/desktop/package.json'),
  ...readdirSync(resolve(repositoryRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(repositoryRoot, 'packages', entry.name, 'package.json'))
    .filter(existsSync),
];
const workspaceManifests = workspaceManifestFiles.map((file) => readJson(file));
const workspaceManifestByName = new Map(
  workspaceManifests.map((manifest) => [manifest.name, manifest]),
);
const visited = new Set();
const packages = [];
const unresolved = [];

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function resolveManifest(packageName, issuerManifestFile) {
  const workspaceManifest = workspaceManifestByName.get(packageName);
  if (workspaceManifest) {
    return workspaceManifestFiles.find((file) => readJson(file).name === packageName);
  }

  const requireFromIssuer = createRequire(issuerManifestFile);
  try {
    return requireFromIssuer.resolve(`${packageName}/package.json`);
  } catch {
    const entry = requireFromIssuer.resolve(packageName);
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

function visit(packageName, issuerManifestFile) {
  let manifestFile;
  try {
    manifestFile = resolveManifest(packageName, issuerManifestFile);
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
    visit(dependency, manifestFile);
  }
}

for (let index = 0; index < workspaceManifests.length; index += 1) {
  const manifest = workspaceManifests[index];
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    visit(dependency, workspaceManifestFiles[index]);
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
      scope: 'Production dependencies reachable from all current workspace manifests',
    },
    null,
    2,
  )}\n`,
);
console.log(
  `License report written to artifacts/licenses/production-dependencies.json (${packages.length} package(s)).`,
);
