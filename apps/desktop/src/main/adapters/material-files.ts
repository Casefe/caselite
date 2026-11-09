import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, rename, unlink, lstat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { MATERIAL_MAX_BYTES, materialKind, type MaterialKind } from '@caselite/contracts';
import type { MaterialFilesPort, MaterialFileIdentity } from '@caselite/application';
const validId = (value: string) => {
  if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid identity');
  return value;
};
const zip = Buffer.from([80, 75, 3, 4]);
const pdf = Buffer.from('%PDF-');
export function materialSignature(data: Uint8Array): MaterialKind | undefined {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.subarray(0, 4).equals(zip)) return 'docx';
  if (bytes.subarray(0, 1024).includes(pdf)) return 'pdf';
}

export function createMaterialFiles(root: string): MaterialFilesPort {
  const staged = join(root, 'staging'),
    assets = join(root, 'originals');
  const path = (dir: string, id: string, kind: MaterialKind = 'pdf') =>
    join(dir, validId(id) + (kind === 'pdf' ? '.pdf' : '.asset'));
  // 旧 PDF 原件仍以原身份和路径读取；新的格式不迁移或重写旧文件。
  const locate = async (dir: string, id: string) => {
    const legacy = path(dir, id),
      attachment = path(dir, id, 'docx');
    if (!(await exists(attachment))) return legacy;
    if (await exists(legacy)) throw new Error('Ambiguous asset identity');
    return attachment;
  };
  async function setup() {
    for (const dir of [root, staged, assets]) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const st = await lstat(dir);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Invalid file root');
    }
  }
  async function read(file: string, sha?: string, expected?: MaterialFileIdentity) {
    const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await fd.stat();
      if (
        expected &&
        (before.dev !== expected.dev ||
          before.ino !== expected.ino ||
          before.size !== expected.size ||
          before.mtimeMs !== expected.mtimeMs)
      )
        throw new Error('Selected file changed');
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
      if (!materialSignature(bytes)) throw new Error('Invalid file signature');
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
    async stage(source, scope, identity, expected) {
      await setup();
      const kind = materialKind(basename(source));
      if (!kind) throw new Error('Unsupported type');
      const bytes = await read(source, undefined, expected),
        token = identity ?? randomUUID();
      if (materialSignature(bytes) !== kind) throw new Error('Unexpected file format');
      if (await exists(path(staged, token, kind))) {
        // 批次在文件落盘后、登记回执前中断时，沿原token校验复用，不能再建一份原件。
        await read(path(staged, token, kind), createHash('sha256').update(bytes).digest('hex'));
        return {
          token,
          scope,
          name: basename(source),
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          state: 'staged',
        };
      }
      const fd = await open(path(staged, token, kind), 'wx', 0o600);
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
        name:
          basename(source).length <= 500
            ? basename(source)
            : basename(source).slice(0, 490) + '.' + kind,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        state: 'staged',
      };
    },
    async placedOrStaged(id, sha) {
      const placed = await locate(assets, id);
      return read((await exists(placed)) ? placed : await locate(staged, id), sha);
    },
    async place(id, sha) {
      await setup();
      const placed = await locate(assets, id);
      if (await exists(placed)) {
        await read(placed, sha);
        return;
      }
      const pending = await locate(staged, id);
      const kind = materialSignature(await read(pending, sha))!;
      const target = path(assets, id, kind);
      await rename(pending, target);
      await syncDirectory(assets);
      await syncDirectory(staged);
      await read(target, sha);
    },
    async read(id, sha) {
      return read(await locate(assets, id), sha);
    },
    async discard(id) {
      try {
        await unlink(await locate(staged, id));
        await syncDirectory(staged);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    },
    async restore(token, id, sha) {
      const original = await locate(assets, id);
      const pending = await locate(staged, token);
      let healthy = false;
      try {
        await read(original, sha);
        healthy = true;
      } catch {
        /* 原件不可用时才使用已校验的恢复副本。 */
      }
      if (healthy) {
        try {
          await unlink(pending);
          await syncDirectory(staged);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        return;
      }
      const kind = materialSignature(await read(pending, sha))!;
      const target = path(assets, id, kind);
      // 损坏副本留在原件目录，恢复只使用完全相同 hash，不悄悄替换来源版本。
      if (await exists(original))
        await rename(original, join(assets, `${validId(id)}.damaged-${randomUUID()}`));
      await rename(pending, target);
      await syncDirectory(assets);
      await syncDirectory(staged);
      await read(target, sha);
    },
  };
}
