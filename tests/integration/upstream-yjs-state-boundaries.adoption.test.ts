// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { reviewUpdateOrigin } from '../../apps/desktop/src/renderer/editors/editor-config';
import {
  appendBinaryText,
  assertBodyRoundTrip,
  createStructuredYjsEditor,
  createYjsEditor,
  disposeYjsEditors,
  separateUndoStep,
} from './yjs-editor-regression-fixture';

afterEach(disposeYjsEditors);

it('restores each independent insertion after deleting all content without deleting an earlier step', () => {
  const { doc, editor } = createYjsEditor();
  const states = [editor.getJSON()];
  for (const text of ['甲方', '共同约定']) {
    separateUndoStep(editor);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, text);
    states.push(editor.getJSON());
  }
  separateUndoStep(editor);
  editor.commands.selectAll();
  editor.commands.deleteSelection();
  states.push(editor.getJSON());
  for (let i = states.length - 2; i >= 0; i--) {
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(states[i]);
    assertBodyRoundTrip(doc, states[i]);
  }
  for (let i = 1; i < states.length; i++) {
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getJSON()).toEqual(states[i]);
    assertBodyRoundTrip(doc, states[i]);
  }
});

it('preserves a heading attribute and its original parent after a single attribute-change/delete transaction is undone', () => {
  const { doc, editor } = createStructuredYjsEditor('<h2>争点标题</h2><p>保留正文</p>');
  const original = editor.getJSON();
  const size = editor.state.doc.child(0).nodeSize;
  separateUndoStep(editor);
  expect(
    editor
      .chain()
      .setTextSelection(1)
      .updateAttributes('heading', { level: 3 })
      .deleteRange({ from: 0, to: size })
      .run(),
  ).toBe(true);
  expect(editor.getText()).toBe('保留正文');
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getJSON()).toEqual(original);
  expect(editor.state.doc.child(0).attrs.level).toBe(2);
  assertBodyRoundTrip(doc, original);
});

it('restores formatted body text after deleting its parent and then undoes only the formatting step', () => {
  const { doc, editor } = createYjsEditor('证据说明');
  const original = editor.getJSON();
  separateUndoStep(editor);
  editor.commands.setTextSelection({ from: 1, to: 3 });
  editor.commands.toggleBold();
  const marked = editor.getJSON();
  expect(marked).not.toEqual(original);
  separateUndoStep(editor);
  editor.commands.selectAll();
  editor.commands.deleteSelection();
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getJSON()).toEqual(marked);
  assertBodyRoundTrip(doc, marked);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getJSON()).toEqual(original);
  assertBodyRoundTrip(doc, original);
});

it('restores a complete table grid and a trailing paragraph after a whole-document delete', () => {
  const { doc, editor } = createStructuredYjsEditor(
    '<table><tr><th>项目</th><th>期限</th></tr><tr><td>交付</td><td>十日</td></tr></table><p>保留尾注</p>',
  );
  const original = editor.getJSON();
  expect(editor.state.doc.firstChild?.type.name).toBe('table');
  separateUndoStep(editor);
  editor.commands.selectAll();
  editor.commands.deleteSelection();
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getJSON()).toEqual(original);
  assertBodyRoundTrip(doc, original);
  expect(editor.commands.redo()).toBe(true);
  expect(editor.getText()).toBe('');
  assertBodyRoundTrip(doc, editor.getJSON());
});

it('keeps an untracked hydration update when undoing and redoing a preceding local insertion', () => {
  const { doc, editor } = createYjsEditor('凭证');
  separateUndoStep(editor);
  editor.commands.insertContentAt(1, '记录');
  Y.applyUpdate(doc, appendBinaryText(doc, '外部导入'), 'synthetic-hydration');
  expect(editor.getText()).toBe('记录凭证外部导入');
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getText()).toBe('凭证外部导入');
  assertBodyRoundTrip(doc, editor.getJSON());
  expect(editor.commands.redo()).toBe(true);
  expect(editor.getText()).toBe('记录凭证外部导入');
  assertBodyRoundTrip(doc, editor.getJSON());
});

it('does not duplicate accepted review text or history when the same binary update is applied again', () => {
  const { doc, editor } = createYjsEditor('原条款');
  const update = appendBinaryText(doc, '核准补充');
  Y.applyUpdate(doc, update, reviewUpdateOrigin);
  const accepted = editor.getJSON();
  const vector = Y.encodeStateVector(doc);
  Y.applyUpdate(doc, update, reviewUpdateOrigin);
  expect(editor.getJSON()).toEqual(accepted);
  expect(Y.encodeStateVector(doc)).toEqual(vector);
  expect(editor.getText()).toBe('原条款核准补充');
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getText()).toBe('原条款');
  expect(editor.commands.undo()).toBe(false);
  expect(editor.commands.redo()).toBe(true);
  expect(editor.getJSON()).toEqual(accepted);
  assertBodyRoundTrip(doc, accepted);
});

it('reopens exact body bytes in a new document without reviving an earlier in-memory undo stack', () => {
  const { doc, editor } = createYjsEditor('重开正文');
  separateUndoStep(editor);
  editor.commands.insertContentAt(1, '已确认');
  const expected = editor.getJSON();
  const bytes = Y.encodeStateAsUpdate(doc);
  editor.destroy();
  const reopened = createYjsEditor('', bytes);
  expect(reopened.editor.getJSON()).toEqual(expected);
  expect(reopened.editor.commands.undo()).toBe(false);
  expect(reopened.editor.commands.redo()).toBe(false);
  expect(reopened.editor.getJSON()).toEqual(expected);
});

it('keeps another document and its fresh encoding unchanged through repeated local undo and redo', () => {
  const first = createYjsEditor('甲份正文');
  const second = createStructuredYjsEditor('<h3>乙份标题</h3><p>乙份条款</p>');
  const expected = second.editor.getJSON();
  const secondBytes = Y.encodeStateAsUpdate(second.doc);
  separateUndoStep(first.editor);
  first.editor.commands.insertContentAt(1, '独立修订');
  for (let i = 0; i < 3; i++) {
    expect(first.editor.commands.undo()).toBe(true);
    expect(first.editor.commands.redo()).toBe(true);
    expect(second.editor.getJSON()).toEqual(expected);
    expect(Y.encodeStateAsUpdate(second.doc)).toEqual(secondBytes);
    assertBodyRoundTrip(second.doc, expected);
  }
});
