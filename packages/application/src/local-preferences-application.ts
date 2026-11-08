import {
  localPreferencesRequestSchema,
  type LocalPreferencesRequest,
  type LocalPreferencesResponse,
} from '@caselite/contracts';
export type LocalPreferencesPort = {
  execute(request: LocalPreferencesRequest): LocalPreferencesResponse;
};
export function createLocalPreferencesApplication(port: LocalPreferencesPort) {
  return {
    execute(input: unknown): LocalPreferencesResponse {
      const parsed = localPreferencesRequestSchema.safeParse(input);
      if (!parsed.success)
        return { ok: false, code: 'INVALID_REQUEST', message: '个人资料或偏好格式无效。' };
      try {
        return port.execute(parsed.data);
      } catch {
        return {
          ok: false,
          code: parsed.data.operation === 'set' ? 'RESULT_UNKNOWN' : 'READ_FAILED',
          message: '无法确认本地设置结果，请保留输入并重新读取原提交。',
        };
      }
    },
  };
}
