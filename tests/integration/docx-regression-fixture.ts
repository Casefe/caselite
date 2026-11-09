import { crc32 } from 'node:zlib';

type Part = { name: string; data: string | Buffer; flags?: number; checksum?: number };
export const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export function documentXml(body: string, namespace = wordNamespace) {
  return `<w:document xmlns:w="${namespace}"><w:body>${body}</w:body></w:document>`;
}

// 仅构造合成的存储型ZIP，以便独立改变CRC、加密位或同名部件，不使用真实案件样本。
export function storedZip(parts: Part[]) {
  const local: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const path = Buffer.from(part.name);
    const plain = Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data);
    // 传统ZIP加密元数据包含12字节头；只构造足以到达拒绝分支的元数据，不模拟解密。
    const data = (part.flags ?? 0) & 1 ? Buffer.concat([Buffer.alloc(12), plain]) : plain;
    const crc = part.checksum ?? crc32(plain);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(part.flags ?? 0x800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(plain.length, 22);
    header.writeUInt16LE(path.length, 26);
    local.push(header, path, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(part.flags ?? 0x800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(plain.length, 24);
    central.writeUInt16LE(path.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, path);
    offset += header.length + path.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(
    directory.reduce((sum, chunk) => sum + chunk.length, 0),
    12,
  );
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...directory, end]);
}
export function docxFixture(body: string, extras: Part[] = [], namespace = wordNamespace) {
  return storedZip([
    {
      name: '[Content_Types].xml',
      data: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    { name: 'word/document.xml', data: documentXml(body, namespace) },
    ...extras,
  ]);
}
