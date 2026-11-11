import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import { darkThemeAuditScript } from './dark-theme-demo';

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage();
  await page.route('**/*', (route) => route.abort());
}, 15000);
afterAll(async () => {
  await browser?.close();
});

type Fixture = {
  selected?: boolean;
  tag?: string;
  extra?: string;
  border?: string;
  accent?: string;
  selectedColor?: string;
  text?: string;
  background?: string;
  selectedCount?: number;
};
async function audit(f: Fixture = {}) {
  const accent = f.accent ?? '#a0a8ff';
  const selected = f.selectedColor ?? '#32323f';
  const tag = f.tag ?? 'button';
  const attrs = (f.selected ?? true) ? 'aria-pressed="true"' : 'aria-pressed="false"';
  const element = `<${tag} ${attrs} style="${f.border ?? 'border-bottom:3px solid #a0a8ff'};${f.extra ?? ''}">预测日期</${tag}>`;
  await page.setContent(`<html data-theme="dark" style="--theme-accent:${accent};--theme-selected:${selected}">
    <style>
      .workspace-main{background:#222225;color:#eeeeef}
      button,.other{width:120px;height:120px;border:0;background:${f.background ?? '#32323f'};color:${f.text ?? '#a0a8ff'}}
      .calendar-forecast-strip{display:flex}
    </style><main class="workspace-main"><nav class="calendar-forecast-strip">
      ${element.repeat(f.selectedCount ?? 1)}
    </nav></main></html>`);
  return page.evaluate<{ theme: string; bright: Array<{ side?: string; background?: string }> }>(
    darkThemeAuditScript('isolated-fixture'),
  );
}

it('accepts the exact semantic selected forecast Bottom indicator in real computed styles', async () => {
  expect((await audit()).bright).toEqual([]);
});

it.each([
  ['white selected bottom', { border: 'border-bottom:3px solid white' }],
  ['wrong bright selected bottom', { border: 'border-bottom:3px solid #ffaaaa' }],
  ['nonselected accent bottom', { selected: false }],
  ['selected top white edge', { extra: 'border-top:3px solid white' }],
  ['selected left white edge', { extra: 'border-left:3px solid white' }],
  [
    'ordinary element long white edge',
    { tag: 'div', extra: 'width:120px;height:120px', border: 'border-bottom:3px solid white' },
  ],
  ['four pixel selected bottom', { border: 'border-bottom:4px solid #a0a8ff' }],
  ['dashed selected bottom', { border: 'border-bottom:3px dashed #a0a8ff' }],
  ['missing accent token', { accent: '' }],
  ['missing selected token', { selectedColor: '' }],
  ['wrong selected text color', { text: '#ffffff' }],
  ['wrong selected background', { background: '#444444' }],
  ['multiple selected forecast buttons', { selectedCount: 2 }],
] satisfies Array<[string, Fixture]>)('still rejects %s', async (_name, fixture) => {
  expect((await audit(fixture)).bright.length).toBeGreaterThan(0);
});

it('keeps scanning the selected element background even when its bottom is semantic', async () => {
  const r = await audit({ background: '#ffffff', selectedColor: '#ffffff' });
  expect(r.bright.some((v) => v.background === 'rgb(255, 255, 255)')).toBe(true);
});

it('keeps ordinary dark edges and semantic keyboard outlines accepted', async () => {
  expect(
    (
      await audit({
        selected: false,
        border: 'border-bottom:1px solid #3a3a42',
        extra: 'outline:2px solid #a0a8ff',
      })
    ).bright,
  ).toEqual([]);
});
