import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'darwin') throw new Error('App icon conversion requires macOS');
const branding = resolve(import.meta.dirname, '../apps/desktop/assets/branding');
const scratch = mkdtempSync(join(tmpdir(), 'caselite-icon-'));
try {
  const iconset = join(scratch, 'caselite.iconset');
  mkdirSync(iconset);
  // 只生成系统要求的图标尺寸；原始产品Logo始终保留，不覆盖或重新设计。
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      execFileSync(
        '/usr/bin/sips',
        [
          '-z',
          String(size * scale),
          String(size * scale),
          join(branding, 'caselite-logo.png'),
          '--out',
          join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
        ],
        { stdio: 'ignore' },
      );
    }
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(branding, 'caselite.icns')]);
  process.stdout.write('Generated CaseLite macOS app icon from the supplied logo.\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
