import { integrationMigrations } from '../../packages/local-db/src/migration-manifest';
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTaskApplication } from '@caselite/application';
import {
  emptyTaskCalendar,
  type Task,
  type TaskCalendar,
  type TaskResponse,
  type CalendarQuery,
} from '@caselite/contracts';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
const migrations = resolve('packages/local-db/migrations');
const roots: string[] = [],
  closes: Array<() => void> = [];
afterEach(() => {
  closes.splice(0).forEach((f) => f());
  roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
const good = (r: TaskResponse) => {
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(r.message);
  return r;
};
function setup(folder = migrations) {
  const dir = mkdtempSync(join(tmpdir(), 'caselite-calendar-'));
  roots.push(dir);
  const file = join(dir, 'local.sqlite'),
    store = openTaskStore(file, folder);
  closes.push(store.close);
  return { dir, file, store, app: createTaskApplication(store) };
}
const query = (view: CalendarQuery['view'], extra: Partial<CalendarQuery> = {}) => ({
  protocol_version: 1 as const,
  operation: 'calendar_query' as const,
  query: {
    view,
    date: '2026-11-09',
    from: '2026-11-01',
    to: '2026-11-30',
    home: false,
    include_closed: false,
    include_overdue: false,
    offset: 0,
    ...extra,
  },
});
function create(app: ReturnType<typeof createTaskApplication>, name = '合成任务') {
  return good(
    app.execute({ ...identity(), operation: 'create', title: name, objective: '合成说明' }),
  ).tasks[0];
}
function command(t: Task, value: Partial<TaskCalendar> = {}) {
  return {
    ...identity(),
    operation: 'update_calendar' as const,
    task_id: t.id,
    expected_version: t.version,
    calendar: { ...emptyTaskCalendar, ...t.calendar, ...value },
  };
}
const timed = { date: '2026-11-09', start: '09:00', end: '10:00', timezone: 'Asia/Shanghai' };
it('queries full accessible ranges beyond 20 and 50 rows, deduplicates date counts, and keeps timed tasks separate from date-only importance', () => {
  const { app, file } = setup();
  const tasks: Task[] = [];
  for (let i = 0; i < 61; i++) {
    let t = create(app, `合成跨页 ${i}`);
    t = good(
      app.execute(
        command(t, {
          important: true,
          type_id: 'hearing',
          attention_source: i === 60 ? 'unknown' : 'schedule',
          planned_date: '2026-11-09',
          schedule: i === 60 ? null : timed,
        }),
      ),
    ).tasks[0];
    tasks.push(t);
  }
  let dateOnly = create(app, '合成仅关注日期');
  dateOnly = good(
    app.execute(
      command(dateOnly, {
        important: true,
        type_id: 'payment',
        attention_source: 'custom',
        attention_date: '2026-11-09',
      }),
    ),
  ).tasks[0];
  expect(good(app.execute(query('important'))).page).toEqual({
    offset: 0,
    total: 62,
    has_more: true,
  });
  const second = good(app.execute(query('important', { offset: 50 })));
  expect(second.tasks).toHaveLength(12);
  expect(
    new Set([...good(app.execute(query('important'))).tasks, ...second.tasks].map((t) => t.id))
      .size,
  ).toBe(62);
  expect(good(app.execute(query('timed'))).page?.total).toBe(60);
  expect(
    good(app.execute(query('timed'))).tasks.every(
      (t) => t.calendar?.schedule?.date === '2026-11-09',
    ),
  ).toBe(true);
  expect(good(app.execute(query('counts'))).calendar_counts).toEqual([
    { date: '2026-11-09', count: 62 },
  ]);
  expect(good(app.execute(query('undated'))).tasks.map((t) => t.id)).not.toContain(dateOnly.id);
  expect(good(app.execute(query('day'))).page?.total).toBe(62);
  const untimed = good(app.execute(query('untimed')));
  expect(untimed.page).toEqual({ offset: 0, total: 2, has_more: false });
  expect(untimed.tasks.map((t) => t.id).sort()).toEqual([tasks[60].id, dateOnly.id].sort());
  expect(good(app.execute(query('important'))).calendar_pending_count).toBe(1);
  const other = openTaskStore(file, migrations, 'other');
  closes.push(other.close);
  expect(good(createTaskApplication(other).execute(query('important'))).page?.total).toBe(0);
  const done = good(
    app.execute({
      ...identity(),
      operation: 'change_status',
      task_id: tasks[0].id,
      expected_version: tasks[0].version,
      status: 'done',
    }),
  ).tasks[0];
  expect(good(app.execute(query('important'))).page?.total).toBe(61);
  expect(good(app.execute(query('important', { include_closed: true }))).page?.total).toBe(62);
  expect(good(app.execute(query('timed'))).page?.total).toBe(59);
  expect(good(app.execute(query('counts', { include_closed: true }))).calendar_counts).toEqual([
    { date: '2026-11-09', count: 62 },
  ]);
  expect(good(app.execute(query('timed', { include_closed: true }))).page?.total).toBe(60);
  good(
    app.execute({
      ...identity(),
      operation: 'change_status',
      task_id: done.id,
      expected_version: done.version,
      status: 'canceled',
    }),
  );
  expect(good(app.execute(query('counts'))).calendar_counts?.[0].count).toBe(61);
});
it('persists calendar on the original Task, preserving due/priority/body/Reminder and old request replay across restart', () => {
  const s = setup();
  const createRequest = {
    ...identity(),
    operation: 'create' as const,
    title: '合成原Task',
    objective: '保留正文',
    priority: 1,
    due_date: '2026-11-11',
  };
  let t = good(s.app.execute(createRequest)).tasks[0];
  const initial = t;
  const save = command(t, {
    planned_date: '2026-11-10',
    schedule: timed,
    important: true,
    type_id: 'hearing',
    attention_source: 'schedule',
  });
  const receipt = good(s.app.execute(save));
  t = receipt.tasks[0];
  expect(t).toMatchObject({
    id: initial.id,
    document_id: initial.document_id,
    body_id: initial.body_id,
    body_revision: 0,
    due_date: '2026-11-11',
    priority: 1,
    version: 2,
  });
  expect(s.app.execute({ ...save, request_id: randomUUID() })).toEqual(receipt);
  expect(
    s.app.execute({ ...save, calendar: { ...save.calendar, important: false } }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(s.app.execute({ ...command(initial), calendar: save.calendar })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  expect(good(s.app.execute(createRequest)).tasks[0]).toEqual(initial);
  expect(
    good(
      s.app.execute({
        protocol_version: 1,
        operation: 'status',
        idempotency_key: save.idempotency_key,
      }),
    ),
  ).toEqual(receipt);
  const db = openToolchainProbe(s.file, migrations).sqlite;
  expect(db.prepare('SELECT count(*) AS n FROM reminders').get()).toEqual({ n: 0 });
  db.close();
  const again = openTaskStore(s.file, migrations);
  closes.push(again.close);
  expect(
    good(
      createTaskApplication(again).execute({
        protocol_version: 1,
        operation: 'read',
        task_id: t.id,
      }),
    ).tasks[0],
  ).toEqual(t);
});
it('keeps disabled type references, independent home visibility, stable rename and versioned custom types', () => {
  const { app } = setup();
  let t = create(app);
  t = good(
    app.execute(command(t, { important: true, type_id: 'hearing', attention_source: 'unknown' })),
  ).tasks[0];
  let type = good(app.execute(query('types'))).calendar_types!.find((t) => t.id === 'hearing')!;
  const set = {
    ...identity(),
    operation: 'set_calendar_type' as const,
    type: { ...type, enabled: false },
  };
  const saved = good(app.execute(set));
  expect(app.execute({ ...set, request_id: randomUUID() })).toEqual(saved);
  type = saved.calendar_types!.find((t) => t.id === 'hearing')!;
  expect(type.version).toBe(1);
  expect(good(app.execute(query('important', { home: true }))).tasks.map((t) => t.id)).toContain(
    t.id,
  );
  const newTask = create(app);
  expect(app.execute(command(newTask, { important: true, type_id: 'hearing' }))).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  t = good(app.execute(command(t, { attention_source: 'custom', attention_date: '2027-03-15' })))
    .tasks[0];
  good(
    app.execute({
      ...identity(),
      operation: 'set_calendar_type',
      type: { ...type, name: '庭审安排', show_home: false },
    }),
  );
  expect(good(app.execute(query('important'))).page?.total).toBe(1);
  expect(good(app.execute(query('important', { home: true }))).page?.total).toBe(0);
  expect(app.execute({ ...identity(), operation: 'set_calendar_type', type })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  const custom = {
    id: 'custom-' + randomUUID(),
    name: '法律研究复核',
    enabled: true,
    show_home: true,
    version: 0,
  };
  good(app.execute({ ...identity(), operation: 'set_calendar_type', type: custom }));
  t = good(app.execute(command(t, { type_id: custom.id }))).tasks[0];
  expect(t.calendar?.type_id).toBe(custom.id);
  expect(good(app.execute(query('important', { home: true }))).page?.total).toBe(1);
});
it.each(['task_activity', 'task_receipts'])(
  'rolls calendar/version back on %s failure and recovers the original key exactly once',
  (table) => {
    const s = setup();
    const t = create(s.app),
      c = command(t, { schedule: timed });
    const db = openToolchainProbe(s.file, migrations).sqlite;
    try {
      db.exec(
        `CREATE TRIGGER calendar_fault BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic calendar failure'); END`,
      );
      expect(s.app.execute(c)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
      expect(
        good(s.app.execute({ protocol_version: 1, operation: 'read', task_id: t.id })).tasks[0],
      ).toEqual(t);
      expect(
        s.app.execute({
          protocol_version: 1,
          operation: 'status',
          idempotency_key: c.idempotency_key,
        }),
      ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      db.exec('DROP TRIGGER calendar_fault');
      good(s.app.execute(c));
      good(s.app.execute(c));
      expect(
        db
          .prepare("SELECT count(*) AS n FROM task_activity WHERE operation='update_calendar'")
          .get(),
      ).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  },
);
it('rejects invalid dates/times/zones, reversed ranges, forged fields and cross-workspace writes', () => {
  const s = setup();
  const t = create(s.app);
  for (const change of [
    { planned_date: '2026-02-30' },
    { schedule: { ...timed, end: '08:59' } },
    { schedule: { ...timed, start: '24:00' } },
    { schedule: { ...timed, timezone: 'Invalid/Zone' } },
    { attention_source: 'due', attention_date: '2026-11-09' },
    { important: true, type_id: null },
  ])
    expect(s.app.execute(command(t, change as Partial<TaskCalendar>))).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  expect(
    s.app.execute({ ...query('counts'), query: { ...query('counts').query, to: '2027-11-30' } }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  expect(
    s.app.execute({ ...command(t, { schedule: timed }), workspace_id: 'other' }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  const other = openTaskStore(s.file, migrations, 'other');
  closes.push(other.close);
  expect(createTaskApplication(other).execute(command(t, { schedule: timed }))).toMatchObject({
    ok: false,
    code: 'NOT_FOUND',
  });
});
it('upgrades a populated 20-migration library and backup; failed 21st DDL rolls back without touching old rows or receipts', async () => {
  const r = mkdtempSync(join(tmpdir(), 'caselite-calendar-upgrade-'));
  roots.push(r);
  const old = join(r, 'old'),
    bad = join(r, 'bad');
  cpSync(migrations, old, { recursive: true });
  rmSync(join(old, 'meta/dual-history-1826.json'));
  const path = join(old, 'meta/_journal.json');
  const journal = JSON.parse(
    readFileSync(resolve('tests/fixtures/migration-histories/A.json'), 'utf8'),
  );
  writeFileSync(path, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 20) }));
  const file = join(r, 'old.sqlite'),
    store = openTaskStore(file, old),
    app = createTaskApplication(store);
  const t = create(app, '旧任务保全');
  const db = openToolchainProbe(file, old).sqlite;
  const tables = ['task_items', 'documents', 'body_revisions', 'task_receipts', 'task_activity'];
  const snapshot = (db: ReturnType<typeof openToolchainProbe>['sqlite']) =>
    tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
  const before = snapshot(db);
  await db.backup(join(r, 'backup.sqlite'));
  db.close();
  store.close();
  cpSync(migrations, bad, { recursive: true });
  rmSync(join(bad, 'meta/dual-history-1826.json'));
  writeFileSync(join(bad, 'meta/_journal.json'), JSON.stringify(journal));
  const ddl = join(bad, '0020_task_calendar.sql');
  writeFileSync(
    ddl,
    readFileSync(ddl, 'utf8') +
      '\n--> statement-breakpoint\nSELECT * FROM synthetic_missing_calendar;',
  );
  expect(() => openTaskStore(file, bad)).toThrow();
  const failed = openToolchainProbe(file, old).sqlite;
  expect(snapshot(failed)).toEqual(before);
  expect(failed.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 20 });
  failed.close();
  for (const fileName of [file, join(r, 'backup.sqlite')]) {
    const upgraded = openTaskStore(fileName, migrations);
    expect(
      good(
        createTaskApplication(upgraded).execute({
          protocol_version: 1,
          operation: 'read',
          task_id: t.id,
        }),
      ).tasks[0],
    ).toMatchObject({ ...t, calendar: emptyTaskCalendar });
    upgraded.close();
    const check = openToolchainProbe(fileName, migrations).sqlite;
    expect(snapshot(check).slice(1)).toEqual(before.slice(1));
    expect(check.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(check.pragma('foreign_key_check')).toEqual([]);
    expect(check.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
      n: integrationMigrations.length,
    });
    check.close();
  }
});

it('includes explicitly timed important attention points without schedule and deduplicates same-day multi-source Tasks', () => {
  const { app } = setup();
  let t = create(app, '合成重要时点');
  t = good(
    app.execute(
      command(t, {
        important: true,
        type_id: 'meeting',
        attention_source: 'custom',
        attention_date: '2026-11-09',
        attention_time: '11:00',
      }),
    ),
  ).tasks[0];
  expect(good(app.execute(query('timed'))).tasks.map((t) => t.id)).toEqual([t.id]);
  expect(good(app.execute(query('day'))).tasks.map((t) => t.id)).toEqual([t.id]);
  expect(good(app.execute(query('counts'))).calendar_counts).toEqual([
    { date: '2026-11-09', count: 1 },
  ]);
  t = good(app.execute(command(t, { schedule: timed, planned_date: '2026-11-09' }))).tasks[0];
  expect(good(app.execute(query('timed'))).tasks.map((t) => t.id)).toEqual([t.id]);
  expect(good(app.execute(query('counts'))).calendar_counts).toEqual([
    { date: '2026-11-09', count: 1 },
  ]);
  t = good(app.execute(command(t, { schedule: { ...timed, date: '2026-11-10' } }))).tasks[0];
  expect(good(app.execute(query('timed'))).tasks.map((t) => t.id)).toEqual([t.id]);
  expect(good(app.execute(query('timed', { date: '2026-11-10' }))).tasks.map((t) => t.id)).toEqual([
    t.id,
  ]);
  good(app.execute(command(t, { schedule: null, planned_date: null, attention_time: null })));
  expect(good(app.execute(query('timed'))).tasks).toEqual([]);
  expect(good(app.execute(query('day'))).page?.total).toBe(1);
});

it('matches the generated Drizzle snapshot while applying additive DDL without rebuilding old Task tables', () => {
  const s = setup(),
    db = openToolchainProbe(s.file, migrations).sqlite;
  try {
    const snapshot = JSON.parse(readFileSync(join(migrations, 'meta/0028_snapshot.json'), 'utf8'));
    const t = create(s.app);
    for (const name of ['task_items', 'calendar_types']) {
      const columns = (db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>)
        .map((v) => v.name)
        .sort();
      expect(columns).toEqual(Object.keys(snapshot.tables[name].columns).sort());
      const sql = (
        db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name) as {
          sql: string;
        }
      ).sql;
      for (const check of Object.keys(snapshot.tables[name].checkConstraints)) {
        // B 原 SQL 的订阅 CHECK 没有显式名称；保留原字节并验证等价约束及非法值拒绝。
        if (check === 'task_subscribed_valid')
          expect(sql).toMatch(/CHECK\s*\(\s*`subscribed` IN \(0, 1\)\)/);
        else expect(sql).toContain(check);
      }
      if (name === 'task_items')
        expect(() => db.prepare('UPDATE task_items SET subscribed=2').run()).toThrow();
    }
    for (const value of ['2026-02-30', '0000-01-01', '2026-11-09T00:00:00Z'])
      expect(() =>
        db.prepare('UPDATE task_items SET planned_date=? WHERE id=?').run(value, t.id),
      ).toThrow();
    expect(() =>
      db.prepare("UPDATE task_items SET schedule_date='2026-11-09' WHERE id=?").run(t.id),
    ).toThrow();
  } finally {
    db.close();
  }
});
it('atomically rolls type configuration back on receipt failure and retains scope, key and version on retry', () => {
  const s = setup(),
    db = openToolchainProbe(s.file, migrations).sqlite;
  const type = good(s.app.execute(query('types'))).calendar_types![0];
  const request = {
    ...identity(),
    operation: 'set_calendar_type',
    type: { ...type, name: '合成重要会议' },
  };
  try {
    db.exec(
      "CREATE TRIGGER type_fault BEFORE INSERT ON task_receipts BEGIN SELECT RAISE(ABORT,'synthetic type failure'); END",
    );
    expect(s.app.execute(request)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
    expect(good(s.app.execute(query('types'))).calendar_types![0]).toEqual(type);
    expect(db.prepare('SELECT count(*) AS n FROM calendar_types').get()).toEqual({ n: 0 });
    db.exec('DROP TRIGGER type_fault');
    const ack = good(s.app.execute(request));
    expect(s.app.execute({ ...request, request_id: randomUUID() })).toEqual(ack);
    expect(s.app.execute({ ...request, type: { ...request.type, name: '异内容' } })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
  } finally {
    db.close();
  }
});

it('reads complete forecast past/future pages without changing task identity, dates or activity, including workspace isolation and closed items', () => {
  const { app, file } = setup();
  const past = good(
    app.execute({
      ...identity(),
      operation: 'create',
      title: '合成日期已过任务',
      objective: '保留说明',
      due_date: '2026-11-08',
    }),
  ).tasks[0];
  good(
    app.execute({
      ...identity(),
      operation: 'create',
      title: '合成边界日任务',
      objective: '',
      due_date: '2026-11-09',
    }),
  );
  const futureTasks = Array.from({ length: 61 }, (_, i) => {
    const task = create(app, `合成预测远期 ${i}`);
    return good(
      app.execute(
        command(task, {
          planned_date: '2026-11-18',
          schedule: { ...timed, date: '2026-11-19' },
          important: true,
          type_id: 'hearing',
          attention_source: 'custom',
          attention_date: '2026-11-20',
        }),
      ),
    ).tasks[0];
  });
  const probe = openToolchainProbe(file, migrations);
  closes.push(() => probe.sqlite.close());
  const activity = () => probe.sqlite.prepare('SELECT count(*) AS n FROM task_activity').get();
  const before = activity();
  expect(good(app.execute(query('past'))).tasks.map((t) => t.id)).toEqual([past.id]);
  const first = good(app.execute(query('future', { date: '2026-11-17' })));
  const second = good(app.execute(query('future', { date: '2026-11-17', offset: 50 })));
  expect(first.page).toEqual({ offset: 0, total: 61, has_more: true });
  expect(second.tasks).toHaveLength(11);
  expect(new Set([...first.tasks, ...second.tasks].map((t) => t.id)).size).toBe(61);
  expect(
    first.tasks.find((t) => t.id === futureTasks[0].id) ??
      second.tasks.find((t) => t.id === futureTasks[0].id),
  ).toEqual(futureTasks[0]);
  expect(good(app.execute(query('future', { date: '2026-11-20' }))).page?.total).toBe(0);
  expect(activity()).toEqual(before);
  const isolated = openTaskStore(file, migrations, 'forecast-other');
  closes.push(isolated.close);
  expect(
    good(createTaskApplication(isolated).execute(query('future', { date: '2026-11-17' }))).page
      ?.total,
  ).toBe(0);
  good(
    app.execute({
      ...identity(),
      operation: 'change_status',
      task_id: futureTasks[0].id,
      expected_version: futureTasks[0].version,
      status: 'done',
    }),
  );
  expect(good(app.execute(query('future', { date: '2026-11-17' }))).page?.total).toBe(60);
  expect(
    good(app.execute(query('future', { date: '2026-11-17', include_closed: true }))).page?.total,
  ).toBe(61);
});
