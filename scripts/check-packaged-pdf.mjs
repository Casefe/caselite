import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('Packaged PDF smoke test requires macOS Apple Silicon');
}

const root = process.cwd();
const executable = join(
  root,
  'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite',
);
const archive = join(
  root,
  'apps/desktop/out/make/zip/darwin/arm64/CaseLite-darwin-arm64-0.0.0.zip',
);
for (const file of [executable, archive]) {
  if (!existsSync(file)) throw new Error('Missing packaged CaseLite application or macOS ZIP');
}

// The app itself blocks HTTP(S) in this probe mode. A success proves that the
// renderer, PDF Worker, fonts and samples can load from the packaged app only.
const result = spawnSync(executable, [], {
  cwd: root,
  env: { ...process.env, CASELITE_PDF_PROBE: '1' },
  encoding: 'utf8',
  timeout: 45_000,
});
if (
  result.error ||
  result.status !== 0 ||
  !result.stdout.includes('CaseLite packaged offline PDF probe passed.')
) {
  const safeStage = (result.stderr ?? '')
    .split('\n')
    .find((line) => /^CaseLite PDF probe failed at [a-z-]+\.$/.test(line));
  const safeState = (result.stderr ?? '')
    .split('\n')
    .find((line) =>
      /^CaseLite PDF probe state: nativeWorker=(true|false|null), canvas=(true|false), text=(true|false), error=(true|false)\.$/.test(
        line,
      ),
    );
  throw new Error(
    `Packaged offline PDF smoke test failed (exit=${result.status ?? 'none'}, signal=${result.signal ?? 'none'}). ${safeStage ?? 'No stage diagnostic.'} ${safeState ?? ''}`,
  );
}
process.stdout.write('Packaged offline PDF smoke test passed.\n');
