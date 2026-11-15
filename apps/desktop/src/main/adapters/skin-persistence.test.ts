import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAppearancePreferences } from './appearance-preferences';
const fault = vi.hoisted(() => ({ rename: false }));
vi.mock('node:fs', async (load) => {
  const real = await load<typeof import('node:fs')>();
  return {
    ...real,
    renameSync: (...args: Parameters<typeof real.renameSync>) => {
      if (fault.rename) throw new Error('synthetic rename failure');
      return real.renameSync(...args);
    },
  };
});
beforeEach(() => {
  fault.rename = false;
});

describe('single device appearance owner', () => {
  it('reads v1 without rewriting, upgrades only on a selected skin and resets to v1', () => {
    const root = mkdtempSync(join(tmpdir(), 'caselite-four-skin-'));
    try {
      const file = join(root, 'appearance-preferences.json'),
        owner = createAppearancePreferences(root);
      expect(owner.readAppearance()).toEqual({ theme: 'dark' });
      expect(existsSync(file)).toBe(false);
      const old = '{"version":1,"theme":"light"}';
      writeFileSync(file, old);
      expect(owner.readAppearance()).toEqual({ theme: 'light' });
      expect(readFileSync(file, 'utf8')).toBe(old);
      owner.writeSkin('pine');
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
        version: 2,
        theme: 'light',
        skin: 'pine',
      });
      createAppearancePreferences(root).write('dark');
      expect(owner.readAppearance()).toEqual({ theme: 'dark', skin: 'pine' });
      owner.writeSkin(undefined);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, theme: 'dark' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('preserves damaged and unknown files through theme, skin and reset attempts', () => {
    const root = mkdtempSync(join(tmpdir(), 'caselite-four-skin-'));
    try {
      const file = join(root, 'appearance-preferences.json'),
        owner = createAppearancePreferences(root);
      for (const raw of [
        '{broken',
        '{"version":3,"theme":"light"}',
        '{"version":2,"theme":"dark"}',
        '{"version":2,"theme":"dark","skin":"other"}',
        '{"version":1,"theme":"light","skin":"pine"}',
      ]) {
        writeFileSync(file, raw);
        expect(() => owner.readAppearance()).toThrow();
        expect(() => owner.write('light')).toThrow();
        expect(() => owner.writeSkin('pine')).toThrow();
        expect(() => owner.writeSkin(undefined)).toThrow();
        expect(readFileSync(file, 'utf8')).toBe(raw);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('leaves original bytes and no temporary file after atomic rename failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'caselite-four-skin-'));
    try {
      const owner = createAppearancePreferences(root);
      owner.write('light');
      const file = join(root, 'appearance-preferences.json'),
        before = readFileSync(file, 'utf8');
      fault.rename = true;
      expect(() => owner.writeSkin('lilac')).toThrow('synthetic rename failure');
      expect(readFileSync(file, 'utf8')).toBe(before);
      expect(readdirSync(root)).toEqual(['appearance-preferences.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
