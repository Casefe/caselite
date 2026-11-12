// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { localExtensions } from '../../apps/desktop/src/renderer/editors/editor-config';
import { validateBody } from '../../packages/local-db/src/body-schema';

const cleanup: (() => void)[] = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose()),
);
const open = (bytes?: Uint8Array) => {
  const doc = new Y.Doc();
  if (bytes) Y.applyUpdate(doc, bytes);
  const editor = new Editor({ extensions: localExtensions(doc, true, true), injectCSS: false });
  cleanup.push(() => {
    editor.destroy();
    doc.destroy();
  });
  const manager = yUndoPluginKey.getState(editor.state)?.undoManager;
  if (!manager) throw new Error('Collaboration undo manager missing');
  expect(manager).toBeInstanceOf(Y.UndoManager);
  return { doc, editor, manager };
};

it('preserves real annotation marks, a table and emoji through split-copy undo and state reconstruction', () => {
  const seeded = open();
  const original: JSONContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '甲乙丙丁',
            marks: [
              { type: 'bold' },
              { type: 'highlight' },
              {
                type: 'comment',
                attrs: { id: '51c560e7-5808-4735-b51a-9fe289a8d3f4', text: '合成批注' },
              },
            ],
          },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: '附件😀不改写' }] }],
              },
            ],
          },
        ],
      },
    ],
  };
  seeded.editor.commands.setContent(original);
  // 从保存版重新建立历史，避免把设置初始内容也当作待撤销的用户修改。
  const { doc, editor, manager } = open(Y.encodeStateAsUpdate(seeded.doc));
  const before = editor.getJSON();
  manager.stopCapturing();
  editor.commands.insertContentAt(3, '履约条款');
  manager.stopCapturing();
  expect(editor.state.doc.textBetween(2, 7)).toBe('乙履约条款');
  editor.commands.deleteRange({ from: 2, to: 7 });
  expect(editor.commands.undo()).toBe(true);
  manager.stopCapturing();
  editor.commands.insertContentAt(5, '补充');
  expect(editor.commands.redo()).toBe(false);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getJSON()).toEqual(before);
  const bytes = Y.encodeStateAsUpdate(doc);
  expect(() => validateBody(bytes, true, 2)).not.toThrow();
  expect(open(bytes).editor.getJSON()).toEqual(before);
});

it('preserves neighboring edits during repeated rich-editor undo and redo', () => {
  const seeded = open();
  seeded.editor.commands.setContent('<p>左右</p>');
  const { doc, editor, manager } = open(Y.encodeStateAsUpdate(seeded.doc));
  const check = (expected: string) => expect(editor.getText()).toBe(expected);
  manager.stopCapturing();
  editor.commands.insertContentAt(2, '付款期限');
  manager.stopCapturing();
  editor.commands.insertContentAt(6, '共同约定');
  manager.stopCapturing();
  editor.commands.deleteRange({ from: 1, to: 11 });
  check('');
  expect(editor.commands.undo()).toBe(true);
  check('左付款期限共同约定右');
  expect(editor.commands.undo()).toBe(true);
  check('左付款期限右');
  expect(editor.commands.undo()).toBe(true);
  check('左右');
  expect(editor.commands.redo()).toBe(true);
  check('左付款期限右');
  expect(editor.commands.redo()).toBe(true);
  check('左付款期限共同约定右');
  expect(open(Y.encodeStateAsUpdate(doc)).editor.getJSON()).toEqual(editor.getJSON());
});
