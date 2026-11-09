// @vitest-environment jsdom
// DEV-1849：经用户批准，改编MIT上游测试场景，不导入其内部状态/Harness。
// bvaughn/react-resizable-panels@0910b4f0450dec5f4906f96eb4518e0e14debe09
// Group.test.tsx：重挂载、键盘、多组；abortActivePointerResize.test.ts：拖动中断。
// Copyright (c) 2018 Brian Vaughn；MIT全文见legal/THIRD-PARTY-SPLIT-PREVIEW-NOTICES.txt。
import { useEffect } from 'react';
import userEvent from '@testing-library/user-event';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SplitPreviewWorkspace, { useSplitPreviewSelection } from './SplitPreviewWorkspace';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const left = this.id.endsWith('-secondary') || this.hasAttribute('data-separator') ? 400 : 0;
    return {
      x: left,
      y: 0,
      left,
      top: 0,
      width: 400,
      height: 600,
      right: left + 400,
      bottom: 600,
      toJSON: () => ({}),
    };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Reader({ onMount }: { onMount(): void }) {
  useEffect(onMount, [onMount]);
  return <textarea aria-label="保留阅读状态" defaultValue="原文" />;
}

function Example({
  name,
  onMount,
  disabled = false,
}: {
  name: string;
  onMount(): void;
  disabled?: boolean;
}) {
  const selection = useSplitPreviewSelection();
  return (
    <div aria-label={name}>
      <button onClick={() => selection.select('乙')}>选择乙</button>
      <output>
        {selection.primary ?? '甲'}/{selection.secondary ?? '空'}/{selection.active}
      </output>
      <SplitPreviewWorkspace
        split={selection.split}
        activePane={selection.active}
        disabled={disabled}
        onActivate={selection.activate}
        onToggle={() => selection.toggle('甲')}
        primary={{ title: selection.primary ?? '甲', content: <Reader onMount={onMount} /> }}
        secondary={
          selection.secondary ? { title: selection.secondary, content: <p>副栏内容</p> } : null
        }
      />
    </div>
  );
}

it('改变属性、分栏方向及收起展开不重建主阅读器，保留输入和滚动位置', () => {
  const mounted = vi.fn();
  const { rerender } = render(<Example name="文档" onMount={mounted} />);
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '保留阅读状态' });
  input.value = '未提交阅读状态';
  const scroll = input.closest('.split-preview-scroll')!;
  scroll.scrollTop = 90;
  fireEvent.click(screen.getByRole('button', { name: '双栏预览' }));
  fireEvent.click(screen.getByRole('button', { name: '上下分栏' }));
  rerender(<Example name="文档新属性" onMount={mounted} />);
  fireEvent.click(screen.getByRole('button', { name: '收起双栏' }));
  fireEvent.click(screen.getByRole('button', { name: '双栏预览' }));
  expect(screen.getByRole('textbox', { name: '保留阅读状态' })).toBe(input);
  expect(input.value).toBe('未提交阅读状态');
  expect(scroll.scrollTop).toBe(90);
  expect(mounted).toHaveBeenCalledTimes(1);
});

it('左右选择独立，收起后回主栏，重新展开仍保留副栏对象', () => {
  render(<Example name="文档" onMount={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '双栏预览' }));
  fireEvent.click(screen.getByRole('button', { name: '副预览' }));
  fireEvent.click(screen.getByRole('button', { name: '选择乙' }));
  expect(screen.getByRole('status').textContent).toBe('甲/乙/secondary');
  fireEvent.click(screen.getByRole('button', { name: '收起双栏' }));
  expect(screen.getByRole('status').textContent).toBe('甲/乙/primary');
  expect(screen.queryByRole('separator', { name: '调整预览分栏' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '双栏预览' }));
  expect(screen.getByText('副栏内容')).toBeTruthy();
});

it('多个工作区的键盘分栏调整互不串组，禁用后不能继续调整', () => {
  const mounted = vi.fn();
  const { rerender } = render(
    <>
      <Example name="文档" onMount={mounted} />
      <Example name="材料" onMount={mounted} />
    </>,
  );
  const docs = within(screen.getByLabelText('文档')),
    materials = within(screen.getByLabelText('材料'));
  fireEvent.click(docs.getByRole('button', { name: '双栏预览' }));
  fireEvent.click(materials.getByRole('button', { name: '双栏预览' }));
  const first = docs.getByRole('separator'),
    second = materials.getByRole('separator');
  const before = first.getAttribute('aria-valuenow'),
    otherBefore = second.getAttribute('aria-valuenow');
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(first.getAttribute('aria-valuenow')).not.toBe(before);
  expect(second.getAttribute('aria-valuenow')).toBe(otherBefore);
  rerender(
    <>
      <Example name="文档" onMount={mounted} disabled />
      <Example name="材料" onMount={mounted} />
    </>,
  );
  const stopped = first.getAttribute('aria-valuenow');
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(first.getAttribute('aria-valuenow')).toBe(stopped);
  expect(docs.getByRole<HTMLButtonElement>('button', { name: '收起双栏' }).disabled).toBe(true);
});

function pointer(target: Element | Document, type: string, x: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    buttons: type === 'pointerup' ? 0 : 1,
    button: 0,
    clientX: x,
    clientY: 100,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: 'mouse' },
    isPrimary: { value: true },
    movementX: { value: 50 },
    movementY: { value: 0 },
  });
  fireEvent(target, event);
}

it.each(['pointercancel', 'lostpointercapture', 'blur'])(
  '拖动遇到%s后继续移动不得再调整布局',
  async (event) => {
    render(<Example name="文档" onMount={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '双栏预览' }));
    const separator = screen.getByRole('separator');
    const before = separator.getAttribute('aria-valuenow');
    pointer(separator, 'pointerdown', 400);
    pointer(document, 'pointermove', 450);
    expect(separator.getAttribute('aria-valuenow')).not.toBe(before);
    if (event === 'blur') fireEvent(window, new Event(event));
    else
      fireEvent(
        event === 'lostpointercapture' ? separator : document,
        new Event(event, { bubbles: true }),
      );
    const stopped = separator.getAttribute('aria-valuenow');
    pointer(document, 'pointermove', 600);
    expect(separator.getAttribute('aria-valuenow')).toBe(stopped);
    pointer(document, 'pointerup', 600);
  },
);
