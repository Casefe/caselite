import { expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { localExtensions } from '../../apps/desktop/src/renderer/editors/editor-config';
import { validateBody } from '../../packages/local-db/src/body-schema';

const editors: Editor[] = [];
const docs: Y.Doc[] = [];
export function disposeYjsEditors() {
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  for (const doc of docs.splice(0)) doc.destroy();
}
export function createYjsEditor(text = '付款期限', state?: Uint8Array) {
  const doc = new Y.Doc();
  docs.push(doc);
  if (state) Y.applyUpdate(doc, state);
  else {
    const paragraph = new Y.XmlElement('paragraph');
    const value = new Y.XmlText();
    value.insert(0, text);
    paragraph.insert(0, [value]);
    doc.getXmlFragment('default').insert(0, [paragraph]);
  }
  const editor = new Editor({ extensions: localExtensions(doc, true), injectCSS: false });
  editors.push(editor);
  return { doc, editor };
}
export function separateUndoStep(editor: Editor) {
  // lib0在模块初始化时保存Date.now，假时钟不能可靠分隔捕获窗口；只调用现有管理器公开API。
  const state = yUndoPluginKey.getState(editor.state);
  if (!state) throw new Error('Collaboration undo manager is missing');
  state.undoManager.stopCapturing();
}
export function assertBodyRoundTrip(doc: Y.Doc, expected: ReturnType<Editor['getJSON']>) {
  const bytes = Y.encodeStateAsUpdate(doc);
  validateBody(bytes, true);
  const fresh = createYjsEditor('', bytes);
  expect(fresh.editor.getJSON()).toEqual(expected);
  return fresh;
}
export function createStructuredYjsEditor(html: string) {
  const seed = createYjsEditor();
  seed.editor.commands.setContent(html);
  // 用真实正文编码建立新的会话，初始夹具的构造不成为被测用户撤销步骤。
  const bytes = Y.encodeStateAsUpdate(seed.doc);
  seed.editor.destroy();
  return createYjsEditor('', bytes);
}
export function appendBinaryText(doc: Y.Doc, text: string) {
  const other = new Y.Doc();
  try {
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const paragraph = other.getXmlFragment('default').get(0) as Y.XmlElement;
    const value = paragraph.get(0) as Y.XmlText;
    value.insert(value.length, text);
    return Y.encodeStateAsUpdate(other);
  } finally {
    other.destroy();
  }
}
