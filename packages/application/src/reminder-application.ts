import {
  reminderRequestSchema,
  type Reminder,
  type ReminderRequest,
  type ReminderResponse,
} from '@caselite/contracts';

export interface ReminderPort {
  execute(request: Exclude<ReminderRequest, { operation: 'resolve' }>): ReminderResponse;
  claimDue(now: string): Reminder[];
  recordAttempt(id: string, revision: number, status: 'shown' | 'failed' | 'unsupported'): void;
}
// 时区只用于用户明确选择的日历时刻；保存固定时间点，系统时区变化不能重新解释它。
export function resolveReminderTime(date: string, time: string, timezone: string): string[] {
  if (!/^20\d\d-/.test(date)) return [];
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const fields = (value: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(value).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const wall = `${date}T${time}:00`,
    base = Date.parse(wall + 'Z'),
    offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = base + hours * 3600000;
    offsets.add(Date.parse(fields(sample) + 'Z') - sample);
  }
  return [...offsets]
    .map((offset) => base - offset)
    .filter((value) => fields(value) === wall)
    .sort((a, b) => a - b)
    .map((value) => new Date(value).toISOString());
}
export function createReminderApplication(port: ReminderPort) {
  return {
    execute(input: unknown): ReminderResponse {
      const parsed = reminderRequestSchema.safeParse(input);
      if (!parsed.success)
        return {
          ok: false,
          code: 'INVALID_REQUEST',
          message: '提醒字段或版本无效，请核对日期、时刻和时区。',
        };
      const request = parsed.data;
      try {
        if ('idempotency_key' in request && request.operation !== 'receipt') {
          const known = port.execute({
            protocol_version: 1,
            operation: 'receipt',
            idempotency_key: request.idempotency_key,
          });
          // 已提交请求以原回执为准；tzdb更新不能使未知回执恢复被新规则拒绝。
          if (known.ok) return port.execute(request);
          if (known.code !== 'NOT_FOUND') return known;
        }
        if (request.operation === 'resolve' || request.operation === 'schedule') {
          let choices: string[];
          try {
            choices = resolveReminderTime(request.date, request.time, request.timezone);
          } catch {
            choices = [];
          }
          if (!choices.length)
            return {
              ok: false,
              code: 'INVALID_REQUEST',
              message: '请输入2000—2099年有效日期、时刻及IANA时区；夏令时跳过的时刻不可保存。',
            };
          if (request.operation === 'resolve')
            return { ok: true, reminders: [], choices, receipt: null };
          if (!choices.includes(request.instant))
            return {
              ok: false,
              code: 'INVALID_REQUEST',
              message: '所选时间点与日期/时区不匹配，请重新确认。',
            };
        }
        return port.execute(request);
      } catch {
        return {
          ok: false,
          code:
            request.operation === 'list' || request.operation === 'receipt'
              ? 'READ_FAILED'
              : 'WRITE_FAILED',
          message: '本地提醒操作失败，请保留原提交并重试核对。',
        };
      }
    },
    claimDue(now: string) {
      return port.claimDue(now);
    },
    recordAttempt(id: string, revision: number, status: 'shown' | 'failed' | 'unsupported') {
      port.recordAttempt(id, revision, status);
    },
  };
}
