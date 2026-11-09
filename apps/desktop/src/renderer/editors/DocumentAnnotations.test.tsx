// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { localExtensions } from './editor-config';
import DocumentAnnotations from './DocumentAnnotations';
import { hasDocumentAnnotations } from './document-annotation-marks';
import { validateBody } from '../../../../../packages/local-db/src/body-schema';
const disposers: (() => void)[] = [];
afterEach(() => {
  cleanup();
  disposers.splice(0).forEach((d) => d());
});
function setup() {
  const doc = new Y.Doc();
  const editor = new Editor({ extensions: localExtensions(doc, true, true), injectCSS: false });
  editor.commands.setContent('<p>付款日期需要核对，分段修改保留批注。</p>');
  disposers.push(() => {
    editor.destroy();
    doc.destroy();
  });
  return { editor, doc };
}
it('round trips native Yjs highlights and fragmented comment edit/delete without touching body text', () => {
  const { editor, doc } = setup();
  editor.commands.setTextSelection({ from: 1, to: 9 });
  render(<DocumentAnnotations editor={editor} />);
  fireEvent.click(screen.getByRole('button', { name: '高亮标记' }));
  fireEvent.click(screen.getByRole('button', { name: '添加批注' }));
  fireEvent.change(screen.getByLabelText('批注内容'), { target: { value: '<b>核对原件</b>' } });
  fireEvent.click(screen.getByRole('button', { name: '确定批注' }));
  const text = editor.getText();
  act(() => {
    editor.chain().setTextSelection({ from: 3, to: 6 }).toggleBold().run();
  });
  expect(editor.state.doc.firstChild!.childCount).toBeGreaterThan(1);
  expect(hasDocumentAnnotations(editor)).toBe(true);
  expect(() => validateBody(Y.encodeStateAsUpdate(doc), true, 2)).not.toThrow();
  const reopenedDoc = new Y.Doc();
  Y.applyUpdate(reopenedDoc, Y.encodeStateAsUpdate(doc));
  const reopened = new Editor({
    extensions: localExtensions(reopenedDoc, true, true),
    injectCSS: false,
  });
  expect(reopened.getHTML()).toContain('document-highlight');
  expect(reopened.getHTML()).toContain('document-comment-anchor');
  expect(reopened.getText()).toBe(text);
  expect(document.querySelector('.annotation-list b')).toBeNull();
  reopened.destroy();
  reopenedDoc.destroy();
  fireEvent.click(screen.getByRole('button', { name: '修改批注' }));
  fireEvent.change(screen.getByLabelText('批注内容'), { target: { value: '修改后的纯文本' } });
  fireEvent.click(screen.getByRole('button', { name: '确定批注' }));
  expect(() => validateBody(Y.encodeStateAsUpdate(doc), true, 2)).not.toThrow();
  editor.state.doc.descendants((node) => {
    for (const m of node.marks.filter((m) => m.type.name === 'comment'))
      expect(m.attrs.text).toBe('修改后的纯文本');
  });
  fireEvent.click(screen.getByRole('button', { name: '删除批注' }));
  expect(editor.getHTML()).not.toContain('document-comment-anchor');
  expect(editor.getText()).toBe(text);
});
it('locks overlapping/code-block/readonly commands and preserves pending draft through validation', () => {
  const { editor } = setup(),
    onDraft = vi.fn();
  editor.commands.setTextSelection({ from: 1, to: 4 });
  const view = render(<DocumentAnnotations editor={editor} onDraft={onDraft} />);
  fireEvent.click(screen.getByRole('button', { name: '添加批注' }));
  expect(onDraft).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '确定批注' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '取消批注' }));
  expect(onDraft).toHaveBeenLastCalledWith(false);
  act(() => {
    editor.commands.setCodeBlock();
  });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '高亮标记' }).disabled).toBe(true);
  view.rerender(<DocumentAnnotations editor={editor} readonly />);
  expect(screen.queryByRole('toolbar', { name: '文档标记' })).toBeNull();
});
