import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { validateBody } from './body-schema';

function paragraph(value = '条款') {
  const node = new Y.XmlElement('paragraph');
  if (value) {
    const text = new Y.XmlText();
    text.insert(0, value);
    node.insert(0, [text]);
  }
  return node;
}

function cell(
  children: Y.XmlElement[],
  attrs: Record<string, unknown> = {},
  name: 'tableCell' | 'tableHeader' = 'tableCell',
) {
  const node = new Y.XmlElement<Record<string, unknown>>(name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (children.length) node.insert(0, children);
  return node;
}

function row(children: Array<Y.XmlElement | Y.XmlText>) {
  const node = new Y.XmlElement('tableRow');
  if (children.length) node.insert(0, children);
  return node;
}

function table(rows: Y.XmlElement[]) {
  const node = new Y.XmlElement('table');
  if (rows.length) node.insert(0, rows);
  return node;
}

function state(blocks: Y.XmlElement[]) {
  const doc = new Y.Doc();
  doc.getXmlFragment('default').insert(0, blocks);
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return bytes;
}

function grid(rows: Y.XmlElement[][]) {
  return state([table(rows.map((cells) => row(cells)))]);
}

const one = (attrs?: Record<string, unknown>) => grid([[cell([paragraph('甲')], attrs)]]);

it('accepts a rectangular header, zero column width, and a table inside a blockquote', () => {
  expect(() =>
    validateBody(
      grid([[cell([paragraph('表头')], { colwidth: [0], align: 'center' }, 'tableHeader')]]),
      true,
    ),
  ).not.toThrow();
  const quote = new Y.XmlElement('blockquote');
  quote.insert(0, [table([row([cell([paragraph('引用中的表')])])])]);
  expect(() => validateBody(state([quote]), true)).not.toThrow();
  expect(() =>
    validateBody(grid([[cell([paragraph('甲')]), cell([paragraph('乙')])]]), true),
  ).not.toThrow();
  expect(() => validateBody(one(), true)).not.toThrow();
  expect(() => validateBody(one({ align: 'justify', colwidth: [0] }), true)).not.toThrow();
});

it('rejects nested, overlapping, and structurally illegal tables', () => {
  const inner = table([row([cell([paragraph('内嵌')])])]);
  const cases: Array<[string, Uint8Array]> = [
    ['Nested table', grid([[cell([paragraph('外层'), inner])]])],
    [
      'Overlapping table cells',
      grid([
        [cell([paragraph('甲')]), cell([paragraph('乙')], { rowspan: 2 })],
        [cell([paragraph('丙')], { colspan: 2 })],
      ]),
    ],
    ['Invalid cell alignment', one({ align: 'middle' })],
    ['Invalid column widths', one({ colwidth: [10001] })],
    ['Invalid column widths', one({ colwidth: [40, 40] })],
    ['Empty table cell', grid([[cell([])]])],
    ['Invalid table row', state([table([paragraph('不是行')])])],
    ['Invalid table cell', grid([[paragraph('不是单元格')]])],
    ['Invalid table cell', state([table([row([new Y.XmlText()])])])],
    ['Invalid table height', state([table([])])],
    ['Invalid table height', grid(Array.from({ length: 201 }, () => [cell([paragraph('行')])]))],
    ['Invalid table span', grid([Array.from({ length: 101 }, () => cell([paragraph('列')]))])],
  ];
  for (const [message, bytes] of cases) expect(() => validateBody(bytes, true)).toThrow(message);
  expect(() => validateBody(one(), false)).toThrow('Table is outside the supported body scope');
  expect(() =>
    validateBody(grid([Array.from({ length: 100 }, () => cell([paragraph('列')]))]), true),
  ).not.toThrow();
  expect(() =>
    validateBody(grid(Array.from({ length: 200 }, () => [cell([paragraph('行')])])), true),
  ).not.toThrow();
});
