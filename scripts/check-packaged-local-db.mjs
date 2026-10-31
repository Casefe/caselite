import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('Packaged SQLite smoke test requires macOS Apple Silicon');
}

const appRoot = join(process.cwd(), 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents');
const executable = join(appRoot, 'MacOS/CaseLite');
const nativeModule = join(
  appRoot,
  'Resources/app.asar.unpacked/.webpack/main/native_modules/prebuilds/darwin-arm64.node',
);
const migration = join(appRoot, 'Resources/migrations/0000_peaceful_hercules.sql');

for (const file of [executable, nativeModule, migration]) {
  if (!existsSync(file)) throw new Error(`Missing packaged file: ${file}`);
}

const result = spawnSync(executable, [], {
  env: { ...process.env, CASELITE_DB_PROBE: '1' },
  encoding: 'utf8',
  timeout: 30_000,
});

if (
  result.error ||
  result.status !== 0 ||
  !result.stdout.includes('CaseLite SQLite/Drizzle Electron probe passed.')
) {
  throw new Error(
    `Packaged SQLite smoke test failed (exit=${result.status ?? 'none'}, signal=${result.signal ?? 'none'}). Check the macOS crash report if the app exited unexpectedly.`,
  );
}

process.stdout.write('Packaged SQLite/Drizzle smoke test passed.\n');
