import { intakeRequestSchema, type IntakeRequest, type IntakeResponse } from '@caselite/contracts';

export interface IntakePort {
  execute(request: IntakeRequest): IntakeResponse;
}

export function createIntakeApplication(port: IntakePort) {
  return {
    execute(input: unknown): IntakeResponse {
      const parsed = intakeRequestSchema.safeParse(input);
      if (!parsed.success)
        return { ok: false, code: 'INVALID_REQUEST', message: '输入格式无效，请检查收件字段。' };
      const request = parsed.data;
      const reading = request.operation === 'list' || request.operation === 'receipt';
      try {
        if (!reading) {
          const known = port.execute({
            protocol_version: 1,
            operation: 'receipt',
            idempotency_key: request.idempotency_key,
          });
          // 原键已有结果时重放原分拣，不能换成新的任务或新的采纳。
          if (known.ok) return port.execute(request);
          if (known.code !== 'NOT_FOUND') return known;
        }
        return port.execute(request);
      } catch {
        return {
          ok: false,
          code: reading ? 'READ_FAILED' : 'WRITE_FAILED',
          message: reading
            ? '收件读取失败，已保存内容保持不变。'
            : '本地收件失败，已保存内容保持不变。请重试或检查本地存储。',
        };
      }
    },
  };
}
