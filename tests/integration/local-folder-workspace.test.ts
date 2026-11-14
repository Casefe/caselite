import { afterEach, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { openToolchainProbe } from '../../packages/local-db/src/connection';
import { createFolderConfigurationStore } from '../../packages/local-db/src/folder-configuration-store';
import { createPersonalMaterialStore } from '../../packages/local-db/src/personal-material-store';
import { createMaterialStore } from '../../packages/local-db/src/material-store';
import { createFolderRootFiles } from '../../apps/desktop/src/main/adapters/folder-root-files';
import { createMaterialFiles } from '../../apps/desktop/src/main/adapters/material-files';
import { createFolderConfigurationApplication } from '../../packages/application/src/folder-configuration-application';
import { createPersonalMaterialApplication } from '../../packages/application/src/personal-material-application';
import type { FolderCaller } from '../../packages/application/src/folder-ports';
import type { PdfProcessorPort } from '../../packages/application/src/material-ports';
import {
  folderResponseSchema,
  type FolderResponse,
  type FolderScope,
} from '../../packages/contracts/src';

const hooks = vi.hoisted(() => ({
  file: '',
  directory: '',
  afterOpen: undefined as (() => void) | undefined,
  afterDirectory: undefined as (() => void) | undefined,
  closes: 0,
  reads: 0,
  directoryCloses: 0,
  directoryReads: 0,
  directorySkip: 0,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const fd = await actual.open(...args);
      if (String(args[0]) !== hooks.file || !hooks.afterOpen) return fd;
      const hook = hooks.afterOpen;
      hooks.afterOpen = undefined;
      hook();
      return new Proxy(fd, {
        get(target, prop) {
          if (prop === 'close')
            return async () => {
              hooks.closes++;
              return target.close();
            };
          if (prop === 'read')
            return async (...a: unknown[]) => {
              hooks.reads++;
              return Reflect.apply(target.read, target, a);
            };
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
    opendir: async (...args: Parameters<typeof actual.opendir>) => {
      const dir = await actual.opendir(...args);
      if (String(args[0]) !== hooks.directory || !hooks.afterDirectory) return dir;
      if (hooks.directorySkip > 0) {
        hooks.directorySkip--;
        return dir;
      }
      const hook = hooks.afterDirectory;
      hooks.afterDirectory = undefined;
      hook();
      return new Proxy(dir, {
        get(target, prop) {
          if (prop === 'close')
            return async () => {
              hooks.directoryCloses++;
              return target.close();
            };
          if (prop === 'read')
            return async () => {
              hooks.directoryReads++;
              return target.read();
            };
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
  Object.assign(hooks, {
    file: '',
    directory: '',
    afterOpen: undefined,
    afterDirectory: undefined,
    closes: 0,
    reads: 0,
    directoryCloses: 0,
    directoryReads: 0,
    directorySkip: 0,
  });
});
const scope: FolderScope = { kind: 'workspace' };
const ok = (r: FolderResponse) => {
  expect(folderResponseSchema.safeParse(r).success).toBe(true);
  if (!r.ok) throw new Error(r.code);
  return r;
};
const pdf = Buffer.from('%PDF-1.4\nsynthetic bytes for identity-only processor\n%%EOF');
// 本组使用真实SQLite、迁移及FS；媒体处理器显式合成，真实Electron阅读/解析另验。
async function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'caselite-folder-')));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const profile = join(dir, 'profile'),
    external = join(dir, 'documents');
  mkdirSync(profile);
  mkdirSync(external);
  mkdirSync(join(external, 'empty'));
  writeFileSync(join(external, 'one.pdf'), pdf);
  const connection = openToolchainProbe(
    join(profile, 'db.sqlite'),
    resolve('packages/local-db/migrations'),
  );
  cleanup.push(() => connection.sqlite.close());
  const db = connection.sqlite,
    configurations = createFolderConfigurationStore(db, 'test-workspace');
  const store = createPersonalMaterialStore(db, 'test-workspace'),
    files = createMaterialFiles(join(profile, 'materials'));
  let current = true,
    chosen: string | null = external,
    choices = 0;
  const caller: FolderCaller = {
    workspace: 'test-workspace',
    session: randomUUID(),
    epoch: 0,
    window_id: 1,
    assertCurrent: () => current,
  };
  const roots = createFolderRootFiles({
    profilePath: profile,
    choose: async () => {
      choices++;
      return chosen;
    },
    getView: (c, s) => configuration.scopeView(c, s),
  });
  const configuration = createFolderConfigurationApplication({
    store: configurations,
    hash: (text) => createHash('sha256').update(text).digest('hex'),
    roots,
  });
  const processor: PdfProcessorPort = {
    configuration: 'MOCK_ONLY-identity',
    inspect: async () => 1,
    process: async (_data, input) =>
      input.onPage({
        page: 1,
        text: 'synthetic',
        origin: 'pdf_text',
        blocks: [],
        width: 1,
        height: 1,
        rotation: 0,
      }),
  };
  const app = createPersonalMaterialApplication({
    store,
    hash: (text) => createHash('sha256').update(text).digest('hex'),
    files,
    roots,
    configuration,
    processors: { pdf: processor, docx: processor, image: processor },
  });
  const call = (r: Record<string, unknown>) => app.execute(caller, { protocol_version: 1, ...r });
  ok(await call({ operation: 'choose_default', request_id: randomUUID(), expected_revision: 0 }));
  const restore = async (s = scope) =>
    ok(await call({ operation: 'restore_default', scope: s, view_generation: 1 }));
  const root = (await restore()).root!;
  const list = async (s = scope, r = root, cursor?: string, entry_id = r.root_entry_id) =>
    call({
      operation: 'list_directory',
      scope: s,
      root_id: r.root_id,
      entry_id,
      view_generation: 1,
      ...(cursor ? { cursor } : {}),
    });
  const entry = ok(await list()).entries!.find((e) => e.display_name === 'one.pdf')!;
  const open = (id = randomUUID(), operation = 'open_entry', e = entry) =>
    call({
      operation,
      scope,
      root_id: root.root_id,
      entry_id: e.entry_id,
      request_id: id,
      mapping_revision: e.mapping_revision,
      view_generation: 1,
    });
  const switchConfig = () => {
    const old = configurations.currentDefault()!;
    configurations.setDefault({
      request_id: randomUUID(),
      request_digest: 'f'.repeat(64),
      expected_revision: old.revision,
      display_name: old.display_name,
      locator: old.locator,
      reselect: false,
    });
  };
  return {
    dir,
    profile,
    external,
    db,
    configurations,
    store,
    hash: (text) => createHash('sha256').update(text).digest('hex'),
    files,
    caller,
    roots,
    app,
    call,
    root,
    entry,
    list,
    open,
    restore,
    processor,
    switchConfig,
    setCurrent: (v: boolean) => {
      current = v;
    },
    setChosen: (v: string | null) => {
      chosen = v;
    },
    choices: () => choices,
  };
}
it('restores a validated root without invoking chooser and never returns a path', async () => {
  const s = await setup(),
    before = s.choices();
  const result = await s.restore();
  expect(result.state).toBe('ready');
  expect(s.choices()).toBe(before);
  expect(JSON.stringify(result)).not.toContain(s.external);
  s.roots.revokeRoots();
  expect((await s.list()).ok).toBe(false);
});
it('lists lazily, reports empty directories and blocked symbolic links, pages 32 entries', async () => {
  const s = await setup();
  symlinkSync(join(s.external, 'one.pdf'), join(s.external, 'link.pdf'));
  for (let i = 0; i < 40; i++) writeFileSync(join(s.external, `item-${i}.txt`), 'unsupported');
  const root = (await s.restore()).root!,
    first = ok(await s.list(scope, root));
  expect(first.entries).toHaveLength(32);
  expect(first.next_cursor).toBeTruthy();
  const second = ok(await s.list(scope, root, first.next_cursor!));
  expect(
    second.entries!.find((e) => e.display_name === 'link.pdf')?.kind ??
      first.entries!.find((e) => e.display_name === 'link.pdf')?.kind,
  ).toBe('blocked_link');
  const empty = first.entries!.find((e) => e.display_name === 'empty')!;
  expect(ok(await s.list(scope, root, undefined, empty.entry_id)).entries).toEqual([]);
  expect((await s.list(scope, root, first.next_cursor!)).ok).toBe(false);
});
it('explicitly rejects a directory over 256 entries', async () => {
  const s = await setup();
  for (let i = 0; i < 255; i++) writeFileSync(join(s.external, `many-${i}.txt`), 'x');
  const root = (await s.restore()).root!;
  expect(await s.list(scope, root)).toMatchObject({ ok: false, code: 'DIRECTORY_LIMIT' });
});
it('durably captures a personal source, reads fixed bytes after original deletion and creates no Task', async () => {
  const s = await setup(),
    id = randomUUID();
  const result = ok(await s.open(id));
  expect(result.source?.owner_kind).toBe('personal');
  expect(result.source?.page_count).toBe(1);
  expect(s.db.prepare('SELECT count(*) n FROM task_items').get()).toEqual({ n: 0 });
  rmSync(s.external, { recursive: true });
  const read = ok(
    await s.call({ operation: 'read_saved', scope, saved_handle: result.saved_handle }),
  );
  expect(Buffer.from(read.data!)).toEqual(pdf);
  const query = ok(
    await s.call({ operation: 'query_capture', request_kind: 'capture', scope, request_id: id }),
  );
  expect(query.source?.id).toBe(result.source?.id);
  const legacy = createMaterialStore(s.db, s.store.workspace);
  expect(legacy.get(result.source!.id)).toBeUndefined();
  expect(legacy.list('home')).toEqual([]);
  expect(s.store.cancel(id)?.phase).toBe('ready');
  expect(s.store.source(result.source!.id)).toBeDefined();
});
it('reopens unchanged file using the same immutable source and asset without duplicate registration', async () => {
  const s = await setup(),
    one = ok(await s.open());
  const root = (await s.restore()).root!,
    e = ok(await s.list(scope, root)).entries!.find((v) => v.display_name === 'one.pdf')!;
  const two = ok(
    await s.call({
      operation: 'open_entry',
      scope,
      root_id: root.root_id,
      entry_id: e.entry_id,
      request_id: randomUUID(),
      mapping_revision: e.mapping_revision,
      view_generation: 2,
    }),
  );
  expect(two.source!.id).toBe(one.source!.id);
  expect(
    s.db.prepare("SELECT count(*) n FROM material_sources WHERE owner_kind='personal'").get(),
  ).toEqual({ n: 1 });
  expect(readdirSync(join(s.profile, 'materials', 'originals'))).toHaveLength(1);
});
it('rejects stale entry replacement before snapshot and preserves pending request identity', async () => {
  const s = await setup(),
    id = randomUUID();
  writeFileSync(join(s.external, 'one.pdf'), Buffer.concat([pdf, Buffer.from('changed')]));
  expect(await s.open(id)).toMatchObject({ ok: false, code: 'ENTRY_CHANGED', request_id: id });
  expect(ok(await s.call({ operation: 'list_pending', scope })).pending?.[0].request_id).toBe(id);
  expect(s.db.prepare('SELECT count(*) n FROM material_sources').get()).toEqual({ n: 0 });
});
it('cancels an in-flight placed capture without deleting bytes or registering a source', async () => {
  const s = await setup(),
    id = randomUUID();
  let release!: () => void, entered!: () => void;
  const inProcessor = new Promise<void>((r) => {
    entered = r;
  });
  const hold = new Promise<void>((r) => {
    release = r;
  });
  s.processor.inspect = async () => {
    entered();
    await hold;
    return 1;
  };
  const opening = s.open(id);
  await inProcessor;
  expect(
    ok(
      await s.call({ operation: 'cancel_capture', request_kind: 'capture', scope, request_id: id }),
    ).phase,
  ).toBe('cancelled');
  release();
  expect(await opening).toMatchObject({ ok: false, code: 'CANCELLED' });
  expect(s.db.prepare('SELECT count(*) n FROM material_sources').get()).toEqual({ n: 0 });
  expect(readdirSync(join(s.profile, 'materials', 'originals'))).toHaveLength(1);
});
it('closes file exactly once and reads zero bytes when configuration changes immediately after open resolves', async () => {
  const s = await setup();
  hooks.file = join(s.external, 'one.pdf');
  hooks.afterOpen = s.switchConfig;
  expect(await s.open()).toMatchObject({ ok: false, code: 'ROOT_EXPIRED' });
  expect(hooks.closes).toBe(1);
  expect(hooks.reads).toBe(0);
});
it('closes directory exactly once and reads zero entries when caller is revoked after opendir resolves', async () => {
  const s = await setup();
  // locator validation also probes this directory; its acquired handle must have the same cleanup guarantee.
  hooks.directory = s.external;
  hooks.afterDirectory = () => s.setCurrent(false);
  expect(await s.list()).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(hooks.directoryCloses).toBe(1);
  expect(hooks.directoryReads).toBe(0);
});
it('retains durable cancellation receipt for native chooser timeout/query recovery', async () => {
  const s = await setup(),
    id = randomUUID();
  s.setChosen(null);
  expect(
    ok(await s.call({ operation: 'choose_default', request_id: id, expected_revision: 1 })).state,
  ).toBe('cancelled');
  expect(
    ok(
      await s.call({
        operation: 'query_configuration',
        request_kind: 'configuration',
        configuration_operation: 'set_default',
        scope,
        request_id: id,
      }),
    ).state,
  ).toBe('cancelled');
  expect(s.configurations.currentDefault()!.revision).toBe(1);
});
it('resumes a placed snapshot by the original request after the external directory disappears', async () => {
  const s = await setup(),
    id = randomUUID();
  const originalInspect = s.processor.inspect;
  s.processor.inspect = async () => {
    throw new Error('simulated processor interruption');
  };
  expect(await s.open(id)).toMatchObject({ ok: false, request_id: id });
  expect(s.store.read(id)?.phase).toBe('placed');
  s.processor.inspect = originalInspect;
  rmSync(s.external, { recursive: true });
  s.roots.revokeRoots();
  const result = ok(
    await s.call({ operation: 'resume_capture', scope, request_id: id, view_generation: 9 }),
  );
  expect(result.phase).toBe('ready');
  expect(result.source!.page_count).toBe(1);
  expect(s.db.prepare('SELECT count(*) n FROM task_items').get()).toEqual({ n: 0 });
});
it('rolls source, mapping and ready receipt back together when a derivation write fails', async () => {
  const s = await setup(),
    id = randomUUID();
  s.db.exec(
    "CREATE TRIGGER deny_derivation BEFORE INSERT ON material_derivations BEGIN SELECT RAISE(ABORT,'synthetic disk fault'); END",
  );
  expect(await s.open(id)).toMatchObject({ ok: false, request_id: id });
  expect(s.store.read(id)?.phase).toBe('placed');
  expect(s.db.prepare('SELECT count(*) n FROM material_sources').get()).toEqual({ n: 0 });
  expect(s.db.prepare('SELECT current_source_id,revision FROM folder_mappings').get()).toEqual({
    current_source_id: null,
    revision: 0,
  });
  s.db.exec('DROP TRIGGER deny_derivation');
  expect(
    ok(await s.call({ operation: 'resume_capture', scope, request_id: id, view_generation: 3 }))
      .phase,
  ).toBe('ready');
});
it('isolates project directories and rejects cross-project saved handles and archived projects', async () => {
  const s = await setup(),
    project = randomUUID(),
    other = randomUUID();
  for (const id of [project, other])
    s.db
      .prepare(
        'INSERT INTO matters(id,workspace_id,title,version,body_id,updated_at) VALUES(?,?,?,1,?,?)',
      )
      .run(id, s.store.workspace, 'synthetic project', randomUUID(), new Date().toISOString());
  mkdirSync(join(s.external, 'A'));
  mkdirSync(join(s.external, 'B'));
  writeFileSync(join(s.external, 'A', 'A.pdf'), pdf);
  writeFileSync(join(s.external, 'B', 'B.pdf'), pdf);
  s.setChosen(join(s.external, 'A'));
  ok(
    await s.call({
      operation: 'bind_project',
      project_id: project,
      request_id: randomUUID(),
      expected_revision: 0,
    }),
  );
  s.setChosen(join(s.external, 'B'));
  ok(
    await s.call({
      operation: 'bind_project',
      project_id: other,
      request_id: randomUUID(),
      expected_revision: 0,
    }),
  );
  const projectScope: FolderScope = { kind: 'project', project_id: project },
    otherScope: FolderScope = { kind: 'project', project_id: other };
  const root = (await s.restore(projectScope)).root!,
    entry = ok(await s.list(projectScope, root)).entries![0];
  expect(entry.display_name).toBe('A.pdf');
  const opened = ok(
    await s.call({
      operation: 'open_entry',
      scope: projectScope,
      root_id: root.root_id,
      entry_id: entry.entry_id,
      request_id: randomUUID(),
      mapping_revision: 0,
      view_generation: 1,
    }),
  );
  expect(
    await s.call({ operation: 'read_saved', scope: otherScope, saved_handle: opened.saved_handle }),
  ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(ok(await s.call({ operation: 'list_saved', scope: otherScope })).saved).toEqual([]);
  const saved = ok(await s.call({ operation: 'list_saved', scope: projectScope })).saved![0];
  expect(
    await s.call({
      operation: 'open_saved',
      scope: otherScope,
      mapping_id: saved.mapping_id,
      source_id: saved.source.id,
    }),
  ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  s.setChosen(join(s.external, 'B'));
  ok(
    await s.call({
      operation: 'bind_project',
      project_id: project,
      request_id: randomUUID(),
      expected_revision: 1,
    }),
  );
  expect(
    await s.call({
      operation: 'read_saved',
      scope: projectScope,
      saved_handle: opened.saved_handle,
    }),
  ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  s.db
    .prepare('UPDATE matters SET archived_at=? WHERE id=?')
    .run(new Date().toISOString(), project);
  expect(
    await s.call({
      operation: 'read_saved',
      scope: projectScope,
      saved_handle: opened.saved_handle,
    }),
  ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
});
it('preserves unknown stage versions and prevents legacy stage/batch overwrites', async () => {
  const s = await setup(),
    id = randomUUID(),
    token = `personal-capture:v2:${id}`;
  const payload = JSON.stringify({
    kind: 'personal_capture_v2',
    stage_schema_version: 999,
    request_id: id,
  });
  s.db.prepare('INSERT INTO material_stages VALUES(?,?,?)').run(token, s.store.workspace, payload);
  expect(await s.open(id)).toMatchObject({ ok: false, code: 'SOURCE_UNAVAILABLE' });
  expect(
    (
      s.db.prepare('SELECT payload FROM material_stages WHERE token=?').get(token) as {
        payload: string;
      }
    ).payload,
  ).toBe(payload);
  const legacy = createMaterialStore(s.db, s.store.workspace),
    stage = {
      token,
      scope: 'home' as const,
      name: 'one.pdf',
      bytes: pdf.length,
      sha256: 'a'.repeat(64),
      state: 'staged' as const,
    };
  expect(() => legacy.putStage(stage)).toThrow('kind conflict');
  expect(
    (
      s.db.prepare('SELECT payload FROM material_stages WHERE token=?').get(token) as {
        payload: string;
      }
    ).payload,
  ).toBe(payload);
});
it('enforces both SQLite owner exclusivity and compound workspace mapping foreign keys', async () => {
  const s = await setup();
  s.db.pragma('foreign_keys = ON');
  expect(() =>
    s.db
      .prepare(
        "INSERT INTO material_sources(id,workspace_id,owner_kind,task_id,asset_version_id,name,sha256,bytes,page_count) VALUES(?,?,'personal','forged-task',?,'one.pdf',?,50,1)",
      )
      .run(randomUUID(), s.store.workspace, randomUUID(), 'a'.repeat(64)),
  ).toThrow();
  expect(() =>
    s.db
      .prepare('INSERT INTO folder_mappings VALUES(?,?,?,?,1,?,0,NULL)')
      .run(
        randomUUID(),
        'other-workspace',
        s.configurations.currentDefault()!.binding_id,
        'one.pdf',
        '{}',
      ),
  ).toThrow();
});

it('closes the list opendir handle after its post-open guard rejects, without reading any entries', async () => {
  const s = await setup();
  hooks.directory = s.external;
  hooks.directorySkip = 2;
  hooks.afterDirectory = s.switchConfig;
  expect(await s.list()).toMatchObject({ ok: false, code: 'ROOT_EXPIRED' });
  expect(hooks.directorySkip).toBe(0);
  expect(hooks.directoryCloses).toBe(1);
  expect(hooks.directoryReads).toBe(0);
});
it('lists only bounded fixed headers without selecting or parsing stored body pages', async () => {
  const s = await setup(),
    opened = ok(await s.open());
  const source = opened.source!,
    original = JSON.stringify(source.pages);
  s.db
    .prepare('UPDATE material_derivations SET pages=? WHERE id=?')
    .run('invalid-body-json', source.derivation_id);
  const prepare = vi.spyOn(s.db, 'prepare');
  const result = ok(await s.call({ operation: 'list_saved', scope }));
  expect(result.saved).toHaveLength(1);
  expect(result.saved![0].source.id).toBe(source.id);
  expect(result.saved![0].source).not.toHaveProperty('pages');
  const queries = prepare.mock.calls.map(([sql]) => String(sql));
  expect(queries.some((sql) => /\bpages\b/i.test(sql))).toBe(false);
  expect(queries.some((sql) => /FROM folder_mappings f/.test(sql) && /LIMIT 257/.test(sql))).toBe(
    true,
  );
  prepare.mockRestore();
  s.db
    .prepare('UPDATE material_derivations SET pages=? WHERE id=?')
    .run(original, source.derivation_id);
  const reopened = ok(
    await s.call({
      operation: 'open_saved',
      scope,
      mapping_id: result.saved![0].mapping_id,
      source_id: source.id,
    }),
  );
  expect(reopened.source!.pages).toEqual(source.pages);
  expect(
    ok(await s.call({ operation: 'read_saved', scope, saved_handle: reopened.saved_handle })).data,
  ).toEqual(new Uint8Array(pdf));
});
it('reuses one lightweight source identity handle across repeated ready queries', async () => {
  const s = await setup(),
    requestId = randomUUID(),
    opened = ok(await s.open(requestId));
  expect(s.roots.savedSource(s.caller, scope, opened.saved_handle!)).toBe(opened.source!.id);
  for (let i = 0; i < 270; i++) {
    const result = ok(
      await s.call({
        operation: 'query_capture',
        request_kind: 'capture',
        scope,
        request_id: requestId,
      }),
    );
    expect(result.saved_handle).toBe(opened.saved_handle);
  }
  const read = ok(
    await s.call({ operation: 'read_saved', scope, saved_handle: opened.saved_handle }),
  );
  expect(read.source!.id).toBe(opened.source!.id);
  expect(Buffer.from(read.data!)).toEqual(pdf);
});
it('loads the fixed source from the controlled Store instead of retaining stale body in its handle', async () => {
  const s = await setup(),
    opened = ok(await s.open());
  s.db
    .prepare('UPDATE material_derivations SET pages=? WHERE id=?')
    .run('invalid-body-json', opened.source!.derivation_id);
  expect(
    await s.call({ operation: 'read_saved', scope, saved_handle: opened.saved_handle }),
  ).toMatchObject({ ok: false });
  expect(s.roots.savedSource(s.caller, scope, opened.saved_handle!)).toBe(opened.source!.id);
});
it('reuses unchanged entry capabilities across repeated metadata scans without exhausting the root budget', async () => {
  const s = await setup();
  for (let i = 0; i < 68; i++) writeFileSync(join(s.external, `many-${i}.txt`), 'synthetic');
  const root = (await s.restore()).root!;
  const first = ok(await s.list(scope, root));
  let latest = first;
  for (let i = 0; i < 64; i++) latest = ok(await s.list(scope, root));
  expect(latest.entries!.map((e) => [e.display_name, e.entry_id])).toEqual(
    first.entries!.map((e) => [e.display_name, e.entry_id]),
  );
  expect(ok(await s.list(scope, root, latest.next_cursor!)).entries).toHaveLength(32);
});
it('replaces only the rescanned parent cursor and preserves another directory pagination', async () => {
  const s = await setup();
  for (const name of ['first', 'second']) {
    mkdirSync(join(s.external, name));
    for (let i = 0; i < 40; i++) writeFileSync(join(s.external, name, `${i}.txt`), 'synthetic');
  }
  const root = (await s.restore()).root!,
    top = ok(await s.list(scope, root)).entries!;
  const a = top.find((e) => e.display_name === 'first')!,
    b = top.find((e) => e.display_name === 'second')!;
  const first = ok(await s.list(scope, root, undefined, a.entry_id)),
    second = ok(await s.list(scope, root, undefined, b.entry_id));
  const refresh = ok(await s.list(scope, root, undefined, a.entry_id));
  expect(refresh.entries!.map((e) => e.entry_id)).toEqual(first.entries!.map((e) => e.entry_id));
  expect(await s.list(scope, root, first.next_cursor!, a.entry_id)).toMatchObject({
    ok: false,
    code: 'CURSOR_EXPIRED',
  });
  expect(ok(await s.list(scope, root, second.next_cursor!, b.entry_id)).entries).toHaveLength(8);
});
it('does not reuse a changed file identity or upgrade an old entry token to the new bytes', async () => {
  const s = await setup();
  const before = s.roots.target(s.caller, scope, s.root.root_id, s.entry.entry_id, () => {});
  const changed = Buffer.concat([pdf, Buffer.from('\nnew-version')]);
  writeFileSync(join(s.external, 'one.pdf'), changed);
  const entry = ok(await s.list()).entries!.find((e) => e.display_name === 'one.pdf')!;
  expect(entry.entry_id).not.toBe(s.entry.entry_id);
  await expect(
    s.roots.snapshot(
      s.caller,
      scope,
      s.root.root_id,
      s.entry.entry_id,
      before.entry_hint,
      () => {},
    ),
  ).rejects.toThrow('ENTRY_CHANGED');
  const target = s.roots.target(s.caller, scope, s.root.root_id, entry.entry_id, () => {});
  expect(
    Buffer.from(
      (
        await s.roots.snapshot(
          s.caller,
          scope,
          s.root.root_id,
          entry.entry_id,
          target.entry_hint,
          () => {},
        )
      ).bytes,
    ),
  ).toEqual(changed);
});
