import { Mark, type Editor } from '@tiptap/react';

// 只使用固定DOM属性；批注正文由React按文本展示，不从外部HTML导入批注。
export const DocumentHighlight = Mark.create({
  name: 'highlight',
  parseHTML: () => [],
  renderHTML: () => ['mark', { class: 'document-highlight' }, 0],
});
export const DocumentComment = Mark.create({
  name: 'comment',
  inclusive: false,
  addAttributes: () => ({ id: { default: null }, text: { default: null } }),
  parseHTML: () => [],
  renderHTML: ({ mark }) => [
    'span',
    { class: 'document-comment-anchor', 'data-comment-id': mark.attrs.id },
    0,
  ],
});
export function hasDocumentAnnotations(editor: Editor) {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.marks.some((mark) => mark.type.name === 'highlight' || mark.type.name === 'comment'))
      found = true;
  });
  return found;
}
