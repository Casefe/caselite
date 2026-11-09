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
    editor.on('update', capture);
    return () => {
      captureSelection.current = () => {};
      editor.off('selectionUpdate', capture);
      editor.off('update', capture);
      if (!editor.isDestroyed) editor.unregisterPlugin(key);
    };
  }, [editor]);
  return snapshot;
}
