import type { ReminderRequest, ReminderResponse } from '../../preload/caselite-api';
export type ReminderCommand = Extract<
  ReminderRequest,
  { operation: 'schedule' | 'cancel' | 'mark_read' }
>;
export function confirmsReminder(result: ReminderResponse, command: ReminderCommand) {
  if (!result.ok || result.receipt !== command.idempotency_key) return false;
  return result.reminders.some(
    (r) =>
      r.id === command.reminder_id &&
      r.task_id === command.task_id &&
      r.version === command.expected_version + 1 &&
      (command.operation === 'schedule'
        ? r.status === 'scheduled' &&
          r.date === command.date &&
          r.time === command.time &&
          r.timezone === command.timezone &&
          r.instant === command.instant
        : command.operation === 'cancel'
          ? r.status === 'canceled'
          : !!r.read_at === command.read),
  );
}
