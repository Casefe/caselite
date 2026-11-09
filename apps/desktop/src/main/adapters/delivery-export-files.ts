import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, copyFile, link, unlink } from 'node:fs/promises';
import { dirname, join, resolve, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import type { DeliveryExport } from '@caselite/contracts';
import type { DeliveryExportFilesPort } from '@caselite/application';

export function createDeliveryExportFiles(
  directory: string,
  openPath: (path: string) => Promise<string>,
  choosePath?: (row: DeliveryExport) => Promise<string | null>,
): DeliveryExportFilesPort {
  const root = resolve(directory);
  async function folder(name: string) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    if ((await lstat(root)).isSymbolicLink()) throw new Error('Linked export root');
    const parent = await realpath(root),
      path = join(parent, name);
    await mkdir(path, { mode: 0o700, recursive: true });
    if ((await lstat(path)).isSymbolicLink() || (await realpath(path)) !== path)
      throw new Error('Linked export folder');
    return path;
  }
  const id = (row: DeliveryExport) => {
    if (!/^[a-f0-9-]{36}$/.test(row.id)) throw new Error('Invalid artifact identity');
    return row.id;
  };
  async function checked(path: string, row: DeliveryExport) {
    let file;
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 20_000_000 || stat.size !== row.bytes || !row.sha256)
        throw new Error('Invalid artifact file');
      if (
        createHash('sha256')
          .update(await file.readFile())
          .digest('hex') !== row.sha256
      )
        throw new Error('Artifact hash mismatch');
      if (stat.nlink !== 1) {
        // link落位后、清理part前退出：只恢复同目录、同inode且匹配预期hash的自有中间文件。
        if (row.status !== 'pending' || stat.nlink !== 2)
          throw new Error('Unexpected artifact link');
        const partial = await lstat(path + '.part');
        if (
          !partial.isFile() ||
          partial.isSymbolicLink() ||
          partial.ino !== stat.ino ||
          partial.dev !== stat.dev
        )
          throw new Error('Unowned artifact link');
        await unlink(path + '.part');
        const directory = await open(await folder('fixed'), constants.O_RDONLY);
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
        if ((await file.stat()).nlink !== 1) throw new Error('Unexpected remaining link');
      }
      return true;
    } finally {
      await file.close();
    }
  }
  async function location(row: DeliveryExport) {
    return join(await folder('fixed'), `${id(row)}.${row.format}`);
  }
  return {
    async read(row) {
      if (row.format !== 'pdf' || row.status !== 'ready') throw new Error('Invalid preview');
      const path = await location(row);
      if (!(await checked(path, row))) throw new Error('Missing fixed export');
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size !== row.bytes || stat.size > 20_000_000)
          throw new Error('Invalid preview file');
        const bytes = await file.readFile();
        if (
          bytes.length !== row.bytes ||
          bytes.subarray(0, 5).toString() !== '%PDF-' ||
          createHash('sha256').update(bytes).digest('hex') !== row.sha256
        )
          throw new Error('Preview hash mismatch');
        return new Uint8Array(bytes);
      } finally {
        await file.close();
      }
    },
    async save(row) {
      const source = await location(row);
      if (!(await checked(source, row)) || !choosePath)
        throw new Error('Missing export or save dialog');
      const target = await choosePath(row);
      if (!target) return false;
      if (extname(target).toLowerCase() !== '.' + row.format) throw new Error('Wrong extension');
      const parent = await realpath(dirname(target));
      const protectedRoot = await realpath(dirname(root));
      const under = relative(protectedRoot, parent);
      if (
        under === '' ||
        (!under.startsWith('..' + '/') && under !== '..' && !under.startsWith('/'))
      )
        throw new Error('Protected output target');
      if (parent !== resolve(dirname(target))) throw new Error('Linked target folder');
      // 最终目标只用排他写入，不接受对话框的同名覆盖；失败只清理本次创建的副本。
      let created = false;
      try {
        await copyFile(source, target, constants.COPYFILE_EXCL);
        created = true;
        if (!(await checked(target, row))) throw new Error('Copy validation failed');
        const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          await file.sync();
        } finally {
          await file.close();
        }
        const directory = await open(parent, constants.O_RDONLY);
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
        return true;
      } catch (error) {
        if (created) await unlink(target);
        throw error;
      }
    },
    async verify(row) {
      return checked(await location(row), row);
    },
    async put(row, bytes) {
      const dest = await location(row),
        temp = dest + '.part';
      if (await checked(dest, row)) return;
      try {
        const old = await lstat(temp);
        if (!old.isFile() || old.isSymbolicLink() || old.nlink !== 1)
          throw new Error('Unsafe partial file');
        await unlink(temp);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const file = await open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      // 不覆盖已有落位文件；中断后按SQLite预期hash恢复同一产物身份。
      await link(temp, dest);
      await unlink(temp);
      const dir = await open(await folder('fixed'), constants.O_RDONLY);
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    },
    async open(row) {
      const source = await location(row);
      if (!(await checked(source, row))) throw new Error('Missing fixed export');
      const work = join(
        await folder('working'),
        `${row.format === 'pdf' ? 'PDF' : 'Word'}草稿-${id(row)}.${row.format}`,
      );
      try {
        await copyFile(source, work, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const info = await lstat(work);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.nlink !== 1 ||
        info.ino === (await lstat(source)).ino
      )
        throw new Error('Unsafe work copy');
      // 已有工作副本可能含用户外部编辑，不用固定产物覆盖；只把副本交给系统应用。
      const error = await openPath(work);
      if (error) throw new Error('Associated application failed');
    },
  };
}
