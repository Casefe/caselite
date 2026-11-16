import { memoRequestSchema, type MemoRequest, type MemoResponse } from '@caselite/contracts';

export interface MemoPort {
  execute(request: MemoRequest): MemoResponse;
}
function fingerprint(request: MemoRequest) {
  if (request.operation === 'list' || request.operation === 'receipt') return undefined;
  const { request_id, ...content } = request;
  void request_id;
  return JSON.stringify(content);
}
// 同一键重叠时不能再写一次。端口抛错只说明结果未知，必须查询回执，不能改口成已保存。
export function createMemoApplication(port: MemoPort) {
  const pending = new Map<string, string>();
  return {
    execute(input: unknown): MemoResponse {
      const parsed = memoRequestSchema.safeParse(input);
      if (!parsed.success)
        return {
          ok: false,
          code: 'INVALID_REQUEST',
          message: '备忘字段无效。请保留原文，不要附带任务、项目或日期。',
        };
      const request = parsed.data;
      const writing = fingerprint(request);
      if (writing && 'idempotency_key' in request) {
        const current = pending.get(request.idempotency_key);
        if (current)
          return {
            ok: false,
            code: current === writing ? 'RESULT_UNKNOWN' : 'CONFLICT',
            message:
              current === writing
                ? '原备忘提交仍在处理，请查询原回执。'
                : '原提交身份正在用于不同备忘内容。',
          };
        pending.set(request.idempotency_key, writing);
      }
      try {
        return port.execute(request);
      } catch {
        return {
          ok: false,
          code:
            request.operation === 'list' || request.operation === 'receipt'
              ? 'READ_FAILED'
              : 'RESULT_UNKNOWN',
          message:
            request.operation === 'list' || request.operation === 'receipt'
              ? '无法读取备忘，请稍后重试。'
              : '无法确认备忘是否已保存，请保留原提交并查询回执。',
        };
      } finally {
        if (writing && 'idempotency_key' in request) pending.delete(request.idempotency_key);
      }
    },
  };
}
