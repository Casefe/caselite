// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createYjsEditor,
  disposeYjsEditors,
  separateUndoStep,
} from './yjs-editor-regression-fixture';

afterEach(disposeYjsEditors);

it('removes the entire original insertion after a restored copy is split by a new edit', () => {
  const { doc, editor } = createYjsEditor('甲乙丙丁');
  separateUndoStep(editor);
  editor.commands.insertContentAt(3, '履约条款');
  expect(editor.getText()).toBe('甲乙履约条款丙丁');
  separateUndoStep(editor);
  editor.commands.deleteRange({ from: 2, to: 7 });
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getText()).toBe('甲乙履约条款丙丁');
  separateUndoStep(editor);
  editor.commands.insertContentAt(5, '补充');
  expect(editor.getText()).toBe('甲乙履约补充条款丙丁');
  expect(editor.commands.redo()).toBe(false);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getText()).toBe('甲乙履约条款丙丁');
  expect(editor.commands.undo()).toBe(true);
  const fresh = createYjsEditor('', Y.encodeStateAsUpdate(doc));
  expect({ live: editor.getText(), fresh: fresh.editor.getText() }).toEqual({
    live: '甲乙丙丁',
    fresh: '甲乙丙丁',
  });
});
