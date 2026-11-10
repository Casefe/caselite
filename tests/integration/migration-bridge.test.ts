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
import Database from 'better-sqlite3';
import { openToolchainProbe } from '../../packages/local-db/src/connection';
import {
  bridgeMigrationHistories,
  migrateDatabase,
} from '../../packages/local-db/src/migration-bridge';
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
      expect(history(upgraded)).toHaveLength(integrationMigrations.length);
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
  expect(() => migrateDatabase(f.db, migrations)).toThrow('无法识别');
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
  expect(history(recovered)).toHaveLength(integrationMigrations.length);
  recovered.close();
});
type WorkerMessage = {
  phase: string;
  ok?: boolean;
  error?: string;
  pid?: number;
  targetOpened?: boolean;
  runtime?: Record<string, string>;
  inTransaction?: boolean;
};
function child(file: string, mode = 'open', release = '') {
  const process = fork(
    resolve('tests/fixtures/migration-histories/worker.cjs'),
    [file, mode, release],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  const messages: WorkerMessage[] = [];
  const closed = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    process.once('close', (code, signal) => resolve({ code, signal }));
  });
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
  return { process, next, closed };
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
    expect(history(good)).toHaveLength(integrationMigrations.length);
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
    expect(history(good)).toHaveLength(integrationMigrations.length);
    expect(new Set(history(good).map((r) => JSON.stringify(r))).size).toBe(
      integrationMigrations.length,
    );
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
    expect(history(good)).toHaveLength(integrationMigrations.length);
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

it('reads the latest migration only inside the complete write transaction', () => {
  const f = fixture('A', 21);
  const prepare = f.db.prepare.bind(f.db);
  let reads = 0;
  vi.spyOn(f.db, 'prepare').mockImplementation((sql) => {
    if (sql.includes('ORDER BY created_at DESC LIMIT 1')) {
      expect(f.db.inTransaction).toBe(true);
      reads++;
    }
    return prepare(sql);
  });
  migrateDatabase(f.db, migrations);
  expect(reads).toBe(1);
  expect(history(f.db)).toHaveLength(integrationMigrations.length);
  f.db.close();
});

it('refuses an already active transaction rather than mistaking a savepoint for a write lock', () => {
  const f = fixture('A', 21);
  const before = { history: history(f.db), schema: schema(f.db) };
  f.db.transaction(() => {
    expect(() => migrateDatabase(f.db, migrations)).toThrow('顶层事务');
  })();
  expect({ history: history(f.db), schema: schema(f.db) }).toEqual(before);
  f.db.close();
});

it.each(['sql', 'when', 'breakpoints', 'length'])(
  'rejects a %s plan changed between public parsing and frozen-directory validation',
  (kind) => {
    const f = fixture('A', 21);
    const changing = join(f.root, 'changing-plan');
    cpSync(migrations, changing, { recursive: true });
    const target = join(
      changing,
      kind === 'sql' ? '0017_task_subscription.sql' : 'meta/_journal.json',
    );
    const original = readFileSync(target, 'utf8');
    if (kind === 'sql') writeFileSync(target, original + '\n-- Synthetic alternate plan bytes\n');
    else {
      const journal = JSON.parse(original);
      if (kind === 'length') journal.entries.pop();
      if (kind === 'when') journal.entries[17].when++;
      if (kind === 'breakpoints') journal.entries[17].breakpoints = false;
      writeFileSync(target, JSON.stringify(journal));
    }
    const transaction = f.db.transaction.bind(f.db);
    vi.spyOn(f.db, 'transaction').mockImplementationOnce((callback) => {
      // 模拟文件在两次读取之间换版，仅操作测试自有副本；桥接看到原版但计划来自另一版。
      writeFileSync(target, original);
      return transaction(callback);
    });
    const before = { history: history(f.db), schema: schema(f.db) };
    expect(() => migrateDatabase(f.db, changing)).toThrow('无法识别');
    expect(f.db.inTransaction).toBe(false);
    expect({ history: history(f.db), schema: schema(f.db) }).toEqual(before);
    f.db.close();
  },
);

it('rejects a view masquerading as the migration ledger without creating application tables', () => {
  const db = new Database(':memory:');
  const last = integrationMigrations.at(-1)!;
  db.exec(
    `CREATE VIEW __drizzle_migrations AS SELECT '${last.hash}' AS hash, ${last.when} AS created_at`,
  );
  const before = schema(db);
  expect(() => migrateDatabase(db, migrations)).toThrow('无法识别');
  expect(schema(db)).toEqual(before);
  db.close();
});

it('rolls back bridge additions as well as later DDL when the complete upgrade fails', () => {
  const f = fixture('A', 21);
  const before = { history: history(f.db), schema: schema(f.db) };
  const prepare = f.db.prepare.bind(f.db);
  vi.spyOn(f.db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql.includes('ADD COLUMN attention_timezone')) {
      const run = statement.run.bind(statement);
      vi.spyOn(statement, 'run').mockImplementation((...args: unknown[]) => {
        run(...args);
        throw Error('synthetic later migration failure');
      });
    }
    return statement;
  });
  expect(() => migrateDatabase(f.db, migrations)).toThrow('synthetic later migration failure');
  expect(f.db.inTransaction).toBe(false);
  expect({ history: history(f.db), schema: schema(f.db) }).toEqual(before);
  vi.restoreAllMocks();
  migrateDatabase(f.db, migrations);
  expect(history(f.db)).toHaveLength(integrationMigrations.length);
  f.db.close();
});

it.each(['ledger', 'commit'])(
  'rolls back the full upgrade when the final %s operation fails',
  (failure) => {
    const f = fixture('A', 21);
    f.db.pragma('foreign_keys = ON');
    const before = { history: history(f.db), schema: schema(f.db) };
    const prepare = f.db.prepare.bind(f.db);
    vi.spyOn(f.db, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql);
      if (sql === 'INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)') {
        const run = statement.run.bind(statement);
        vi.spyOn(statement, 'run').mockImplementation((...args: unknown[]) => {
          const result = run(...args);
          if (args[1] === integrationMigrations.at(-1)!.when) {
            if (failure === 'ledger') throw Error('synthetic final ledger failure');
            // 延迟外键在真实 COMMIT 才失败，证明异常不只覆盖回调内部的 SQL。
            f.db.exec(`CREATE TABLE synthetic_commit_failure (
              task_id TEXT REFERENCES task_items(id) DEFERRABLE INITIALLY DEFERRED
            ); INSERT INTO synthetic_commit_failure VALUES('missing-synthetic-task')`);
          }
          return result;
        });
      }
      return statement;
    });
    expect(() => migrateDatabase(f.db, migrations)).toThrow(
      failure === 'ledger' ? 'synthetic final ledger failure' : 'FOREIGN KEY constraint failed',
    );
    expect(f.db.inTransaction).toBe(false);
    expect({ history: history(f.db), schema: schema(f.db) }).toEqual(before);
    f.db.close();
  },
);

it('reports a bounded busy lock without retrying or changing the old library', () => {
  const f = fixture('A', 21);
  const before = { history: history(f.db), schema: schema(f.db) };
  const competitor = new Database(f.file, { timeout: 20 });
  f.db.exec('BEGIN IMMEDIATE');
  const transaction = vi.spyOn(competitor, 'transaction');
  try {
    expect(() => migrateDatabase(competitor, migrations)).toThrow(
      expect.objectContaining({ code: 'SQLITE_BUSY' }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(competitor.inTransaction).toBe(false);
  } finally {
    f.db.exec('ROLLBACK');
    competitor.close();
  }
  expect({ history: history(f.db), schema: schema(f.db) }).toEqual(before);
  f.db.close();
});

it.each(['fresh', 'current'])(
  'successfully opens a %s library through two independent production connections',
  async (state) => {
    const root = mkdtempSync(join(tmpdir(), 'caselite-production-concurrency-'));
    roots.push(root);
    const file = join(root, 'synthetic.sqlite');
    if (state === 'current') openToolchainProbe(file, migrations).sqlite.close();
    const workers = [child(file), child(file)];
    try {
      await Promise.all(workers.map((worker) => worker.next('ready')));
      for (const worker of workers) worker.process.send('go');
      for (const result of await Promise.all(workers.map((worker) => worker.next('done'))))
        expect(result).toMatchObject({ ok: true });
      expect(await Promise.all(workers.map((worker) => worker.closed))).toEqual([
        { code: 0, signal: null },
        { code: 0, signal: null },
      ]);
      const db = openToolchainProbe(file, migrations).sqlite;
      expect(history(db)).toHaveLength(integrationMigrations.length);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('foreign_key_check')).toEqual([]);
      db.close();
    } finally {
      for (const worker of workers) worker.process.kill('SIGKILL');
    }
  },
);

it.each(['A', 'B'] as const)(
  'serializes complete independent upgrades of %s while preserving committed Yjs and receipts',
  async (branch) => {
    const f = fixture(branch);
    const store = openTaskStore(f.file, f.folder);
    const app = createTaskApplication(store);
    const identity = () => ({
      protocol_version: 1 as const,
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
    });
    const created = app.execute({
      ...identity(),
      operation: 'create',
      title: '合成并发正文保全',
      objective: '',
    });
    if (!created.ok) throw Error('Synthetic create failed');
    const task = created.tasks[0];
    const doc = new Y.Doc(),
      block = new Y.XmlElement('paragraph'),
      text = new Y.XmlText();
    text.insert(0, '非空旧正文与原键回执保全🙂');
    block.insert(0, [text]);
    doc.getXmlFragment('default').push([block]);
    const saved = app.execute({
      ...identity(),
      operation: 'save',
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: 0,
      editor_schema: 1,
      state: Array.from(Y.encodeStateAsUpdate(doc)),
    });
    expect(saved.ok).toBe(true);
    doc.destroy();
    const protectedRows = () =>
      ['body_revisions', 'task_receipts', 'documents'].map((table) =>
        f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      );
    const before = protectedRows();
    expect((before[0] as unknown[]).length).toBe(1);
    store.close();
    f.db.close();
    const release = join(f.root, 'release-atomic');
    const a = child(f.file, 'atomic-pause', release),
      b = child(f.file, 'atomic');
    try {
      const ready = await Promise.all([a.next('ready'), b.next('ready')]);
      expect(new Set(ready.map((r) => r.pid)).size).toBe(2);
      for (const r of ready) {
        expect(r.targetOpened).toBe(false);
        expect(Object.keys(r.runtime ?? {})).length.greaterThanOrEqual(6);
        for (const [path, hash] of Object.entries(r.runtime ?? {}))
          expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash);
      }
      a.process.send('go');
      expect(await a.next('atomic-read')).toMatchObject({ inTransaction: true });
      b.process.send('go');
      await b.next('opening');
      let secondFinished = false;
      const second = b.next('done').then((result) => {
        secondFinished = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(secondFinished).toBe(false);
      writeFileSync(release, 'release');
      expect(await a.next('done')).toMatchObject({ ok: true });
      expect(await second).toMatchObject({ ok: true });
      expect(await a.closed).toEqual({ code: 0, signal: null });
      expect(await b.closed).toEqual({ code: 0, signal: null });
      const upgraded = openToolchainProbe(f.file, migrations).sqlite;
      const after = ['body_revisions', 'task_receipts', 'documents'].map((table) =>
        upgraded.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      );
      expect(after).toEqual(before);
      expect(history(upgraded)).toHaveLength(integrationMigrations.length);
      expect(upgraded.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(upgraded.pragma('foreign_key_check')).toEqual([]);
      upgraded.close();
    } finally {
      a.process.kill('SIGKILL');
      b.process.kill('SIGKILL');
    }
  },
);

it('preserves the pre-upgrade library after process death in later DDL of the complete transaction', async () => {
  const f = fixture('A', 21);
  const before = { history: history(f.db), schema: schema(f.db) };
  f.db.close();
  const c = child(f.file, 'atomic-crash');
  try {
    await c.next('ready');
    c.process.send('go');
    await c.next('uncommitted-later-ddl');
    c.process.kill('SIGKILL');
    expect(await c.closed).toEqual({ code: null, signal: 'SIGKILL' });
    const old = openToolchainProbe(f.file, f.folder).sqlite;
    expect({ history: history(old), schema: schema(old) }).toEqual(before);
    old.close();
    const recovered = openToolchainProbe(f.file, migrations).sqlite;
    expect(history(recovered)).toHaveLength(integrationMigrations.length);
    recovered.close();
  } finally {
    c.process.kill('SIGKILL');
  }
});
