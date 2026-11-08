import { taskRequestSchema, type TaskRequest, type TaskResponse } from '@caselite/contracts';

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
        return port.execute(parsed.data);
      } catch {
        return {
          ok: false,
          code:
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
