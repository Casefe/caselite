import * as Y from 'yjs';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
import { createReminderApplication, createTaskApplication } from '../../packages/application/src';
import type { ReminderResponse } from '../../packages/contracts/src';
const migrations = resolve('packages/local-db/migrations'),
  roots: string[] = [];
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
const ok = (r: ReminderResponse) => {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.message);
  return r;
};
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'caselite-reminder-'));
  roots.push(dir);
  const file = join(dir, 'db.sqlite'),
    store = openTaskStore(file, migrations),
    app = createReminderApplication(store.reminders),
    tasks = createTaskApplication(store);
  const result = tasks.execute({
    ...identity(),
    operation: 'create',
    title: '合成提醒任务',
    objective: '',
  });
  if (!result.ok) throw new Error('task');
  const task = result.tasks[0];
  const cmd = {
    ...identity(),
    operation: 'schedule' as const,
    task_id: task.id,
    reminder_id: randomUUID(),
    expected_version: 0,
    date: '2026-01-01',
    time: '09:00',
    timezone: 'Asia/Shanghai',
    instant: '2026-01-01T01:00:00.000Z',
    confirmed: true as const,
  };
  return { dir, file, store, app, tasks, task, cmd };
}
it('keeps ordinary due_date independent; atomic schedule receipts, scope, version, cancel, read and restart dedup', () => {
  const { file, store, app, tasks, task, cmd } = setup();
  const before = tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.id });
  const result = ok(app.execute(cmd)),
    r = result.reminders[0];
  expect(ok(app.execute({ ...cmd, request_id: randomUUID() }))).toEqual(result);
  const changedTzdb = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
    throw new Error('synthetic tzdb change');
  });
  try {
    expect(ok(app.execute({ ...cmd, request_id: randomUUID() }))).toEqual(result);
  } finally {
    changedTzdb.mockRestore();
  }
  expect(app.execute({ ...cmd, time: '10:00', instant: '2026-01-01T02:00:00.000Z' })).toMatchObject(
    { ok: false, code: 'CONFLICT' },
  );
  expect(app.execute({ ...cmd, ...identity() })).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.id })).toEqual(
    before,
  );
  const other = openTaskStore(file, migrations, 'other'),
    otherApp = createReminderApplication(other.reminders);
  expect(ok(otherApp.execute({ protocol_version: 1, operation: 'list' })).reminders).toEqual([]);
  expect(otherApp.execute({ ...cmd, ...identity(), expected_version: 1 })).toMatchObject({
    ok: false,
    code: 'NOT_FOUND',
  });
  other.close();
  expect(app.claimDue('2025-12-31T00:00:00.000Z')).toEqual([]);
  expect(app.claimDue('2026-01-02T00:00:00.000Z')).toHaveLength(1);
  expect(app.claimDue('2026-01-02T00:00:00.000Z')).toEqual([]);
  expect(ok(app.execute({ protocol_version: 1, operation: 'list' })).reminders[0]).toMatchObject({
    attempt: 'unknown',
    read_at: null,
  });
  app.recordAttempt(r.id, 1, 'failed');
  expect(ok(app.execute({ protocol_version: 1, operation: 'list' })).reminders[0]).toMatchObject({
    attempt: 'failed',
    read_at: null,
  });
  let read = ok(
    app.execute({
      ...identity(),
      operation: 'mark_read',
      task_id: task.id,
      reminder_id: r.id,
      expected_version: 1,
      read: true,
    }),
  ).reminders[0];
  expect(read.read_at).not.toBeNull();
  expect(read.plan_revision).toBe(1);
  for (const value of [false, true]) {
    read = ok(
      app.execute({
        ...identity(),
        operation: 'mark_read',
        task_id: task.id,
        reminder_id: r.id,
        expected_version: read.version,
        read: value,
      }),
    ).reminders[0];
    expect(!!read.read_at).toBe(value);
    expect(read.plan_revision).toBe(1);
    expect(read.attempt).toBe('failed');
    expect(app.claimDue('2026-01-02T00:00:00.000Z')).toEqual([]);
  }
  expect(app.claimDue('2026-01-02T00:00:00.000Z')).toEqual([]);
  const changed = ok(
    app.execute({
      ...cmd,
      ...identity(),
      expected_version: read.version,
      time: '10:00',
      instant: '2026-01-01T02:00:00.000Z',
    }),
  ).reminders[0];
  expect(changed).toMatchObject({ plan_revision: 2, read_at: null, attempt: null });
  app.recordAttempt(r.id, 1, 'shown');
  expect(
    ok(app.execute({ protocol_version: 1, operation: 'list' })).reminders[0].attempt,
  ).toBeNull();
  const canceled = ok(
    app.execute({
      ...identity(),
      operation: 'cancel',
      task_id: task.id,
      reminder_id: r.id,
      expected_version: changed.version,
    }),
  ).reminders[0];
  expect(canceled).toMatchObject({ status: 'canceled', plan_revision: 3 });
  expect(
    app.execute({
      ...identity(),
      operation: 'mark_read',
      task_id: task.id,
      reminder_id: r.id,
      expected_version: canceled.version,
      read: true,
    }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  expect(ok(app.execute({ protocol_version: 1, operation: 'list' })).reminders[0]).toEqual(
    canceled,
  );
  expect(app.claimDue('2026-01-02T00:00:00.000Z')).toEqual([]);
  store.close();
  const reopened = openTaskStore(file, migrations),
    again = createReminderApplication(reopened.reminders);
  expect(ok(again.execute({ protocol_version: 1, operation: 'list' })).reminders[0]).toEqual(
    canceled,
  );
  expect(
    ok(
      again.execute({
        protocol_version: 1,
        operation: 'receipt',
        idempotency_key: cmd.idempotency_key,
      }),
    ),
  ).toEqual(result);
  reopened.close();
});
it('does not mark a future plan read, and an unknown attempt survives restart without blind retransmission', () => {
  const { file, store, app, task, cmd } = setup();
  const future = { ...cmd, date: '2099-01-01', instant: '2099-01-01T01:00:00.000Z' };
  const r = ok(app.execute(future)).reminders[0];
  expect(
    app.execute({
      ...identity(),
      operation: 'mark_read',
      task_id: task.id,
      reminder_id: r.id,
      expected_version: 1,
      read: true,
    }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  app.claimDue('2099-01-02T00:00:00.000Z');
  store.close();
  const reopened = openTaskStore(file, migrations),
    again = createReminderApplication(reopened.reminders);
  expect(again.claimDue('2099-01-02T00:00:00.000Z')).toEqual([]);
  expect(ok(again.execute({ protocol_version: 1, operation: 'list' })).reminders[0]).toMatchObject({
    attempt: 'unknown',
    read_at: null,
  });
  reopened.close();
});
it.each(['reminder_receipts', 'task_activity'])(
  'rolls schedule, version and receipt back when %s fails, then retries original key',
  (table) => {
    const { file, store, app, cmd } = setup(),
      db = openToolchainProbe(file, migrations).sqlite;
    db.exec(
      `CREATE TRIGGER fail_reminder BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic'); END`,
    );
    expect(app.execute(cmd)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
    expect(ok(app.execute({ protocol_version: 1, operation: 'list' })).reminders).toEqual([]);
    expect(
      app.execute({
        protocol_version: 1,
        operation: 'receipt',
        idempotency_key: cmd.idempotency_key,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    db.exec('DROP TRIGGER fail_reminder');
    ok(app.execute(cmd));
    ok(app.execute(cmd));
    expect(db.prepare('SELECT count(*) AS n FROM reminders').get()).toEqual({ n: 1 });
    db.close();
    store.close();
  },
);
it('rolls claim back with event failure so no OS attempt is allowed; serial claimers share dedup', () => {
  const { file, store, app, cmd } = setup();
  ok(app.execute(cmd));
  const db = openToolchainProbe(file, migrations).sqlite;
  db.exec(
    "CREATE TRIGGER fail_attempt BEFORE INSERT ON task_activity BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  expect(() => app.claimDue('2026-01-02T00:00:00.000Z')).toThrow();
  expect(db.prepare('SELECT count(*) AS n FROM reminder_attempts').get()).toEqual({ n: 0 });
  db.exec('DROP TRIGGER fail_attempt');
  const other = openTaskStore(file, migrations);
  expect(app.claimDue('2026-01-02T00:00:00.000Z')).toHaveLength(1);
  expect(other.reminders.claimDue('2026-01-02T00:00:00.000Z')).toEqual([]);
  other.close();
  db.close();
  store.close();
});
it('upgrades an exact eight-migration populated database preserving all existing tables and receipts, and rolls failed DDL back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'caselite-reminder-upgrade-'));
  roots.push(dir);
  const old = join(dir, 'old'),
    bad = join(dir, 'bad');
  for (const [target, count, fail] of [
    [old, 8, false],
    [bad, 9, true],
  ] as const) {
    mkdirSync(join(target, 'meta'), { recursive: true });
    const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.slice(0, count);
    for (const e of journal.entries)
      copyFileSync(join(migrations, e.tag + '.sql'), join(target, e.tag + '.sql'));
    if (fail) {
      const name = join(target, journal.entries.at(-1).tag + '.sql');
      writeFileSync(
        name,
        readFileSync(name, 'utf8') + '\n--> statement-breakpoint\nSELECT * FROM synthetic_missing;',
      );
    }
    writeFileSync(join(target, 'meta/_journal.json'), JSON.stringify(journal));
  }
  const file = join(dir, 'db.sqlite'),
    store = openTaskStore(file, old),
    tasks = createTaskApplication(store);

  const doc = new Y.Doc(),
    paragraph = new Y.XmlElement('paragraph'),
    text = new Y.XmlText();
  text.insert(0, '合成旧库富文本说明与正文，迁移不得覆盖。');
  paragraph.insert(0, [text]);
  doc.getXmlFragment('default').insert(0, [paragraph]);
  const bytes = Array.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  const created = tasks.execute({
    ...identity(),
    operation: 'create',
    title: '合成旧库任务',
    objective: '',
    objective_state: bytes,
  });
  if (!created.ok) throw new Error('Old Task fixture create failed');
  const task = created.tasks[0],
    saved = tasks.execute({
      ...identity(),
      operation: 'save',
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: 0,
      editor_schema: 1,
      state: bytes,
    });
  expect(saved.ok).toBe(true);
  store.close();
  const db = openToolchainProbe(file, old).sqlite,
    tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'__drizzle_migrations' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((r) => r.name);
  expect(db.prepare('SELECT state FROM body_revisions').get()).toEqual({
    state: Buffer.from(bytes),
  });
  expect(db.prepare('SELECT state FROM task_objective_revisions').get()).toEqual({
    state: Buffer.from(bytes),
  });
  const snapshot = JSON.stringify(tables.map((name) => db.prepare(`SELECT * FROM ${name}`).all()));
  db.close();
  expect(() => openTaskStore(file, bad)).toThrow();
  const rollback = openToolchainProbe(file, old).sqlite;
  expect(
    rollback.prepare("SELECT name FROM sqlite_master WHERE name='reminders'").get(),
  ).toBeUndefined();
  expect(
    JSON.stringify(tables.map((name) => rollback.prepare(`SELECT * FROM ${name}`).all())),
  ).toBe(snapshot);
  expect(rollback.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
    n: 8,
  });
  for (const name of ['reminders', 'reminder_attempts', 'reminder_receipts'])
    expect(
      rollback.prepare('SELECT name FROM sqlite_master WHERE name=?').get(name),
    ).toBeUndefined();
  rollback.close();
  const upgraded = openToolchainProbe(file, migrations).sqlite;
  expect(
    JSON.stringify(tables.map((name) => upgraded.prepare(`SELECT * FROM ${name}`).all())),
  ).toBe(snapshot);
  expect(upgraded.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
    n: 9,
  });
  expect(upgraded.pragma('foreign_key_check')).toEqual([]);
  upgraded.close();
});
