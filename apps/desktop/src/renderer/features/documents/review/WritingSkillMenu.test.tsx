// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import { EditorSurface } from '../../../editors/RichEditor';
import { localExtensions } from '../../../editors/editor-config';
import { draftDoc } from '../../../editors/editor-state';
import WritingSkillMenu from './WritingSkillMenu';
import type * as Y from 'yjs';
import {
  LocalPreferencesProvider,
  initialLocalPreferences,
} from '../../../shared/data/LocalPreferences';
import { defaultWritingSkills } from '../../../shared/data/writing-skills';
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
it('shows the first three enabled personal skills in saved order and blocks disabled execution', async () => {
  const skills = [
    defaultWritingSkills[3],
    { ...defaultWritingSkills[1], enabled: false },
    defaultWritingSkills[0],
    defaultWritingSkills[2],
    defaultWritingSkills[4],
  ];
  Object.defineProperty(window, 'caselite', {
    configurable: true,
    value: {
      preferences: vi.fn(async () => ({
        ok: true,
        preferences: { ...initialLocalPreferences, writing_skills: skills },
        receipt: null,
      })),
    },
  });
  const doc = draftDoc({ text: '原文条款', state: null });
  const editor = new Editor({ extensions: localExtensions(doc), injectCSS: false });
  resources.push({ editor, doc });
  const onPick = vi.fn();
  const view = render(
    <LocalPreferencesProvider>
      <EditorSurface
        editor={editor}
        mode="simple"
        documentScheme="markdown"
        selectionActions={<WritingSkillMenu editor={editor} revision={1} enabled onPick={onPick} />}
      />
    </LocalPreferencesProvider>,
  );
  await waitFor(() => expect(editor.isInitialized).toBe(true));
  await act(async () => {
    editor.view.dom.focus();
    editor.commands.setTextSelection({ from: 1, to: 5 });
  });
  const region = await screen.findByRole('region', { name: '常用写作技能' });
  await waitFor(() =>
    expect(
      [...region.querySelectorAll('.writing-skill-quick')].map((b) =>
        b.textContent?.replace('↗', ''),
      ),
    ).toEqual(['摘要与要点提炼', '提升法律表达', '解释条款']),
  );
  fireEvent.click(screen.getByRole('button', { name: '摘要与要点提炼', exact: true }));
  expect(onPick).toHaveBeenCalledOnce();
  view.rerender(
    <LocalPreferencesProvider>
      <EditorSurface
        editor={editor}
        mode="simple"
        documentScheme="markdown"
        selectionActions={
          <WritingSkillMenu editor={editor} revision={1} enabled={false} onPick={onPick} />
        }
      />
    </LocalPreferencesProvider>,
  );
  const button = screen.getByRole<HTMLButtonElement>('button', {
    name: '提升法律表达',
    exact: true,
  });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(onPick).toHaveBeenCalledOnce();
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
  await screen.findByRole('button', { name: '更多技能…' });
  const capturedDoc = editor.state.doc;
  fireEvent.contextMenu(editor.view.dom, { clientX: 200, clientY: 200 });
  const shortcuts = screen.getByRole('region', { name: '常用写作技能' });
  expect(shortcuts.querySelectorAll('.writing-skill-quick')).toHaveLength(3);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更多技能…' }));
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
  fireEvent.click(screen.getByRole('button', { name: '更多技能…' }));
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
