import { lstat, opendir } from 'node:fs/promises';
import path from 'node:path';

import type {
  FolderCaller as Caller,
  PrivateRootLocator as PrivateLocatorRecord,
} from '@caselite/application';
type EffectGuard = () => void;
type HostIdentity = { dev: string; ino: string; birthtimeNs: string };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== keys.sort().join(',')
  )
    throw new Error('ROOT_MISMATCH');
  return value as Record<string, unknown>;
}
const identity = {
  parse(value: unknown): HostIdentity {
    const o = object(value, ['dev', 'ino', 'birthtimeNs']);
    if (![o.dev, o.ino, o.birthtimeNs].every((v) => typeof v === 'string' && /^\d+$/.test(v)))
      throw new Error('ROOT_MISMATCH');
    return { dev: o.dev as string, ino: o.ino as string, birthtimeNs: o.birthtimeNs as string };
  },
};
const chainSchema = {
  parse(value: unknown): Array<{ name: string; identity: HostIdentity }> {
    if (!Array.isArray(value) || !value.length || value.length > 256)
      throw new Error('ROOT_MISMATCH');
    return value.map((item) => {
      const o = object(item, ['name', 'identity']);
      if (typeof o.name !== 'string' || !o.name || o.name.length > 512)
        throw new Error('ROOT_MISMATCH');
      return { name: o.name, identity: identity.parse(o.identity) };
    });
  },
};
const recordSchema = {
  parse(value: unknown): PrivateLocatorRecord {
    const o = object(value, [
      'private_path',
      'root_identity',
      'ancestor_chain',
      'profile_identity',
      'locator_version',
    ]);
    if (
      o.locator_version !== 1 ||
      !['private_path', 'root_identity', 'ancestor_chain', 'profile_identity'].every(
        (k) =>
          typeof o[k] === 'string' &&
          (o[k] as string).length > 0 &&
          (o[k] as string).length <= 65536,
      )
    )
      throw new Error('ROOT_MISMATCH');
    return {
      private_path: o.private_path as string,
      root_identity: o.root_identity as string,
      ancestor_chain: o.ancestor_chain as string,
      profile_identity: o.profile_identity as string,
      locator_version: 1,
    };
  },
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function parseCanonical<T>(schema: { parse(value: unknown): T }, value: string): T {
  const parsed = schema.parse(JSON.parse(value));
  if (JSON.stringify(parsed) !== value) throw new Error('INVALID_RECORD');
  return parsed;
}
function safeRelative(value: string): string[] {
  if (
    value === '' ||
    value === '.' ||
    path.isAbsolute(value) ||
    value.includes('\\') ||
    value.split('/').some((s) => !s || s === '.' || s === '..')
  )
    throw new Error('INVALID_DIRECTORY');
  return value.split('/');
}
async function directoryIdentity(p: string, guard: EffectGuard) {
  guard();
  const stat = await lstat(p, { bigint: true });
  guard();
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('INVALID_DIRECTORY');
  return { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
}
async function absoluteChain(p: string, guard: EffectGuard) {
  guard();
  if (!path.isAbsolute(p) || path.normalize(p) !== p) throw new Error('INVALID_DIRECTORY');
  const parsed = path.parse(p),
    parts = p.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  const result = [{ name: parsed.root, identity: await directoryIdentity(current, guard) }];
  guard();
  for (const part of parts) {
    current = path.join(current, part);
    result.push({ name: part, identity: await directoryIdentity(current, guard) });
    guard();
  }
  return result;
}
async function probeDirectory(p: string, guard: EffectGuard): Promise<void> {
  guard();
  const handle = await opendir(p);
  try {
    guard();
    await handle.read();
    guard();
  } finally {
    // 撤权后仍须关闭已取得的句柄；清理不代表允许继续读取旧目录。
    await handle.close();
  }
  guard();
}
export function createFolderRootLocator(options: {
  profilePath: string;
  isCurrent: (caller: Caller) => boolean;
  choose: (caller: Caller, defaultPath?: string) => Promise<string | null>;
}) {
  const current = (caller: Caller) => {
    if (!options.isCurrent(caller)) throw new Error('STALE_CALLER');
  };
  const guarded = (caller: Caller, assertValid: EffectGuard): EffectGuard => {
    if (typeof assertValid !== 'function') throw new Error('CONFIGURATION_UNAVAILABLE');
    return () => {
      current(caller);
      assertValid();
    };
  };
  const checked = async <T>(guard: EffectGuard, effect: () => Promise<T>) => {
    // 效果用闭包延迟启动，不能在校验前已调用opendir/lstat。
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
  async function validate(
    caller: Caller,
    input: PrivateLocatorRecord,
    assertValid: EffectGuard,
  ): Promise<void> {
    const guard = guarded(caller, assertValid);
    guard();
    const record = recordSchema.parse(input),
      expected = parseCanonical(chainSchema, record.ancestor_chain);
    const root = parseCanonical(identity, record.root_identity),
      profile = parseCanonical(chainSchema, record.profile_identity);
    const actualProfile = await checked(guard, () => absoluteChain(options.profilePath, guard));
    const actual = await checked(guard, () => absoluteChain(record.private_path, guard));
    if (
      !same(profile, actualProfile) ||
      !same(expected, actual) ||
      !same(root, actual.at(-1)?.identity)
    )
      throw new Error('IDENTITY_CHANGED');
    await checked(guard, () => probeDirectory(record.private_path, guard));
    const verifiedProfile = await checked(guard, () => absoluteChain(options.profilePath, guard));
    const verifiedRoot = await checked(guard, () => absoluteChain(record.private_path, guard));
    if (!same(profile, verifiedProfile) || !same(expected, verifiedRoot))
      throw new Error('IDENTITY_CHANGED');
    guard();
  }
  async function select(
    caller: Caller,
    assertValid: EffectGuard,
  ): Promise<PrivateLocatorRecord | null> {
    const guard = guarded(caller, assertValid);
    const selected = await checked(guard, () => options.choose(caller));
    if (selected === null) return null;
    const ancestors = await checked(guard, () => absoluteChain(selected, guard));
    const profile = await checked(guard, () => absoluteChain(options.profilePath, guard));
    guard();
    return {
      private_path: selected,
      root_identity: JSON.stringify(ancestors.at(-1)!.identity),
      ancestor_chain: JSON.stringify(ancestors),
      profile_identity: JSON.stringify(profile),
      locator_version: 1,
    };
  }
  async function bindDirectory(
    caller: Caller,
    locator: PrivateLocatorRecord,
    relativeDirectory: string,
    assertValid: EffectGuard,
  ): Promise<string> {
    const guard = guarded(caller, assertValid);
    await checked(guard, () => validate(caller, locator, guard));
    const parts = safeRelative(relativeDirectory);
    let p = locator.private_path;
    const result = [{ name: '.', identity: parseCanonical(identity, locator.root_identity) }];
    for (const part of parts) {
      p = path.join(p, part);
      result.push({
        name: part,
        identity: await checked(guard, () => directoryIdentity(p, guard)),
      });
    }
    await checked(guard, () => validate(caller, locator, guard));
    guard();
    return JSON.stringify(result);
  }
  async function validateProject(
    caller: Caller,
    locator: PrivateLocatorRecord,
    relativeDirectory: string,
    identityChain: string,
    assertValid: EffectGuard,
  ): Promise<void> {
    const guard = guarded(caller, assertValid);
    guard();
    const expected = parseCanonical(chainSchema, identityChain);
    const actual = await checked(guard, () =>
      bindDirectory(caller, locator, relativeDirectory, guard),
    );
    if (!same(expected, JSON.parse(actual))) throw new Error('IDENTITY_CHANGED');
    const target = path.join(locator.private_path, ...safeRelative(relativeDirectory));
    await checked(guard, () => probeDirectory(target, guard));
    const verified = await checked(guard, () =>
      bindDirectory(caller, locator, relativeDirectory, guard),
    );
    if (!same(expected, JSON.parse(verified))) throw new Error('IDENTITY_CHANGED');
    guard();
  }
  async function selectProject(
    caller: Caller,
    locator: PrivateLocatorRecord,
    assertValid: EffectGuard,
  ) {
    const guard = guarded(caller, assertValid);
    await checked(guard, () => validate(caller, locator, guard));
    const selected = await checked(guard, () => options.choose(caller, locator.private_path));
    if (selected === null) return null;
    const relative_directory = path
      .relative(locator.private_path, selected)
      .split(path.sep)
      .join('/');
    safeRelative(relative_directory);
    const directory_identity = await checked(guard, () =>
      bindDirectory(caller, locator, relative_directory, guard),
    );
    await checked(guard, () =>
      validateProject(caller, locator, relative_directory, directory_identity, guard),
    );
    return { relative_directory, directory_identity };
  }
  return { select, validate, bindDirectory, validateProject, selectProject };
}
