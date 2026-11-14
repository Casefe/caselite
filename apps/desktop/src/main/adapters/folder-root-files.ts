import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import path from 'node:path';
import {
  FOLDER_DEPTH_LIMIT,
  FOLDER_DIRECTORY_LIMIT,
  FOLDER_PAGE_SIZE,
  FOLDER_SNAPSHOT_LIMIT,
  MATERIAL_MAX_BYTES,
  materialKind,
  type FolderEntry,
  type FolderScope,
} from '@caselite/contracts';
import type {
  FolderCaller,
  FolderDefault,
  FolderGuard,
  FolderProject,
  FolderRootsPort,
  PrivateRootLocator,
} from '@caselite/application';
import { createFolderRootLocator } from './folder-root-locator';
import { materialSignature } from './material-files';

type Entry = {
  relative: string;
  hint: string;
  kind: FolderEntry['kind'];
  name: string;
  bytes: number | null;
};
type Root = {
  caller: FolderCaller;
  scope: FolderScope;
  locator: PrivateRootLocator;
  project: FolderProject | undefined;
  config: FolderDefault;
  guard: FolderGuard;
  entries: Map<string, Entry>;
  prefix: string;
};
type Snapshot = { root: string; directory: string; entries: FolderEntry[]; offset: number };
const equalScope = (a: FolderScope, b: FolderScope) => JSON.stringify(a) === JSON.stringify(b);
const sameCaller = (a: FolderCaller, b: FolderCaller) =>
  a.workspace === b.workspace &&
  a.session === b.session &&
  a.epoch === b.epoch &&
  a.window_id === b.window_id;
const identity = (s: BigIntStats) =>
  JSON.stringify({
    dev: String(s.dev),
    ino: String(s.ino),
    birthtimeNs: String(s.birthtimeNs),
    size: String(s.size),
    mtimeNs: String(s.mtimeNs),
    ctimeNs: String(s.ctimeNs),
  });
export function createFolderRootFiles(options: {
  profilePath: string;
  choose(caller: FolderCaller, defaultPath?: string): Promise<string | null>;
  getView(
    caller: FolderCaller,
    scope: FolderScope,
  ): {
    defaultRoot: FolderDefault | undefined;
    project: FolderProject | undefined;
    guard: FolderGuard;
  };
}): FolderRootsPort {
  const roots = new Map<string, Root>(),
    snapshots = new Map<string, Snapshot>();
  const saved = new Map<string, { caller: FolderCaller; scope: FolderScope; source_id: string }>();
  let generation = 0;
  const isCurrent = (c: FolderCaller) => c.assertCurrent();
  const locator = createFolderRootLocator({ ...options, isCurrent });
  const checked = async <T>(guard: FolderGuard, effect: () => Promise<T>) => {
    guard();
    try {
      const result = await effect();
      guard();
      return result;
    } catch (error) {
      guard();
      throw error;
    }
  };
  function grant(caller: FolderCaller, scope: FolderScope, id: string, requestGuard: FolderGuard) {
    requestGuard();
    const r = roots.get(id);
    if (!isCurrent(caller) || !r || !sameCaller(r.caller, caller) || !equalScope(r.scope, scope))
      throw new Error('ROOT_EXPIRED');
    const guard = () => {
      requestGuard();
      r.guard();
      if (!isCurrent(caller) || roots.get(id) !== r) throw new Error('ROOT_EXPIRED');
    };
    guard();
    return { r, guard };
  }
  async function verify(caller: FolderCaller, r: Root, guard: FolderGuard) {
    if (r.project)
      await locator.validateProject(
        caller,
        r.locator,
        r.project.relative_directory,
        r.project.directory_identity,
        guard,
      );
    else await locator.validate(caller, r.locator, guard);
    guard();
  }
  async function entryPath(caller: FolderCaller, r: Root, e: Entry, guard: FolderGuard) {
    await verify(caller, r, guard);
    const parts = e.relative ? e.relative.split('/') : [];
    if (parts.some((v) => !v || v === '.' || v === '..' || v.includes('\\')))
      throw new Error('ENTRY_CHANGED');
    let current = r.locator.private_path;
    for (const part of parts.slice(0, -1)) {
      current = path.join(current, part);
      const stat = await checked(guard, () => lstat(current, { bigint: true }));
      const parent = [...r.entries.values()].find(
        (v) =>
          v.relative === path.relative(r.locator.private_path, current).split(path.sep).join('/'),
      );
      if (
        stat.isSymbolicLink() ||
        !stat.isDirectory() ||
        (parent && identity(stat) !== parent.hint)
      )
        throw new Error('ENTRY_CHANGED');
    }
    const file = path.join(r.locator.private_path, ...parts);
    const st = await checked(guard, () => lstat(file, { bigint: true }));
    if (st.isSymbolicLink() || identity(st) !== e.hint) throw new Error('ENTRY_CHANGED');
    return { file, st };
  }
  const prune = (rootId: string) => {
    roots.delete(rootId);
    for (const [id, snapshot] of snapshots) if (snapshot.root === rootId) snapshots.delete(id);
  };
  return {
    isCurrent,
    select: locator.select,
    validate: locator.validate,
    selectProject: locator.selectProject,
    async issue(caller, record, scope, project, requestGuard) {
      const view = options.getView(caller, scope);
      const guard = () => {
        requestGuard();
        view.guard();
        if (!isCurrent(caller)) throw new Error('STALE_CALLER');
      };
      if (
        !view.defaultRoot ||
        JSON.stringify(view.defaultRoot.locator) !== JSON.stringify(record) ||
        JSON.stringify(view.project) !== JSON.stringify(project)
      )
        throw new Error('CONFIGURATION_CHANGED');
      const prefix = project?.relative_directory ?? '';
      const root: Root = {
        caller,
        scope,
        locator: record,
        project,
        config: view.defaultRoot,
        guard,
        entries: new Map(),
        prefix,
      };
      await verify(caller, root, guard);
      const file = path.join(record.private_path, prefix);
      const stat = await checked(guard, () => lstat(file, { bigint: true }));
      guard();
      // 每个窗口/范围只保留最新根；旧根和分页令牌立即失效。
      for (const [id, r] of roots)
        if (sameCaller(r.caller, caller) && equalScope(r.scope, scope)) prune(id);
      if (roots.size >= 64) throw new Error('BUSY');
      const root_id = randomUUID(),
        root_entry_id = randomUUID();
      root.entries.set(root_entry_id, {
        relative: prefix,
        hint: identity(stat),
        kind: 'directory',
        name: path.basename(file),
        bytes: null,
      });
      roots.set(root_id, root);
      return {
        root_id,
        root_entry_id,
        generation: ++generation,
        display_name: path.basename(file) || '/',
      };
    },
    async list(caller, request, requestGuard) {
      const { r, guard } = grant(caller, request.scope, request.root_id, requestGuard);
      const directory = r.entries.get(request.entry_id);
      if (!directory || directory.kind !== 'directory') throw new Error('FORBIDDEN');
      await entryPath(caller, r, directory, guard);
      const page = (snapshot: Snapshot) => {
        guard();
        const entries = snapshot.entries.slice(snapshot.offset, snapshot.offset + FOLDER_PAGE_SIZE);
        snapshot.offset += entries.length;
        let next_cursor: string | null = null;
        if (snapshot.offset < snapshot.entries.length) {
          next_cursor = randomUUID();
          snapshots.set(next_cursor, snapshot);
          while (snapshots.size > FOLDER_SNAPSHOT_LIMIT)
            snapshots.delete(snapshots.keys().next().value!);
        }
        return { entries, next_cursor };
      };
      if (request.cursor) {
        const snapshot = snapshots.get(request.cursor);
        if (
          !snapshot ||
          snapshot.root !== request.root_id ||
          snapshot.directory !== request.entry_id
        )
          throw new Error('CURSOR_EXPIRED');
        snapshots.delete(request.cursor);
        return page(snapshot);
      }
      const depth = directory.relative.slice(r.prefix.length).split('/').filter(Boolean).length;
      if (depth >= FOLDER_DEPTH_LIMIT) throw new Error('DIRECTORY_LIMIT');
      const { file } = await entryPath(caller, r, directory, guard);
      guard();
      const dir = await opendir(file);
      const children: Array<{ dto: FolderEntry; value: Entry }> = [];
      try {
        guard();
        while (true) {
          const child = await checked(guard, () => dir.read());
          if (!child) break;
          if (children.length >= FOLDER_DIRECTORY_LIMIT) throw new Error('DIRECTORY_LIMIT');
          if (child.name.includes('\\')) throw new Error('ENTRY_CHANGED');
          const stat = await checked(guard, () =>
            lstat(path.join(file, child.name), { bigint: true }),
          );
          const kind = stat.isSymbolicLink()
            ? 'blocked_link'
            : stat.isDirectory()
              ? 'directory'
              : stat.isFile() && materialKind(child.name)
                ? 'file'
                : 'unsupported';
          const value: Entry = {
            relative: [directory.relative, child.name].filter(Boolean).join('/'),
            hint: identity(stat),
            kind,
            name: child.name,
            bytes: stat.isFile() ? Number(stat.size) : null,
          };
          // 同一根内只有身份完全未变的条目可复用能力；修改或替换不能升级旧token。
          const existing = [...r.entries].find(
            ([, entry]) =>
              entry.relative === value.relative &&
              entry.hint === value.hint &&
              entry.kind === value.kind,
          );
          children.push({
            value,
            dto: {
              entry_id: existing?.[0] ?? randomUUID(),
              display_name: child.name,
              kind,
              bytes: value.bytes,
              mapping_revision: 0,
            },
          });
        }
      } finally {
        await dir.close();
      }
      await entryPath(caller, r, directory, guard);
      children.sort(
        (a, b) =>
          Number(b.value.kind === 'directory') - Number(a.value.kind === 'directory') ||
          a.value.name.localeCompare(b.value.name),
      );
      guard();
      // 新扫描接续该目录的新页位置，不让其废旧游标挤掉其他目录的有效分页。
      for (const [id, snapshot] of snapshots)
        if (snapshot.root === request.root_id && snapshot.directory === request.entry_id)
          snapshots.delete(id);
      for (const { value, dto } of children) r.entries.set(dto.entry_id, value);
      if (r.entries.size > FOLDER_DIRECTORY_LIMIT * FOLDER_SNAPSHOT_LIMIT) {
        prune(request.root_id);
        throw new Error('DIRECTORY_LIMIT');
      }
      return page({
        root: request.root_id,
        directory: request.entry_id,
        entries: children.map((c) => c.dto),
        offset: 0,
      });
    },
    target(caller, scope, rootId, entryId, requestGuard) {
      const { r, guard } = grant(caller, scope, rootId, requestGuard);
      const entry = r.entries.get(entryId);
      if (!entry || entry.kind !== 'file') throw new Error('UNSUPPORTED_FORMAT');
      guard();
      return {
        binding_id: r.config.binding_id,
        relative_name: entry.relative,
        entry_hint: entry.hint,
        mapping_revision: 0,
        scope,
        default_revision: r.config.revision,
        project_revision: r.project?.revision ?? null,
      };
    },
    async snapshot(caller, scope, rootId, entryId, expectedHint, requestGuard) {
      const { r, guard } = grant(caller, scope, rootId, requestGuard);
      const entry = r.entries.get(entryId);
      if (!entry || entry.kind !== 'file' || entry.hint !== expectedHint)
        throw new Error('ENTRY_CHANGED');
      const { file, st } = await entryPath(caller, r, entry, guard);
      if (!st.isFile() || st.size < 8n || st.size > BigInt(MATERIAL_MAX_BYTES))
        throw new Error('FILE_LIMIT');
      guard();
      const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        guard();
        const before = await checked(guard, () => fd.stat({ bigint: true }));
        if (!before.isFile() || identity(before) !== entry.hint) throw new Error('ENTRY_CHANGED');
        // 固定长度读取，不能让被替换/持续增长的文件突破内存预算。
        const bytes = Buffer.alloc(Number(before.size));
        let offset = 0;
        while (offset < bytes.length) {
          const result = await checked(guard, () =>
            fd.read(bytes, offset, bytes.length - offset, offset),
          );
          if (!result.bytesRead) throw new Error('ENTRY_CHANGED');
          offset += result.bytesRead;
        }
        const after = await checked(guard, () => fd.stat({ bigint: true }));
        if (identity(before) !== identity(after)) throw new Error('ENTRY_CHANGED');
        await entryPath(caller, r, entry, guard);
        const kind = materialKind(entry.name);
        if (!kind || materialSignature(bytes) !== kind) throw new Error('UNSUPPORTED_FORMAT');
        guard();
        return {
          bytes,
          name: entry.name,
          kind,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      } finally {
        await fd.close();
      }
    },
    revokeRoots() {
      roots.clear();
      snapshots.clear();
    },
    revokeCaller(caller) {
      for (const [id, r] of roots) if (sameCaller(r.caller, caller)) prune(id);
      for (const [id, s] of saved) if (sameCaller(s.caller, caller)) saved.delete(id);
    },
    savedHandle(caller, scope, sourceId) {
      if (!isCurrent(caller)) throw new Error('STALE_CALLER');
      for (const [id, value] of saved)
        if (
          sameCaller(value.caller, caller) &&
          equalScope(value.scope, scope) &&
          value.source_id === sourceId
        )
          return id;
      if (saved.size >= 256) saved.delete(saved.keys().next().value!);
      const id = randomUUID();
      saved.set(id, { caller, scope, source_id: sourceId });
      return id;
    },
    savedSource(caller, scope, handle) {
      const value = saved.get(handle);
      if (
        !isCurrent(caller) ||
        !value ||
        !sameCaller(value.caller, caller) ||
        !equalScope(scope, value.scope)
      )
        throw new Error('FORBIDDEN');
      return value.source_id;
    },
  };
}
