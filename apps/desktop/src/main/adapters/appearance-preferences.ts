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
import { themeSchema, type Theme } from '@caselite/contracts';

export function createAppearancePreferences(root: string) {
  const file = join(root, 'appearance-preferences.json');
  const read = (): Theme => {
    if (!existsSync(file)) return 'light';
    const stored: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (
      !stored ||
      typeof stored !== 'object' ||
      Array.isArray(stored) ||
      !('version' in stored) ||
      stored.version !== 1 ||
      !('theme' in stored) ||
      Object.keys(stored).some((key) => key !== 'version' && key !== 'theme')
    )
      throw new Error('Invalid appearance settings');
    return themeSchema.parse(stored.theme);
  };
  return {
    read,
    write(theme: Theme) {
      // 损坏或未知版本必须保留，不能用新主题覆盖无法识别的偏好。
      read();
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify({ version: 1, theme }), {
          mode: 0o600,
          flag: 'wx',
        });
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
    },
  };
}
