import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { tmpdir } from 'node:os';

export function validateSilentPerformance(
  enabledBuild: boolean,
  root: string | undefined,
  output: string | undefined,
) {
  if (!enabledBuild || !root || !output || !/^run-[0-9]+\.json$/.test(output))
    throw new Error('Silent performance configuration rejected');
  const temporary = realpathSync(tmpdir());
  if (
    realpathSync(root) !== root ||
    !root.startsWith(temporary + sep) ||
    !basename(root).startsWith('caselite-task-demo-silent-')
  )
    throw new Error('Silent performance root rejected');
  // 只接受执行器自己创建的目录；任何符号链接在数据库/会话触达前拒绝。
  const walk = (path: string) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || stat.uid !== process.getuid?.())
      throw new Error('Silent performance ownership rejected');
    if (stat.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name));
  };
  walk(root);
  const manifest = JSON.parse(readFileSync(join(root, 'silent-manifest.json'), 'utf8'));
  if (
    manifest.version !== 1 ||
    manifest.purpose !== 'DEV-1932-synthetic-only' ||
    manifest.root !== root ||
    manifest.credentialAccess !== 'disabled' ||
    !/^[a-f0-9]{64}$/.test(manifest.token)
  )
    throw new Error('Silent performance manifest rejected');
  if (readdirSync(root).includes(output)) throw new Error('Silent output exists');
  return { root, output: join(root, output) };
}
