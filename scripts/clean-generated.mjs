import { existsSync, lstatSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const generatedDirectories = [
  'apps/desktop/.webpack',
  'apps/desktop/out',
  'artifacts',
  'coverage',
  'playwright-report',
  '.vitest',
];

function resolveInsideRepository(relativePath) {
  const target = path.resolve(repositoryRoot, relativePath);
  const relativeTarget = path.relative(repositoryRoot, target);

  if (
    relativeTarget === '' ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    throw new Error(`拒绝清理仓库外或仓库根目录：${relativePath}`);
  }

  return target;
}

for (const relativePath of generatedDirectories) {
  const target = resolveInsideRepository(relativePath);

  if (!existsSync(target)) {
    console.log(`跳过（不存在）：${relativePath}`);
    continue;
  }

  if (lstatSync(target).isSymbolicLink()) {
    throw new Error(`拒绝清理符号链接：${relativePath}`);
  }

  rmSync(target, { force: true, recursive: true, maxRetries: 2, retryDelay: 100 });
  console.log(`已清理可重建目录：${relativePath}`);
}

console.log('清理完成：源码、锁文件、node_modules 和用户资料均未触及。');
