// @vitest-environment jsdom
import { Editor } from '@tiptap/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { editorCapabilities, localExtensions } from './editor-config';

describe('editor capabilities', () => {
  it('preserves legacy schemas including independent table and annotation options', () => {
    const docs: Y.Doc[] = [];
    const editors: Editor[] = [];
    const schema = (
      option?: boolean | { tables: boolean; annotations: boolean },
      annotations?: boolean,
    ) => {
      const doc = new Y.Doc();
      docs.push(doc);
      const editor = new Editor({
        extensions: localExtensions(doc, option, annotations),
        injectCSS: false,
      });
      editors.push(editor);
      return { nodes: Object.keys(editor.schema.nodes), marks: Object.keys(editor.schema.marks) };
    };
    try {
      const basic = schema();
      const full = schema(true, true);
      expect(schema(editorCapabilities.basic)).toEqual(basic);
      expect(schema(editorCapabilities.document)).toEqual(full);
      const tablesOnly = schema(true);
      const annotationsOnly = schema(false, true);
      expect(schema(undefined, true)).toEqual(annotationsOnly);
      expect(tablesOnly.nodes).toContain('table');
      expect(tablesOnly.marks).toEqual(basic.marks);
      expect(annotationsOnly.nodes).toEqual(basic.nodes);
      expect(annotationsOnly.marks).toEqual(full.marks);
      expect(full.marks.length).toBeGreaterThan(basic.marks.length);
    } finally {
      editors.forEach((editor) => editor.destroy());
      docs.forEach((doc) => doc.destroy());
    }
  });

  it('keeps named capability editors and undo histories isolated', () => {
    const firstDoc = new Y.Doc();
    const secondDoc = new Y.Doc();
    const first = new Editor({
      extensions: localExtensions(firstDoc, editorCapabilities.document),
      injectCSS: false,
    });
    const second = new Editor({
      extensions: localExtensions(secondDoc, editorCapabilities.document),
      injectCSS: false,
    });
    try {
      first.commands.insertContent('first');
      second.commands.insertContent('second');
      first.commands.undo();
      expect(first.getText()).toBe('');
      expect(second.getText()).toBe('second');
      expect(Y.encodeStateAsUpdate(firstDoc)).not.toEqual(Y.encodeStateAsUpdate(secondDoc));
    } finally {
      first.destroy();
      second.destroy();
      firstDoc.destroy();
      secondDoc.destroy();
    }
  });
});
