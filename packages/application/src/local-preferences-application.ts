import {
  localPreferencesRequestSchema,
  type LocalPreferencesRequest,
  type LocalPreferencesResponse,
  type WorkspaceLocations,
  workspaceLocationsSchema,
} from '@caselite/contracts';
export type LocalPreferencesPort = {
  execute(request: LocalPreferencesRequest): LocalPreferencesResponse;
};
export function createLocalPreferencesApplication(
  port: LocalPreferencesPort,
  locations?: WorkspaceLocations,
) {
  const locationView = locations ? workspaceLocationsSchema.parse(locations) : undefined;
  return {
    execute(input: unknown): LocalPreferencesResponse {
      const parsed = localPreferencesRequestSchema.safeParse(input);
      if (!parsed.success)
        return { ok: false, code: 'INVALID_REQUEST', message: '个人资料或偏好格式无效。' };
      try {
        const result = port.execute(parsed.data);
        // 主机绑定的目录只随读取返回，不进入可编辑值、版本或历史回执。
        return result.ok && parsed.data.operation === 'read' && locationView
          ? { ...result, locations: locationView }
          : result;
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
