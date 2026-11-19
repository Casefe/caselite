import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { validateBody } from './body-schema';

function cell(text: string, attrs?: Record<string, unknown>) {
  const cellNode = new Y.XmlElement('tableCell');
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) cellNode.setAttribute(key, value as never);
  }
  const paragraph = new Y.XmlElement('paragraph');
  const content = new Y.XmlText();
  content.insert(0, text);
  paragraph.insert(0, [content]);
  cellNode.insert(0, [paragraph]);
  return cellNode;
}

function tableFromRows(rows: Y.XmlElement[]) {
  const table = new Y.XmlElement('table');
  table.insert(0, rows);
  const doc = new Y.Doc();
  doc.getXmlFragment('default').insert(0, [table]);
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

function validTableState() {
  const row = new Y.XmlElement('tableRow');
  row.insert(0, [cell('已提交单元格', { colwidth: [0] })]);
  return tableFromRows([row]);
}

describe('validateBody table scope and geometry', () => {
  it('accepts colwidth zero as the read-compat baseline for committed task bodies', () => {
    expect(() => validateBody(validTableState(), true)).not.toThrow();
    expect(validateBody(validTableState(), true)).toBe(true);
  });

  it('rejects tables outside consumers that disallow them while still reading legal paragraphs', () => {
    expect(() => validateBody(validTableState(), false)).toThrow(
      'Table is outside the supported body scope',
    );
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    text.insert(0, '项目说明');
    paragraph.insert(0, [text]);
    doc.getXmlFragment('default').insert(0, [paragraph]);
    const state = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    expect(() => validateBody(state)).not.toThrow();
  });

  it.each([
    [
      'Invalid table height',
      () => {
        const rows = Array.from({ length: 201 }, () => {
          const row = new Y.XmlElement('tableRow');
          row.insert(0, [cell('行')]);
          return row;
        });
        return tableFromRows(rows);
      },
    ],
    [
      'Overlapping table cells',
      () => {
        const first = new Y.XmlElement('tableRow');
        first.insert(0, [cell('甲'), cell('乙', { rowspan: 2 })]);
        const second = new Y.XmlElement('tableRow');
        second.insert(0, [cell('丙', { colspan: 2 })]);
        return tableFromRows([first, second]);
      },
    ],
    [
      'Empty table cell',
      () => {
        const empty = new Y.XmlElement('tableCell');
        const row = new Y.XmlElement('tableRow');
        row.insert(0, [empty]);
        return tableFromRows([row]);
      },
    ],
    [
      'Invalid column widths',
      () => {
        const row = new Y.XmlElement('tableRow');
        row.insert(0, [cell('宽', { colwidth: [0, 1] })]);
        return tableFromRows([row]);
      },
    ],
    [
      'Invalid table span',
      () => {
        const row = new Y.XmlElement('tableRow');
        row.insert(0, [cell('越界', { colspan: 101 })]);
        return tableFromRows([row]);
      },
    ],
    [
      'Incomplete table grid',
      () => {
        const first = new Y.XmlElement('tableRow');
        first.insert(0, [cell('甲', { colspan: 2 })]);
        const second = new Y.XmlElement('tableRow');
        second.insert(0, [cell('乙')]);
        return tableFromRows([first, second]);
      },
    ],
    [
      'Unsupported node attribute',
      () => {
        const row = new Y.XmlElement('tableRow');
        row.insert(0, [cell('属性', { 'data-hostile': '1' })]);
        return tableFromRows([row]);
      },
    ],
  ])('refuses %s before persistence', (message, build) => {
    expect(() => validateBody(build(), true)).toThrow(message);
  });
});
