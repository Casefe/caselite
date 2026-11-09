import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTaskApplication, createReminderApplication } from '@caselite/application';
import { emptyTaskCalendar, type TaskCalendar, type TaskResponse } from '@caselite/contracts';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
const key = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
const ok = (r: TaskResponse) => {
  if (!r.ok) throw Error(r.message);
  return r;
};
it('creates a disposable 17-Task native acceptance library with real calendar writes and a future Reminder, without touching any user workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-task-demo-calendar-fixture-')),
    file = join(root, 'caselite.sqlite'),
    migrations = resolve('packages/local-db/migrations'),
    store = openTaskStore(file, migrations),
    app = createTaskApplication(store);
  const now = new Date(),
    date = (delta: number) => {
      const n = new Date(now);
      n.setHours(12, 0, 0, 0);
      n.setDate(n.getDate() + delta);
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    },
    today = date(0),
    zone = 'Asia/Shanghai';
  const samples: Array<{
    code: string;
    title: string;
    due?: string;
    calendar: Partial<TaskCalendar>;
    status?: 'done' | 'canceled';
  }> = [
    {
      code: 'I01',
      title: '与客户核对诉讼方案会议',
      calendar: {
        important: true,
        type_id: 'meeting',
        attention_source: 'custom',
        attention_date: today,
        attention_time: '10:30',
      },
    },
    {
      code: 'I02',
      title: '参加青禾买卖合同案开庭',
      calendar: {
        important: true,
        type_id: 'hearing',
        attention_source: 'schedule',
        schedule: { date: date(1), start: '09:00', end: '11:00', timezone: zone },
      },
    },
    {
      code: 'I03',
      title: '核对并交纳案件受理费',
      due: today,
      calendar: { important: true, type_id: 'payment', attention_source: 'due' },
    },
    {
      code: 'I04',
      title: '向法庭提交补充资料清单',
      due: date(2),
      calendar: { important: true, type_id: 'court-submission', attention_source: 'due' },
    },
    {
      code: 'I05',
      title: '参加证据交换并核对目录',
      calendar: {
        important: true,
        type_id: 'evidence',
        attention_source: 'schedule',
        schedule: { date: date(3), start: '14:00', end: '15:00', timezone: zone },
      },
    },
    {
      code: 'I06',
      title: '核对立案补正通知中的日期',
      calendar: { important: true, type_id: 'filing' },
    },
    {
      code: 'I07',
      title: '参加鉴定材料核对会议',
      calendar: {
        important: true,
        type_id: 'appraisal',
        attention_source: 'schedule',
        schedule: { date: date(5), start: '10:00', end: '11:00', timezone: zone },
      },
    },
    {
      code: 'I08',
      title: '确认上次调解会议的后续安排',
      calendar: {
        important: true,
        type_id: 'negotiation',
        attention_source: 'custom',
        attention_date: date(-1),
        attention_time: '15:00',
      },
    },
    {
      code: 'I09',
      title: '核对上诉材料并确认提交安排',
      due: date(11),
      calendar: { important: true, type_id: 'remedy', attention_source: 'due' },
    },
    {
      code: 'I10',
      title: '核查保全措施与续保材料',
      due: date(22),
      calendar: { important: true, type_id: 'preservation', attention_source: 'due' },
    },
    {
      code: 'I11',
      title: '核对执行申请材料与办理日期',
      due: `${now.getFullYear() + 1}-03-15`,
      calendar: { important: true, type_id: 'execution', attention_source: 'due' },
    },
    {
      code: 'I12',
      title: '核查通知与材料中的期间起算信息',
      calendar: { important: true, type_id: 'period-check' },
    },
    {
      code: 'I13',
      title: '已完成的缴费凭证核对',
      due: today,
      status: 'done',
      calendar: { important: true, type_id: 'payment', attention_source: 'due' },
    },
    {
      code: 'I14',
      title: '已取消的庭前沟通会议',
      status: 'canceled',
      calendar: {
        important: true,
        type_id: 'meeting',
        attention_source: 'schedule',
        schedule: { date: date(1), start: '16:00', end: '16:30', timezone: zone },
      },
    },
    {
      code: 'S01',
      title: '核对设备采购合同修订稿',
      calendar: {
        schedule: { date: today, start: '09:00', end: '10:00', timezone: zone },
        planned_date: today,
      },
    },
    { code: 'S02', title: '确认补充材料目录', due: today, calendar: {} },
    { code: 'S03', title: '整理本周法律研究笔记', calendar: {} },
  ];
  try {
    const rows = samples.map((sample) => {
      let t = ok(
        app.execute({
          ...key(),
          operation: 'create',
          title: `【合成 ${sample.code}】${sample.title}`,
          objective: '合成验收材料；日期为人工录入，不构成法律期间计算。',
          priority: sample.code === 'S01' ? 1 : 3,
          due_date: sample.due ?? null,
        }),
      ).tasks[0];
      const calendar = { ...emptyTaskCalendar, ...sample.calendar };
      if (JSON.stringify(calendar) !== JSON.stringify(emptyTaskCalendar))
        t = ok(
          app.execute({
            ...key(),
            operation: 'update_calendar',
            task_id: t.id,
            expected_version: t.version,
            calendar,
          }),
        ).tasks[0];
      if (sample.status)
        t = ok(
          app.execute({
            ...key(),
            operation: 'change_status',
            task_id: t.id,
            expected_version: t.version,
            status: sample.status,
          }),
        ).tasks[0];
      return { code: sample.code, task: t };
    });
    const q = {
      date: today,
      from: today,
      to: today,
      home: false,
      include_closed: false,
      include_overdue: false,
      offset: 0,
    };
    expect(
      ok(
        app.execute({
          protocol_version: 1,
          operation: 'calendar_query',
          query: { ...q, view: 'important' },
        }),
      ).page?.total,
    ).toBe(12);
    expect(
      ok(
        app.execute({
          protocol_version: 1,
          operation: 'calendar_query',
          query: { ...q, view: 'counts' },
        }),
      ).calendar_counts,
    ).toEqual([{ date: today, count: 4 }]);
    expect(
      ok(
        app.execute({
          protocol_version: 1,
          operation: 'calendar_query',
          query: { ...q, view: 'timed' },
        }),
      )
        .tasks.map((t) => t.id)
        .sort(),
    ).toEqual(
      rows
        .filter((r) => ['I01', 'S01'].includes(r.code))
        .map((r) => r.task.id)
        .sort(),
    );
    const reminders = createReminderApplication(store.reminders),
      future = `${now.getFullYear() + 5}-11-10`;
    const resolved = reminders.execute({
      protocol_version: 1,
      operation: 'resolve',
      date: future,
      time: '09:00',
      timezone: zone,
    });
    if (!resolved.ok) throw Error(resolved.message);
    expect(
      reminders.execute({
        ...key(),
        operation: 'schedule',
        reminder_id: randomUUID(),
        task_id: rows.find((r) => r.code === 'S01')!.task.id,
        expected_version: 0,
        date: future,
        time: '09:00',
        timezone: zone,
        instant: resolved.choices[0],
        confirmed: true,
      }).ok,
    ).toBe(true);
    const output = process.env.CASELITE_CALENDAR_FIXTURE_DIR;
    if (output) {
      const target = resolve(output);
      if (existsSync(target)) throw Error('Acceptance fixture output must be a new directory');
      mkdirSync(join(target, 'userData'), { recursive: true });
      const db = openToolchainProbe(file, migrations).sqlite;
      try {
        await db.backup(join(target, 'userData/caselite.sqlite'));
      } finally {
        db.close();
      }
      writeFileSync(
        join(target, 'fixture.json'),
        JSON.stringify(
          {
            synthetic: true,
            today,
            tasks: rows,
            important: 12,
            taskCount: 17,
            todayCount: 4,
            timed: ['I01', 'S01'],
            dateOnlyNotTimed: ['I03', 'S02'],
            providerCalls: 0,
            credentials: 'none',
            futureReminder: future,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
