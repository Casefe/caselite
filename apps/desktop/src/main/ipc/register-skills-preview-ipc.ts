import { createHash } from 'node:crypto';
import { ipcMain } from 'electron';
import { previewSkillImport } from '@caselite/application';
import {
  SKILLS_PREVIEW_CHANNEL,
  skillPreviewInputSchema,
  skillPreviewResultSchema,
  type SkillPreviewResult,
} from '@caselite/contracts';
import { isTrustedBusinessSender } from './window-capabilities';

export function registerSkillsPreviewIpc() {
  ipcMain.handle(SKILLS_PREVIEW_CHANNEL, (event, input): SkillPreviewResult => {
    if (!isTrustedBusinessSender(event)) return { status: 'rejected', code: 'FORBIDDEN' };
    const parsed = skillPreviewInputSchema.safeParse(input);
    if (!parsed.success) return { status: 'rejected', code: 'INVALID_INPUT' };
    // 只转换显式传入的字节，不接触文件系统、生产库或Agent执行入口。
    try {
      const result = skillPreviewResultSchema.safeParse(
        previewSkillImport(parsed.data, {
          createSha256() {
            const hash = createHash('sha256');
            return {
              update(bytes) {
                hash.update(bytes);
                return this;
              },
              digestHex() {
                return hash.digest('hex');
              },
            };
          },
        }),
      );
      return result.success ? result.data : { status: 'rejected', code: 'INVALID_RESULT' };
    } catch {
      return { status: 'rejected', code: 'PREVIEW_FAILED' };
    }
  });
}
