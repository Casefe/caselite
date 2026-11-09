import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { editorSelection, type EditorRange } from './editor-selection';

export default function useEditorSelection(editor: Editor | null, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ range: EditorRange; doc: object }>();
  const allowed = useRef(enabled);
  const captureSelection = useRef(() => {});
  useLayoutEffect(() => {
    allowed.current = enabled;
    if (enabled) captureSelection.current();
  }, [enabled]);
  useEffect(() => {
    if (!editor) return;
    const key = new PluginKey('caselite-ai-selection');
    editor.registerPlugin(
      new Plugin({
        key,
        props: {
          decorations(state) {
            const { from, to, empty } = state.selection;
            return empty
              ? DecorationSet.empty
              : DecorationSet.create(state.doc, [
                  Decoration.inline(from, to, { class: 'editor-ai-selection' }),
                ]);
          },
        },
      }),
    );
    const capture = () => {
      if (!allowed.current || editor.isDestroyed || editor.view.composing) return;
      const range = editorSelection(editor);
      setSnapshot(range ? { range, doc: editor.state.doc } : undefined);
    };
    captureSelection.current = capture;
    capture();
    editor.on('selectionUpdate', capture);
    // 浮层注销可触发内容相同的Yjs重投影；Tiptap不发update，但doc身份已变。
    // 跟随真实事务刷新本机选区，发送时仍严格检查当前doc和保存修订。
    editor.on('transaction', capture);
    return () => {
      captureSelection.current = () => {};
      editor.off('selectionUpdate', capture);
      editor.off('transaction', capture);
      if (!editor.isDestroyed) editor.unregisterPlugin(key);
    };
  }, [editor]);
  return snapshot;
}
