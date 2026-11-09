import type { Task } from '../../../preload/caselite-api';

export function localDate(value = new Date()) {
  return `${value.getFullYear().toString().padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
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
          (task.calendar?.attention_source === 'schedule'
            ? task.calendar.schedule?.timezone
            : task.calendar?.attention_timezone) ===
            Intl.DateTimeFormat().resolvedOptions().timeZone &&
          time < clock)
      ? '已过时点待核对'
      : date === today
        ? '今日'
        : '未来';
}
