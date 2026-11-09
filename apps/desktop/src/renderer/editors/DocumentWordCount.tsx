import { useEditorState, type Editor } from '@tiptap/react';
import { useLocalPreferences } from '../shared/data/LocalPreferences';

export function DocumentWordCount({ editor }: { editor: Editor }) {
  const enabled = useLocalPreferences().preferences.show_word_count;
  const count = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      enabled
        ? Array.from(
            current.state.doc
              .textBetween(0, current.state.doc.content.size, '\n')
              .replace(/\s/gu, ''),
          ).length
        : 0,
  });
  return enabled ? (
    <div className="document-word-count" aria-label="文档字数">
      {count} 字
    </div>
  ) : null;
}
