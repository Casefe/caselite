import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { CalendarQuery, TaskCalendar } from '../../../preload/caselite-api';

import { localDate } from './calendar-dates';
export { localDate, attentionDate, attentionTime, attentionGroup } from './calendar-dates';

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
