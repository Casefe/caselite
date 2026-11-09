import { taskRequestSchema, type TaskRequest, type TaskResponse } from '@caselite/contracts';
import { resolveReminderTime } from './reminder-application';

export interface TaskPort {
  execute(request: TaskRequest): TaskResponse;
}
export function createTaskApplication(port: TaskPort) {
  return {
    execute(input: unknown): TaskResponse {
      const parsed = taskRequestSchema.safeParse(input);
      if (!parsed.success)
        return {
          ok: false,
          code: 'INVALID_REQUEST',
          message: '输入格式无效，请检查任务字段和版本。',
        };
      try {
        if (parsed.data.operation === 'create' && parsed.data.initial_reminder) {
          const request = parsed.data;
          // 原键回执优先；时区规则更新不能阻断已经提交的创建请求恢复。
          const known = port.execute({
            protocol_version: 1,
            operation: 'status',
            idempotency_key: request.idempotency_key,
          });
          if (known.ok) return port.execute(request);
          if (known.code !== 'NOT_FOUND') return known;
          const reminder = request.initial_reminder!;
          let choices: string[] = [];
          try {
            choices = resolveReminderTime(reminder.date, reminder.time, reminder.timezone);
          } catch {
            /* 无效时区按无可用时刻拒绝。 */
          }
          if (!choices.includes(reminder.instant))
            return {
              ok: false,
              code: 'INVALID_REQUEST',
              message: '提醒日期、时刻与时区不匹配，请重新确认。',
            };
        }
        return port.execute(parsed.data);
      } catch {
        return {
          ok: false,
          code:
            parsed.data.operation === 'calendar_query' ||
            parsed.data.operation === 'list' ||
            parsed.data.operation === 'read' ||
            parsed.data.operation === 'list_snapshots' ||
            parsed.data.operation === 'read_snapshot' ||
            parsed.data.operation === 'status'
              ? 'READ_FAILED'
              : 'WRITE_FAILED',
          message: '本地操作失败，已保存内容保持不变。请重试或检查本地存储。',
        };
      }
    },
  };
}
