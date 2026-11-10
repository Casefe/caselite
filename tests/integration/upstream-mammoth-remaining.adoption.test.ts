// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { convertToHtml } from 'mammoth';
import { createTaskApplication } from '../../packages/application/src';
import { openTaskStore } from '../../packages/local-db/src';
import type { TextPage, TaskResponse } from '../../packages/contracts/src';
import {
  parseDocxDraft,
  encodeDocxDraft,
} from '../../apps/desktop/src/renderer/ui/DocxDraftPreview';
import { renderSnapshotWord } from '../../apps/desktop/src/main/adapters/snapshot-word';
import { sourceDocxProcessor } from './docx-source-worker';
import { docxFixture, wordNamespace } from './docx-regression-fixture';

let worker: ReturnType<typeof sourceDocxProcessor>;
beforeAll(() => {
  worker = sourceDocxProcessor();
});
afterAll(() => worker?.dispose());
const relationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const officeRelationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const run = (text: string, properties = '') =>
  `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t>${text}</w:t></w:r>`;
const paragraph = (text: string, properties = '') =>
  `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${run(text)}</w:p>`;
const rels = (type: string, target: string) => ({
  name: 'word/_rels/document.xml.rels',
  data: `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="r1" Type="${officeRelationship}${type}" Target="${target}" TargetMode="External"/></Relationships>`,
});
async function textPages(bytes: Uint8Array) {
  const pages: TextPage[] = [];
  await worker.api.createDocxProcessor().process(bytes, {
    ocr: false,
    previous: [],
    signal: new AbortController().signal,
    onPage: (page) => {
      pages.push(page);
    },
  });
  return pages;
}
function good(result: TaskResponse) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});

it('preserves UTF-8 source text through the checked buffer worker without adding a host path', async () => {
  const bytes = docxFixture(paragraph('中文原文𠮷😀 &amp; &lt;待核&gt;'));
  expect((await textPages(bytes)).map((p) => p.text)).toEqual(['中文原文𠮷😀 & <待核>']);
  expect(parseDocxDraft((await worker.api.readDocxSemanticHtml(bytes)).html).html).toContain(
    '中文原文𠮷😀 &amp; &lt;待核&gt;',
  );
});

it.each([
  ['caps', '<w:caps/>'],
  ['small caps', '<w:smallCaps/>'],
  ['highlight', '<w:highlight w:val="yellow"/>'],
  ['shading', '<w:shd w:fill="FFEE00"/>'],
  ['font and color', '<w:rFonts w:ascii="Synthetic Font"/><w:color w:val="FF0000"/>'],
])(
  'keeps original letter case and text when simplifying %s presentation',
  async (_name, properties) => {
    const text = 'Abc ß 合成条款';
    const bytes = docxFixture(`<w:p>${run(text, properties)}</w:p>`);
    const preview = parseDocxDraft((await worker.api.readDocxSemanticHtml(bytes)).html);
    expect(preview.html).toBe(`<p>${text}</p>`);
    expect((await textPages(bytes))[0].text).toBe(text);
  },
);

it('reads a heading style without w:name and does not infer a heading from alignment or indentation', async () => {
  const styles = {
    name: 'word/styles.xml',
    data: `<w:styles xmlns:w="${wordNamespace}"><w:style w:type="paragraph" w:styleId="Heading1"/></w:styles>`,
  };
  const bytes = docxFixture(
    paragraph('明确标题', '<w:pStyle w:val="Heading1"/>') +
      paragraph('居中普通原文', '<w:jc w:val="center"/><w:ind w:left="720" w:firstLine="360"/>'),
    [styles],
  );
  const preview = parseDocxDraft((await worker.api.readDocxSemanticHtml(bytes)).html);
  expect(preview.json.content?.map((node) => node.type)).toEqual(['heading', 'paragraph']);
  expect(preview.json.content?.[0].attrs?.level).toBe(1);
  expect(preview.html).toContain('<p>居中普通原文</p>');
});

it.each([
  'https://example.invalid/synthetic',
  'javascript:synthetic()',
  'file:///synthetic/not-opened',
])(
  'keeps link label but excludes the untrusted %s destination from the editable draft',
  async (target) => {
    const link = `<w:p><w:hyperlink xmlns:r="${officeRelationship.slice(0, -1)}" r:id="r1">${run('原文链接标签')}</w:hyperlink></w:p>`;
    const preview = parseDocxDraft(
      (await worker.api.readDocxSemanticHtml(docxFixture(link, [rels('hyperlink', target)]))).html,
    );
    expect(preview.html).toBe('<p>原文链接标签</p>');
    expect(preview.html).not.toContain('href');
    expect(JSON.stringify(preview.json)).not.toContain(target);
  },
);

it.each([
  ' HYPERLINK "https://example.invalid/field" ',
  ' HYPERLINK https://example.invalid/unquoted ',
  ' HYPERLINK \\l "same-bookmark" ',
  ' CITATION SyntheticRef \\l 2052 ',
])(
  'retains complex-field display text while excluding instruction text: %s',
  async (instruction) => {
    const split = Math.floor(instruction.length / 2);
    const field = `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${instruction.slice(0, split)}</w:instrText></w:r><w:r><w:instrText>${instruction.slice(split)}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('字段显示原文')}<w:r><w:fldChar w:fldCharType="end"/></w:r>${run('字段后原文')}</w:p>`;
    const bytes = docxFixture(field);
    const preview = parseDocxDraft((await worker.api.readDocxSemanticHtml(bytes)).html);
    expect(preview.html).toBe('<p>字段显示原文字段后原文</p>');
    expect((await textPages(bytes))[0].text).toBe('字段显示原文字段后原文');
  },
);

it('does not turn repeated Word bookmarks into editable HTML IDs or trusted source anchors', async () => {
  const body =
    '<w:p><w:bookmarkStart w:id="1" w:name="same-bookmark"/>' +
    run('第一处') +
    '<w:bookmarkEnd w:id="1"/><w:bookmarkStart w:id="2" w:name="same-bookmark"/>' +
    run('第二处') +
    '<w:bookmarkEnd w:id="2"/></w:p>';
  const preview = parseDocxDraft((await worker.api.readDocxSemanticHtml(docxFixture(body))).html);
  expect(preview.html).toBe('<p>第一处第二处</p>');
  expect(JSON.stringify(preview.json)).not.toContain('same-bookmark');
});

it('keeps a Word paragraph id out of editable HTML and source metadata', async () => {
  const bytes = docxFixture(
    `<w:p xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w14:paraId="001A2B3C">${run('段落身份仍以CaseLite为准')}</w:p>`,
  );
  const preview = parseDocxDraft((await worker.api.readDocxSemanticHtml(bytes)).html);
  expect(preview.html).toBe('<p>段落身份仍以CaseLite为准</p>');
  expect(JSON.stringify(preview.json)).not.toContain('001A2B3C');
});

it.each(['footnote', 'endnote'])(
  'keeps referenced %s text in the semantic draft without inventing source metadata',
  async (kind) => {
    const note = {
      name: `word/${kind}s.xml`,
      data: `<w:${kind}s xmlns:w="${wordNamespace}"><w:${kind} w:id="2">${paragraph('合成注释正文')}</w:${kind}></w:${kind}s>`,
    };
    const bytes = docxFixture(
      `<w:p>${run('主体原文')}<w:r><w:${kind}Reference w:id="2"/></w:r></w:p>`,
      [note],
    );
    const preview = parseDocxDraft((await worker.api.readDocxSemanticHtml(bytes)).html);
    expect(preview.html).toContain('主体原文');
    expect(preview.html).toContain('合成注释正文');
    expect(preview.html).not.toMatch(/href=|id=|data-/);
  },
);

it('flags comment ranges and comment metadata without importing author or date as editable body facts', async () => {
  const bytes = docxFixture(
    `<w:p><w:commentRangeStart w:id="1"/>${run('需要核原件的正文')}<w:commentRangeEnd w:id="1"/></w:p>`,
    [
      {
        name: 'word/comments.xml',
        data: `<w:comments xmlns:w="${wordNamespace}"><w:comment w:id="1" w:author="SyntheticAuthor" w:date="2026-01-01T00:00:00Z">${paragraph('批注内容')}</w:comment></w:comments>`,
      },
    ],
  );
  const pages = await textPages(bytes);
  expect(pages[0]).toMatchObject({ text: '需要核原件的正文', docx_review: { comments: true } });
  const preview = parseDocxDraft((await worker.api.readDocxSemanticHtml(bytes)).html);
  expect(preview.html).toBe('<p>需要核原件的正文</p>');
});

it('keeps body text and fixed input bytes when header/footer relationships are present', async () => {
  const bytes = docxFixture(paragraph('主体条款'), [
    {
      name: 'word/header1.xml',
      data: `<w:hdr xmlns:w="${wordNamespace}">${paragraph('合成页眉')}</w:hdr>`,
    },
    {
      name: 'word/footer1.xml',
      data: `<w:ftr xmlns:w="${wordNamespace}">${paragraph('合成页脚')}</w:ftr>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="header" Type="${officeRelationship}header" Target="header1.xml"/><Relationship Id="footer" Type="${officeRelationship}footer" Target="footer1.xml"/></Relationships>`,
    },
  ]);
  const hash = createHash('sha256').update(bytes).digest('hex');
  expect(parseDocxDraft((await worker.api.readDocxSemanticHtml(bytes)).html).html).toBe(
    '<p>主体条款</p>',
  );
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
});

it('keeps image-adjacent text and excludes linked external image bytes and title from the draft', async () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-docx-external-probe-'));
  try {
    const sentinel = 'SYNTHETIC_EXTERNAL_BYTES_MUST_NOT_APPEAR';
    const image = join(root, 'image.png');
    writeFileSync(image, sentinel);
    const bytes = docxFixture(
      `<w:p>${run('图前条款')}<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Synthetic Image" title="Synthetic Image Title"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip xmlns:r="${officeRelationship.slice(0, -1)}" r:link="r1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>${run('图后条款')}</w:p>`,
      [rels('image', pathToFileURL(image).href)],
    );
    const result = await worker.api.readDocxSemanticHtml(bytes);
    expect(result.html).not.toContain(Buffer.from(sentinel).toString('base64'));
    expect(parseDocxDraft(result.html).html).toBe('<p>图前条款图后条款</p>');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  ['Wingdings', 'F0FC', '✓'],
  ['SyntheticUnsupportedFont', 'F0FC', ''],
])(
  'uses current symbol mapping for %s and warns rather than guessing unknown fonts',
  async (font, char, symbol) => {
    const bytes = docxFixture(
      `<w:p>${run('符号前')}<w:r><w:sym w:font="${font}" w:char="${char}"/></w:r>${run('符号后')}</w:p>`,
    );
    const result = await worker.api.readDocxSemanticHtml(bytes);
    expect(parseDocxDraft(result.html).html).toBe(`<p>符号前${symbol}符号后</p>`);
    expect(result.warningCount > 0).toBe(symbol === '');
  },
);

it.each([
  [
    'math',
    '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x</m:t></m:r></m:oMath>',
  ],
  [
    'ruby',
    '<w:ruby><w:rt><w:r><w:t>zhu</w:t></w:r></w:rt><w:rubyBase><w:r><w:t>注</w:t></w:r></w:rubyBase></w:ruby>',
  ],
])(
  'exposes a parser warning for unsupported %s and retains surrounding text',
  async (_name, unsupported) => {
    const result = await worker.api.readDocxSemanticHtml(
      docxFixture(`<w:p>${run('前文')}${unsupported}${run('后文')}</w:p>`),
    );
    expect(result.warningCount).toBeGreaterThan(0);
    const html = parseDocxDraft(result.html).html;
    expect(html).toContain('前文');
    expect(html).toContain('后文');
  },
);

it('keeps a page-break-before paragraph as body text and does not replace it with a horizontal rule', async () => {
  const preview = parseDocxDraft(
    (
      await worker.api.readDocxSemanticHtml(
        docxFixture(paragraph('分页前文字') + paragraph('分页后文字', '<w:pageBreakBefore/>')),
      )
    ).html,
  );
  expect(preview.html).toBe('<p>分页前文字</p><p>分页后文字</p>');
});

it('keeps table cells while excluding unsupported table style, vertical alignment and width metadata', async () => {
  const cell = (text: string) =>
    `<w:tc><w:tcPr><w:vAlign w:val="center"/><w:tcW w:w="1440" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc>`;
  const bytes = docxFixture(
    `<w:tbl><w:tblPr><w:tblStyle w:val="SyntheticTable"/></w:tblPr><w:tr>${cell('左格条款')}${cell('右格条款')}</w:tr></w:tbl>`,
  );
  const hash = createHash('sha256').update(bytes).digest('hex');
  const result = await worker.api.readDocxSemanticHtml(bytes);
  expect(result.warningCount).toBeGreaterThan(0);
  const preview = parseDocxDraft(result.html);
  const table = new DOMParser().parseFromString(preview.html, 'text/html').querySelector('table')!;
  expect([...table.querySelectorAll('td')].map((element) => element.textContent)).toEqual([
    '左格条款',
    '右格条款',
  ]);
  expect(table.querySelector('[valign],[width],[data-table-grid]')).toBeNull();
  expect((await textPages(bytes)).map((page) => page.text)).toEqual(['左格条款', '右格条款']);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
});

it('retains a real styles part and follows a nonstandard styles relationship before using a default', async () => {
  const styles = `<w:styles xmlns:w="${wordNamespace}"><w:style w:type="paragraph" w:styleId="ExplicitTitle"><w:name w:val="Heading 1"/></w:style></w:styles>`;
  const bytes = docxFixture(paragraph('真实关系标题', '<w:pStyle w:val="ExplicitTitle"/>'), [
    { name: 'word/styles/custom.style', data: styles },
    {
      name: 'word/_rels/document.xml.rels',
      data: `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="styles" Type="${officeRelationship}styles" Target="styles/custom.style"/></Relationships>`,
    },
  ]);
  const preview = parseDocxDraft((await worker.api.readDocxSemanticHtml(bytes)).html);
  expect(preview.json.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
  expect(preview.html).toContain('真实关系标题');
});

it('uses an existing standard styles part instead of replacing its known table style with a default', async () => {
  const styles = `<w:styles xmlns:w="${wordNamespace}"><w:style w:type="table" w:styleId="KnownTable"><w:name w:val="Normal Table"/></w:style></w:styles>`;
  const bytes = docxFixture(
    `<w:tbl><w:tblPr><w:tblStyle w:val="KnownTable"/></w:tblPr><w:tr><w:tc>${paragraph('已知样式单元格')}</w:tc></w:tr></w:tbl>`,
    [{ name: 'word/styles.xml', data: styles }],
  );
  const result = await worker.api.readDocxSemanticHtml(bytes);
  expect(result.warningCount).toBe(0);
  expect(parseDocxDraft(result.html).html).toContain('已知样式单元格');
});

it('keeps the first existing nonstandard styles target when an earlier relationship points to a missing standard part', async () => {
  const bytes = docxFixture(paragraph('有效关系标题', '<w:pStyle w:val="RelatedHeading"/>'), [
    {
      name: 'word/custom.style',
      data: `<w:styles xmlns:w="${wordNamespace}"><w:style w:type="paragraph" w:styleId="RelatedHeading"><w:name w:val="Heading 1"/></w:style></w:styles>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="missing" Type="${officeRelationship}styles" Target="styles.xml"/><Relationship Id="existing" Type="${officeRelationship}styles" Target="custom.style"/></Relationships>`,
    },
  ]);
  const preview = parseDocxDraft((await worker.api.readDocxSemanticHtml(bytes)).html);
  expect(preview.json.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
  expect(preview.html).toContain('有效关系标题');
});

it('does not hide a malformed nonstandard styles target behind a generated standard part', async () => {
  const bytes = docxFixture(paragraph('坏部件必须报错'), [
    {
      name: 'word/custom.style',
      data: `<w:styles xmlns:w="${wordNamespace}"><w:style></w:styles>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="missing" Type="${officeRelationship}styles" Target="styles.xml"/><Relationship Id="bad" Type="${officeRelationship}styles" Target="custom.style"/></Relationships>`,
    },
  ]);
  await expect(worker.api.readDocxSemanticHtml(bytes)).rejects.toThrow();
});

it.each([
  `${officeRelationship}styles`,
  'http://purl.oclc.org/ooxml/officeDocument/relationships/styles',
])(
  'keeps a broken prefixed styles declaration explicit rather than guessing a default: %s',
  async (type) => {
    const bytes = docxFixture(
      `<w:tbl><w:tblPr><w:tblStyle w:val="MissingStyle"/></w:tblPr><w:tr><w:tc>${paragraph('关系断裂需核原件')}</w:tc></w:tr></w:tbl>`,
      [
        {
          name: 'word/_rels/document.xml.rels',
          data: `<pr:Relationships xmlns:pr="${relationshipNamespace}"><pr:Relationship Id="missing" Type="${type}" Target="unavailable.style"/></pr:Relationships>`,
        },
      ],
    );
    await expect(worker.api.readDocxSemanticHtml(bytes)).rejects.toThrow();
  },
);

it.each(['word/styles.xml', 'word/styles/custom.style'])(
  'rejects malformed existing %s rather than masking it with a generated default',
  async (path) => {
    const bytes = docxFixture(paragraph('格式错误不可伪称可用', '<w:pStyle w:val="Synthetic"/>'), [
      { name: path, data: `<w:styles xmlns:w="${wordNamespace}"><w:style></w:styles>` },
      {
        name: 'word/_rels/document.xml.rels',
        data: `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="styles" Type="${officeRelationship}styles" Target="${path.slice('word/'.length)}"/></Relationships>`,
      },
    ]);
    await expect(worker.api.readDocxSemanticHtml(bytes)).rejects.toThrow();
    const pages: TextPage[] = [];
    await expect(
      worker.api.createDocxProcessor().process(bytes, {
        ocr: false,
        previous: [],
        signal: new AbortController().signal,
        onPage: (page) => {
          pages.push(page);
        },
      }),
    ).rejects.toThrow();
    expect(pages).toEqual([]);
  },
);

it.each(['decimal', 'upperRoman', 'lowerLetter'])(
  'keeps paragraph-style-linked %s list structure using the current installed reader',
  async (format) => {
    const styles = {
      name: 'word/styles.xml',
      data: `<w:styles xmlns:w="${wordNamespace}"><w:style w:type="paragraph" w:styleId="LegalList"><w:name w:val="Synthetic List"/></w:style></w:styles>`,
    };
    const numbering = {
      name: 'word/numbering.xml',
      data: `<w:numbering xmlns:w="${wordNamespace}"><w:abstractNum w:abstractNumId="42"><w:lvl w:ilvl="0"><w:numFmt w:val="${format}"/><w:pStyle w:val="LegalList"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="42"/></w:num></w:numbering>`,
    };
    const bytes = docxFixture(
      paragraph('第一条', '<w:pStyle w:val="LegalList"/>') +
        paragraph('第二条', '<w:pStyle w:val="LegalList"/>'),
      [styles, numbering],
    );
    const preview = parseDocxDraft((await worker.api.readDocxSemanticHtml(bytes)).html);
    expect(preview.json.content?.[0].type).toBe('orderedList');
    expect(preview.html.indexOf('第一条')).toBeLessThan(preview.html.indexOf('第二条'));
    expect(preview.html).not.toContain('style=');
  },
);

it('isolates concurrent conversions and returns fresh results after a rejected document', async () => {
  await expect(
    worker.api.readDocxSemanticHtml(Buffer.from('synthetic invalid DOCX')),
  ).rejects.toThrow();
  const results = await Promise.all(
    ['甲份唯一条款', '乙份唯一条款'].map((text) =>
      worker.api.readDocxSemanticHtml(docxFixture(paragraph(text))),
    ),
  );
  expect(results.map((result) => parseDocxDraft(result.html).html)).toEqual([
    '<p>甲份唯一条款</p>',
    '<p>乙份唯一条款</p>',
  ]);
});

it('persists the imported body, creates a real fixed snapshot and exports that snapshot after later edits and reopen', async () => {
  const bytes = docxFixture(
    paragraph('固定条款标题') + `<w:p>${run('甲项')}<w:r><w:br/></w:r>${run('乙项')}</w:p>`,
  );
  const imported = parseDocxDraft((await worker.api.readDocxSemanticHtml(bytes)).html);
  expect(imported.html).toContain('<br>');
  const state = encodeDocxDraft(imported.json);
  const root = mkdtempSync(join(tmpdir(), 'caselite-mammoth-snapshot-'));
  const database = join(root, 'test.sqlite');
  let store = openTaskStore(database, resolve('packages/local-db/migrations'));
  try {
    let application = createTaskApplication(store);
    const task = good(
      application.execute({
        ...identity(),
        operation: 'create',
        title: '合成固定稿',
        objective: '',
      }),
    ).tasks[0];
    const saved = good(
      application.execute({
        ...identity(),
        operation: 'save',
        task_id: task.id,
        document_id: task.document_id,
        body_id: task.body_id,
        expected_revision: 0,
        editor_schema: 1,
        state,
      }),
    ).tasks[0];
    const snapshot = good(
      application.execute({
        ...identity(),
        operation: 'create_snapshot',
        task_id: task.id,
        document_id: task.document_id,
        body_id: task.body_id,
        expected_revision: 1,
        expected_metadata_version: saved.document_metadata_version,
        expected_task_version: saved.version,
        note: '合成回归快照',
      }),
    ).snapshots![0];
    const later = encodeDocxDraft(parseDocxDraft('<p>稍后编辑的新正文</p>').json);
    good(
      application.execute({
        ...identity(),
        operation: 'save',
        task_id: task.id,
        document_id: task.document_id,
        body_id: task.body_id,
        expected_revision: 1,
        editor_schema: 1,
        state: later,
      }),
    );
    store.close();
    store = openTaskStore(database, resolve('packages/local-db/migrations'));
    application = createTaskApplication(store);
    const fixed = good(
      application.execute({
        protocol_version: 1,
        operation: 'read_snapshot',
        task_id: task.id,
        document_id: task.document_id,
        snapshot_id: snapshot.id,
      }),
    );
    expect(fixed.state).toEqual(state);
    expect(fixed.snapshots![0]).toEqual(snapshot);
    const output = await renderSnapshotWord(snapshot, Uint8Array.from(fixed.state!));
    const html = (await convertToHtml({ buffer: Buffer.from(output) })).value;
    expect(html).toContain('固定条款标题');
    expect(html).toContain('甲项<br />乙项');
    expect(html).not.toContain('稍后编辑的新正文');
    expect(createHash('sha256').update(Uint8Array.from(fixed.state!)).digest('hex')).toBe(
      snapshot.content_sha256,
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
