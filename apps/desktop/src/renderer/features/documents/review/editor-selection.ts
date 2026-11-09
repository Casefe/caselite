import type { Editor } from '@tiptap/react';
import type { ReviewRange } from '../../../../preload/caselite-api';

export type EditorRange = Pick<ReviewRange, 'paragraph' | 'from' | 'to' | 'text'>;

// 从 ProseMirror 状态读取结构化位置，不能把 DOM 文字偏移当成正文坐标。
export function editorSelection(editor: Editor): EditorRange | undefined {
  const { $from, $to } = editor.state.selection;
  if (
    $from.depth !== 1 ||
    !$from.sameParent($to) ||
    $from.parent.type.name !== 'paragraph' ||
    $from.parent.textContent.length !== $from.parent.content.size
  )
    return;
  return {
    paragraph: $from.index(0),
    from: $from.parentOffset,
    to: $to.parentOffset,
    text: $from.parent.textBetween($from.parentOffset, $to.parentOffset),
  };
}
