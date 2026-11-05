import { describe, expect, it } from 'vitest';
import {
  pdfAnchorSchema,
  readyAssetSchema,
  sourceRefSchema,
  sourceResolutionSchema,
  sourceVersionSchema,
} from '../../packages/contracts/src/source';

const id = '11111111-1111-4111-8111-111111111111';
const anchor = {
  anchor_id: id,
  source_version_id: id,
  locator_version: 1,
  locator_granularity: 'text',
  page: {
    page_index: 0,
    display_label: 'i',
    crop_box: [0, 0, 612, 792],
    rotation: 90,
    user_unit: 1,
  },
  quads: [[20, 30, 90, 30, 20, 20, 90, 20]],
  quote: '收到乙方合规发票后十个自然日内',
  prefix: '',
  suffix: '',
  text_origin: 'pdf_text',
  text_derivation_id: null,
};
describe('fixed PDF source design contract', () => {
  it('only describes ready, hashed PDF bytes and stable Task source identity', () => {
    const asset = {
      asset_version_id: id,
      sha256: 'a'.repeat(64),
      bytes: 1024,
      media_type: 'application/pdf',
      state: 'ready',
    };
    expect(readyAssetSchema.safeParse(asset).success).toBe(true);
    for (const patch of [{ state: 'staging' }, { sha256: 'wrong' }, { path: '/private/file' }])
      expect(readyAssetSchema.safeParse({ ...asset, ...patch }).success).toBe(false);
    expect(
      sourceVersionSchema.safeParse({
        source_version_id: id,
        task_id: id,
        asset_version_id: id,
        asset_sha256: asset.sha256,
        title: '合成合同v1',
        page_count: 2,
      }).success,
    ).toBe(true);
  });

  it('preserves physical page, original quote and distinct repeated-text geometries', () => {
    const first = pdfAnchorSchema.parse(anchor);
    const second = pdfAnchorSchema.parse({
      ...anchor,
      anchor_id: '22222222-2222-4222-8222-222222222222',
      quads: [[20, 130, 90, 130, 20, 120, 90, 120]],
    });
    expect(first.quote).toBe(second.quote);
    expect(first.quads).not.toEqual(second.quads);
    expect(first.page.page_index).toBe(0);
    expect(first.page.display_label).toBe('i');
    for (const patch of [
      { locator_version: 2 },
      { page: { ...anchor.page, page_index: -1 } },
      { page: { ...anchor.page, crop_box: [612, 0, 0, 792] } },
      { quads: [[NaN, 0, 0, 0, 0, 0, 0, 0]] },
      { quads: [[613, 0, 0, 0, 0, 0, 0, 0]] },
      { quads: [[0, 0, 0, 0, 0, 0, 0, 0]] },
      { quads: [[20, 30, 90, 20, 20, 20, 90, 30]] },
      { text_origin: 'ocr_candidate' },
    ])
      expect(pdfAnchorSchema.safeParse({ ...anchor, ...patch }).success).toBe(false);
  });

  it('keeps OCR page or region candidates distinct from an exact verified text hit', () => {
    for (const locator_granularity of ['page', 'region']) {
      const candidate = {
        ...anchor,
        locator_granularity,
        text_origin: 'ocr_candidate',
        text_derivation_id: id,
        quads: locator_granularity === 'page' ? [] : anchor.quads,
      };
      expect(pdfAnchorSchema.safeParse(candidate).success).toBe(true);
      expect(pdfAnchorSchema.safeParse({ ...candidate, locator_granularity: 'text' }).success).toBe(
        false,
      );
    }
    expect(
      pdfAnchorSchema.safeParse({
        ...anchor,
        page: { ...anchor.page, crop_box: [10, 10, 612, 792], rotation: 270, user_unit: 2 },
      }).success,
    ).toBe(true);
    expect(
      pdfAnchorSchema.safeParse({
        ...anchor,
        page: { ...anchor.page, crop_box: [100, 100, 612, 792] },
      }).success,
    ).toBe(false);
  });

  it('represents failure honestly without accepting an invented successful location', () => {
    expect(sourceRefSchema.parse({ source_version_id: id, anchor_id: id })).toEqual({
      source_version_id: id,
      anchor_id: id,
    });
    for (const reason of ['QUOTE_MISMATCH', 'AMBIGUOUS', 'VERSION_MISMATCH', 'OCR_REQUIRED'])
      expect(sourceResolutionSchema.safeParse({ status: 'unresolved', reason }).success).toBe(true);
    expect(sourceResolutionSchema.safeParse({ status: 'resolved', anchor: null }).success).toBe(
      false,
    );
    expect(
      sourceRefSchema.safeParse({ source_version_id: id, anchor_id: id, note: '原文' }).success,
    ).toBe(false);
  });
});
