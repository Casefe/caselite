// 只读可信单face SFNT的Unicode cmap；缺字就拒绝，不能把系统fallback当成已冻结字库。
export function assertExportFontCoverage(font: Uint8Array, text: string): void {
  const bytes = Buffer.from(font.buffer, font.byteOffset, font.byteLength);
  const bounds = (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > bytes.length)
      throw new Error('PDF_FONT_UNAVAILABLE');
  };
  const u16 = (offset: number) => {
    bounds(offset, 2);
    return bytes.readUInt16BE(offset);
  };
  const u32 = (offset: number) => {
    bounds(offset, 4);
    return bytes.readUInt32BE(offset);
  };
  bounds(0, 12);
  if (![0x10000, 0x4f54544f].includes(u32(0))) throw new Error('PDF_FONT_UNAVAILABLE');
  let cmap = -1,
    end = 0;
  const tables = u16(4);
  if (tables > 256) throw new Error('PDF_FONT_UNAVAILABLE');
  for (let i = 0; i < tables; i++) {
    const offset = 12 + i * 16;
    bounds(offset, 16);
    if (bytes.toString('ascii', offset, offset + 4) === 'cmap') {
      cmap = u32(offset + 8);
      end = cmap + u32(offset + 12);
      bounds(cmap, end - cmap);
    }
  }
  if (cmap < 0 || u16(cmap) !== 0 || u16(cmap + 2) > 256) throw new Error('PDF_FONT_UNAVAILABLE');
  const maps: Array<(code: number) => number> = [];
  for (let i = 0; i < u16(cmap + 2); i++) {
    const record = cmap + 4 + i * 8,
      platform = u16(record),
      encoding = u16(record + 2);
    if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
    const start = cmap + u32(record + 4),
      format = u16(start);
    if (format === 12) {
      const length = u32(start + 4),
        count = u32(start + 12);
      if (start + length > end || length < 16 || count > 1000000 || 16 + count * 12 > length)
        throw new Error('PDF_FONT_UNAVAILABLE');
      maps.push((code) => {
        let left = 0,
          right = count - 1;
        while (left <= right) {
          const middle = (left + right) >>> 1,
            group = start + 16 + middle * 12,
            first = u32(group),
            last = u32(group + 4);
          if (code < first) right = middle - 1;
          else if (code > last) left = middle + 1;
          else return u32(group + 8) + code - first;
        }
        return 0;
      });
    } else if (format === 4) {
      const length = u16(start + 2),
        count = u16(start + 6) / 2;
      if (!Number.isInteger(count) || count < 1 || start + length > end || 16 + count * 8 > length)
        throw new Error('PDF_FONT_UNAVAILABLE');
      const ends = start + 14,
        starts = ends + count * 2 + 2,
        deltas = starts + count * 2,
        ranges = deltas + count * 2;
      maps.push((code) => {
        if (code > 65535) return 0;
        for (let j = 0; j < count; j++) {
          if (code > u16(ends + j * 2)) continue;
          const first = u16(starts + j * 2);
          if (code < first) return 0;
          const delta = u16(deltas + j * 2),
            range = u16(ranges + j * 2);
          if (!range) return (code + delta) & 65535;
          const at = ranges + j * 2 + range + (code - first) * 2;
          if (at + 2 > start + length) throw new Error('PDF_FONT_UNAVAILABLE');
          const glyph = u16(at);
          return glyph ? (glyph + delta) & 65535 : 0;
        }
        return 0;
      });
    }
  }
  if (!maps.length) throw new Error('PDF_FONT_UNAVAILABLE');
  for (const character of new Set(text)) {
    const code = character.codePointAt(0)!;
    if ([9, 10, 13].includes(code)) continue;
    if (!maps.some((map) => map(code) > 0)) throw new Error('PDF_GLYPH_UNAVAILABLE');
  }
}
