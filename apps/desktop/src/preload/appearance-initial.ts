import { appearanceResponseSchema, type AppearanceResponse } from '@caselite/contracts';

export function readInitialAppearance(read: () => unknown): AppearanceResponse {
  try {
    const result = appearanceResponseSchema.safeParse(read());
    if (result.success) return result.data;
  } catch {
    // 无法确认时不能伪造已读取成功；Renderer显示可重试的启动错误。
  }
  return { ok: false, message: '无法读取初始外观，请重新读取。' };
}
