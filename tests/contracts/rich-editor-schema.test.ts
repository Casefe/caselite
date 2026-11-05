// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { draftDoc, localExtensions } from '../../apps/desktop/src/renderer/editors/RichEditor';
import { bodyPlainText } from '../../packages/local-db/src/body-schema';

it('accepts the installed Tiptap editor binary without losing rich task content', () => {
  const doc = draftDoc({ text: '', state: null });
  const editor = new Editor({ injectCSS: false, extensions: localExtensions(doc) });
  try {
    editor.commands.setHeading({ level: 2 });
    editor.commands.insertContent('事实核对');
    editor.commands.selectAll();
    editor.commands.toggleBold();
    expect([...doc.share.keys()]).toContain('__tiptap_position_migrations:root:default');
    expect(bodyPlainText(Y.encodeStateAsUpdate(doc))).toBe(
      editor.getText({ blockSeparator: '\n' }),
    );
    expect(editor.getHTML()).toContain('<h2><strong>事实核对</strong></h2>');
    const restored = draftDoc({ text: '', state: Array.from(Y.encodeStateAsUpdate(doc)) });
    const reopened = new Editor({ injectCSS: false, extensions: localExtensions(restored) });
    try {
      expect(reopened.getJSON()).toEqual(editor.getJSON());
      reopened.commands.selectAll();
      reopened.commands.setBlockquote();
      expect(bodyPlainText(Y.encodeStateAsUpdate(restored))).toBe(
        reopened.getText({ blockSeparator: '\n' }),
      );
      restored
        .getMap('__tiptap_position_migrations:root:default')
        .set('bad', { transfers: 'invalid' });
      expect(() => bodyPlainText(Y.encodeStateAsUpdate(restored))).toThrow(
        'Unsupported position history',
      );
    } finally {
      reopened.destroy();
      restored.destroy();
    }
  } finally {
    editor.destroy();
    doc.destroy();
  }
});

it('rejects a text/array disguised as the position Map and Map keys hidden in the body fragment', () => {
  for (const kind of ['text', 'array', 'body-map']) {
    const doc = new Y.Doc();
    try {
      const root = '__tiptap_position_migrations:root:default';
      if (kind === 'text') doc.getText(root).insert(0, 'hidden');
      else if (kind === 'array') doc.getArray(root).insert(0, ['hidden']);
      else doc.getMap('default').set('hidden', true);
      expect(() => bodyPlainText(Y.encodeStateAsUpdate(doc))).toThrow(/root container/);
    } finally {
      doc.destroy();
    }
  }
});

it('derives the same text boundaries as Tiptap across supported blocks and rejects unknown roots', () => {
  const doc = draftDoc({ text: '', state: null });
  const editor = new Editor({ injectCSS: false, extensions: localExtensions(doc) });
  try {
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: '事实' },
                    { type: 'hardBreak' },
                    { type: 'text', text: '缺件' },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '待核对' }] }],
            },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'A\nB' }] },
        { type: 'horizontalRule' },
        { type: 'paragraph' },
      ],
    });
    expect(bodyPlainText(Y.encodeStateAsUpdate(doc))).toBe(
      editor.getText({ blockSeparator: '\n' }),
    );
    doc.getMap('unexpected').set('anything', true);
    expect(() => bodyPlainText(Y.encodeStateAsUpdate(doc))).toThrow('Unsupported body root');
  } finally {
    editor.destroy();
    doc.destroy();
  }
});
