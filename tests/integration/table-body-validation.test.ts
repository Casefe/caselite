import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { bodyPlainText, validateBody } from '../../packages/local-db/src/body-schema';

// DEV-1812：宿主对表格 Yjs 正文的结构门禁。直接构造二进制，不经过编辑器，
// 这样才能覆盖编辑器自身永远不会产出、但旧客户端/损坏数据可能带来的负例。
type Attrs = Record<string, unknown>;

function cell(attrs: Attrs = {}, name = 'tableCell', text = '格') {
  const node = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value as string);
  const paragraph = new Y.XmlElement('paragraph');
  const content = new Y.XmlText();
  content.insert(0, text);
  paragraph.insert(0, [content]);
  node.insert(0, [paragraph]);
  return node;
}

function row(cells: Y.XmlElement[]) {
  const node = new Y.XmlElement('tableRow');
  node.insert(0, cells);
  return node;
}

function encode(build: (root: Y.XmlFragment) => void) {
  const doc = new Y.Doc();
  try {
    build(doc.getXmlFragment('default'));
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

function tableState(rows: Y.XmlElement[]) {
  return encode((root) => {
    const table = new Y.XmlElement('table');
    table.insert(0, rows);
    root.push([table]);
  });
}

const grid = (rows: number, cols: number) =>
  Array.from({ length: rows }, () => row(Array.from({ length: cols }, () => cell())));

describe('host table body validation (DEV-1812)', () => {
  it('accepts the documented 200 row and 100 column boundary and rejects one past it', () => {
    expect(validateBody(tableState(grid(200, 1)), true)).toBe(true);
    expect(validateBody(tableState(grid(1, 100)), true)).toBe(true);
    expect(() => validateBody(tableState(grid(201, 1)), true)).toThrow('Invalid table height');
    expect(() => validateBody(tableState(grid(1, 101)), true)).toThrow('Invalid table span');
  });

  it('rejects a table without rows and keeps tables out of scopes that do not opt in', () => {
    expect(() => validateBody(tableState([]), true)).toThrow('Invalid table height');
    expect(() => validateBody(tableState(grid(1, 1)))).toThrow(
      'Table is outside the supported body scope',
    );
    expect(() => validateBody(tableState(grid(1, 1)), false, 2)).toThrow(
      'Table is outside the supported body scope',
    );
  });

  it('rejects structure the editor would silently repair on reopen', () => {
    const emptyCell = new Y.XmlElement('tableCell');
    expect(() => validateBody(tableState([row([emptyCell])]), true)).toThrow('Empty table cell');
    expect(() => validateBody(tableState([row([])]), true)).toThrow('Incomplete table grid');
    const stray = encode((root) => {
      const table = new Y.XmlElement('table');
      table.insert(0, [cell()]);
      root.push([table]);
    });
    expect(() => validateBody(stray, true)).toThrow('Invalid table row');
    const paragraphInRow = encode((root) => {
      const table = new Y.XmlElement('table');
      const bad = new Y.XmlElement('tableRow');
      bad.insert(0, [new Y.XmlElement('paragraph')]);
      table.insert(0, [bad]);
      root.push([table]);
    });
    expect(() => validateBody(paragraphInRow, true)).toThrow('Unsupported node');
    const rowOutsideTable = encode((root) => root.push([row([cell()])]));
    expect(() => validateBody(rowOutsideTable, true)).toThrow('Unsupported node');
  });

  it('rejects invalid span, alignment and column width attributes', () => {
    const attempt = (attrs: Attrs, message: string) =>
      expect(() => validateBody(tableState([row([cell(attrs)])]), true)).toThrow(message);
    attempt({ colspan: 0 }, 'Invalid table span');
    attempt({ rowspan: 0 }, 'Invalid table span');
    attempt({ colspan: 1.5 }, 'Invalid table span');
    attempt({ rowspan: '2' }, 'Invalid table span');
    attempt({ align: 'top' }, 'Invalid cell alignment');
    attempt({ colwidth: [100, 100] }, 'Invalid column widths');
    attempt({ colwidth: [-1] }, 'Invalid column widths');
    attempt({ colwidth: [10001] }, 'Invalid column widths');
    attempt({ colwidth: 100 }, 'Invalid column widths');
    attempt({ background: 'red' }, 'Unsupported node attribute');
  });

  it('keeps the read-compat cases that already-saved revisions rely on', () => {
    for (const attrs of [
      { colwidth: [0] },
      { colwidth: [10000] },
      { align: 'justify' },
      { colspan: 1, rowspan: 1 },
    ])
      expect(validateBody(tableState([row([cell(attrs)])]), true)).toBe(true);
    const header = tableState([row([cell({}, 'tableHeader', '表头')])]);
    expect(validateBody(header, true)).toBe(true);
    expect(bodyPlainText(header, true).trim()).toBe('表头');
  });

  it('rejects overlap from a vertical merge and an incomplete grid even when spans are individually valid', () => {
    const overlap = tableState([
      row([cell({ rowspan: 2 }), cell()]),
      row([cell(), cell({ colspan: 2 })]),
    ]);
    expect(() => validateBody(overlap, true)).toThrow('Incomplete table grid');
    const hole = tableState([row([cell({ rowspan: 2 })]), row([])]);
    expect(validateBody(hole, true)).toBe(true);
    const ragged = tableState([row([cell(), cell()]), row([cell()])]);
    expect(() => validateBody(ragged, true)).toThrow('Incomplete table grid');
  });

  it('bounds how deeply tables can be nested inside cells', () => {
    const nested = (levels: number) =>
      encode((root) => {
        let inner = cell();
        for (let level = 0; level < levels; level++) {
          const table = new Y.XmlElement('table');
          table.insert(0, [row([inner])]);
          const wrapper = new Y.XmlElement('tableCell');
          wrapper.insert(0, [table]);
          inner = wrapper;
        }
        const table = new Y.XmlElement('table');
        table.insert(0, [row([inner])]);
        root.push([table]);
      });
    expect(() => validateBody(nested(30), true)).toThrow('Body too complex');
  });
});
