import { afterEach, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
import { createTaskApplication } from '../../packages/application/src/task-application';
import type { TaskResponse } from '../../packages/contracts/src';

const migrations = resolve('packages/local-db/migrations'),
  roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
const root = () => {
  const p = mkdtempSync(join(tmpdir(), 'caselite-attributes-'));
  roots.push(p);
  return p;
};
const ok = (r: TaskResponse) => {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.message);
  return r;
};
const binary = () => {
  const d = new Y.Doc(),
    p = new Y.XmlElement('paragraph'),
    t = new Y.XmlText();
  t.insert(0, '合成正文：普通日期不得覆盖。');
  p.insert(0, [t]);
  d.getXmlFragment('default').insert(0, [p]);
  const bytes = Array.from(Y.encodeStateAsUpdate(d));
  d.destroy();
  return bytes;
};
function migrationCopy(directory: string, count: number, fail = false) {
  const target = join(directory, fail ? 'failed' : 'old');
  mkdirSync(join(target, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, count);
  for (const e of journal.entries)
    copyFileSync(join(migrations, e.tag + '.sql'), join(target, e.tag + '.sql'));
  if (fail) {
    const file = join(target, journal.entries.at(-1).tag + '.sql');
    writeFileSync(
      file,
      readFileSync(file, 'utf8') +
        '\n--> statement-breakpoint\nSELECT * FROM synthetic_missing_attributes;',
    );
  }
  writeFileSync(join(target, 'meta/_journal.json'), JSON.stringify(journal));
  return target;
}
it('upgrades populated pre-attribute WAL data and its backup, preserving status, bytes, timestamps and old receipt JSON/digest', async () => {
  const dir = root(),
    file = join(dir, 'old.sqlite'),
    backup = join(dir, 'backup.sqlite'),
    old = migrationCopy(dir, 7);
  const c = openToolchainProbe(file, old),
    db = c.sqlite;
  db.pragma('journal_mode=WAL');
  db.pragma('foreign_keys=ON');
  const id = randomUUID(),
    body = randomUUID(),
    document = randomUUID(),
    key = randomUUID(),
    bytes = Buffer.from(binary());
  db.prepare(
    'INSERT INTO task_items(id,workspace_id,title,objective,status,version,updated_at) VALUES(?,?,?,?,?,2,?)',
  ).run(id, 'local', '合成旧任务', '', 'done', '2026-11-01');
  db.prepare(
    'INSERT INTO documents(id,task_id,body_id,body_revision,editor_schema) VALUES(?,?,?,1,1)',
  ).run(document, id, body);
  db.prepare('INSERT INTO body_revisions(body_id,revision,state) VALUES(?,1,?)').run(body, bytes);
  const oldResult = JSON.stringify({
    ok: true,
    tasks: [
      {
        id,
        title: '合成旧任务',
        objective: '',
        status: 'done',
        version: 2,
        updated_at: '2026-11-01',
        matter_id: null,
        document_id: document,
        body_id: body,
        body_revision: 1,
        editor_schema: 1,
      },
    ],
    state: null,
    receipt: key,
  });
  db.prepare('INSERT INTO task_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)').run(
    'local',
    key,
    'original-digest',
    oldResult,
  );
  const before = JSON.stringify({
    docs: db.prepare('SELECT * FROM documents').all(),
    body: db.prepare('SELECT * FROM body_revisions').all(),
    receipts: db.prepare('SELECT * FROM task_receipts').all(),
  });
  await db.backup(backup);
  db.close();
  for (const candidate of [file, backup]) {
    const store = openTaskStore(candidate, migrations),
      app = createTaskApplication(store);
    const r = ok(app.execute({ protocol_version: 1, operation: 'read', task_id: id }));
    expect(r.tasks[0]).toMatchObject({
      id,
      status: 'done',
      priority: 0,
      due_date: null,
      version: 2,
      updated_at: '2026-11-01',
    });
    expect(r.state).toEqual(Array.from(bytes));
    expect(
      ok(app.execute({ protocol_version: 1, operation: 'status', idempotency_key: key })).tasks[0],
    ).toMatchObject({ status: 'done', priority: 0, due_date: null });
    store.close();
    const checked = openToolchainProbe(candidate, migrations).sqlite;
    expect(
      JSON.stringify({
        docs: checked.prepare('SELECT * FROM documents').all(),
        body: checked.prepare('SELECT * FROM body_revisions').all(),
        receipts: checked.prepare('SELECT * FROM task_receipts').all(),
      }),
    ).toBe(before);
    expect(checked.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(checked.pragma('foreign_key_check')).toEqual([]);
    expect(checked.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
      n: 9,
    });
    checked.close();
  }
});
it('rolls failed attribute DDL back without dropping old status, Task or body rows and upgrades afterward', () => {
  const dir = root(),
    file = join(dir, 'db.sqlite'),
    old = migrationCopy(dir, 7),
    db = openToolchainProbe(file, old).sqlite;
  db.prepare(
    'INSERT INTO task_items(id,workspace_id,title,objective,status,version,updated_at) VALUES(?,?,?,?,?,3,?)',
  ).run('synthetic', 'local', '旧任务', '', 'canceled', '2026-11-01');
  const body = randomUUID(),
    bytes = Buffer.from(binary());
  db.prepare(
    'INSERT INTO documents(id,task_id,body_id,body_revision,editor_schema) VALUES(?,?,?,1,1)',
  ).run(randomUUID(), 'synthetic', body);
  db.prepare('INSERT INTO body_revisions(body_id,revision,state) VALUES(?,1,?)').run(body, bytes);
  db.close();
  expect(() => openTaskStore(file, migrationCopy(dir, 8, true))).toThrow();
  const checked = openToolchainProbe(file, old).sqlite;
  expect(
    checked
      .prepare('PRAGMA table_info(task_items)')
      .all()
      .some((r) => (r as { name: string }).name === 'priority'),
  ).toBe(false);
  expect(checked.prepare('SELECT status,version FROM task_items').get()).toEqual({
    status: 'canceled',
    version: 3,
  });
  expect(checked.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 7 });
  expect(checked.prepare('SELECT state FROM body_revisions WHERE body_id=?').get(body)).toEqual({
    state: bytes,
  });
  checked.close();
  const upgraded = openToolchainProbe(file, migrations).sqlite;
  expect(upgraded.prepare('SELECT status,priority,due_date FROM task_items').get()).toEqual({
    status: 'canceled',
    priority: 0,
    due_date: null,
  });
  upgraded.close();
});
it('sets/clears literal dates and priorities, keeps them through legacy writes and status changes, and rejects stale or cross-workspace mutations', () => {
  const file = join(root(), 'db.sqlite'),
    store = openTaskStore(file, migrations),
    app = createTaskApplication(store);
  const create = {
    ...identity(),
    operation: 'create' as const,
    title: '合成普通日期',
    objective: '',
  };
  let task = ok(app.execute(create)).tasks[0];
  const createTask = task;
  const first = {
    ...identity(),
    operation: 'update_attributes' as const,
    task_id: task.id,
    expected_version: task.version,
    priority: 1,
    due_date: '2024-02-29',
  };
  const result = app.execute(first);
  task = ok(result).tasks[0];
  expect(ok(app.execute(create)).tasks[0]).toMatchObject({ priority: 0, due_date: null });
  expect(
    ok(app.execute({ protocol_version: 1, operation: 'read', task_id: task.id })).tasks[0],
  ).toEqual(task);
  expect(app.execute({ ...first, request_id: randomUUID() })).toEqual(result);
  expect(app.execute({ ...first, due_date: '2024-03-01' })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  expect(
    app.execute({ ...first, ...identity(), expected_version: createTask.version }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  const other = openTaskStore(file, migrations, 'other');
  expect(
    createTaskApplication(other).execute({
      ...first,
      ...identity(),
      expected_version: task.version,
    }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  other.close();
  task = ok(
    app.execute({
      ...identity(),
      operation: 'change_status',
      task_id: task.id,
      expected_version: task.version,
      status: 'done',
    }),
  ).tasks[0];
  expect(
    app.execute({ ...first, ...identity(), expected_version: task.version - 1, due_date: null }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  task = ok(
    app.execute({
      ...identity(),
      operation: 'update',
      task_id: task.id,
      expected_version: task.version,
      title: task.title,
      objective: '合成新说明',
    }),
  ).tasks[0];
  const bytes = binary();
  task = ok(
    app.execute({
      ...identity(),
      operation: 'save',
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: 0,
      editor_schema: 1,
      state: bytes,
    }),
  ).tasks[0];
  expect(task).toMatchObject({ status: 'done', priority: 1, due_date: '2024-02-29' });
  for (const due_date of ['0001-01-01', '2000-02-29', '9999-12-31', null, '2024-02-29'])
    task = ok(
      app.execute({
        ...identity(),
        operation: 'update_attributes',
        task_id: task.id,
        expected_version: task.version,
        priority: 4,
        due_date,
      }),
    ).tasks[0];
  expect(
    app.execute({
      ...identity(),
      operation: 'update_attributes',
      task_id: task.id,
      expected_version: task.version,
      priority: 4,
      due_date: task.due_date,
    }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  expect(
    ok(app.execute({ protocol_version: 1, operation: 'read', task_id: task.id })).state,
  ).toEqual(bytes);
  const db = openToolchainProbe(file, migrations).sqlite;
  for (const priority of [-1, 5, 1.5, 'unexpected'])
    expect(() =>
      db.prepare('UPDATE task_items SET priority=? WHERE id=?').run(priority, task.id),
    ).toThrow();
  for (const date of [
    '2026-02-30',
    '1900-02-29',
    '0000-01-01',
    '2026-13-01',
    '2026-01-01T00:00:00Z',
  ])
    expect(() =>
      db.prepare('UPDATE task_items SET due_date=? WHERE id=?').run(date, task.id),
    ).toThrow();
  db.close();
  store.close();
  const reopened = openTaskStore(file, migrations);
  expect(
    ok(reopened.execute({ protocol_version: 1, operation: 'read', task_id: task.id })).tasks[0],
  ).toEqual(task);
  reopened.close();
});
it.each(['task_activity', 'task_receipts'])(
  'rolls attribute/version writes back on %s failure, then retries the original key once',
  (table) => {
    const file = join(root(), 'db.sqlite'),
      store = openTaskStore(file, migrations),
      app = createTaskApplication(store),
      task = ok(
        app.execute({ ...identity(), operation: 'create', title: '合成故障', objective: '' }),
      ).tasks[0],
      db = openToolchainProbe(file, migrations).sqlite;
    const command = {
      ...identity(),
      operation: 'update_attributes' as const,
      task_id: task.id,
      expected_version: task.version,
      priority: 2,
      due_date: '2026-01-01',
    };
    db.exec(
      `CREATE TRIGGER fail_attributes BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic attributes failure'); END`,
    );
    expect(app.execute(command)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
    expect(
      ok(app.execute({ protocol_version: 1, operation: 'read', task_id: task.id })).tasks[0],
    ).toEqual(task);
    expect(
      app.execute({
        protocol_version: 1,
        operation: 'status',
        idempotency_key: command.idempotency_key,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    db.exec('DROP TRIGGER fail_attributes');
    ok(app.execute(command));
    ok(app.execute(command));
    expect(
      db
        .prepare("SELECT count(*) AS n FROM task_activity WHERE operation='update_attributes'")
        .get(),
    ).toEqual({ n: 1 });
    db.close();
    store.close();
  },
);
