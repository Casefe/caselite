// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { localExtensions } from '../editors/editor-config';
import { parseDocxDraft, encodeDocxDraft } from './DocxDraftPreview';
import { validateBody } from '../../../../../packages/local-db/src/body-schema';
const html =
  '<h1>中文合同</h1><ol start="3"><li>付款</li><li>交付</li></ol><table><tr><td colspan="2">横向合并</td></tr><tr><td rowspan="2">纵向合并</td><td>甲</td></tr><tr><td>乙</td></tr></table>';
describe('DOCX semantic draft', () => {
  it('rejects hostile spans before creating a ProseMirror table map', () => {
    for (const attribute of ['colspan', 'rowspan']) {
      expect(() =>
        parseDocxDraft(`<table><tr><td ${attribute}="100000000">合同</td></tr></table>`),
      ).toThrow(/跨度|超过 100 列/);
    }
    expect(() =>
      parseDocxDraft(
        '<table><tr><td colspan="100" rowspan="2">甲</td></tr><tr><td>乙</td></tr></table>',
      ),
    ).toThrow(/跨度|超过 100 列/);
    expect(() => parseDocxDraft('<table><tr><td rowspan="2">甲</td></tr></table>')).toThrow(
      /跨度|超过 100 列/,
    );
    expect(() =>
      parseDocxDraft('<table><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td></tr></table>'),
    ).toThrow('不完整');
  });
  it('retains numbering and both spans across real Tiptap to Yjs and host validation', () => {
    const parsed = parseDocxDraft(html);
    const state = Uint8Array.from(encodeDocxDraft(parsed.json));
    expect(() => validateBody(state, true)).not.toThrow();
    expect(() => validateBody(state)).toThrow('Table is outside the supported body scope');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const editor = new Editor({ extensions: localExtensions(doc, true), injectCSS: false });
    try {
      expect(editor.getJSON()).toEqual(parsed.json);
      expect(editor.getHTML()).toContain('colspan="2"');
      expect(editor.getHTML()).toContain('rowspan="2"');
      expect(editor.getHTML()).toContain('start="3"');
    } finally {
      editor.destroy();
      doc.destroy();
    }
  });
  it('removes external content, scripts and event handlers before creating the draft', () => {
    const parsed = parseDocxDraft(
      '<p onclick="alert(1)">合同<script>alert(1)</script><a href="javascript:alert(1)">文字</a><img src="https://invalid.example/a"><iframe src="https://invalid.example"></iframe></p>',
    );
    expect(parsed.html).toBe('<p>合同文字</p>');
    expect(() => parseDocxDraft('<img src="https://invalid.example">')).toThrow();
  });
  it('rejects overlapping and out-of-bounds spans without accepting a repaired body', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Uint8Array.from(encodeDocxDraft(parseDocxDraft(html).json)));
    const table = doc.getXmlFragment('default').get(2) as Y.XmlElement;
    const row = table.get(1) as Y.XmlElement;
    const cell = row.get(0) as Y.XmlElement;
    cell.setAttribute('rowspan', 30 as unknown as string);
    expect(() => validateBody(Y.encodeStateAsUpdate(doc), true)).toThrow('Invalid table span');
    cell.setAttribute('rowspan', 2 as unknown as string);
    const lastRow = table.get(2) as Y.XmlElement;
    const last = lastRow.get(0) as Y.XmlElement;
    last.setAttribute('colspan', 2 as unknown as string);
    expect(() => validateBody(Y.encodeStateAsUpdate(doc), true)).toThrow('Incomplete table grid');
    doc.destroy();
  });
});
