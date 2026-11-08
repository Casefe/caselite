// @vitest-environment jsdom
import { assertBoundedHtml } from './bounded-html';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { TableCommands } from './TableCommands';
import { EditorSurface } from './RichEditor';
import { localExtensions } from './editor-config';
import { validateBody } from '../../../../../packages/local-db/src/body-schema';
const disposers: (() => void)[] = [];
afterEach(() => {
  cleanup();
  disposers.splice(0).forEach((dispose) => dispose());
});
function setup() {
  const doc = new Y.Doc();
  const editor = new Editor({ extensions: localExtensions(doc, true), injectCSS: false });
  editor.commands.setContent(
    '<table><tr><td>甲方</td><td>乙方</td></tr><tr><td>付款</td><td>交付</td></tr></table>',
  );
  disposers.push(() => {
    editor.destroy();
    doc.destroy();
  });
  const cells: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell') cells.push(pos);
  });
  return { editor, doc, cells };
}
it('merges and splits selected cells through the toolbar while preserving both texts and valid Yjs', () => {
  const { editor, doc, cells } = setup();
  editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
  render(<TableCommands editor={editor} />);
  fireEvent.change(screen.getByLabelText('表格操作'), { target: { value: 'mergeCells' } });
  expect(editor.getHTML()).toContain('colspan="2"');
  expect(editor.getText()).toContain('甲方');
  expect(editor.getText()).toContain('乙方');
  expect(() => validateBody(Y.encodeStateAsUpdate(doc), true)).not.toThrow();
  fireEvent.change(screen.getByLabelText('表格操作'), { target: { value: 'splitCell' } });
  expect(editor.getHTML()).not.toContain('colspan="2"');
  expect(() => validateBody(Y.encodeStateAsUpdate(doc), true)).not.toThrow();
});
it('preserves readonly content and blocks oversized clipboard HTML before ProseMirror parsing', () => {
  const { editor } = setup();
  render(<EditorSurface editor={editor} mode="simple" />);
  const before = editor.getHTML();
  const editable = document.querySelector('.tiptap')!;
  fireEvent.paste(editable, {
    clipboardData: { getData: () => '<table><tr><td colspan="100000000">危险</td></tr></table>' },
  });
  expect(screen.getByRole('alert').textContent).toMatch(/跨度|超过/);
  expect(editor.getHTML()).toBe(before);
  act(() => {
    editor.setEditable(false);
  });
  fireEvent.change(screen.getByLabelText('表格操作'), { target: { value: 'deleteTable' } });
  expect(editor.getHTML()).toBe(before);
});

it('rejects table fragments before the clipboard parser can wrap hidden spans', () => {
  for (const html of [
    '<td colspan="100000000">x</td>',
    '<tr><td rowspan="100000000">x</td></tr>',
    '<meta charset="utf-8"><tbody><tr><td>x</td></tr></tbody>',
  ])
    expect(() => assertBoundedHtml(html)).toThrow('完整表格');
});
it('does not allow a toolbar command to exceed the host table width limit', () => {
  const { editor, doc } = setup();
  editor.commands.setContent('<table><tr>' + '<td>条款</td>'.repeat(100) + '</tr></table>');
  editor.commands.setTextSelection(4);
  render(<TableCommands editor={editor} />);
  const option = screen.getByRole('option', { name: '右侧插入列' }) as HTMLOptionElement;
  expect(option.disabled).toBe(true);
  const before = editor.getHTML();
  fireEvent.change(screen.getByLabelText('表格操作'), { target: { value: 'addColumnAfter' } });
  expect(editor.getHTML()).toBe(before);
  expect(() => validateBody(Y.encodeStateAsUpdate(doc), true)).not.toThrow();
});
it('keeps the final-cell Tab shortcut within the host row limit', () => {
  const { editor } = setup();
  editor.commands.setContent('<table>' + '<tr><td>条款</td></tr>'.repeat(200) + '</table>');
  let last = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell') last = pos + 2;
  });
  editor.commands.setTextSelection(last);
  render(<EditorSurface editor={editor} mode="simple" />);
  const before = editor.getHTML();
  fireEvent.keyDown(document.querySelector('.tiptap')!, { key: 'Tab', code: 'Tab' });
  expect(editor.getHTML()).toBe(before);
  expect(screen.getByRole('alert').textContent).toContain('200 行');
});
it('rejects hidden clipboard context and excessive open depth while allowing complete normal copies', () => {
  expect(() =>
    assertBoundedHtml(
      `<p data-pm-slice='0 0 ["tableCell",{"colspan":100000000,"rowspan":1}]'>x</p>`,
    ),
  ).toThrow('结构上下文');
  expect(() => assertBoundedHtml('<p data-pm-slice="100000 0 []">x</p>')).toThrow('结构上下文');
  expect(() => assertBoundedHtml('<p data-pm-slice="1 1 []">中文合同</p>')).not.toThrow();
  expect(() =>
    assertBoundedHtml('<table data-pm-slice="0 0 []"><tr><td>中文合同</td></tr></table>'),
  ).not.toThrow();
});

it('rejects context hidden in head tags and rejects unsupported column widths', () => {
  expect(() =>
    assertBoundedHtml(
      `<style data-pm-slice='0 0 ["tableCell",{"colspan":100000000}]'></style><p>x</p>`,
    ),
  ).toThrow('结构上下文');
  expect(() =>
    assertBoundedHtml('<table><tr><td colwidth="999999999">x</td></tr></table>'),
  ).toThrow('列宽');
});

it('rejects a second HTML table inside an existing table while retaining the original cells', () => {
  const { editor } = setup();
  editor.commands.setTextSelection(4);
  render(<EditorSurface editor={editor} mode="simple" />);
  const before = editor.getHTML();
  fireEvent.paste(document.querySelector('.tiptap')!, {
    clipboardData: { getData: () => '<table><tr><td>x</td></tr></table>' },
  });
  expect(screen.getByRole('alert').textContent).toContain('在表格外粘贴');
  expect(editor.getHTML()).toBe(before);
});
