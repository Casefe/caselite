import { expect, it } from 'vitest';
import {
  defaultExportStyle,
  exportStyleSchema,
  localPreferenceValuesSchema,
} from '@caselite/contracts';

it('keeps legacy preferences absent of an export default and accepts a bounded style explicitly', () => {
  const legacy = { name: '测试律师', email: '', avatar: 'portrait', show_word_count: false };
  expect(localPreferenceValuesSchema.parse(legacy)).toEqual(legacy);
  expect(
    localPreferenceValuesSchema.parse({ ...legacy, export_style: defaultExportStyle }),
  ).toEqual({ ...legacy, export_style: defaultExportStyle });
});

it('rejects executable paths, unknown formats, nonfinite sizes and insufficient running-text margins', () => {
  for (const style of [
    { ...defaultExportStyle, font: '/tmp/arbitrary.ttf' },
    { ...defaultExportStyle, paper: 'A3' },
    { ...defaultExportStyle, font_size: Number.NaN },
    { ...defaultExportStyle, font_size: 12.3 },
    { ...defaultExportStyle, header: '页眉\n下一行' },
    { ...defaultExportStyle, footer: 'x'.repeat(121) },
    { ...defaultExportStyle, resource_sha256: 'not-owned-by-renderer' },
    { ...defaultExportStyle, margins: { ...defaultExportStyle.margins, left: -1 } },
    { ...defaultExportStyle, header: '页眉', margins: { ...defaultExportStyle.margins, top: 8 } },
    {
      ...defaultExportStyle,
      footer: '{page}',
      margins: { ...defaultExportStyle.margins, bottom: 8 },
    },
  ]) {
    expect(exportStyleSchema.safeParse(style).success).toBe(false);
  }
  expect(
    exportStyleSchema.parse({
      ...defaultExportStyle,
      paper: 'Letter',
      font_size: 10.5,
      header: '  合成测试  ',
      footer: '第 {page} 页，共 {pages} 页',
    }),
  ).toMatchObject({ paper: 'Letter', font_size: 10.5, header: '合成测试' });
});
