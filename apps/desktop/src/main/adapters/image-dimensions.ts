export function imageDimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) throw new Error('Invalid JPEG');
      let marker = bytes[offset++];
      while (marker === 255 && offset < bytes.length) marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error('Invalid JPEG length');
      if ([192, 193, 194].includes(marker)) {
        if (length < 8) throw new Error('Invalid JPEG dimensions');
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (!width || !height || width * height > 9_000_000)
    throw new Error('请选择有效且不超过900万像素的JPEG或PNG照片。');
  return { width, height };
}
