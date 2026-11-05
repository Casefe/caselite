// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DraftEditor, draftDoc } from './RichEditor';
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
