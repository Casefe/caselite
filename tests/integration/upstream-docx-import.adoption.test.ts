// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { convertToHtml } from 'mammoth';
import { sourceDocxProcessor } from './docx-source-worker';
import { docxFixture } from './docx-regression-fixture';
import {
  parseDocxDraft,
  encodeDocxDraft,
} from '../../apps/desktop/src/renderer/ui/DocxDraftPreview';
import { openTaskStore } from '../../packages/local-db/src/index';
import type { TaskResponse, DeliverySnapshot } from '../../packages/contracts/src';
import { renderSnapshotWord } from '../../apps/desktop/src/main/adapters/snapshot-word';

let worker: ReturnType<typeof sourceDocxProcessor>;
beforeAll(() => {
  worker = sourceDocxProcessor();
});
afterAll(() => worker?.dispose());
function good(result: TaskResponse) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}
function run(properties: string, text = '合成条款') {
  return `<w:p><w:r><w:rPr>${properties}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;
}

it.each(['single', 'double'])(
  'retains an active %s underline through the actual semantic worker',
  async (value) => {
    const result = await worker.api.readDocxSemanticHtml(
      docxFixture(run(`<w:u w:val="${value}"/>`)),
    );
    const parsed = parseDocxDraft(result.html);
    expect(parsed.html).toContain('<u>合成条款</u>');
  },
);
it.each(['none', 'false', '0'])(
  'does not invent underline when OOXML disables it with %s',
  async (value) => {
    const result = await worker.api.readDocxSemanticHtml(
      docxFixture(run(`<w:u w:val="${value}"/>`)),
    );
    expect(parseDocxDraft(result.html).html).toBe('<p>合成条款</p>');
  },
);
it('retains independently combined marks through DOCX, HTML, Yjs, SQLite restart and fixed Word export', async () => {
  const body = docxFixture(run('<w:b/><w:i/><w:strike/><w:u w:val="single"/>', '付款文字𠮷😀'));
  const original = createHash('sha256').update(body).digest('hex');
  const imported = await worker.api.readDocxSemanticHtml(body);
  const parsed = parseDocxDraft(imported.html);
  const state = encodeDocxDraft(parsed.json);
  const root = mkdtempSync(join(tmpdir(), 'caselite-docx-roundtrip-'));
  let store = openTaskStore(join(root, 'test.sqlite'), resolve('packages/local-db/migrations'));
  try {
    const task = good(
      store.execute({
        protocol_version: 1,
        operation: 'create',
        request_id: randomUUID(),
        idempotency_key: randomUUID(),
        title: '合成导入任务',
        objective: '',
      }),
    ).tasks[0];
    good(
      store.execute({
        protocol_version: 1,
        operation: 'save',
        request_id: randomUUID(),
        idempotency_key: randomUUID(),
        task_id: task.id,
        document_id: task.document_id,
        body_id: task.body_id,
        expected_revision: 0,
        editor_schema: 1,
        state,
      }),
    );
    store.close();
    store = openTaskStore(join(root, 'test.sqlite'), resolve('packages/local-db/migrations'));
    const reread = good(
      store.execute({ protocol_version: 1, operation: 'read', task_id: task.id }),
    );
    expect(reread.state).toEqual(state);
    const marks = parsed.json.content?.[0].content?.[0].marks?.map((mark) => mark.type).sort();
    expect(marks).toEqual(['bold', 'italic', 'strike', 'underline']);
    const snapshot: DeliverySnapshot = {
      id: randomUUID(),
      document_id: task.document_id,
      task_id: task.id,
      body_id: task.body_id,
      body_revision: 1,
      editor_schema: 1,
      metadata_version: 1,
      task_version: 1,
      title: task.title,
      collection: '',
      tags: [],
      note: '',
      content_sha256: createHash('sha256').update(Uint8Array.from(state)).digest('hex'),
      created_at: new Date().toISOString(),
      created_by: 'local',
      kind: 'draft',
      source_refs: [],
    };
    const exported = await renderSnapshotWord(snapshot, Uint8Array.from(reread.state!));
    const html = (await convertToHtml({ buffer: Buffer.from(exported) }, { styleMap: ['u => u'] }))
      .value;
    expect(html).toContain('付款文字𠮷😀');
    for (const tag of ['strong', 'em', 's', 'u']) expect(html).toContain(`<${tag}>`);
    expect(createHash('sha256').update(body).digest('hex')).toBe(original);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
it('never obeys an embedded mapping that would suppress the source paragraph', async () => {
  const result = await worker.api.readDocxSemanticHtml(
    docxFixture(run('', '保全的原文'), [{ name: 'mammoth/style-map', data: 'p => !' }]),
  );
  expect(parseDocxDraft(result.html).html).toBe('<p>保全的原文</p>');
});

it.each(['<w:ilvl w:val="0"/>', '<w:numId w:val="7"/>', ''])(
  'keeps text when numbering properties are incomplete: %s',
  async (properties) => {
    const xml = `<w:p><w:pPr><w:numPr>${properties}</w:numPr></w:pPr><w:r><w:t>不完整编号的文字</w:t></w:r></w:p>`;
    const result = await worker.api.readDocxSemanticHtml(docxFixture(xml));
    expect(parseDocxDraft(result.html).html).toContain('不完整编号的文字');
  },
);
it('keeps undefined paragraph styles as text and exposes a warning instead of throwing', async () => {
  const xml =
    '<w:p><w:pPr><w:pStyle w:val="NonexistentStyle"/></w:pPr><w:r><w:t>样式缺失但文字保全</w:t></w:r></w:p>';
  const result = await worker.api.readDocxSemanticHtml(docxFixture(xml));
  expect(parseDocxDraft(result.html).html).toContain('样式缺失但文字保全');
  expect(result.warningCount).toBeGreaterThan(0);
});
it('keeps VML textbox text while excluding the shape layout from the semantic body', async () => {
  const xml =
    '<w:p><w:r><w:pict><v:rect xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent><w:p><w:r><w:t>文本框中的条款</w:t></w:r></w:p></w:txbxContent></v:textbox></v:rect></w:pict></w:r></w:p>';
  const result = await worker.api.readDocxSemanticHtml(docxFixture(xml));
  expect(parseDocxDraft(result.html).html).toBe('<p>文本框中的条款</p>');
});
it('handles a deleted paragraph mark by retaining its text with the following paragraph', async () => {
  const xml =
    '<w:p><w:pPr><w:rPr><w:del/></w:rPr></w:pPr><w:r><w:t>前段文字</w:t></w:r></w:p><w:p><w:r><w:t>后段文字</w:t></w:r></w:p>';
  const result = await worker.api.readDocxSemanticHtml(docxFixture(xml));
  expect(parseDocxDraft(result.html).html).toBe('<p>前段文字后段文字</p>');
});
it('drops a tracked deleted table row and retains the surviving row text', async () => {
  const cell = (value: string) => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
  const xml = `<w:tbl><w:tr><w:trPr><w:del/></w:trPr>${cell('删除行文字')}</w:tr><w:tr>${cell('保留行文字')}</w:tr></w:tbl>`;
  const result = await worker.api.readDocxSemanticHtml(docxFixture(xml));
  const parsed = parseDocxDraft(result.html);
  expect(parsed.html).toContain('保留行文字');
  expect(parsed.html).not.toContain('删除行文字');
});
it('reports a missing VML image relationship without losing adjacent text', async () => {
  const xml =
    '<w:p><w:r><w:t>图旁原文</w:t><w:pict><v:imagedata xmlns:v="urn:schemas-microsoft-com:vml"/></w:pict></w:r></w:p>';
  const result = await worker.api.readDocxSemanticHtml(docxFixture(xml));
  expect(parseDocxDraft(result.html).html).toBe('<p>图旁原文</p>');
  expect(result.warningCount).toBeGreaterThan(0);
});
it('keeps a real table header row distinct from ordinary cells', async () => {
  const cell = (value: string) => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
  const result = await worker.api.readDocxSemanticHtml(
    docxFixture(
      `<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('标题')}</w:tr><w:tr>${cell('正文')}</w:tr></w:tbl>`,
    ),
  );
  const parsed = parseDocxDraft(result.html);
  expect(parsed.html).toContain('<th');
  expect(parsed.html).toContain('<td');
  expect(parsed.html).toContain('标题');
  expect(parsed.html).toContain('正文');
});
it.each([false, true])(
  'terminates cyclic numbering style links (two definitions: %s) while keeping text',
  async (two) => {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const xml =
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>循环编号正文</w:t></w:r></w:p>';
    const numbering = `<w:numbering xmlns:w="${ns}"><w:abstractNum w:abstractNumId="10"><w:numStyleLink w:val="LoopA"/></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>${two ? '<w:abstractNum w:abstractNumId="20"><w:numStyleLink w:val="LoopB"/></w:abstractNum><w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num>' : ''}</w:numbering>`;
    const styles = `<w:styles xmlns:w="${ns}"><w:style w:type="numbering" w:styleId="LoopA"><w:pPr><w:numPr><w:numId w:val="${two ? '2' : '1'}"/></w:numPr></w:pPr></w:style>${two ? '<w:style w:type="numbering" w:styleId="LoopB"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>' : ''}</w:styles>`;
    const result = await worker.api.readDocxSemanticHtml(
      docxFixture(xml, [
        { name: 'word/numbering.xml', data: numbering },
        { name: 'word/styles.xml', data: styles },
      ]),
    );
    expect(parseDocxDraft(result.html).html).toBe('<p>循环编号正文</p>');
  },
);
