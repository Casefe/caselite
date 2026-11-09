import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  defaultExportStyle,
  exportStyleSchema,
  localPreferenceValuesSchema,
  taskRequestSchema,
  deliveryExportSchema,
} from '@caselite/contracts';

it('keeps legacy preferences absent of an export default and accepts a bounded style explicitly', () => {
  const legacy = { name: '测试律师', email: '', avatar: 'portrait', show_word_count: false };
  expect(localPreferenceValuesSchema.parse(legacy)).toEqual(legacy);
  expect(
    localPreferenceValuesSchema.parse({ ...legacy, export_style: defaultExportStyle }),
  ).toEqual({ ...legacy, export_style: defaultExportStyle });
});

it('accepts style values but keeps resource fingerprints and converter selection out of Renderer commands', () => {
  const request = {
    protocol_version: 1,
    operation: 'export_snapshot',
    request_id: randomUUID(),
    idempotency_key: randomUUID(),
    task_id: randomUUID(),
    document_id: randomUUID(),
    snapshot_id: randomUUID(),
    format: 'pdf',
    export_style: defaultExportStyle,
  };
  expect(taskRequestSchema.safeParse(request).success).toBe(true);
  for (const extra of [
    { configuration: {} },
    { configuration_fingerprint: 'a'.repeat(64) },
    { converter: 'electron-45.1.0-pdf-v3' },
    { font_path: '/outside/font.ttf' },
  ]) {
    expect(taskRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
  }
  const row = {
    id: randomUUID(),
    snapshot_id: request.snapshot_id,
    format: 'pdf',
    converter: 'electron-45.1.0-pdf-v3',
    status: 'pending',
    sha256: null,
    bytes: null,
    created_at: new Date().toISOString(),
  };
  expect(deliveryExportSchema.safeParse(row).success).toBe(false);
  const configuration = {
    version: 1,
    style: defaultExportStyle,
    font: { family: 'Arial Unicode MS', sha256: 'a'.repeat(64) },
    fingerprint: 'b'.repeat(64),
  };
  expect(deliveryExportSchema.safeParse({ ...row, configuration }).success).toBe(true);
  expect(
    deliveryExportSchema.safeParse({ ...row, configuration, converter: 'electron-45.1.0-pdf-v2' })
      .success,
  ).toBe(false);
  expect(
    deliveryExportSchema.safeParse({
      ...row,
      configuration: { ...configuration, font: { ...configuration.font, family: 'PingFang SC' } },
    }).success,
  ).toBe(false);
});

it('rejects executable paths, unknown formats, nonfinite sizes and insufficient running-text margins', () => {
  for (const style of [
    { ...defaultExportStyle, font: '/tmp/arbitrary.ttf' },
    { ...defaultExportStyle, paper: 'A3' },
    { ...defaultExportStyle, font_size: Number.NaN },
    { ...defaultExportStyle, font_size: 12.3 },
    { ...defaultExportStyle, header: '页眉\n下一行' },
    { ...defaultExportStyle, header: '坏字符\ud800' },
    { ...defaultExportStyle, footer: '坏字符\uffff' },
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
  expect(exportStyleSchema.safeParse({ ...defaultExportStyle, header: '合成😀𠮷' }).success).toBe(
    true,
  );
});
