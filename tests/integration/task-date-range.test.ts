import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openTaskStore } from '../../packages/local-db/src';
import { createTaskApplication } from '../../packages/application/src/task-application';
import { createReminderApplication } from '../../packages/application/src/reminder-application';
import type { TaskRequest, TaskResponse } from '../../packages/contracts/src';

const migrations = resolve('packages/local-db/migrations');
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
const file = () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-date-range-'));
  roots.push(root);
  return join(root, 'workspace.sqlite');
};
const ok = (r: TaskResponse) => {
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(r.message);
  return r;
};

it('upgrades the previous complete history without changing old task identities, dates or receipt bytes; reopens a saved range', () => {
  const path = file(),
    db = new Database(path);
  db.exec(
    'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'));
  for (const entry of journal.entries.slice(0, -1)) {
    const sql = readFileSync(join(migrations, entry.tag + '.sql'), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)').run(
      createHash('sha256').update(sql).digest('hex'),
      entry.when,
    );
  }
  const id = randomUUID(),
    document = randomUUID(),
    body = randomUUID();
  db.prepare(
    'INSERT INTO task_items(id,workspace_id,title,objective,version,updated_at,due_date) VALUES(?,?,?,?,1,?,?)',
  ).run(id, 'local', '历史任务', '', '2026-11-01T00:00:00.000Z', '2026-11-12');
  db.prepare(
    'INSERT INTO documents(id,task_id,body_id,body_revision,editor_schema) VALUES(?,?,?,0,1)',
  ).run(document, id, body);
  const request = { ...identity(), operation: 'create' as const, title: '历史任务', objective: '' };
  const { request_id, ...content } = request;
  void request_id;
  const receipt = JSON.stringify({
    ok: true,
    tasks: [
      {
        id,
        title: '历史任务',
        objective: '',
        status: 'todo',
        priority: 0,
        due_date: '2026-11-12',
        matter_id: null,
        version: 1,
        document_id: document,
        body_id: body,
        body_revision: 0,
        editor_schema: 1,
        updated_at: '2026-11-01T00:00:00.000Z',
      },
    ],
    state: null,
    receipt: request.idempotency_key,
  });
  const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  db.prepare('INSERT INTO task_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)').run(
    'local',
    request.idempotency_key,
    digest,
    receipt,
  );
  db.close();
  let store = openTaskStore(path, migrations),
    app = createTaskApplication(store);
  const before = ok(app.execute({ protocol_version: 1, operation: 'read', task_id: id })).tasks[0]!;
  expect(before).toMatchObject({
    id,
    document_id: document,
    body_id: body,
    start_date: null,
    due_date: '2026-11-12',
    version: 1,
  });
  expect(ok(app.execute(request)).tasks[0]?.start_date).toBeUndefined();
  const update = {
    ...identity(),
    operation: 'update_attributes' as const,
    task_id: id,
    expected_version: 1,
    priority: 0,
    start_date: '2026-11-10',
    due_date: '2026-11-12',
  };
  const saved = ok(app.execute(update));
  expect(app.execute(update)).toEqual(saved);
  store.close();
  store = openTaskStore(path, migrations);
  app = createTaskApplication(store);
  expect(
    ok(app.execute({ protocol_version: 1, operation: 'read', task_id: id })).tasks[0],
  ).toMatchObject({
    start_date: '2026-11-10',
    due_date: '2026-11-12',
    version: 2,
    document_id: document,
    body_id: body,
  });
  const verify = new Database(path, { readonly: true });
  expect(
    verify
      .prepare('SELECT digest,result FROM task_receipts WHERE key=?')
      .get(request.idempotency_key),
  ).toEqual({ digest, result: receipt });
  verify.close();
  store.close();
});

it('preserves omitted starts, clears explicit null, rejects invalid ranges, conflicts and foreign workspaces without a second version', () => {
  const path = file(),
    store = openTaskStore(path, migrations),
    app = createTaskApplication(store);
  const created = ok(
    app.execute({
      ...identity(),
      operation: 'create',
      title: '日期样例',
      objective: '',
      start_date: '2028-02-29',
      due_date: '2028-03-02',
    }),
  ).tasks[0]!;
  const update = (patch: Record<string, unknown>) =>
    app.execute({
      ...identity(),
      operation: 'update_attributes',
      task_id: created.id,
      expected_version: 1,
      priority: 2,
      due_date: '2028-03-02',
      ...patch,
    });
  expect(update({ start_date: '2028-03-03' })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(update({ start_date: '2027-02-29' })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(update({ due_date: '2028-02-28' })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  const preserved = ok(update({})).tasks[0]!;
  expect(preserved).toMatchObject({ start_date: '2028-02-29', version: 2 });
  expect(update({ start_date: null })).toMatchObject({ ok: false, code: 'CONFLICT' });
  const cleared = ok(update({ expected_version: 2, start_date: null })).tasks[0]!;
  expect(cleared.start_date).toBeNull();
  const foreign = openTaskStore(path, migrations, 'foreign');
  expect(
    foreign.execute({
      ...identity(),
      operation: 'update_attributes',
      task_id: created.id,
      expected_version: 3,
      priority: 2,
      due_date: null,
      start_date: null,
    }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  foreign.close();
  const db = new Database(path);
  expect(() =>
    db
      .prepare('UPDATE task_items SET start_date=?,due_date=? WHERE id=?')
      .run('2028-03-04', '2028-03-02', created.id),
  ).toThrow();
  db.close();
  store.close();
});

it('commits an explicitly confirmed initial reminder with its task and replays one identity; rejects mismatched instants', () => {
  const path = file(),
    store = openTaskStore(path, migrations),
    app = createTaskApplication(store);
  const reminder = {
    date: '2030-11-12',
    time: '09:00',
    timezone: 'Asia/Shanghai',
    instant: '2030-11-12T01:00:00.000Z',
    confirmed: true as const,
  };
  expect(
    app.execute({
      ...identity(),
      operation: 'create',
      title: '无效提醒',
      objective: '',
      initial_reminder: { ...reminder, instant: '2030-11-12T02:00:00.000Z' },
    }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  const command: TaskRequest = {
    ...identity(),
    operation: 'create',
    title: '有提醒的任务',
    objective: '',
    initial_reminder: reminder,
  };
  const r = ok(app.execute(command));
  expect(r.reminder_created).toBe(true);
  expect(app.execute(command)).toEqual(r);
  const list = createReminderApplication(store.reminders).execute({
    protocol_version: 1,
    operation: 'list',
    task_id: r.tasks[0]!.id,
  });
  expect(list).toMatchObject({
    ok: true,
    reminders: [
      { task_id: r.tasks[0]!.id, date: reminder.date, instant: reminder.instant, version: 1 },
    ],
  });
  expect(ok(app.execute({ protocol_version: 1, operation: 'list' })).tasks).toHaveLength(1);
  store.close();
});

it('rolls task, document, reminder, activity and receipts back if the initial reminder receipt cannot be written', () => {
  const path = file(),
    store = openTaskStore(path, migrations),
    app = createTaskApplication(store),
    db = new Database(path);
  db.exec(
    "CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON reminder_receipts BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  const command: TaskRequest = {
    ...identity(),
    operation: 'create',
    title: '原子创建样例',
    objective: '',
    initial_reminder: {
      date: '2030-11-12',
      time: '09:00',
      timezone: 'Asia/Shanghai',
      instant: '2030-11-12T01:00:00.000Z',
      confirmed: true,
    },
  };
  expect(app.execute(command)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
  for (const table of [
    'task_items',
    'documents',
    'reminders',
    'task_activity',
    'task_receipts',
    'reminder_receipts',
  ])
    expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  db.exec('DROP TRIGGER synthetic_receipt_failure');
  expect(ok(app.execute(command)).reminder_created).toBe(true);
  db.close();
  store.close();
});

it('creates with optional local assignee values while keeping omitted legacy request digests and replay stable', () => {
  const path = file();
  let store = openTaskStore(path, migrations),
    app = createTaskApplication(store);
  const legacy = {
    ...identity(),
    operation: 'create' as const,
    title: '旧格式创建',
    objective: '',
  };
  const first = ok(app.execute(legacy));
  expect(first.tasks[0]?.assignee).toBe('本人');
  const { request_id, ...content } = legacy;
  void request_id;
  const expectedDigest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const check = new Database(path);
  expect(
    check.prepare('SELECT digest FROM task_receipts WHERE key=?').get(legacy.idempotency_key),
  ).toEqual({ digest: expectedDigest });
  check.close();
  for (const assignee of ['本人', null, '  合成负责人  ']) {
    const request = {
      ...identity(),
      operation: 'create' as const,
      title: '指定负责人',
      objective: '',
      assignee,
    };
    const created = ok(app.execute(request));
    expect(created.tasks[0]?.assignee).toBe(assignee?.trim() ?? null);
    expect(app.execute(request)).toEqual(created);
  }
  for (const assignee of ['', '甲'.repeat(81), '甲\0乙', 7])
    expect(
      app.execute({
        ...identity(),
        operation: 'create',
        title: '非法负责人',
        objective: '',
        assignee,
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  store.close();
  store = openTaskStore(path, migrations);
  app = createTaskApplication(store);
  expect(app.execute(legacy)).toEqual(first);
  expect(ok(app.execute({ protocol_version: 1, operation: 'list' })).tasks).toHaveLength(4);
  store.close();
});
