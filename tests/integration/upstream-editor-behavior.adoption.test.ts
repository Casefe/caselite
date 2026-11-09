// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import {
  localExtensions,
  reviewUpdateOrigin,
} from '../../apps/desktop/src/renderer/editors/editor-config';
import { assertBoundedHtml } from '../../apps/desktop/src/renderer/editors/bounded-html';
import { validateBody } from '../../packages/local-db/src/body-schema';
const editors: Editor[] = [],
  docs: Y.Doc[] = [];
// jsdom没有原生ClipboardEvent；显式传入合成DOM事件，仍走真实ProseMirror粘贴事务。
const pasteEvent = () => new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
afterEach(() => {
  for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy();
  for (const d of docs.splice(0)) d.destroy();
});
function create(value = '甲方乙方', existing?: Y.Doc) {
  const doc = existing ?? new Y.Doc();
  if (!existing) docs.push(doc);
  if (!existing) {
    const p = new Y.XmlElement('paragraph'),
      t = new Y.XmlText();
    t.insert(0, value);
    p.insert(0, [t]);
    doc.getXmlFragment('default').insert(0, [p]);
  }
  const editor = new Editor({ extensions: localExtensions(doc, true), injectCSS: false });
  editors.push(editor);
  return { doc, editor };
}
function appendUpdate(doc: Y.Doc, origin: unknown) {
  const other = new Y.Doc();
  try {
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const p = other.getXmlFragment('default').get(0) as Y.XmlElement;
    const t = p.get(0) as Y.XmlText;
    t.insert(t.length, '候选');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), origin);
  } finally {
    other.destroy();
  }
}
it('uses collaboration undo/redo without a second StarterKit history owner', () => {
  const { doc, editor } = create();
  expect(editor.extensionManager.extensions.some((e) => e.name === 'undoRedo')).toBe(false);
  editor.commands.insertContentAt(3, '新增');
  expect(editor.getText()).toBe('甲方新增乙方');
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getText()).toBe('甲方乙方');
  expect(editor.commands.redo()).toBe(true);
  expect(editor.getText()).toBe('甲方新增乙方');
  expect(() => validateBody(Y.encodeStateAsUpdate(doc), true)).not.toThrow();
});
it('never undoes the contents of another document instance', () => {
  const a = create('第一份'),
    b = create('第二份');
  a.editor.commands.insertContentAt(1, '修改');
  b.editor.commands.insertContentAt(1, '独立');
  a.editor.commands.undo();
  expect(a.editor.getText()).toBe('第一份');
  expect(b.editor.getText()).toBe('独立第二份');
});
it('includes explicitly accepted review updates in the current document undo history', () => {
  const { doc, editor } = create('原文');
  appendUpdate(doc, reviewUpdateOrigin);
  expect(editor.getText()).toBe('原文候选');
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getText()).toBe('原文');
  expect(editor.commands.redo()).toBe(true);
  expect(editor.getText()).toBe('原文候选');
});
it('does not turn untracked hydration into a user undo operation', () => {
  const { doc, editor } = create('原文');
  appendUpdate(doc, 'synthetic-hydration');
  expect(editor.getText()).toBe('原文候选');
  expect(editor.commands.undo()).toBe(false);
  expect(editor.getText()).toBe('原文候选');
});
it('places pasted plain text and the caret at the same structured location', () => {
  const { editor } = create('前文后文');
  editor.commands.setTextSelection(3);
  editor.view.pasteText('粘贴', pasteEvent());
  expect(editor.getText()).toBe('前文粘贴后文');
  expect(editor.state.selection.$from.parentOffset).toBe(4);
});
it('keeps a multiline plain text paste ordered and places the caret before the original suffix', () => {
  const { editor } = create('前文后文');
  editor.commands.setTextSelection(3);
  editor.view.pasteText('第一行\n第二行', pasteEvent());
  expect(editor.state.doc.childCount).toBe(2);
  expect(editor.state.doc.child(0).textContent).toBe('前文第一行');
  expect(editor.state.doc.child(1).textContent).toBe('第二行后文');
  expect(editor.state.selection.$from.parentOffset).toBe(3);
});
it('keeps the original suffix outside an inserted complete HTML table', () => {
  const { doc, editor } = create('前文后文');
  editor.commands.setTextSelection(3);
  const html = '<table><tr><td>表甲</td><td>表乙</td></tr></table>';
  assertBoundedHtml(html);
  editor.view.pasteHTML(html, pasteEvent());
  const blocks: Array<[string, string]> = [];
  editor.state.doc.forEach((n) => blocks.push([n.type.name, n.textContent]));
  expect(blocks).toEqual([
    ['paragraph', '前文'],
    ['table', '表甲表乙'],
    ['paragraph', '后文'],
  ]);
  expect(() => validateBody(Y.encodeStateAsUpdate(doc), true)).not.toThrow();
});
it('preserves the caller-owned Yjs body when an editor is destroyed and recreated', () => {
  const { doc, editor } = create('重开原文');
  editor.commands.insertContentAt(1, '编辑');
  editor.destroy();
  expect(doc.isDestroyed).toBe(false);
  const next = create('', doc);
  expect(next.editor.getText()).toBe('编辑重开原文');
});
