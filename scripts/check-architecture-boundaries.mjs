import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { imports, sourceFiles } from './lib/source-analysis.mjs';

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const packageName = (name) =>
  name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
const posix = (path) => path.replaceAll('\\', '/');
const under = (file, folder) => file === folder || file.startsWith(`${folder}/`);
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function boundaryViolation(file, specifier, target, typeOnly = false) {
  const node = specifier.startsWith('node:') || builtins.has(specifier.split('/')[0]);
  const pkg = packageName(specifier);
  const renderer = file.includes('/renderer/');
  const forbidden = [
    'electron',
    'better-sqlite3',
    'drizzle-orm',
    '@caselite/application',
    '@caselite/domain',
    '@caselite/local-db',
    '@caselite/files',
    '@earendil-works/pi-agent-core',
    '@earendil-works/pi-ai',
  ];
  if (renderer && (node || forbidden.includes(pkg) || (pkg === '@caselite/contracts' && !typeOnly)))
    return 'renderer cannot access privileged implementation';
  if (
    renderer &&
    target &&
    !target.includes('/renderer/') &&
    !(typeOnly && target.endsWith('/preload/caselite-api.ts'))
  )
    return 'renderer cannot cross the desktop process boundary';
  if (file.includes('/preload/') && target?.includes('/main/'))
    return 'preload cannot import main implementation';
  if (
    file.includes('/preload/') &&
    (node || forbidden.filter((name) => name !== 'electron').includes(pkg))
  )
    return 'preload must use fixed IPC instead of privileged implementation';
  if (
    file.includes('/main/ipc/') &&
    (['better-sqlite3', 'drizzle-orm', '@caselite/local-db', '@caselite/files'].includes(pkg) ||
      target?.startsWith('packages/local-db/') ||
      target?.startsWith('packages/files/'))
  )
    return 'IPC handlers must use Application ports';
  const own = file.match(/^packages\/([^/]+)\//)?.[1];
  const other = target?.match(/^packages\/([^/]+)\//)?.[1];
  const allowed = {
    domain: [],
    contracts: [],
    application: ['domain', 'contracts'],
    'sync-client': ['domain', 'contracts', 'crdt'],
  };
  if (own in allowed && other && other !== own && !allowed[own].includes(other))
    return `${own} cannot depend on ${other}`;
  if (own && target?.startsWith('apps/')) return 'packages cannot import application hosts';
  if (
    own === 'domain' &&
    (node ||
      ['electron', 'react', 'react-dom', 'drizzle-orm', 'better-sqlite3', 'yjs', 'zod'].includes(
        pkg,
      ))
  )
    return 'domain must remain independent of frameworks';
  if (
    own === 'contracts' &&
    (node ||
      ['electron', 'react', 'react-dom', 'drizzle-orm', 'better-sqlite3', 'yjs'].includes(pkg))
  )
    return 'contracts cannot depend on implementation frameworks';
  if (
    own === 'application' &&
    (node ||
      ['electron', 'react', 'react-dom', 'drizzle-orm', 'better-sqlite3', 'yjs'].includes(pkg))
  )
    return 'application must use ports';
  if (own === 'sync-client' && ['react', 'react-dom'].includes(pkg))
    return 'sync-client cannot depend on React';
  if (
    (file.includes('/hosts/mcp/') ||
      file.startsWith('packages/skills/') ||
      file.startsWith('packages/integrations/mcp/')) &&
    ((node && /fs|sqlite/.test(specifier)) ||
      ['better-sqlite3', 'drizzle-orm', '@caselite/local-db'].includes(pkg) ||
      target?.startsWith('packages/local-db/') ||
      target?.includes('/repositories/'))
  )
    return 'MCP/skills must use Application ports';
  if (/\/(?:ee|enterprise|commercial)\//i.test(`/${specifier}/${target ?? ''}/`))
    return 'commercial source requires separate admission';
  return null;
}

export function analyzeArchitecture(root) {
  const violations = [];
  const manifests = [
    'apps/desktop',
    ...readdirSync(resolve(root, 'packages'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `packages/${e.name}`),
  ]
    .filter((folder) => existsSync(resolve(root, folder, 'package.json')))
    .map((folder) => ({ folder, ...json(resolve(root, folder, 'package.json')) }));
  const workspaces = new Map(manifests.map((item) => [item.name, item]));
  const files = manifests.flatMap((item) =>
    existsSync(resolve(root, item.folder, 'src'))
      ? sourceFiles(resolve(root, item.folder, 'src')).filter(
          (file) => !/\.(?:test|spec)\./.test(file),
        )
      : [],
  );
  const graph = new Map(files.map((file) => [posix(relative(root, file)), []]));
  const used = new Set();
  const resolveSource = (base) =>
    [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mjs`,
      `${base}.js`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    ].find((file) => graph.has(posix(relative(root, file))));
  const publicEntry = (item) => {
    const entry = item.exports?.['.'];
    return typeof entry === 'string' ? entry : (entry?.default ?? item.main ?? './src/index.ts');
  };
  for (const item of manifests) {
    if (
      !files.some(
        (file) =>
          under(posix(relative(root, file)), `${item.folder}/src`) &&
          readFileSync(file, 'utf8')
            .replace(/export\s*\{\s*\}\s*;?/g, '')
            .replace(/\s|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').length > 0,
      )
    )
      violations.push(`${item.folder}: workspace has no implementation`);
  }
  for (const file of files) {
    const name = posix(relative(root, file));
    const owner = manifests.find((item) => under(name, item.folder));
    for (const entry of imports(readFileSync(file, 'utf8'), file)) {
      const specifier = entry.specifier;
      if (specifier === null) {
        violations.push(`${name}: non-literal module loading requires review`);
        continue;
      }
      const dependency = workspaces.get(packageName(specifier));
      let resolved;
      if (specifier.startsWith('.')) resolved = resolveSource(resolve(dirname(file), specifier));
      else if (dependency) {
        if (specifier !== dependency.name)
          violations.push(`${name}: workspace deep import ${specifier}`);
        resolved = resolveSource(resolve(root, dependency.folder, publicEntry(dependency)));
        if (dependency.name !== owner.name) used.add(dependency.name);
        if (!resolved) violations.push(`${name}: unresolved workspace entry ${specifier}`);
      }
      const target = resolved ? posix(relative(root, resolved)) : undefined;
      if (target) graph.get(name).push(target);
      const reason = boundaryViolation(name, specifier, target, entry.typeOnly);
      if (reason) violations.push(`${name}: ${reason}: ${specifier}`);
      const targetOwner = manifests.find((item) => target && under(target, item.folder));
      if (targetOwner && targetOwner.name !== owner.name) {
        used.add(targetOwner.name);
        if (specifier.startsWith('.'))
          violations.push(`${name}: cross-workspace relative import bypasses public entry`);
      }
      if (
        !specifier.startsWith('.') &&
        !specifier.startsWith('node:') &&
        !builtins.has(specifier.split('/')[0]) &&
        !owner.dependencies?.[packageName(specifier)] &&
        !owner.devDependencies?.[packageName(specifier)]
      )
        violations.push(`${name}: undeclared dependency ${packageName(specifier)}`);
    }
  }
  for (const item of manifests.filter((item) => item.folder.startsWith('packages/')))
    if (!used.has(item.name)) violations.push(`${item.folder}: unused workspace package`);
  const active = new Set();
  const done = new Set();
  function visit(file) {
    if (active.has(file)) {
      violations.push(`circular dependency: ${file}`);
      return;
    }
    if (done.has(file)) return;
    active.add(file);
    for (const target of graph.get(file) ?? []) visit(target);
    active.delete(file);
    done.add(file);
  }
  for (const file of graph.keys()) visit(file);
  const deferred = [
    'apps/server',
    'packages/work-runtime',
    'packages/integrations',
    'packages/skills',
    'packages/sync-client',
    'packages/authz',
    'infra',
  ];
  for (const folder of deferred)
    if (existsSync(resolve(root, folder)) && sourceFiles(resolve(root, folder)).length === 0)
      violations.push(`${folder}: empty future platform directory`);
  return {
    violations,
    workspaces: manifests.map(({ name, folder }) => ({ name, folder })),
    graph: Object.fromEntries(graph),
    scannedFiles: files.length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const report = analyzeArchitecture(root);
  const fixtures = ['renderer-imports-node.ts', 'renderer-imports-application.ts'];
  for (const fixture of fixtures) {
    const file = resolve(root, 'tests/fixtures/architecture-boundaries', fixture);
    if (
      !imports(readFileSync(file, 'utf8'), file).some(
        (entry) =>
          entry.specifier &&
          boundaryViolation('apps/desktop/src/renderer/fixture.ts', entry.specifier),
      )
    )
      report.violations.push(`negative fixture not detected: ${fixture}`);
  }
  mkdirSync(resolve(root, 'artifacts/evidence'), { recursive: true });
  writeFileSync(
    resolve(root, 'artifacts/evidence/architecture-graph.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (report.violations.length) {
    console.error(report.violations.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Architecture boundary check passed: ${report.scannedFiles} source files scanned.`);
    for (const fixture of fixtures) console.log(`Deliberate negative fixture detected: ${fixture}`);
  }
}
