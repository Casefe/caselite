import { memoRequestSchema, type MemoRequest, type MemoResponse } from '@caselite/contracts';

export interface MemoPort {
  execute(request: MemoRequest): MemoResponse;
}

export function createMemoApplication(port: MemoPort) {
  return {
    execute(input: unknown): MemoResponse {
      const parsed = memoRequestSchema.safeParse(input);
      if (!parsed.success)
        return {
          ok: false,
          code: 'INVALID_REQUEST',
          message: '备忘字段或版本无效，请检查正文和身份。',
        };
      const request = parsed.data;
      try {
        if (request.operation !== 'list' && request.operation !== 'receipt') {
          const known = port.execute({
            protocol_version: 1,
            operation: 'receipt',
            idempotency_key: request.idempotency_key,
          });
          if (known.ok) return port.execute(request);
          if (known.code !== 'NOT_FOUND') return known;
        }
        return port.execute(request);
      } catch {
        return {
          ok: false,
          code:
            request.operation === 'list' || request.operation === 'receipt'
              ? 'READ_FAILED'
              : 'WRITE_FAILED',
          message: '本地备忘操作失败，请保留原提交并重试核对。',
        };
      }
    },
  };
}
