import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openToolchainProbe } from '../../packages/local-db/src/connection';
import { bridgeMigrationHistories } from '../../packages/local-db/src/migration-bridge';
import { integrationMigrations } from '../../packages/local-db/src/migration-manifest';
import { openTaskStore } from '../../packages/local-db/src/task-store';
import { createTaskApplication, createReminderApplication } from '../../packages/application/src';
import * as Y from 'yjs';
const migrations = resolve('packages/local-db/migrations');
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function fixture(branch: 'A' | 'B', count?: number) {
  const root = mkdtempSync(join(tmpdir(), 'caselite-dual-history-'));
  roots.push(root);
  const folder = join(root, 'original-migrations');
  mkdirSync(join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(
    readFileSync(resolve(`tests/fixtures/migration-histories/${branch}.json`), 'utf8'),
  );
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries) {
    const source = join(migrations, e.tag + '.sql');
    expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(
      integrationMigrations.find((m) => m.tag === e.tag)!.hash,
    );
    copyFileSync(source, join(folder, e.tag + '.sql'));
  }
  const file = join(root, '旧历史.sqlite');
  const db = openToolchainProbe(file, folder).sqlite;
  db.prepare('INSERT INTO toolchain_probe VALUES(?,?)').run('preserved', '合成旧业务');
  return { root, file, folder, db };
}
const history = (db: ReturnType<typeof openToolchainProbe>['sqlite']) =>
  db.prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY rowid').all();
const schema = (db: ReturnType<typeof openToolchainProbe>['sqlite']) =>
  db
    .prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();

it.each([
  ['A', 17],
  ['A', 18],
  ['A', 19],
  ['A', 20],
  ['A', 21],
  ['B', 18],
  ['B', 19],
  ['B', 20],
] as const)(
  'upgrades original %s prefix %i and reopens without changing old rows or original records',
  (branch, count) => {
    const f = fixture(branch, count);
    const before = history(f.db);
    f.db.close();
    for (let i = 0; i < 2; i++) {
      const upgraded = openToolchainProbe(f.file, migrations).sqlite;
      expect(history(upgraded)).toHaveLength(24);
      expect(history(upgraded)).toEqual(expect.arrayContaining(before));
      expect(upgraded.prepare('SELECT * FROM toolchain_probe').all()).toEqual([
        { id: 'preserved', value: '合成旧业务' },
      ]);
      for (const column of ['subscribed', 'planned_date'])
        expect(upgraded.pragma('table_info(task_items)')).toEqual(
          expect.arrayContaining([expect.objectContaining({ name: column })]),
        );
      for (const table of [
        'project_milestones',
        'delivery_exports',
        'local_preferences',
        'calendar_types',
      ])
        expect(upgraded.prepare('SELECT name FROM sqlite_schema WHERE name=?').get(table)).toEqual({
          name: table,
        });
      expect(upgraded.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(upgraded.pragma('foreign_key_check')).toEqual([]);
      upgraded.close();
    }
  },
);
it('does not expand old fixture directories, even when opening them twice', () => {
  const f = fixture('A', 18);
  const before = history(f.db);
  f.db.close();
  const old = openToolchainProbe(f.file, f.folder).sqlite;
  expect(history(old)).toEqual(before);
  expect(old.pragma('table_info(task_items)')).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'subscribed' })]),
  );
  old.close();
});

it('rejects a mixed migration directory without its manifest marker before changing A data or schema', () => {
  const f = fixture('A');
  const mixed = join(f.root, 'mixed-without-marker');
  cpSync(migrations, mixed, { recursive: true });
  rmSync(join(mixed, 'meta/dual-history-1826.json'));
  const before = {
    history: history(f.db),
    schema: schema(f.db),
    rows: f.db.prepare('SELECT * FROM toolchain_probe').all(),
  };
  expect(() => bridgeMigrationHistories(f.db, mixed)).toThrow('无法识别');
  expect({
    history: history(f.db),
    schema: schema(f.db),
    rows: f.db.prepare('SELECT * FROM toolchain_probe').all(),
  }).toEqual(before);
  f.db.close();
});

it.each(['A', 'B'] as const)(
  'preserves populated %s business rows, Yjs revisions, fixed originals, receipts and opaque credential files',
  (branch) => {
    const f = fixture(branch);
    const store = openTaskStore(f.file, f.folder);
    const app = createTaskApplication(store);
    const keys = () => ({
      protocol_version: 1 as const,
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
    });
    const good = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
      if (!r.ok) throw Error('Synthetic preservation seed rejected');
      return r as Extract<T, { ok: true }>;
    };
    const project = good(
      store.catalog.execute({ ...keys(), operation: 'create_project', title: '合成保全项目' }),
    ).target_id!;
    let task = good(
      app.execute({
        ...keys(),
        operation: 'create',
        title: '旧任务与修改',
        objective: '保留用户修改',
        matter_id: project,
      }),
    ).tasks[0];
    const doc = new Y.Doc(),
      block = new Y.XmlElement('paragraph'),
      text = new Y.XmlText();
    text.insert(0, '合成正文初稿🙂', { bold: {} });
    block.insert(0, [text]);
    doc.getXmlFragment('default').push([block]);
    const save = () => {
      task = good(
        app.execute({
          ...keys(),
          operation: 'save',
          task_id: task.id,
          document_id: task.document_id,
          body_id: task.body_id,
          expected_revision: task.body_revision,
          editor_schema: 1,
          state: Array.from(Y.encodeStateAsUpdate(doc)),
        }),
      ).tasks[0];
    };
    save();
    if (branch === 'A') {
      const snapshot = good(
        app.execute({
          ...keys(),
          operation: 'create_snapshot',
          task_id: task.id,
          document_id: task.document_id,
          body_id: task.body_id,
          expected_revision: 1,
          expected_metadata_version: task.document_metadata_version!,
          expected_task_version: task.version,
          note: '旧快照',
        }),
      ).snapshots![0];
      f.db
        .prepare(
          'INSERT INTO delivery_exports(id,workspace_id,snapshot_id,format,converter,status,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          'local',
          snapshot.id,
          'word',
          'synthetic-original',
          'ready',
          'a'.repeat(64),
          10,
          '2026-11-08',
        );
    } else {
      const milestone = good(
        store.catalog.execute({
          ...keys(),
          operation: 'create_milestone',
          project_id: project,
          title: '旧里程碑',
          target_date: '2026-12-01',
        }),
      ).target_id!;
      good(
        store.catalog.execute({
          ...keys(),
          operation: 'assign_milestone',
          project_id: project,
          task_id: task.id,
          expected_version: task.version,
          milestone_id: milestone,
        }),
      );
      good(
        store.catalog.execute({
          ...keys(),
          operation: 'publish_discussion',
          scope: { kind: 'update', project_id: project },
          state: Array.from(Y.encodeStateAsUpdate(doc)),
          health: 'at_risk',
        }),
      );
    }
    text.insert(text.length, '；用户第二修订');
    save();
    doc.destroy();
    const reminders = createReminderApplication(store.reminders),
      wall = { date: '2031-11-10', time: '09:00', timezone: 'Asia/Shanghai' };
    const resolved = good(
      reminders.execute({ protocol_version: 1, operation: 'resolve', ...wall }),
    );
    good(
      reminders.execute({
        ...keys(),
        operation: 'schedule',
        reminder_id: randomUUID(),
        task_id: task.id,
        expected_version: 0,
        ...wall,
        instant: resolved.choices[0],
        confirmed: true,
      }),
    );
    const original = Buffer.from('SYNTHETIC IMMUTABLE ORIGINAL\u0000'),
      sourceId = randomUUID();
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const files = ['original.bin', 'opaque-credentials.enc', 'default-model.json'];
    for (const [i, file] of files.entries())
      writeFileSync(
        join(f.root, file),
        i === 0
          ? original
          : i === 1
            ? Buffer.from([0, 255, 3, 8, 41])
            : JSON.stringify({ model: 'deepseek-chat' }),
      );
    f.db
      .prepare(
        'INSERT INTO material_sources(id,workspace_id,task_id,asset_version_id,name,sha256,bytes,page_count) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        sourceId,
        'local',
        task.id,
        randomUUID(),
        '旧材料.bin',
        hash(original),
        original.length,
        1,
      );
    f.db
      .prepare(
        'INSERT INTO agent_runs(id,workspace_id,scope,sequence,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        randomUUID(),
        'local',
        task.id,
        1,
        '2026-11-08',
        '2026-11-08',
        JSON.stringify({ synthetic: true, status: 'cancelled', partial: '历史哨兵' }),
      );
    const columns = (
      f.db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'__drizzle_migrations' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map(({ name }) => ({
      name,
      columns: (f.db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    }));
    const rows = (db: typeof f.db) =>
      columns.map((t) =>
        db
          .prepare(
            `SELECT ${t.columns.map((c) => '"' + c + '"').join(',')} FROM "${t.name}" ORDER BY rowid`,
          )
          .all(),
      );
    const before = JSON.stringify(rows(f.db)),
      hashes = files.map((p) => hash(readFileSync(join(f.root, p))));
    store.close();
    f.db.close();
    const upgraded = openToolchainProbe(f.file, migrations).sqlite;
    expect(JSON.stringify(rows(upgraded))).toBe(before);
    expect(files.map((p) => hash(readFileSync(join(f.root, p))))).toEqual(hashes);
    expect(upgraded.pragma('foreign_key_check')).toEqual([]);
    // 原历史的列投影仍可读取；这不是旧二进制理解新增操作的承诺。
    expect(
      upgraded.prepare('SELECT title,objective FROM task_items WHERE id=?').get(task.id),
    ).toEqual({ title: '旧任务与修改', objective: '保留用户修改' });
    upgraded.close();
  },
);
it.each([
  'unknown-hash',
  'unknown-time',
  'gap',
  'schema-without-record',
  'record-without-schema',
  'partial-DDL',
  'missing-trigger',
])('rejects %s and preserves the rejected library', (kind) => {
  const f = fixture('A', kind === 'record-without-schema' ? 17 : 21);
  if (kind === 'unknown-hash')
    f.db.exec(
      "UPDATE __drizzle_migrations SET hash='unknown' WHERE created_at=(SELECT max(created_at) FROM __drizzle_migrations)",
    );
  if (kind === 'unknown-time')
    f.db.exec(
      'UPDATE __drizzle_migrations SET created_at=1 WHERE created_at=(SELECT max(created_at) FROM __drizzle_migrations)',
    );
  if (kind === 'gap') f.db.exec('DELETE FROM __drizzle_migrations WHERE created_at=1794137445427');
  if (kind === 'schema-without-record')
    f.db.exec(readFileSync(join(migrations, '0017_task_subscription.sql'), 'utf8'));
  if (kind === 'record-without-schema') {
    const m = integrationMigrations[20];
    f.db
      .prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)')
      .run(m.hash, m.when);
  }
  if (kind === 'partial-DDL') f.db.exec('ALTER TABLE task_items ADD COLUMN subscribed INTEGER');
  if (kind === 'missing-trigger') f.db.exec('DROP TRIGGER delivery_snapshot_no_update');
  const before = {
    history: history(f.db),
    schema: schema(f.db),
    values: f.db.prepare('SELECT * FROM toolchain_probe').all(),
  };
  expect(() => bridgeMigrationHistories(f.db, migrations)).toThrow('无法识别');
  expect({
    history: history(f.db),
    schema: schema(f.db),
    values: f.db.prepare('SELECT * FROM toolchain_probe').all(),
  }).toEqual(before);
  f.db.close();
});
it('rolls every bridge DDL and original migration record back on a mid-bridge failure', () => {
  const f = fixture('A');
  const before = { history: history(f.db), schema: schema(f.db) };
  const exec = f.db.exec.bind(f.db);
  vi.spyOn(f.db, 'exec').mockImplementation((sql) => {
    const result = exec(sql);
    if (sql.includes('ADD `health`')) throw Error('synthetic bridge failure');
    return result;
  });
  expect(() => bridgeMigrationHistories(f.db, migrations)).toThrow('synthetic bridge failure');
  expect(f.db.inTransaction).toBe(false);
  expect({ history: history(f.db), schema: schema(f.db) }).toEqual(before);
  vi.restoreAllMocks();
  f.db.close();
  const recovered = openToolchainProbe(f.file, migrations).sqlite;
  expect(history(recovered)).toHaveLength(24);
  recovered.close();
});
type WorkerMessage = { phase: string; ok?: boolean; error?: string };
function child(file: string, mode = 'open', release = '') {
  const process = fork(
    resolve('tests/fixtures/migration-histories/worker.cjs'),
    [file, mode, release],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  const messages: WorkerMessage[] = [];
  const next = (phase: string) =>
    new Promise<WorkerMessage>((resolve, reject) => {
      const prior = messages.find((m) => m.phase === phase);
      if (prior) return resolve(prior);
      const timer = setTimeout(() => reject(Error('Child phase timeout: ' + phase)), 15000);
      process.on('message', function listen(m: WorkerMessage) {
        if (m.phase === phase) {
          clearTimeout(timer);
          process.off('message', listen);
          resolve(m);
        }
      });
      process.once('error', reject);
    });
  process.on('message', (m) => messages.push(m as WorkerMessage));
  return { process, next };
}
it('preserves the A library after process death inside the uncommitted bridge', async () => {
  const f = fixture('A');
  const before = { history: history(f.db), schema: schema(f.db) };
  f.db.close();
  const c = child(f.file, 'crash');
  try {
    await c.next('ready');
    c.process.send('go');
    await c.next('uncommitted-ddl');
    const exited = new Promise((resolve) => c.process.once('exit', resolve));
    c.process.kill('SIGKILL');
    await exited;
    const old = openToolchainProbe(f.file, f.folder).sqlite;
    expect({ history: history(old), schema: schema(old) }).toEqual(before);
    old.close();
    const good = openToolchainProbe(f.file, migrations).sqlite;
    expect(history(good)).toHaveLength(24);
    good.close();
  } finally {
    c.process.kill('SIGKILL');
  }
});
it('concurrent independent opens converge or fail safely and recover without duplicate bridge records', async () => {
  const f = fixture('A');
  f.db.close();
  const a = child(f.file),
    b = child(f.file);
  try {
    await Promise.all([a.next('ready'), b.next('ready')]);
    a.process.send('go');
    b.process.send('go');
    const results = await Promise.all([a.next('done'), b.next('done')]);
    expect(results.some((r) => r.ok)).toBe(true);
    for (const r of results) if (!r.ok) expect(r.error).toMatch(/SQLITE_BUSY|SQLITE_ERROR/);
    const good = openToolchainProbe(f.file, migrations).sqlite;
    expect(history(good)).toHaveLength(24);
    expect(new Set(history(good).map((r) => JSON.stringify(r))).size).toBe(24);
    good.close();
  } finally {
    a.process.kill('SIGKILL');
    b.process.kill('SIGKILL');
  }
});

it('reports the stale Drizzle read/BEGIN competitor as a failure and safely reopens the committed library', async () => {
  const f = fixture('A', 20);
  f.db.close();
  const firstRelease = join(f.root, 'release-first'),
    secondRelease = join(f.root, 'release-second');
  const a = child(f.file, 'pause-drizzle', firstRelease),
    b = child(f.file, 'pause-drizzle', secondRelease);
  try {
    await Promise.all([a.next('ready'), b.next('ready')]);
    a.process.send('go');
    b.process.send('go');
    await Promise.all([a.next('drizzle-read'), b.next('drizzle-read')]);
    writeFileSync(firstRelease, 'release');
    expect((await a.next('done')).ok).toBe(true);
    writeFileSync(secondRelease, 'release');
    expect(await b.next('done')).toMatchObject({ ok: false, error: 'SQLITE_ERROR' });
    const good = openToolchainProbe(f.file, migrations).sqlite;
    expect(history(good)).toHaveLength(24);
    expect(good.pragma('table_info(task_items)')).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'planned_date' })]),
    );
    expect(good.prepare('SELECT value FROM toolchain_probe').get()).toEqual({
      value: '合成旧业务',
    });
    good.close();
  } finally {
    a.process.kill('SIGKILL');
    b.process.kill('SIGKILL');
  }
});
