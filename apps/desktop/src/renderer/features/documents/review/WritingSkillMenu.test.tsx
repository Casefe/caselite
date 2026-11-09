// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import { EditorSurface } from '../../../editors/RichEditor';
import { localExtensions } from '../../../editors/editor-config';
import { draftDoc } from '../../../editors/editor-state';
import WritingSkillMenu from './WritingSkillMenu';
import type * as Y from 'yjs';
const resources: { editor: Editor; doc: Y.Doc }[] = [];
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [new DOMRect(0, 0, 1, 20)],
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 20),
  });
});
afterEach(() => {
  cleanup();
  for (const { editor, doc } of resources.splice(0)) {
    editor.destroy();
    doc.destroy();
  }
  vi.unstubAllGlobals();
});
it('keeps the skill submenu inside its selection toolbar and hands off without reprojecting Yjs', async () => {
  const doc = draftDoc({ text: '原文条款', state: null });
  const editor = new Editor({ extensions: localExtensions(doc), injectCSS: false });
  resources.push({ editor, doc });
  const onPick = vi.fn();
  render(
    <EditorSurface
      editor={editor}
      mode="simple"
      documentScheme="markdown"
      selectionActions={<WritingSkillMenu editor={editor} revision={1} enabled onPick={onPick} />}
    />,
  );
  await waitFor(() => expect(editor.isInitialized).toBe(true));
  await act(async () => {
    editor.view.dom.focus();
    editor.commands.setTextSelection({ from: 1, to: 5 });
  });
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await screen.findByRole('button', { name: '✧ 技能' });
  const capturedDoc = editor.state.doc;
  fireEvent.contextMenu(editor.view.dom, { clientX: 200, clientY: 200 });
  const menu = await screen.findByRole('menu', { name: '写作技能' });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '提升法律表达' })),
  );
  expect(document.body.contains(menu)).toBe(true);
  expect(menu.closest('.selection-tools')).toBeTruthy();
  fireEvent.scroll(menu);
  expect(screen.getByRole('menu', { name: '写作技能' })).toBe(menu);
  fireEvent.scroll(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.contextMenu(editor.view.dom, { clientX: 200, clientY: 200 });
  await screen.findByRole('menu', { name: '写作技能' });
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '校对与一致性检查' }));
  expect(editor.isEditable).toBe(true);
  expect(editor.view.composing).toBe(false);
  expect(editor.state.doc).toBe(capturedDoc);
  expect(editor.state.selection.toJSON()).toEqual({ type: 'text', anchor: 1, head: 5 });
  expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(document.activeElement!);
  expect(onPick).toHaveBeenCalledOnce();
  expect(onPick.mock.calls[0][0]).toMatchObject({
    from: 1,
    to: 5,
    revision: 1,
    skill: { id: 'proofread' },
  });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(editor.state.selection.toJSON()).toEqual({ type: 'text', anchor: 1, head: 5 });
});
