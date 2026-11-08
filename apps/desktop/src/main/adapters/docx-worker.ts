import { parentPort } from 'node:worker_threads';
import { crc32 } from 'node:zlib';
import { convertToHtml, extractRawText, images } from 'mammoth';
import { DOMParser } from '@xmldom/xmldom';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';

const wordNamespaces = [
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
];
const maxExpanded = 32 * 1024 * 1024;
const revisionTags = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'moveFromRangeStart',
  'moveToRangeStart',
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
  'cellIns',
  'cellDel',
  'cellMerge',
  'numberingChange',
]);
const commentTags = new Set([
  'comment',
  'commentRangeStart',
  'commentRangeEnd',
  'commentReference',
]);

// yauzl 3.4 提供本地文件头，已锁定的类型声明尚未覆盖这一接口。
type ZipWithLocalHeader = ZipFile & {
  readLocalFileHeader(
    entry: Entry,
    callback: (error: Error | null, header: { fileName: Buffer }) => void,
  ): void;
};

export async function inspectZip(bytes: Buffer) {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      bytes,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, file) => (error ? reject(error) : resolve(file)),
    ),
  );
  const review = { revisions: false, comments: false };
  const names = new Set<string>();
  const entries = new Map<string, Buffer>();
  const checked = new Set<string>();
  let size = 0;
  function xmlText(name: string, data: Buffer) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (checked.has(name)) return text;
    if (text.includes('\0') || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unsafe XML');
    const root = new DOMParser({
      onError: (_level, message) => {
        throw new Error(message);
      },
    }).parseFromString(text, 'application/xml');
    for (const ns of wordNamespaces) {
      const elements = root.getElementsByTagNameNS(ns, '*');
      for (let i = 0; i < elements.length; i++) {
        const tag = elements.item(i)!.localName ?? '';
        review.revisions ||= revisionTags.has(tag);
        review.comments ||= commentTags.has(tag);
      }
    }
    checked.add(name);
    return text;
  }
  try {
    if (zip.entryCount > 500) throw new Error('Too many ZIP entries');
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject).once('end', resolve);
      zip.on('entry', (entry: Entry) => {
        const name = entry.fileName;
        const directory = name.endsWith('/');
        size += entry.uncompressedSize;
        const parts = name.replace(/\/$/u, '').split('/');
        if (
          names.has(name.toLowerCase()) ||
          parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0')) ||
          size > maxExpanded ||
          entry.isEncrypted() ||
          (directory && entry.uncompressedSize !== 0)
        ) {
          reject(new Error('Unsafe ZIP'));
          return;
        }
        names.add(name.toLowerCase());
        (zip as ZipWithLocalHeader).readLocalFileHeader(entry, (error, header) => {
          if (error) return reject(error);
          const central = (entry as Entry & { fileNameRaw: Buffer }).fileNameRaw;
          if (!central.equals(header.fileName) || !central.equals(Buffer.from(name, 'utf8')))
            return reject(new Error('Inconsistent ZIP entry name'));
          zip.openReadStream(entry, (error, stream) => {
            if (error) return reject(error);
            const chunks: Buffer[] = [];
            let crc = 0;
            stream.on('error', reject);
            stream.on('data', (chunk: Buffer) => {
              crc = crc32(chunk, crc);
              chunks.push(chunk);
            });
            stream.on('end', () => {
              try {
                if (crc !== entry.crc32) throw new Error('Invalid ZIP checksum');
                if (!directory && name !== 'mammoth/style-map') {
                  const data = Buffer.concat(chunks);
                  if (/\.(xml|rels)$/i.test(name)) xmlText(name, data);
                  entries.set(name, data);
                }
                zip.readEntry();
              } catch (error) {
                reject(error);
              }
            });
          });
        });
      });
      zip.readEntry();
    });
    if (!entries.has('[Content_Types].xml') || !entries.has('word/document.xml'))
      throw new Error('Missing DOCX parts');
    return {
      review,
      file: {
        exists: (name: string) => entries.has(name),
        async read(name: string, encoding?: string) {
          const data = entries.get(name);
          if (!data) throw new Error('Unvalidated DOCX part');
          // 关系可指向非标准扩展名；任何实际作为文本读取的部件仍须检查 XML。
          return encoding === 'base64'
            ? data.toString('base64')
            : encoding
              ? xmlText(name, data)
              : data;
        },
      },
    };
  } finally {
    zip.close();
  }
}

// Mammoth 1.13.0 的 openZip 支持 file adapter，类型声明只公开 path/buffer。
// 只提供通过预检的部件，避免 Mammoth 的第二套 ZIP 解析器看到额外或不同名的内容。
type CheckedMammothInput = { file: Awaited<ReturnType<typeof inspectZip>>['file'] };
const checkedHtml = convertToHtml as unknown as (
  input: CheckedMammothInput,
  options: Parameters<typeof convertToHtml>[1],
) => ReturnType<typeof convertToHtml>;
const checkedText = extractRawText as unknown as (
  input: CheckedMammothInput,
) => ReturnType<typeof extractRawText>;

parentPort?.once('message', async (input: { bytes: Uint8Array; semantic: boolean }) => {
  try {
    const buffer = Buffer.from(input.bytes);
    const { file, review } = await inspectZip(buffer);
    if (input.semantic) {
      const result = await checkedHtml(
        { file },
        {
          externalFileAccess: false,
          includeEmbeddedStyleMap: false,
          // 本轮只验文字和表格，图片继续留在固定原件。
          convertImage: images.imgElement(async () => ({ src: '' })),
        },
      );
      if (!result.value || result.value.length > 1_000_000) throw new Error('Invalid HTML extent');
      parentPort!.postMessage({ html: result.value, warningCount: result.messages.length });
      return;
    }
    const raw = await checkedText({ file });
    if (raw.value.length > 1_000_000) throw new Error('Unsupported DOCX text extent');
    const paragraphs = raw.value
      .split(/\n{2,}/u)
      .map((text) => text.trim())
      .filter(Boolean);
    if (
      !paragraphs.length ||
      paragraphs.length > 200 ||
      paragraphs.some((text) => text.length > 100_000)
    )
      throw new Error('Unsupported DOCX text extent');
    parentPort!.postMessage({ paragraphs, review });
  } catch {
    parentPort!.postMessage(null);
  }
});
