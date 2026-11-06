import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, rename, unlink, lstat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { MATERIAL_MAX_BYTES } from '@caselite/contracts';
import type { MaterialFilesPort } from '@caselite/application';
const validId = (value: string) => {
  if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid identity');
  return value;
};
export function createMaterialFiles(root: string): MaterialFilesPort {
  const staged = join(root, 'staging'),
    assets = join(root, 'originals');
  const path = (dir: string, id: string) => join(dir, validId(id) + '.pdf');
  async function setup() {
    for (const dir of [root, staged, assets]) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const st = await lstat(dir);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Invalid file root');
    }
  }
  async function read(file: string, sha?: string) {
    const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await fd.stat();
      if (!before.isFile() || before.size < 8 || before.size > MATERIAL_MAX_BYTES)
        throw new Error('File budget');
      const bytes = await fd.readFile();
      const after = await fd.stat();
      if (
        bytes.length !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.size !== before.size
      )
        throw new Error('File changed');
      if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Invalid PDF');
      if (sha && createHash('sha256').update(bytes).digest('hex') !== sha)
        throw new Error('Hash mismatch');
      return bytes;
    } finally {
      await fd.close();
    }
  }
  async function syncDirectory(dir: string) {
    const fd = await open(dir, constants.O_RDONLY);
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
  }
  async function exists(file: string) {
    try {
      await lstat(file);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  }
  return {
    async stage(source, scope) {
      await setup();
      if (!/\.pdf$/i.test(source)) throw new Error('Unsupported type');
      const bytes = await read(source),
        token = randomUUID();
      const fd = await open(path(staged, token), 'wx', 0o600);
      try {
        await fd.writeFile(bytes);
        await fd.sync();
      } finally {
        await fd.close();
      }
      await syncDirectory(staged);
      return {
        token,
        scope,
        name: basename(source).slice(0, 500),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        state: 'staged',
      };
    },
    async placedOrStaged(id, sha) {
      return read((await exists(path(assets, id))) ? path(assets, id) : path(staged, id), sha);
    },
    async place(id, sha) {
      await setup();
      if (await exists(path(assets, id))) {
        await read(path(assets, id), sha);
        return;
      }
      await read(path(staged, id), sha);
      await rename(path(staged, id), path(assets, id));
      await syncDirectory(assets);
      await syncDirectory(staged);
      await read(path(assets, id), sha);
    },
    async read(id, sha) {
      return read(path(assets, id), sha);
    },
    async discard(id) {
      try {
        await unlink(path(staged, id));
        await syncDirectory(staged);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    },
    async restore(token, id, sha) {
      let healthy = false;
      try {
        await read(path(assets, id), sha);
        healthy = true;
      } catch {
        /* 原件不可用时才使用已校验的恢复副本。 */
      }
      if (healthy) {
        try {
          await unlink(path(staged, token));
          await syncDirectory(staged);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        return;
      }
      await read(path(staged, token), sha);
      // 损坏副本留在原件目录，恢复只使用完全相同 hash，不悄悄替换来源版本。
      if (await exists(path(assets, id)))
        await rename(path(assets, id), join(assets, `${validId(id)}.damaged-${randomUUID()}`));
      await rename(path(staged, token), path(assets, id));
      await syncDirectory(assets);
      await syncDirectory(staged);
      await read(path(assets, id), sha);
    },
  };
}
