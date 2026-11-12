import { expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { localExtensions } from '../../apps/desktop/src/renderer/editors/editor-config';
import { draftDoc } from '../../apps/desktop/src/renderer/editors/editor-state';

type Profile = 'body' | 'task';
export function probeSplitUndo(profile: Profile) {
  const resources: { doc: Y.Doc; editor: Editor }[] = [];
  const seed = draftDoc({ text: '甲乙丙丁', state: null });
  const initial = Y.encodeStateAsUpdate(seed);
  seed.destroy();
  const create = (state: Uint8Array) => {
    // 先水合再建立历史；分别保持两个真实消费者的保存版初始化和扩展组合。
    const doc =
      profile === 'task' ? draftDoc({ text: '甲乙丙丁', state: Array.from(state) }) : new Y.Doc();
    if (profile === 'body') Y.applyUpdate(doc, state);
    const editor = new Editor({
      extensions: profile === 'body' ? localExtensions(doc, true, true) : localExtensions(doc),
      injectCSS: false,
    });
    resources.push({ doc, editor });
    return { doc, editor };
  };
  const separate = (editor: Editor) => {
    const state = yUndoPluginKey.getState(editor.state);
    if (!state) throw new Error('Collaboration undo manager is missing');
    expect(state.undoManager).toBeInstanceOf(Y.UndoManager);
    state.undoManager.stopCapturing();
  };
  const trace: unknown[] = [];
  try {
    const { doc, editor } = create(initial);
    const capture = (step: string) =>
      trace.push({ step, text: editor.getText(), json: editor.getJSON() });
    capture('hydrated');
    separate(editor);
    editor.commands.insertContentAt(3, '履约条款');
    expect(editor.getText()).toBe('甲乙履约条款丙丁');
    capture('original-insertion');
    const selected = editor.state.doc.textBetween(2, 7);
    trace.push({ step: 'range', from: 2, to: 7, selected, length: selected.length });
    // 此断言核实原生选文拟稿，不能通过改索引或缩短选区让诊断转绿。
    expect(selected).toBe('乙履约条款');
    separate(editor);
    editor.commands.deleteRange({ from: 2, to: 7 });
    expect(editor.getText()).toBe('甲丙丁');
    capture('partial-delete');
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe('甲乙履约条款丙丁');
    capture('restored');
    separate(editor);
    editor.commands.insertContentAt(5, '补充');
    expect(editor.getText()).toBe('甲乙履约补充条款丙丁');
    capture('split-restored-copy');
    expect(editor.commands.redo()).toBe(false);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe('甲乙履约条款丙丁');
    expect(editor.commands.undo()).toBe(true);
    const fresh = create(Y.encodeStateAsUpdate(doc));
    const actual = { live: editor.getText(), fresh: fresh.editor.getText() };
    trace.push({ step: 'undo-original-insertion', ...actual });
    // 输出仅含固定合成词，不读取真实工作区；原FAIL和预期保持独立。
    console.info('SYNTHETIC_PROFILE_TRACE', JSON.stringify({ profile, trace }));
    expect(actual).toEqual({ live: '甲乙丙丁', fresh: '甲乙丙丁' });
  } finally {
    for (const item of resources.reverse()) {
      item.editor.destroy();
      item.doc.destroy();
    }
  }
}
