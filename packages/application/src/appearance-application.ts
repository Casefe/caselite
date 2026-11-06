import { appearanceRequestSchema, type AppearanceResponse, type Theme } from '@caselite/contracts';

export type AppearancePort = { read(): Theme; write(theme: Theme): void };

export function createAppearanceApplication(port: AppearancePort) {
  return {
    execute(input: unknown): AppearanceResponse {
      const parsed = appearanceRequestSchema.safeParse(input);
      if (!parsed.success) return { ok: false, message: '主题请求无效。' };
      try {
        if (parsed.data.operation === 'set') port.write(parsed.data.theme);
        return { ok: true, theme: port.read() };
      } catch {
        return { ok: false, message: '无法确认本机主题设置，请重新读取后重试。' };
      }
    },
  };
}
