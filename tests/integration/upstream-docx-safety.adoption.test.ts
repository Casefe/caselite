import { afterAll, beforeAll, expect, it } from 'vitest';
import { extractRawText } from 'mammoth';
import { inspectZip } from '../../apps/desktop/src/main/adapters/docx-worker';
import { documentXml, docxFixture, storedZip, wordNamespace } from './docx-regression-fixture';
import { sourceDocxProcessor } from './docx-source-worker';

let worker: ReturnType<typeof sourceDocxProcessor>;
beforeAll(() => {
  worker = sourceDocxProcessor();
});
afterAll(() => worker?.dispose());
const body = '<w:p><w:r><w:t>合成正文</w:t></w:r></w:p>';

it('rejects a wrong CRC that raw Mammoth accepts, so replacing preflight with buffer conversion is unsafe', async () => {
  const bytes = storedZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: documentXml(body), checksum: 0 },
  ]);
  expect((await extractRawText({ buffer: bytes })).value).toContain('合成正文');
  await expect(inspectZip(bytes)).rejects.toThrow('Invalid ZIP checksum');
  await expect(worker.api.readDocxSemanticHtml(bytes)).rejects.toThrow('Invalid DOCX');
});
it.each(['word/document.xml', 'WORD/DOCUMENT.XML'])(
  'rejects a duplicate/case-colliding %s part instead of choosing a winner',
  async (name) => {
    await expect(
      inspectZip(docxFixture(body, [{ name, data: documentXml(body) }])),
    ).rejects.toThrow('Unsafe ZIP');
  },
);
it('rejects encrypted entries before conversion', async () => {
  await expect(
    inspectZip(docxFixture(body, [{ name: 'encrypted.bin', data: 'synthetic', flags: 0x801 }])),
  ).rejects.toThrow('Unsafe ZIP');
});
it.each([
  '../outside.xml',
  'word/../document.xml',
  'word/./alternate.xml',
  '/absolute.xml',
  'word\\alternate.xml',
])('refuses an unsafe archive path %s', async (name) => {
  await expect(inspectZip(docxFixture(body, [{ name, data: '<root/>' }]))).rejects.toThrow();
});
it.each([
  '<!DOCTYPE root [<!ENTITY named "synthetic">]><root>&named;</root>',
  '<!ENTITY named "synthetic"><root/>',
  '<root>\0</root>',
  '<root><child></root>',
])('refuses unsafe or malformed XML in additional parts: %s', async (data) => {
  await expect(
    inspectZip(docxFixture(body, [{ name: 'word/additional.xml', data }])),
  ).rejects.toThrow();
});
it('rejects invalid UTF8 before the dependency can replace invalid bytes', async () => {
  await expect(
    inspectZip(
      docxFixture(body, [{ name: 'word/additional.xml', data: Buffer.from([0xff, 0xfe, 0xc0]) }]),
    ),
  ).rejects.toThrow();
});

it('accepts UTF8 BOM in the main XML part without inventing visible text', async () => {
  const bytes = storedZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: '\uFEFF' + documentXml(body) },
  ]);
  const pages: string[] = [];
  await worker.api.createDocxProcessor().process(bytes, {
    signal: new AbortController().signal,
    ocr: false,
    previous: [],
    onPage: (page) => pages.push(page.text),
  });
  expect(pages).toEqual(['合成正文']);
});
it('accepts exactly 500 entries but rejects 501 without returning a partial adapter', async () => {
  const extra = Array.from({ length: 498 }, (_, i) => ({ name: `data/${i}.txt`, data: '' }));
  const valid = await inspectZip(docxFixture(body, extra));
  expect(valid.file.exists('data/497.txt')).toBe(true);
  await expect(
    inspectZip(docxFixture(body, [...extra, { name: 'data/over.txt', data: '' }])),
  ).rejects.toThrow('Too many ZIP entries');
});
it.each([wordNamespace, 'http://purl.oclc.org/ooxml/wordprocessingml/main'])(
  'detects tracked changes and comments by namespace URI, including %s',
  async (namespace) => {
    const xml = `<a:document xmlns:a="${namespace}"><a:body><a:p><a:ins><a:r><a:t>新文字</a:t></a:r></a:ins><a:commentReference a:id="1"/></a:p></a:body></a:document>`;
    const parsed = await inspectZip(
      storedZip([
        { name: '[Content_Types].xml', data: '<Types/>' },
        { name: 'word/document.xml', data: xml },
      ]),
    );
    expect(parsed.review).toEqual({ revisions: true, comments: true });
  },
);
it('does not flag similarly named nodes in an unrelated namespace as Word review data', async () => {
  const parsed = await inspectZip(
    docxFixture(body, [
      { name: 'custom.xml', data: '<root xmlns:x="urn:unrelated"><x:ins/><x:comment/></root>' },
    ]),
  );
  expect(parsed.review).toEqual({ revisions: false, comments: false });
});
it('surfaces review flags in real worker text results while keeping deleted words out of accepted text', async () => {
  const bytes = docxFixture(
    '<w:p><w:del><w:r><w:delText>删除标记文字</w:delText></w:r></w:del><w:ins><w:r><w:t>当前文字</w:t></w:r></w:ins><w:commentReference w:id="1"/></w:p>',
  );
  const pages: Array<{ text: string; docx_review?: { revisions: boolean; comments: boolean } }> =
    [];
  await worker.api.createDocxProcessor().process(bytes, {
    signal: new AbortController().signal,
    ocr: false,
    previous: [],
    onPage: (page) => pages.push(page),
  });
  expect(pages).toHaveLength(1);
  expect(pages[0].text).toBe('当前文字');
  expect(pages[0].docx_review).toEqual({ revisions: true, comments: true });
});
it('rejects a pre-cancelled actual processor request without emitting any page', async () => {
  const controller = new AbortController();
  controller.abort();
  const pages: unknown[] = [];
  await expect(
    worker.api.createDocxProcessor().process(docxFixture(body), {
      signal: controller.signal,
      ocr: false,
      previous: [],
      onPage: (page) => pages.push(page),
    }),
  ).rejects.toThrow('CANCELLED');
  expect(pages).toEqual([]);
});
