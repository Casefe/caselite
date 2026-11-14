import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, rename, unlink, lstat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { MATERIAL_MAX_BYTES, materialKind, type MaterialKind } from '@caselite/contracts';
import type {
  MaterialFilesPort,
  MaterialFileIdentity,
  PersonalMaterialFilesPort,
  FolderGuard,
} from '@caselite/application';
const validId = (value: string) => {
  if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid identity');
  return value;
};
const zip = Buffer.from([80, 75, 3, 4]);
const pdf = Buffer.from('%PDF-');
export function materialSignature(data: Uint8Array): MaterialKind | undefined {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
  )
    return 'image';
  if (bytes.subarray(0, 4).equals(zip)) return 'docx';
  if (bytes.subarray(0, 1024).includes(pdf)) return 'pdf';
}

export function createMaterialFiles(root: string): MaterialFilesPort & PersonalMaterialFilesPort {
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
  const checked = async <T>(guard: FolderGuard, effect: () => Promise<T>) => {
    guard();
    try {
      const value = await effect();
      guard();
      return value;
    } catch (error) {
      guard();
      throw error;
    }
  };
  async function durableExisting(file: string, sha: string, guard: FolderGuard) {
    guard();
    const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      guard();
      const stat = await checked(guard, () => fd.stat());
      if (!stat.isFile() || stat.size < 8 || stat.size > MATERIAL_MAX_BYTES)
        throw new Error('FILE_LIMIT');
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await checked(guard, () =>
          fd.read(bytes, offset, bytes.length - offset, offset),
        );
        if (!result.bytesRead) throw new Error('SOURCE_UNAVAILABLE');
        offset += result.bytesRead;
      }
      const after = await checked(guard, () => fd.stat());
      if (
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        createHash('sha256').update(bytes).digest('hex') !== sha ||
        !materialSignature(bytes)
      )
        throw new Error('SOURCE_UNAVAILABLE');
      // 上次可能在写完/改名前的fsync边界中断；重用前再次确保持久化。
      await checked(guard, () => fd.sync());
      return bytes;
    } finally {
      await fd.close();
    }
  }
  async function durableSetup(guard: FolderGuard) {
    for (const dir of [root, staged, assets]) {
      await checked(guard, () => mkdir(dir, { recursive: true, mode: 0o700 }));
      const stat = await checked(guard, () => lstat(dir));
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('SOURCE_UNAVAILABLE');
    }
  }
  async function durableLocate(dir: string, id: string, guard: FolderGuard) {
    const legacy = path(dir, id),
      attachment = path(dir, id, 'docx');
    const hasAttachment = await checked(guard, () => exists(attachment));
    const hasLegacy = await checked(guard, () => exists(legacy));
    if (hasAttachment && hasLegacy) throw new Error('SOURCE_UNAVAILABLE');
    return hasAttachment ? attachment : legacy;
  }
  async function durableRead(id: string, sha: string, guard: FolderGuard) {
    const placed = await durableLocate(assets, id, guard);
    const file = (await checked(guard, () => exists(placed)))
      ? placed
      : await durableLocate(staged, id, guard);
    const bytes = await durableExisting(file, sha, guard);
    await checked(guard, () => syncDirectory(file === placed ? assets : staged));
    return bytes;
  }
  return {
    async stageFrozen(data, name, token, sha, guard) {
      guard();
      validId(token);
      const kind = materialKind(name),
        bytes = Buffer.from(data);
      if (
        !kind ||
        bytes.length < 8 ||
        bytes.length > MATERIAL_MAX_BYTES ||
        materialSignature(bytes) !== kind ||
        createHash('sha256').update(bytes).digest('hex') !== sha
      )
        throw new Error('UNSUPPORTED_FORMAT');
      await durableSetup(guard);
      const existing = await durableLocate(assets, token, guard);
      const pending = await durableLocate(staged, token, guard);
      if (await checked(guard, () => exists(existing))) {
        await durableExisting(existing, sha, guard);
        await checked(guard, () => syncDirectory(assets));
        return;
      }
      if (await checked(guard, () => exists(pending))) {
        await durableExisting(pending, sha, guard);
        await checked(guard, () => syncDirectory(staged));
        return;
      }
      guard();
      const finalPending = path(staged, token, kind);
      // 未写完的临时文件不占用正式token；中断后仅校验/复用完整已命名副本。
      const writing = join(staged, `.partial-${validId(token)}-${randomUUID()}`);
      const fd = await open(writing, 'wx', 0o600);
      try {
        guard();
        await checked(guard, () => fd.writeFile(bytes));
        await checked(guard, () => fd.sync());
      } finally {
        await fd.close();
      }
      await checked(guard, () => rename(writing, finalPending));
      await checked(guard, () => syncDirectory(staged));
    },
    async stagePhoto(data, scope, token) {
      await setup();
      if (data.length < 8 || data.length > 8 * 1024 * 1024 || materialSignature(data) !== 'image')
        throw new Error('Invalid photo');
      validId(token);
      const bytes = Buffer.from(data);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const pending = path(staged, token, 'image'),
        placed = await locate(assets, token),
        existingPending = await locate(staged, token);
      let newlyCreated = false;
      if (await exists(placed)) await read(placed, sha256);
      else if (await exists(existingPending)) await read(existingPending, sha256);
      else {
        const fd = await open(pending, 'wx', 0o600);
        newlyCreated = true;
        try {
          await fd.writeFile(bytes);
          await fd.sync();
        } finally {
          await fd.close();
        }
        await syncDirectory(staged);
      }
      return {
        newly_created: newlyCreated,
        token,
        scope,
        name: `照片-${token.slice(0, 8)}.${bytes[0] === 137 ? 'png' : 'jpg'}`,
        bytes: bytes.length,
        sha256,
        state: 'staged',
      };
    },
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
            : basename(source).slice(0, 490) +
              '.' +
              (kind === 'image' ? (bytes[0] === 137 ? 'png' : 'jpg') : kind),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        state: 'staged',
      };
    },
    async placedOrStaged(id, sha, guard?: FolderGuard) {
      if (guard) return durableRead(id, sha, guard);
      const placed = await locate(assets, id);
      return read((await exists(placed)) ? placed : await locate(staged, id), sha);
    },
    async place(id, sha, guard?: FolderGuard) {
      if (guard) {
        await durableSetup(guard);
        const placed = await durableLocate(assets, id, guard);
        if (await checked(guard, () => exists(placed))) {
          await durableExisting(placed, sha, guard);
          await checked(guard, () => syncDirectory(assets));
          await checked(guard, () => syncDirectory(staged));
          return;
        }
        const pending = await durableLocate(staged, id, guard);
        const kind = materialSignature(await durableExisting(pending, sha, guard))!;
        const target = path(assets, id, kind);
        await checked(guard, () => rename(pending, target));
        await checked(guard, () => syncDirectory(assets));
        await checked(guard, () => syncDirectory(staged));
        await durableExisting(target, sha, guard);
        return;
      }
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
    async read(id, sha, guard?: FolderGuard) {
      if (guard) {
        const file = await durableLocate(assets, id, guard);
        return durableExisting(file, sha, guard);
      }
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
