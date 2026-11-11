// @vitest-environment jsdom
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import { StrictMode, useEffect } from 'react';
import { DraftEditor, draftDoc, EditorSurface, localExtensions } from './RichEditor';
import * as Y from 'yjs';

// jsdom无真实排版，只补齐Range几何API；本测试只验锁定，定位另由真实Electron验证。
const previousRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const previousRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [new DOMRect(0, 0, 1, 20)],
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 20),
  });
});
afterEach(cleanup);
afterAll(() => {
  if (previousRects) Object.defineProperty(Range.prototype, 'getClientRects', previousRects);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  if (previousRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', previousRect);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});
describe('rich input locking', () => {
  it.each(['compact', 'simple', 'notion'] as const)(
    'restores the first click and input after the owner unlocks %s without changing saved Yjs',
    async (mode) => {
      const doc = draftDoc({ text: '已保存且暂时锁定的正文', state: null });
      const editor = new Editor({
        extensions: localExtensions(doc),
        injectCSS: false,
        editable: false,
      });
      const updates = vi.fn();
      editor.on('update', updates);
      function Owner({ disabled }: { disabled: boolean }) {
        useEffect(() => {
          editor.setEditable(!disabled, false);
        }, [disabled]);
        return <EditorSurface editor={editor} mode={mode} disabled={disabled} />;
      }
      const view = render(<Owner disabled />);
      try {
        await waitFor(() => expect(editor.isInitialized).toBe(true));
        const input = screen.getByRole('textbox');
        const surface = input.closest('.editor-surface')!;
        const saved = Y.encodeStateAsUpdate(doc);
        const selection = editor.state.selection.toJSON();
        const undo = editor.can().undo();
        for (let i = 0; i < 2; i++) {
          view.rerender(<Owner disabled={false} />);
          await waitFor(() => expect(surface.getAttribute('aria-disabled')).toBe('false'));
          expect(input.getAttribute('contenteditable')).toBe('true');
          expect(screen.getByRole('textbox')).toBe(input);
          expect(Y.encodeStateAsUpdate(doc)).toEqual(saved);
          expect(editor.state.selection.toJSON()).toEqual(selection);
          expect(editor.can().undo()).toBe(undo);
          expect(updates).not.toHaveBeenCalled();
          view.rerender(<Owner disabled />);
          await waitFor(() => expect(input.getAttribute('contenteditable')).toBe('false'));
          const blocked = createEvent.click(input);
          fireEvent(input, blocked);
          expect(blocked.defaultPrevented).toBe(true);
          expect(Y.encodeStateAsUpdate(doc)).toEqual(saved);
        }
        view.rerender(<Owner disabled={false} />);
        await waitFor(() => expect(surface.getAttribute('aria-disabled')).toBe('false'));
        const firstClick = createEvent.click(input);
        fireEvent(input, firstClick);
        expect(firstClick.defaultPrevented).toBe(false);
        await act(async () => {
          editor.commands.insertContent('新增输入');
        });
        expect(editor.getText()).toContain('新增输入');
        expect(updates).toHaveBeenCalled();
      } finally {
        view.unmount();
        editor.destroy();
        doc.destroy();
      }
    },
  );
  it('keeps selection-menu lifecycle and formatting isolated across document and compact editors', async () => {
    const firstDoc = draftDoc({ text: '文档条款独立保存', state: null });
    const secondDoc = draftDoc({ text: '项目任务评论独立保存', state: null });
    const first = new Editor({ extensions: localExtensions(firstDoc), injectCSS: false });
    const second = new Editor({ extensions: localExtensions(secondDoc), injectCSS: false });
    const firstUpdates = vi.fn();
    const secondUpdates = vi.fn();
    first.on('update', firstUpdates);
    second.on('update', secondUpdates);
    const firstState = Y.encodeStateAsUpdate(firstDoc);
    const secondState = Y.encodeStateAsUpdate(secondDoc);
    const view = render(
      <StrictMode>
        <EditorSurface editor={first} mode="simple" />
        <EditorSurface editor={second} mode="compact" />
      </StrictMode>,
    );
    try {
      await waitFor(() => expect(first.isInitialized && second.isInitialized).toBe(true));
      await act(async () => {
        first.view.dom.focus();
        first.commands.setTextSelection({ from: 1, to: 5 });
      });
      const menu = await screen.findByRole('toolbar', { name: '选区格式' });
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      expect(document.body.contains(menu)).toBe(true);
      await waitFor(() =>
        expect((menu.closest('.selection-tools') as HTMLElement).style.visibility).toBe('visible'),
      );
      expect(Y.encodeStateAsUpdate(firstDoc)).toEqual(firstState);
      expect(firstUpdates).not.toHaveBeenCalled();
      await act(async () => {
        (menu.querySelector('[aria-label=加粗]') as HTMLButtonElement).focus();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      expect(document.body.contains(menu)).toBe(true);
      fireEvent.mouseDown(menu.querySelector('[aria-label=加粗]')!);
      fireEvent.click(menu.querySelector('[aria-label=加粗]')!);
      expect(first.getJSON().content?.[0].content?.[0].marks).toEqual([{ type: 'bold' }]);
      expect(Y.encodeStateAsUpdate(secondDoc)).toEqual(secondState);
      await act(async () => {
        first.commands.undo();
      });
      expect(first.getJSON().content?.[0].content?.[0].marks).toBeUndefined();
      await waitFor(() => expect(first.view.hasFocus()).toBe(true));
      await act(async () => {
        second.view.dom.focus();
        second.commands.setTextSelection({ from: 1, to: 5 });
      });
      await waitFor(() => {
        const menus = screen.getAllByRole('toolbar', { name: '选区格式' });
        expect(menus).toHaveLength(1);
        expect(menus[0].closest('[data-editor-mode]')?.getAttribute('data-editor-mode')).toBe(
          'compact',
        );
      });
      const compactMenu = screen.getByRole('toolbar', { name: '选区格式' });
      await act(async () => {
        (compactMenu.querySelector('[aria-label=斜体]') as HTMLButtonElement).focus();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      expect(document.body.contains(compactMenu)).toBe(true);
      expect(compactMenu.closest('[data-editor-mode]')?.getAttribute('data-editor-mode')).toBe(
        'compact',
      );
      expect(second.state.selection.toJSON()).toEqual({ type: 'text', anchor: 1, head: 5 });
      fireEvent.click(compactMenu.querySelector('[aria-label=斜体]')!);
      expect(second.getJSON().content?.[0].content?.[0].marks).toEqual([{ type: 'italic' }]);
      expect(first.getJSON().content?.[0].content?.[0].marks).toBeUndefined();
      await act(async () => {
        second.commands.undo();
      });
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          second.commands.setTextSelection(1);
        });
        await waitFor(() => expect(screen.queryByRole('toolbar', { name: '选区格式' })).toBeNull());
        await act(async () => {
          second.commands.setTextSelection({ from: 1, to: 5 });
        });
        await screen.findByRole('toolbar', { name: '选区格式' });
      }
      secondUpdates.mockClear();
      const saved = Y.encodeStateAsUpdate(secondDoc);
      fireEvent.compositionStart(second.view.dom);
      await waitFor(() => expect(screen.queryByRole('toolbar', { name: '选区格式' })).toBeNull());
      fireEvent.keyDown(second.view.dom, { key: 'Enter', isComposing: true });
      fireEvent.compositionEnd(second.view.dom);
      expect(Y.encodeStateAsUpdate(secondDoc)).toEqual(saved);
      expect(secondUpdates).not.toHaveBeenCalled();
      await act(async () => {
        second.setEditable(false, false);
      });
      view.rerender(<EditorSurface editor={second} mode="compact" disabled />);
      await waitFor(() => expect(screen.queryByRole('toolbar', { name: '选区格式' })).toBeNull());
      expect(Y.encodeStateAsUpdate(secondDoc)).toEqual(saved);
      expect(secondUpdates).not.toHaveBeenCalled();
      view.unmount();
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      expect(document.querySelector('.selection-tools')).toBeNull();
    } finally {
      view.unmount();
      first.destroy();
      second.destroy();
      firstDoc.destroy();
      secondDoc.destroy();
    }
  });
  it('switches document schemes without changing Yjs, selection or undo history, and retains tables', async () => {
    const doc = draftDoc({ text: '合成付款条款', state: null });
    const editor = new Editor({ extensions: localExtensions(doc, true), injectCSS: false });
    const view = render(<EditorSurface editor={editor} mode="simple" documentScheme="word" />);
    try {
      await screen.findByRole('toolbar', { name: '文档格式' });
      editor.commands.setTextSelection({ from: 1, to: 3 });
      editor.commands.toggleBold();
      const selection = editor.state.selection.toJSON();
      const before = Y.encodeStateAsUpdate(doc);
      const undo = editor.can().undo();
      view.rerender(<EditorSurface editor={editor} mode="simple" documentScheme="markdown" />);
      expect(screen.getByText('Markdown · 快捷写作')).toBeTruthy();
      // jsdom 不实现 details 的原生可见性；桌面测试另验工具栏确实收起。
      expect(screen.getByRole('toolbar', { name: '文档格式' }).closest('details')?.open).toBe(
        false,
      );
      expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
      expect(editor.state.selection.toJSON()).toEqual(selection);
      expect(editor.can().undo()).toBe(undo);
      view.rerender(<EditorSurface editor={editor} mode="simple" documentScheme="word" />);
      expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
      expect(editor.state.selection.toJSON()).toEqual(selection);
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getJSON().content?.[0].content?.[0].marks).toBeUndefined();
      editor.commands.focus('end');
      editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false });
      const tableState = Y.encodeStateAsUpdate(doc);
      view.rerender(<EditorSurface editor={editor} mode="simple" documentScheme="markdown" />);
      expect(view.container.querySelectorAll('td')).toHaveLength(4);
      expect(Y.encodeStateAsUpdate(doc)).toEqual(tableState);
    } finally {
      view.unmount();
      editor.destroy();
      doc.destroy();
    }
  });
  it('does not mark a saved body dirty when a save or archive toggles read-only mode', async () => {
    const change = vi.fn();
    const props = {
      value: { text: '已保存项目说明', state: null },
      onChange: change,
      label: '项目说明锁定',
    };
    const view = render(<DraftEditor {...props} />);
    const input = await screen.findByRole('textbox', { name: props.label });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(change).not.toHaveBeenCalled();
    const content = input.innerHTML;
    view.rerender(<DraftEditor {...props} disabled />);
    await waitFor(() => expect(input.getAttribute('contenteditable')).toBe('false'));
    expect(change).not.toHaveBeenCalled();
    view.rerender(<DraftEditor {...props} disabled={false} />);
    await waitFor(() => expect(input.getAttribute('contenteditable')).toBe('true'));
    await waitFor(() =>
      expect(input.closest('.editor-surface')?.getAttribute('aria-disabled')).toBe('false'),
    );
    expect(screen.getByRole('textbox', { name: props.label })).toBe(input);
    expect(change).not.toHaveBeenCalled();
    expect(input.innerHTML).toBe(content);
  });
  it('does not let an open block menu or active drag modify a disabled submission', async () => {
    const change = vi.fn();
    const props = {
      value: { text: '第一段\n第二段', state: null },
      onChange: change,
      label: '受控任务说明',
    };
    const view = render(<DraftEditor {...props} />);
    const input = await screen.findByRole('textbox', { name: '受控任务说明' });
    input.focus();
    const handle = await screen.findByRole('button', { name: '块操作' });
    fireEvent.click(handle);
    expect(screen.getByRole('menuitem', { name: '复制块' })).toBeTruthy();
    const before = input.innerHTML;
    const transfer = { setData: vi.fn(), getData: () => '', effectAllowed: '' };
    fireEvent.dragStart(handle, { dataTransfer: transfer });
    view.rerender(<DraftEditor {...props} disabled />);
    await waitFor(() => expect(input.getAttribute('contenteditable')).toBe('false'));
    expect(screen.queryByRole('menuitem', { name: '复制块' })).toBeNull();
    expect(screen.queryByRole('button', { name: '块操作' })).toBeNull();
    fireEvent.drop(input.closest('[data-editor-mode]')!, {
      dataTransfer: transfer,
      clientX: 0,
      clientY: 0,
    });
    expect(input.innerHTML).toBe(before);
    expect(input.textContent).toBe('第一段第二段');
  });
  it('does not treat persisted-body hydration as an unsaved user change', async () => {
    const doc = draftDoc({ text: '已保存项目说明', state: null });
    const state = Array.from(Y.encodeStateAsUpdate(doc));
    doc.destroy();
    const change = vi.fn();
    render(<DraftEditor value={{ text: '', state }} onChange={change} label="已保存说明" />);
    const input = await screen.findByRole('textbox', { name: '已保存说明' });
    await new Promise((r) => setTimeout(r, 20));
    expect(input.textContent).toBe('已保存项目说明');
    expect(change).not.toHaveBeenCalled();
    input.focus();
    fireEvent.click(await screen.findByRole('button', { name: '块操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '复制块' }));
    await waitFor(() => expect(change).toHaveBeenCalled());
  });
});
