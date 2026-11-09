import { expect, it } from 'vitest';
import { assertExportFontCoverage } from './export-font-coverage';

function font(format: 4 | 12) {
  const length = format === 4 ? 32 : 40;
  const bytes = Buffer.alloc(40 + length);
  bytes.writeUInt32BE(0x10000, 0);
  bytes.writeUInt16BE(1, 4);
  bytes.write('cmap', 12);
  bytes.writeUInt32BE(28, 20);
  bytes.writeUInt32BE(12 + length, 24);
  bytes.writeUInt16BE(1, 30);
  bytes.writeUInt16BE(3, 32);
  bytes.writeUInt16BE(format === 4 ? 1 : 10, 34);
  bytes.writeUInt32BE(12, 36);
  const start = 40;
  bytes.writeUInt16BE(format, start);
  if (format === 4) {
    bytes.writeUInt16BE(length, start + 2);
    bytes.writeUInt16BE(4, start + 6);
    bytes.writeUInt16BE(0x7a, start + 14);
    bytes.writeUInt16BE(65535, start + 16);
    bytes.writeUInt16BE(0x61, start + 20);
    bytes.writeUInt16BE(65535, start + 22);
    bytes.writeUInt16BE(65536 - 96, start + 24);
    bytes.writeUInt16BE(1, start + 26);
  } else {
    bytes.writeUInt32BE(length, start + 4);
    bytes.writeUInt32BE(2, start + 12);
    bytes.writeUInt32BE(0x61, start + 16);
    bytes.writeUInt32BE(0x7a, start + 20);
    bytes.writeUInt32BE(1, start + 24);
    bytes.writeUInt32BE(0x20bb7, start + 28);
    bytes.writeUInt32BE(0x20bb7, start + 32);
    bytes.writeUInt32BE(27, start + 36);
  }
  return bytes;
}
it('accepts mapped BMP/non-BMP characters and rejects absent glyphs instead of allowing fallback', () => {
  expect(() => assertExportFontCoverage(font(4), 'abc\nz')).not.toThrow();
  expect(() => assertExportFontCoverage(font(12), 'abc𠮷')).not.toThrow();
  expect(() => assertExportFontCoverage(font(4), '𠮷')).toThrow('PDF_GLYPH_UNAVAILABLE');
  expect(() => assertExportFontCoverage(font(12), '𠀀')).toThrow('PDF_GLYPH_UNAVAILABLE');
  expect(() => assertExportFontCoverage(font(4), 'A')).toThrow('PDF_GLYPH_UNAVAILABLE');
});
it('rejects truncated or out-of-bounds font tables before reading content', () => {
  expect(() => assertExportFontCoverage(font(4).subarray(0, 42), 'a')).toThrow(
    'PDF_FONT_UNAVAILABLE',
  );
  const invalid = font(12);
  invalid.writeUInt32BE(0xffffffff, 36);
  expect(() => assertExportFontCoverage(invalid, 'a')).toThrow('PDF_FONT_UNAVAILABLE');
});
