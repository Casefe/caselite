import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { orderSkinNavigation, skins } from './index';
const styles = new URL('../../styles/', import.meta.url);
const luminance = (hex: string) =>
  hex
    .slice(1)
    .match(/../g)!
    .map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: string, b: string) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
it('keeps every navigation object and unknown entries stable while ranking only existing ids', () => {
  const items = [{ id: 'new-1' }, { id: 'documents' }, { id: 'home' }, { id: 'new-2' }];
  expect(skins.map((s) => s.id)).toEqual(['deep-sea', 'lilac', 'paper', 'pine']);
  expect(orderSkinNavigation(items)).toEqual(items);
  expect(orderSkinNavigation(items, 'pine')).toEqual([items[1], items[2], items[0], items[3]]);
  expect(items[0].id).toBe('new-1');
  for (const skin of skins)
    expect(new Set(skin.navigationOrder).size).toBe(skin.navigationOrder.length);
});
it('declares each palette independently and provides readable real primary/navigation/profile-name consumers', () => {
  const report: Record<string, Record<string, number>> = {};
  for (const { id } of skins) {
    const css = readFileSync(new URL(`skin-${id}.css`, styles), 'utf8');
    expect(css).not.toMatch(/--theme-(?:canvas|panel):/);
    for (const mode of ['light', 'dark']) {
      const block = css.split(`html[data-skin='${id}'][data-theme='${mode}']`)[1]?.split('}')[0];
      expect(block).toBeDefined();
      const token = (name: string) => block.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))![1];
      const ratios = {
        primary: contrast(token('theme-accent'), mode === 'dark' ? '#17232b' : '#ffffff'),
        navigation: contrast(token('skin-nav-ink'), token('nav')),
        profileName: contrast(token('skin-nav-ink'), token('nav')),
        selectedNavigation: contrast(token('skin-nav-selected'), token('skin-nav-active')),
      };
      report[`${id}/${mode}`] = ratios;
      for (const ratio of Object.values(ratios)) expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  }
  const common = readFileSync(new URL('skins.css', styles), 'utf8');
  expect(common).toContain("html[data-skin][data-theme='dark'] button.primary");
  expect(common).toContain('color: #17232b');
  expect(common).toMatch(
    /html\[data-skin\] \.primary-sidebar \.profile-name\s*\{\s*color: var\(--skin-nav-ink\);\s*\}/,
  );
  expect(Object.values(report).flatMap((ratios) => Object.values(ratios))).toHaveLength(32);
  expect(Object.keys(report)).toHaveLength(8);
});
