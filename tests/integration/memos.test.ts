import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createMemoApplication, createTaskApplication } from '../../packages/application/src';
import type { MemoResponse } from '../../packages/contracts/src';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
import { integrationMigrations } from '../../packages/local-db/src/migration-manifest';
import { createMemoStore } from '../../packages/local-db/src/memo-store';
import Database from 'better-sqlite3';

const migrations = resolve('packages/local-db/migrations');
const roots: string[] = [];
const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
const identity = () => ({
  protocol_version: 1 as const,
  request_id: crypto.randomUUID(),
  idempotency_key: crypto.randomUUID(),
});
const ok = (response: MemoResponse) => {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error(response.message);
  return response;
};
function directory() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-memo-'));
  roots.push(root);
  return root;
}
function open(file: string) {
  const connection = openToolchainProbe(file, migrations);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    connection.sqlite.close();
  };
  closers.push(close);
  return { ...connection, close };
}
it('keeps an undated memo across days and restart, and scratch, restore, edit and soft-delete only that memo', () => {
  const root = directory();
  const file = join(root, 'db.sqlite');
  let clock = '2026-11-15T16:00:00.000Z';
  const first = open(file);
  const app = createMemoApplication(createMemoStore(first.sqlite, 'local', () => clock));
  const created = {
    ...identity(),
    operation: 'create' as const,
    memo_id: crypto.randomUUID(),
    text: '  合成备忘  ',
  };
  const saved = ok(app.execute(created));
  const memo = saved.memos[0];
  expect(memo).toMatchObject({
    id: created.memo_id,
    text: '合成备忘',
    status: 'active',
    version: 1,
    created_at: clock,
    updated_at: clock,
    deleted_at: null,
  });
  expect(memo).not.toHaveProperty('task_id');
  expect(ok(app.execute({ ...created, request_id: crypto.randomUUID() }))).toEqual(saved);
  expect(
    app.execute({
      protocol_version: 1,
      operation: 'receipt',
      idempotency_key: created.idempotency_key,
    }),
  ).toEqual(saved);
  const memoSql = first.sqlite
    .prepare("SELECT sql FROM sqlite_schema WHERE name='memos'")
    .get() as { sql: string };
  expect(memoSql.sql).not.toMatch(/task_id|matter_id|due_date|planned_date|\bdate\b/);
  expect(
    (
      first.sqlite.prepare('PRAGMA table_info(memos)').all() as Array<{
        name: string;
        notnull: number;
      }>
    ).map((column) => [column.name, column.notnull]),
  ).toEqual([
    ['id', 1],
    ['workspace_id', 1],
    ['text', 1],
    ['status', 1],
    ['version', 1],
    ['created_at', 1],
    ['updated_at', 1],
    ['deleted_at', 0],
  ]);
  clock = '2026-11-15T16:00:01.000Z';
  const other = ok(
    app.execute({
      ...identity(),
      operation: 'create',
      memo_id: crypto.randomUUID(),
      text: '另一条备忘',
    }),
  ).memos[0];
  clock = '2026-11-16T01:00:00.000Z';
  expect(ok(app.execute({ protocol_version: 1, operation: 'list', view: 'active' })).memos).toEqual(
    [other, memo],
  );
  const scratched = ok(
    app.execute({
      ...identity(),
      operation: 'scratch',
      memo_id: memo.id,
      expected_version: 1,
    }),
  ).memos[0];
  expect(scratched).toMatchObject({
    text: '合成备忘',
    status: 'done',
    version: 2,
    created_at: memo.created_at,
    deleted_at: null,
  });
  expect(ok(app.execute({ protocol_version: 1, operation: 'list', view: 'active' })).memos).toEqual(
    [other],
  );
  expect(ok(app.execute({ protocol_version: 1, operation: 'list', view: 'done' })).memos).toEqual([
    scratched,
  ]);
  expect(
    app.execute({ ...identity(), operation: 'scratch', memo_id: memo.id, expected_version: 2 }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  clock = '2026-11-20T00:00:00.000Z';
  const restored = ok(
    app.execute({
      ...identity(),
      operation: 'restore',
      memo_id: memo.id,
      expected_version: 2,
    }),
  ).memos[0];
  expect(restored).toMatchObject({ status: 'active', text: '合成备忘', version: 3 });
  const edited = ok(
    app.execute({
      ...identity(),
      operation: 'update',
      memo_id: memo.id,
      expected_version: 3,
      text: '改过的备忘',
    }),
  ).memos[0];
  expect(edited).toMatchObject({
    text: '改过的备忘',
    status: 'active',
    version: 4,
    created_at: memo.created_at,
  });
  const done = ok(
    app.execute({ ...identity(), operation: 'scratch', memo_id: memo.id, expected_version: 4 }),
  ).memos[0];
  const deleted = ok(
    app.execute({ ...identity(), operation: 'delete', memo_id: memo.id, expected_version: 5 }),
  ).memos[0];
  expect(deleted).toMatchObject({
    text: '改过的备忘',
    status: 'done',
    version: 6,
    deleted_at: clock,
  });
  expect(ok(app.execute({ protocol_version: 1, operation: 'list', view: 'active' })).memos).toEqual(
    [other],
  );
  expect(ok(app.execute({ protocol_version: 1, operation: 'list', view: 'done' })).memos).toEqual(
    [],
  );
  expect(
    ok(app.execute({ protocol_version: 1, operation: 'list', view: 'deleted' })).memos,
  ).toEqual([deleted]);
  expect(done.status).toBe('done');
  const recovered = ok(
    app.execute({ ...identity(), operation: 'recover', memo_id: memo.id, expected_version: 6 }),
  ).memos[0];
  expect(recovered).toMatchObject({
    status: 'done',
    text: '改过的备忘',
    deleted_at: null,
    version: 7,
  });
  expect(ok(app.execute({ protocol_version: 1, operation: 'list', view: 'done' })).memos).toEqual([
    recovered,
  ]);
  first.close();
  const reopened = open(file);
  const again = createMemoApplication(createMemoStore(reopened.sqlite, 'local'));
  expect(ok(again.execute({ protocol_version: 1, operation: 'list', view: 'done' })).memos).toEqual(
    [recovered],
  );
  expect(
    ok(again.execute({ protocol_version: 1, operation: 'list', view: 'active' })).memos,
  ).toEqual([other]);
});
it('isolates memo writes from tasks, documents and other workspaces', () => {
  const file = join(directory(), 'db.sqlite');
  const store = openTaskStore(file, migrations);
  closers.push(() => store.close());
  const tasks = createTaskApplication(store);
  const memos = createMemoApplication(store.memos);
  const task = tasks.execute({
    ...identity(),
    operation: 'create',
    title: '合成任务',
    objective: '',
  });
  if (!task.ok) throw new Error(task.message);
  const read = () =>
    tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.tasks[0].id });
  const before = read();
  const db = new Database(file, { readonly: true });
  closers.push(() => db.close());
  const counts = () => ({
    tasks: (db.prepare('SELECT count(*) n FROM task_items').get() as { n: number }).n,
    documents: (db.prepare('SELECT count(*) n FROM documents').get() as { n: number }).n,
    activity: (db.prepare('SELECT count(*) n FROM task_activity').get() as { n: number }).n,
    bodies: (db.prepare('SELECT count(*) n FROM body_revisions').get() as { n: number }).n,
  });
  const beforeCounts = counts();
  const memo = ok(
    memos.execute({
      ...identity(),
      operation: 'create',
      memo_id: crypto.randomUUID(),
      text: '只改备忘',
    }),
  ).memos[0];
  ok(memos.execute({ ...identity(), operation: 'scratch', memo_id: memo.id, expected_version: 1 }));
  ok(memos.execute({ ...identity(), operation: 'delete', memo_id: memo.id, expected_version: 2 }));
  ok(memos.execute({ ...identity(), operation: 'recover', memo_id: memo.id, expected_version: 3 }));
  expect(read()).toEqual(before);
  expect(counts()).toEqual(beforeCounts);
  expect(db.prepare('SELECT count(*) n FROM memos').get()).toEqual({ n: 1 });
  const otherStore = openTaskStore(file, migrations, 'other');
  closers.push(() => otherStore.close());
  const other = createMemoApplication(otherStore.memos);
  expect(ok(other.execute({ protocol_version: 1, operation: 'list', view: 'done' })).memos).toEqual(
    [],
  );
  expect(
    other.execute({ ...identity(), operation: 'scratch', memo_id: memo.id, expected_version: 4 }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(
    other.execute({ ...identity(), operation: 'create', memo_id: memo.id, text: '越权副本' }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(ok(memos.execute({ protocol_version: 1, operation: 'list', view: 'done' })).memos).toEqual(
    [expect.objectContaining({ id: memo.id, text: '只改备忘', status: 'done' })],
  );
});
it('rolls back a failed save, keeps the original receipt, and rejects stale versions', () => {
  const file = join(directory(), 'db.sqlite');
  const connection = open(file);
  const app = createMemoApplication(createMemoStore(connection.sqlite, 'local'));
  const request = {
    ...identity(),
    operation: 'create' as const,
    memo_id: crypto.randomUUID(),
    text: '失败演练',
  };
  connection.sqlite.exec(
    "CREATE TRIGGER fail_memo_receipt BEFORE INSERT ON memo_receipts BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
  );
  expect(app.execute(request)).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  expect(connection.sqlite.prepare('SELECT count(*) n FROM memos').get()).toEqual({ n: 0 });
  expect(
    app.execute({
      protocol_version: 1,
      operation: 'receipt',
      idempotency_key: request.idempotency_key,
    }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  connection.sqlite.exec('DROP TRIGGER fail_memo_receipt');
  const saved = ok(app.execute(request));
  expect(saved.memos).toHaveLength(1);
  expect(
    app.execute({ ...request, request_id: crypto.randomUUID(), text: '另一内容' }),
  ).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  expect(ok(app.execute({ ...request, request_id: crypto.randomUUID() }))).toEqual(saved);
  expect(
    app.execute({
      ...identity(),
      operation: 'update',
      memo_id: request.memo_id,
      expected_version: 2,
      text: '过期版本',
    }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(ok(app.execute({ protocol_version: 1, operation: 'list', view: 'active' })).memos).toEqual(
    saved.memos,
  );
  expect(app.execute({ ...request, text: '' })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(app.execute({ ...request, task_id: crypto.randomUUID() })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
});
it('upgrades the previous history without moving old rows, then stores memos separately', () => {
  const root = directory();
  const file = join(root, 'old.sqlite');
  const old = new Database(file);
  old.exec(
    'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  for (const migration of integrationMigrations.slice(0, -1)) {
    old.exec(readFileSync(join(migrations, `${migration.tag}.sql`), 'utf8'));
    old
      .prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)')
      .run(migration.hash, migration.when);
  }
  old.prepare('INSERT INTO toolchain_probe(id,value) VALUES(?,?)').run('preserved', '旧数据');
  const history = old
    .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY rowid')
    .all();
  old.close();
  const upgraded = open(file);
  expect(upgraded.sqlite.prepare('SELECT * FROM toolchain_probe').all()).toEqual([
    { id: 'preserved', value: '旧数据' },
  ]);
  expect(
    upgraded.sqlite
      .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY rowid')
      .all()
      .slice(0, -1),
  ).toEqual(history);
  expect(upgraded.sqlite.prepare('SELECT * FROM memos').all()).toEqual([]);
  expect(upgraded.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
  expect(upgraded.sqlite.pragma('foreign_key_check')).toEqual([]);
  const app = createMemoApplication(
    createMemoStore(upgraded.sqlite, 'local', () => '2026-11-16T00:00:00.000Z'),
  );
  ok(
    app.execute({
      ...identity(),
      operation: 'create',
      memo_id: crypto.randomUUID(),
      text: '升级后的备忘',
    }),
  );
  expect(upgraded.sqlite.prepare('SELECT * FROM toolchain_probe').all()).toEqual([
    { id: 'preserved', value: '旧数据' },
  ]);
  expect(upgraded.sqlite.prepare('SELECT count(*) n FROM task_items').get()).toEqual({ n: 0 });
});
