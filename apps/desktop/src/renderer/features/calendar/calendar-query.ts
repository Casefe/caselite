import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { CalendarQuery, Task, TaskCalendar } from '../../../preload/caselite-api';

export function localDate(value = new Date()) {
  return `${value.getFullYear().toString().padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
export function shiftDate(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number);
  const value = new Date(0);
  value.setFullYear(y, m - 1, d + days);
  value.setHours(12, 0, 0, 0);
  return localDate(value);
}
export const calendarQuery = (
  view: CalendarQuery['view'],
  extra: Partial<CalendarQuery> = {},
): CalendarQuery => ({
  view,
  date: localDate(),
  from: localDate(),
  to: localDate(),
  home: false,
  include_closed: false,
  include_overdue: false,
  offset: 0,
  ...extra,
});
export function invalidateCalendar(client: QueryClient) {
  void client.cancelQueries({ queryKey: ['calendar'] });
  void client.invalidateQueries({ queryKey: ['calendar'] });
}
export function useCalendar(query: CalendarQuery, enabled = true) {
  return useQuery({
    queryKey: ['calendar', query],
    enabled,
    queryFn: async () => {
      const r = await window.caselite.task({
        protocol_version: 1,
        operation: 'calendar_query',
        query,
      });
      if (!r.ok) throw Error(r.message);
      return r;
    },
  });
}
export function attentionDate(t: Task) {
  const c = t.calendar;
  return c?.attention_source === 'schedule'
    ? (c.schedule?.date ?? null)
    : c?.attention_source === 'planned'
      ? c.planned_date
      : c?.attention_source === 'due'
        ? t.due_date
        : c?.attention_source === 'custom'
          ? c.attention_date
          : null;
}
export function attentionTime(t: Task) {
  return t.calendar?.attention_source === 'schedule'
    ? t.calendar.schedule?.start
    : t.calendar?.attention_source === 'custom'
      ? t.calendar.attention_time
      : null;
}

export function attentionGroup(task: Task, now = new Date()) {
  const date = attentionDate(task),
    time = attentionTime(task),
    today = localDate(now),
    clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return !date
    ? '日期待确认'
    : date < today ||
        (date === today &&
          !!time &&
          task.calendar?.attention_source === 'schedule' &&
          task.calendar.schedule?.timezone === Intl.DateTimeFormat().resolvedOptions().timeZone &&
          time < clock)
      ? '已过时点待核对'
      : date === today
        ? '今日'
        : '未来';
}

// 仅为表单空值；持久化字段和权威校验仍由受控宿主负责。
export const emptyCalendar: TaskCalendar = {
  planned_date: null,
  schedule: null,
  important: false,
  type_id: null,
  attention_source: 'unknown',
  attention_date: null,
  attention_time: null,
};
