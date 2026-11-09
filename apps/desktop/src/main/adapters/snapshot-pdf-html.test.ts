import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { randomUUID } from 'node:crypto';
import type { DeliverySnapshot } from '@caselite/contracts';
import { renderSnapshotPdfHtml } from './snapshot-pdf-html';

const element = (
  name: string,
  children: Array<Y.XmlElement | Y.XmlText> = [],
  attrs: Record<string, unknown> = {},
) => {
  const node = new Y.XmlElement(name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value as string));
  node.insert(0, children);
  return node;
};
const text = (value: string) => {
  const node = new Y.XmlText();
  node.insert(0, value);
  return node;
};
const paragraph = (value: string) => element('paragraph', [text(value)]);
const snapshot: DeliverySnapshot = {
  id: randomUUID(),
  task_id: randomUUID(),
  document_id: randomUUID(),
  body_id: randomUUID(),
  body_revision: 1,
  editor_schema: 1,
  metadata_version: 1,
  task_version: 1,
  title: '<合成付款合同>',
  collection: '',
  tags: [],
  note: '',
  content_sha256: 'a'.repeat(64),
  created_at: new Date().toISOString(),
  created_by: 'local',
  kind: 'draft',
  source_refs: [],
};
function render(nodes: Y.XmlElement[], selected = snapshot) {
  const doc = new Y.Doc();
  doc.getXmlFragment('default').insert(0, nodes);
  try {
    return renderSnapshotPdfHtml(selected, Y.encodeStateAsUpdate(doc), 'a'.repeat(32));
  } finally {
    doc.destroy();
  }
}
it('escapes title and body, keeps numbering, marks and merged cells in a script-free print projection', () => {
  const bold = new Y.XmlText();
  bold.insert(0, '付款<十日>', { bold: {} });
  const html = render([
    element('heading', [text('中文标题')], { level: 2 }),
    element('paragraph', [bold]),
    paragraph('<script>alert(1)</script>'),
    element('orderedList', [element('listItem', [paragraph('第三项')])], { start: 3, type: '1' }),
    element('table', [
      element('tableRow', [
        element('tableHeader', [paragraph('合并表头')], { colspan: 2, colwidth: [0, 0] }),
      ]),
      element('tableRow', [
        element('tableCell', [paragraph('交付')], { rowspan: 2 }),
        element('tableCell', [paragraph('五日')]),
      ]),
      element('tableRow', [element('tableCell', [paragraph('十日')])]),
    ]),
  ]);
  expect(html).toContain('&lt;合成付款合同&gt;');
  expect(html).toContain('<strong>付款&lt;十日&gt;</strong>');
  expect(html).not.toContain('<script>');
  expect(html).toContain("script-src 'none'");
  expect(html).toContain('<ol start="3" type="1">');
  expect(html).toContain('<thead>');
  expect(html).toContain('colspan="2"');
  expect(html).toContain('rowspan="2"');
  expect(html).toContain(snapshot.id);
  expect(html).toContain('正文修订 1');
});
it('rejects unapproved sources, nodes, sized cells and malformed lists instead of silently dropping content', () => {
  expect(() => render([element('image')])).toThrow();
  expect(() =>
    render([paragraph('正文')], { ...snapshot, source_refs: [{}] } as unknown as DeliverySnapshot),
  ).toThrow();
  expect(() => render([paragraph('非法\u0001文字')])).toThrow();
  expect(() =>
    render([element('orderedList', [element('listItem', [paragraph('一')])], { start: 0 })]),
  ).toThrow();
  expect(() =>
    render([
      element('table', [
        element('tableRow', [element('tableCell', [paragraph('内容')], { colwidth: [120] })]),
      ]),
    ]),
  ).toThrow();
});

it('keeps intentional radicals distinct and selects the legacy font only for old converter intents', () => {
  const doc = new Y.Doc();
  doc.getXmlFragment('default').insert(0, [paragraph('十日和⼗⽇必须分别保留')]);
  try {
    const state = Y.encodeStateAsUpdate(doc);
    const current = renderSnapshotPdfHtml(snapshot, state, 'a'.repeat(32));
    expect(current).toContain('十日和⼗⽇必须分别保留');
    expect(current).toContain('Arial Unicode MS');
    const legacy = renderSnapshotPdfHtml(snapshot, state, 'a'.repeat(32), true);
    expect(legacy).toContain('STSongti-SC-Regular');
    expect(legacy).not.toContain('Arial Unicode MS');
  } finally {
    doc.destroy();
  }
});
