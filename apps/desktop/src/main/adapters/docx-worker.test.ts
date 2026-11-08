import { expect, it } from 'vitest';
import { crc32 } from 'node:zlib';
import { inspectZip } from './docx-worker';

// 最小存储型 ZIP，可让文件头和中央目录声明不同的名称或条目数量。
function makeZip(
  entries: { name: string; localName?: string; text?: string }[],
  declaredCount = entries.length,
) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, localName = name, text = '' } of entries) {
    const data = Buffer.from(text);
    const localPath = Buffer.from(localName);
    const centralPath = Buffer.from(name);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50);
    localHeader.writeUInt32LE(crc32(data), 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(localPath.length, 26);
    locals.push(localHeader, localPath, data);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50);
    centralHeader.writeUInt32LE(crc32(data), 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(centralPath.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, centralPath);
    offset += localHeader.length + localPath.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(declaredCount, 8);
  end.writeUInt16LE(declaredCount, 10);
  end.writeUInt32LE(
    central.reduce((sum, buffer) => sum + buffer.length, 0),
    12,
  );
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

it('rejects local names and paths that could override an inspected DOCX part', async () => {
  await expect(
    inspectZip(makeZip([{ localName: 'word/document.xml', name: 'word/alternate.xx' }])),
  ).rejects.toThrow('Inconsistent ZIP entry name');
  await expect(inspectZip(makeZip([{ name: 'word//document.xml' }]))).rejects.toThrow('Unsafe ZIP');
});

it('only exposes validated entries and validates alternate parts on XML reads', async () => {
  const { file } = await inspectZip(
    makeZip(
      [
        { name: '[Content_Types].xml', text: '<Types/>' },
        { name: 'word/document.xml', text: '<document/>' },
        { name: 'word/alternate.xx', text: '<!DOCTYPE document><document/>' },
        { name: 'word/unlisted.xml', text: '<document/>' },
      ],
      3,
    ),
  );
  await expect(file.read('word/document.xml', 'utf8')).resolves.toBe('<document/>');
  expect(file.exists('word/unlisted.xml')).toBe(false);
  await expect(file.read('word/unlisted.xml', 'utf8')).rejects.toThrow('Unvalidated DOCX part');
  await expect(file.read('word/alternate.xx', 'utf8')).rejects.toThrow('Unsafe XML');
});
