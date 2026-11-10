import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppearancePreferences } from './appearance-preferences';

describe('local appearance preference', () => {
  it('persists across instances and does not overwrite unknown settings', () => {
    const root = mkdtempSync(join(tmpdir(), 'caselite-appearance-test-'));
    try {
      const first = createAppearancePreferences(root);
      const file = join(root, 'appearance-preferences.json');
      expect(first.read()).toBe('dark');
      expect(existsSync(file)).toBe(false);
      first.write('light');
      expect(createAppearancePreferences(root).read()).toBe('light');
      first.write('dark');
      expect(createAppearancePreferences(root).read()).toBe('dark');
      const corrupt = '{"version":2,"theme":"dark"}';
      writeFileSync(file, corrupt);
      expect(() => first.read()).toThrow();
      expect(() => first.write('light')).toThrow();
      expect(readFileSync(file, 'utf8')).toBe(corrupt);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
