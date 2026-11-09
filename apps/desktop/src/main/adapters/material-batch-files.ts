import { lstat, opendir, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  MATERIAL_BATCH_MAX_DEPTH,
  MATERIAL_BATCH_MAX_FILES,
  MATERIAL_MAX_BYTES,
  materialKind,
} from '@caselite/contracts';
import type { MaterialBatchEntry } from '@caselite/application';
export class MaterialBatchSelectionError extends Error {}

export async function validateMaterialBatchPath(path: string) {
  // 包括中间目录在内拒绝符号链接；预览之后目录被替换时，不沿新链接读取材料。
  if ((await realpath(path)) !== resolve(path))
    throw new Error('目录或文件包含链接，请选择真实本地目录。');
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('文件类型已变化，请重新选择。');
}
export async function scanMaterialBatch(
  paths: string[],
  folder: boolean,
): Promise<MaterialBatchEntry[]> {
  const entries: MaterialBatchEntry[] = [];
  let visited = 0;
  const add = (entry: MaterialBatchEntry) => {
    entries.push(entry);
    if (entries.length > MATERIAL_BATCH_MAX_FILES)
      throw new MaterialBatchSelectionError('每批最多16项，请选择更小的文件夹或文件集合。');
  };
  async function walk(path: string, relative: string, depth: number) {
    if (++visited > 256) throw new MaterialBatchSelectionError('目录项目过多，请缩小选择范围。');
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      return add({ relative_name: relative, bytes: 0, message: '已跳过符号链接' });
    if (stat.isDirectory()) {
      if (!folder) return add({ relative_name: relative, bytes: 0, message: '请使用文件夹入口' });
      if (depth > MATERIAL_BATCH_MAX_DEPTH)
        return add({ relative_name: relative, bytes: 0, message: '目录超过8层，请单独选择' });
      const names: string[] = [];
      for await (const entry of await opendir(path)) {
        names.push(entry.name);
        if (names.length + visited > 256)
          throw new MaterialBatchSelectionError('目录项目过多，请缩小选择范围。');
      }
      for (const name of names.sort())
        await walk(join(path, name), `${relative}/${name}`, depth + 1);
      return;
    }
    let message: string | undefined;
    if (!stat.isFile()) message = '已跳过非普通文件';
    else if (!materialKind(relative)) message = '暂不支持此格式';
    else if (!stat.size || stat.size > MATERIAL_MAX_BYTES) message = '文件必须非空且不超过20 MB';
    if (!message) await validateMaterialBatchPath(path);
    add({
      ...(message
        ? {}
        : {
            path,
            expected: { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs },
          }),
      relative_name: relative,
      bytes: Math.min(stat.size, Number.MAX_SAFE_INTEGER),
      message,
    });
  }
  for (const path of paths) await walk(path, basename(path), 0);
  return entries;
}
