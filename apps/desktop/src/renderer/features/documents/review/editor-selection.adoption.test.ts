// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/react';
import * as Y from 'yjs';
import { localExtensions } from '../../../editors/editor-config';
import { editorSelection } from './editor-selection';

function withEditor(
  content: JSONContent & { content: JSONContent[] },
  run: (editor: Editor, doc: Y.Doc) => void,
) {
  const doc = new Y.Doc();
  const editor = new Editor({ extensions: localExtensions(doc, true), injectCSS: false });
  try {
    // DEV-1845：用本地合成正文核对结构化选区，不复用上游实现或样本。
    // Collaboration 从 Y.Doc 初始化；夹具装载失败也必须释放 Editor 与 Y.Doc。
    editor.commands.setContent(content, { emitUpdate: false });
    expect(editor.getJSON().content?.slice(0, content.content?.length)).toMatchObject(
      content.content,
    );
    run(editor, doc);
  } finally {
    editor.destroy();
    doc.destroy();
  }
}

it('freezes an exact UTF-16 selection and leaves Yjs bytes unchanged while reading it', () => {
  withEditor(
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲😀乙' }] }] },
    (editor, doc) => {
      editor.commands.setTextSelection({ from: 2, to: 4 });
      const state = Y.encodeStateAsUpdate(doc);
      expect(editorSelection(editor)).toEqual({ paragraph: 0, from: 1, to: 3, text: '😀' });
      expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
      editor.commands.setTextSelection(4);
      expect(editorSelection(editor)).toEqual({ paragraph: 0, from: 3, to: 3, text: '' });
      expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
    },
  );
});

it('refuses a range crossing paragraphs so adjacent content is not silently sent', () => {
  withEditor(
    {
      type: 'doc',
      content: ['可选', '未授权相邻段'].map((text) => ({
        type: 'paragraph',
        content: [{ type: 'text', text }],
      })),
    },
    (editor) => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      expect(editorSelection(editor)).toBeUndefined();
    },
  );
});

const nestedCases: Array<[string, JSONContent, number]> = [
  [
    '列表',
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '嵌套' }] }],
        },
      ],
    },
    3,
  ],
  [
    '引用',
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '嵌套' }] }],
    },
    2,
  ],
];
it.each(nestedCases)('refuses unsupported nested selection in %s', (_label, node, position) => {
  withEditor({ type: 'doc', content: [node] }, (editor) => {
    editor.commands.setTextSelection({ from: position, to: position + 1 });
    expect(editorSelection(editor)).toBeUndefined();
  });
});

it('refuses a paragraph containing a hard break rather than using flattened DOM offsets', () => {
  withEditor(
    {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '甲' },
            { type: 'hardBreak' },
            { type: 'text', text: '乙' },
          ],
        },
      ],
    },
    (editor) => {
      editor.commands.setTextSelection({ from: 1, to: 2 });
      expect(editorSelection(editor)).toBeUndefined();
    },
  );
});
