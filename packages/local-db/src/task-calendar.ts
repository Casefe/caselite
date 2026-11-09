import type Database from 'better-sqlite3';
import {
  calendarTypeSchema,
  defaultCalendarTypes,
  taskCalendarSchema,
  type CalendarType,
  type Task,
  type TaskCalendar,
  type CalendarQuery,
  type TaskResponse,
} from '@caselite/contracts';

export const calendarColumns =
  ',t.planned_date,t.schedule_date,t.schedule_start,t.schedule_end,t.schedule_timezone,t.is_important,t.important_type_id,t.attention_source,t.attention_date,t.attention_time';
export type CalendarRow = {
  planned_date: string | null;
  schedule_date: string | null;
  schedule_start: string | null;
  schedule_end: string | null;
  schedule_timezone: string | null;
  is_important: number;
  important_type_id: string | null;
  attention_source: TaskCalendar['attention_source'];
  attention_date: string | null;
  attention_time: string | null;
  attention_timezone?: string | null;
};
export function decodeCalendar(row: CalendarRow): TaskCalendar {
  return taskCalendarSchema.parse({
    planned_date: row.planned_date,
    schedule: row.schedule_date
      ? {
          date: row.schedule_date,
          start: row.schedule_start,
          end: row.schedule_end,
          timezone: row.schedule_timezone,
        }
      : null,
    important: !!row.is_important,
    type_id: row.important_type_id,
    attention_source: row.attention_source,
    attention_date: row.attention_date,
    attention_time: row.attention_time,
    ...(row.attention_timezone ? { attention_timezone: row.attention_timezone } : {}),
  });
}
export function calendarValues(v: TaskCalendar) {
  return [
    v.planned_date,
    v.schedule?.date ?? null,
    v.schedule?.start ?? null,
    v.schedule?.end ?? null,
    v.schedule?.timezone ?? null,
    +v.important,
    v.type_id,
    v.attention_source,
    v.attention_date,
    v.attention_time,
  ];
}
export function calendarTypes(db: Database.Database, workspace: string): CalendarType[] {
  const rows = db
    .prepare(
      'SELECT id,name,enabled,show_home,version FROM calendar_types WHERE workspace_id=? ORDER BY id',
    )
    .all(workspace) as Array<{
    id: string;
    name: string;
    enabled: number;
    show_home: number;
    version: number;
  }>;
  const configured = rows.map((v) =>
    calendarTypeSchema.parse({ ...v, enabled: !!v.enabled, show_home: !!v.show_home }),
  );
  return [
    ...defaultCalendarTypes.map((v) => configured.find((t) => t.id === v.id) ?? v),
    ...configured.filter((v) => !defaultCalendarTypes.some((t) => t.id === v.id)),
  ];
}
// 可空时段须先折为false；否则SQL NOT(NULL)会把普通date-only任务错误排除。
const timedForDate =
  "(COALESCE(t.schedule_date=?,0) OR (t.is_important=1 AND t.attention_source='custom' AND t.attention_date=? AND t.attention_time IS NOT NULL))";
const attention = `CASE t.attention_source WHEN 'schedule' THEN t.schedule_date WHEN 'planned' THEN t.planned_date WHEN 'due' THEN t.due_date WHEN 'custom' THEN t.attention_date ELSE NULL END`;
export function queryCalendar<Row>(
  db: Database.Database,
  workspace: string,
  select: string,
  decode: (row: Row) => Task,
  q: CalendarQuery,
): TaskResponse {
  const types = calendarTypes(db, workspace);
  const clauses = ['t.workspace_id=?'];
  const params: (string | number)[] = [workspace];
  if (!q.include_closed) clauses.push("t.status NOT IN ('done','canceled')");
  let order = 't.id';
  const orderParams: string[] = [];
  if (q.view === 'important') {
    clauses.push('t.is_important=1');
    if (q.home) {
      clauses.push(
        'NOT EXISTS (SELECT 1 FROM calendar_types ct WHERE ct.workspace_id=t.workspace_id AND ct.id=t.important_type_id AND ct.show_home=0)',
      );
    }
    order = `(${attention} IS NULL),${attention},COALESCE(CASE t.attention_source WHEN 'schedule' THEN t.schedule_start WHEN 'custom' THEN t.attention_time END,'99:99'),t.id`;
  } else if (q.view === 'day' || q.view === 'untimed') {
    clauses.push(
      `(t.due_date=? OR t.planned_date=? OR t.schedule_date=? OR (t.is_important=1 AND t.attention_source='custom' AND t.attention_date=?) ${q.include_overdue ? 'OR (t.due_date<?)' : ''})`,
    );
    params.push(q.date, q.date, q.date, q.date, ...(q.include_overdue ? [q.date] : []));
    if (q.view === 'untimed') {
      clauses.push(`NOT ${timedForDate}`);
      params.push(q.date, q.date);
    }
    order = `${q.include_overdue ? '(t.due_date IS NULL OR t.due_date>=?),' : ''}(t.priority=0),t.priority,t.id`;
    if (q.include_overdue) orderParams.push(q.date);
  } else if (q.view === 'timed') {
    clauses.push(timedForDate);
    params.push(q.date, q.date);
    order = 'CASE WHEN t.schedule_date=? THEN t.schedule_start ELSE t.attention_time END,t.id';
    orderParams.push(q.date);
  } else if (q.view === 'undated') {
    order = '(t.priority=0),t.priority,t.id';
    clauses.push(
      "t.due_date IS NULL AND t.planned_date IS NULL AND t.schedule_date IS NULL AND (t.is_important=0 OR t.attention_source<>'custom' OR t.attention_date IS NULL)",
    );
  }
  if (q.view === 'types')
    return { ok: true, tasks: [], state: null, receipt: null, calendar_types: types };
  const filtered = `${select} WHERE ${clauses.join(' AND ')}`;
  if (q.view === 'counts') {
    const rows = db
      .prepare(
        `WITH allowed AS (${filtered}) SELECT date,count(DISTINCT id) AS count FROM (SELECT id,due_date AS date FROM allowed UNION SELECT id,planned_date FROM allowed UNION SELECT id,schedule_date FROM allowed UNION SELECT id,CASE WHEN is_important=1 AND attention_source='custom' THEN attention_date END FROM allowed) WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date`,
      )
      .all(...params, q.from, q.to) as Array<{ date: string; count: number }>;
    return {
      ok: true,
      tasks: [],
      state: null,
      receipt: null,
      calendar_types: types,
      calendar_counts: rows,
    };
  }
  const total = (
    db.prepare(`SELECT count(*) AS n FROM (${filtered})`).get(...params) as { n: number }
  ).n;
  const pending =
    q.view === 'important'
      ? (
          db
            .prepare(`SELECT count(*) AS n FROM (${filtered} AND ${attention} IS NULL)`)
            .get(...params) as { n: number }
        ).n
      : 0;
  const rows = db
    .prepare(`${filtered} ORDER BY ${order} LIMIT 50 OFFSET ?`)
    .all(...params, ...orderParams, q.offset) as Row[];
  return {
    ok: true,
    tasks: rows.map(decode),
    state: null,
    receipt: null,
    calendar_types: types,
    calendar_pending_count: pending,
    page: { offset: q.offset, total, has_more: q.offset + rows.length < total },
  };
}
