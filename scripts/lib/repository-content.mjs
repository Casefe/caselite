import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export function readWorktreeOrIndex(root, file) {
  const path = resolve(root, file);
  // git ls-files includes indexed paths that have been moved/deleted before
  // staging. Their indexed content still needs scanning before a public push.
  return existsSync(path)
    ? readFileSync(path)
    : execFileSync('git', ['show', `:${file}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
}
