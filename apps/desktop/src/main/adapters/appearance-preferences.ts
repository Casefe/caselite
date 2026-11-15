import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  appearanceValuesSchema,
  skinIdSchema,
  themeSchema,
  type AppearanceValues,
  type SkinId,
  type Theme,
} from '@caselite/contracts';

export function createAppearancePreferences(root: string) {
  const file = join(root, 'appearance-preferences.json');
  const readAppearance = (): AppearanceValues => {
    if (!existsSync(file)) return { theme: 'dark' };
    const stored: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!stored || typeof stored !== 'object' || Array.isArray(stored) || !('version' in stored))
      throw new Error('Invalid appearance settings');
    if (stored.version === 1) {
      if (
        Object.keys(stored).some((key) => key !== 'version' && key !== 'theme') ||
        !('theme' in stored)
      )
        throw new Error('Invalid appearance settings');
      return { theme: themeSchema.parse(stored.theme) };
    }
    if (stored.version === 2) {
      if (
        Object.keys(stored).some((key) => !['version', 'theme', 'skin'].includes(key)) ||
        !('skin' in stored) ||
        !('theme' in stored)
      )
        throw new Error('Invalid appearance settings');
      return appearanceValuesSchema.parse({
        theme: stored.theme,
        skin: skinIdSchema.parse(stored.skin),
      });
    }
    throw new Error('Invalid appearance settings');
  };
  const read = (): Theme => readAppearance().theme;
  const writeAppearance = (value: AppearanceValues) => {
    const values = appearanceValuesSchema.parse(value);
    // 只有受控读取成功后才写入；未知版本、损坏原文与既有主题不得被覆盖。
    readAppearance();
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const stored =
        values.skin === undefined
          ? { version: 1, theme: values.theme }
          : { version: 2, theme: values.theme, skin: values.skin };
      writeFileSync(temporary, JSON.stringify(stored), { mode: 0o600, flag: 'wx' });
      const fd = openSync(temporary, 'r');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
  };
  return {
    read,
    readAppearance,
    write(theme: Theme) {
      // 颜色调整（包括AI操作与撤销）只改主题，保留最新的皮肤选择。
      writeAppearance({ ...readAppearance(), theme: themeSchema.parse(theme) });
    },
    writeSkin(skin: SkinId | undefined) {
      const current = readAppearance();
      // 显式恢复原版才降回v1，保留颜色；不删除文件或工作数据。
      writeAppearance(
        skin === undefined
          ? { theme: current.theme }
          : { ...current, skin: skinIdSchema.parse(skin) },
      );
    },
  };
}
