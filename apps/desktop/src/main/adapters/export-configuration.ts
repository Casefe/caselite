import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  exportStyleSchema,
  exportFontFamilies,
  exportConfigurationContent,
  exportConfigurationSchema,
  type ExportStyle,
  type ExportConfiguration,
} from '@caselite/contracts';

// 苹方为多face TTC集合；未验证精确face提取前，不把同名家族冒充已冻结字体。
async function systemFont(font: ExportStyle['font']): Promise<string> {
  if (font !== 'arial-unicode') throw new Error('PDF_FONT_UNAVAILABLE');
  return '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
}

export function createExportConfigurationResolver(
  // 仅宿主组合根/隔离测试可替换定位器；IPC不接受路径或资源哈希。
  locate: (font: ExportStyle['font']) => Promise<string> = systemFont,
) {
  async function resolve(style: ExportStyle): Promise<ExportConfiguration> {
    const normalized = exportStyleSchema.parse(style);
    let file;
    try {
      file = await open(await locate(normalized.font), constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = await file.stat();
      if (!before.isFile() || before.size < 12 || before.size > 100_000_000)
        throw new Error('Invalid font');
      const hash = createHash('sha256');
      const buffer = Buffer.alloc(64 * 1024);
      let position = 0;
      while (position < before.size) {
        const { bytesRead } = await file.read(
          buffer,
          0,
          Math.min(buffer.length, before.size - position),
          position,
        );
        if (!bytesRead) throw new Error('Font changed');
        if (
          position === 0 &&
          !['00010000', '4f54544f', '74746366'].includes(buffer.subarray(0, 4).toString('hex'))
        )
          throw new Error('Invalid font');
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      const after = await file.stat();
      if (
        after.ino !== before.ino ||
        after.dev !== before.dev ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs
      )
        throw new Error('Font changed');
      const payload = {
        version: 1 as const,
        style: normalized,
        font: { family: exportFontFamilies[normalized.font], sha256: hash.digest('hex') },
      };
      return exportConfigurationSchema.parse({
        ...payload,
        fingerprint: createHash('sha256').update(exportConfigurationContent(payload)).digest('hex'),
      });
    } catch {
      throw new Error('PDF_FONT_UNAVAILABLE');
    } finally {
      await file?.close();
    }
  }
  return {
    resolve,
    async readFont(configuration: ExportConfiguration): Promise<Uint8Array> {
      const selected = exportConfigurationSchema.parse(configuration);
      const file = await open(
        await locate(selected.style.font),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const before = await file.stat();
        if (!before.isFile() || before.size < 12 || before.size > 100_000_000)
          throw new Error('PDF_FONT_UNAVAILABLE');
        const bytes = await file.readFile();
        const after = await file.stat();
        if (
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs ||
          bytes.length !== before.size ||
          createHash('sha256').update(bytes).digest('hex') !== selected.font.sha256
        )
          throw new Error('EXPORT_FONT_CHANGED');
        return new Uint8Array(bytes);
      } finally {
        await file.close();
      }
    },
    async verify(configuration: ExportConfiguration) {
      const current = await resolve(configuration.style);
      if (current.fingerprint !== configuration.fingerprint) throw new Error('EXPORT_FONT_CHANGED');
    },
  };
}
