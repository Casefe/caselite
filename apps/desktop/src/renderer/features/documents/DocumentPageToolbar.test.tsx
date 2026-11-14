// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DocumentPageToolbar from './DocumentPageToolbar';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function props() {
  return {
    documentId: 'document-a',
    title: '合成文档',
    path: '我的文档 / 工作文档 / 合成文档',
    favorite: <button aria-label="已有收藏入口">☆</button>,
    disabled: false,
    backDisabled: false,
    split: false,
    orientation: 'horizontal' as const,
    wide: false,
    onBack: vi.fn(),
    onToggleSplit: vi.fn(),
    onToggleOrientation: vi.fn(),
    onToggleWide: vi.fn(),
  };
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: '更多文档操作' }));
  return screen.getByRole('menu', { name: '文档页面操作' });
}

// 保留既有测试身份与权限断言；标题布局改为页签后，同时覆盖项目上下文短标题。
it('常驻标题/私人边界与原收藏入口，共享明确未接入，不出现未接线的管理动作', () => {
  const actions = props();
  const { rerender } = render(<DocumentPageToolbar {...actions} />);
  const header = screen.getByRole('banner', { name: '文档页面顶栏' });
  expect(within(header).queryByText('合成文档')).toBeNull();
  expect(within(header).getByText('私人').title).toContain('尚未启用共享');
  expect(within(header).getByRole('button', { name: '已有收藏入口' })).toBeTruthy();
  expect(screen.queryByRole('menu')).toBeNull();
  const menu = open();
  const share = within(menu).getByRole<HTMLButtonElement>('menuitem', { name: '共享' });
  expect(share.disabled).toBe(true);
  expect(document.getElementById(share.getAttribute('aria-describedby')!)?.textContent).toContain(
    '共享功能尚未接入',
  );
  expect(within(menu).getByRole('menuitemcheckbox', { name: '双栏预览' })).toBeTruthy();
  expect(within(menu).queryByText(/导出|删除|复制链接|修改属性/)).toBeNull();
  expect(actions.onToggleSplit).not.toHaveBeenCalled();
  rerender(<DocumentPageToolbar {...actions} showContextTitle />);
  expect(within(header).getByText('合成文档').title).toBe(actions.path);
});

it('页面动作调用原回调，选择后关闭并返回触发按钮', () => {
  const actions = props();
  render(<DocumentPageToolbar {...actions} />);
  fireEvent.click(within(open()).getByRole('menuitemcheckbox', { name: '双栏预览' }));
  expect(actions.onToggleSplit).toHaveBeenCalledTimes(1);
  expect(actions.onToggleOrientation).not.toHaveBeenCalled();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '更多文档操作' }));
  fireEvent.click(within(open()).getByRole('menuitemcheckbox', { name: '全宽阅读' }));
  expect(actions.onToggleWide).toHaveBeenCalledTimes(1);
});

it('脏状态/在途锁仍禁用分栏和方向；纯阅读宽度不触发保存或分栏回调', () => {
  const actions = props();
  render(<DocumentPageToolbar {...actions} disabled backDisabled split />);
  const menu = open();
  const split = within(menu).getByRole<HTMLButtonElement>('menuitemcheckbox', { name: '收起双栏' });
  const orientation = within(menu).getByRole<HTMLButtonElement>('menuitem', { name: '上下分栏' });
  expect(split.disabled).toBe(true);
  expect(orientation.disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '返回文件夹' }).disabled).toBe(true);
  fireEvent.click(split);
  fireEvent.click(orientation);
  expect(actions.onToggleSplit).not.toHaveBeenCalled();
  expect(actions.onToggleOrientation).not.toHaveBeenCalled();
  fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: '全宽阅读' }));
  expect(actions.onToggleWide).toHaveBeenCalledTimes(1);
});

it('箭头/Home/End只移动菜单焦点，Escape关闭回焦，组合输入不误触关闭', () => {
  const actions = props();
  render(<DocumentPageToolbar {...actions} split />);
  const trigger = screen.getByRole('button', { name: '更多文档操作' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const menu = screen.getByRole('menu');
  const width = within(menu).getByRole('menuitemcheckbox', { name: '全宽阅读' });
  const split = within(menu).getByRole('menuitemcheckbox', { name: '收起双栏' });
  const direction = within(menu).getByRole('menuitem', { name: '上下分栏' });
  expect(document.activeElement).toBe(width);
  fireEvent.keyDown(width, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(split);
  fireEvent.keyDown(split, { key: 'End' });
  expect(document.activeElement).toBe(direction);
  fireEvent.keyDown(direction, { key: 'Home' });
  expect(document.activeElement).toBe(width);
  fireEvent.keyDown(width, { key: 'Escape', isComposing: true });
  expect(screen.getByRole('menu')).toBe(menu);
  fireEvent.keyDown(width, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(actions.onToggleSplit).not.toHaveBeenCalled();
});

it('外部点击或切文会关闭旧菜单，侧边输入仍是同一节点且内容保留', () => {
  const actions = props();
  const view = (documentId: string) => (
    <>
      <textarea aria-label="既有AI草稿" defaultValue="尚未发送的问题" />
      <DocumentPageToolbar {...actions} documentId={documentId} />
    </>
  );
  const { rerender } = render(view('document-a'));
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '既有AI草稿' });
  const menu = open();
  fireEvent.pointerDown(menu);
  expect(screen.getByRole('menu')).toBe(menu);
  fireEvent.pointerDown(input);
  expect(screen.queryByRole('menu')).toBeNull();
  open();
  rerender(view('document-b'));
  expect(screen.queryByRole('menu')).toBeNull();
  input.focus();
  rerender(view('document-a'));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(input);
  expect(screen.getByRole('textbox', { name: '既有AI草稿' })).toBe(input);
  expect(input.value).toBe('尚未发送的问题');
  expect(actions.onToggleSplit).not.toHaveBeenCalled();
});

it('短窄视口菜单保持在窗口内，窗口变化后关闭，空态不启用阅读设置', () => {
  vi.stubGlobal('innerWidth', 300);
  vi.stubGlobal('innerHeight', 240);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const isMenu = this.getAttribute('role') === 'menu';
    const x = isMenu ? 0 : 270,
      y = isMenu ? 0 : 210,
      width = isMenu ? 228 : 30,
      height = isMenu ? 190 : 30;
    return {
      x,
      y,
      left: x,
      top: y,
      width,
      height,
      right: x + width,
      bottom: y + height,
      toJSON() {},
    };
  });
  render(<DocumentPageToolbar {...props()} documentId={undefined} />);
  const menu = open();
  const left = parseFloat(menu.style.left),
    top = parseFloat(menu.style.top);
  expect(left).toBeGreaterThanOrEqual(8);
  expect(left + 228).toBeLessThanOrEqual(292);
  expect(top).toBeGreaterThanOrEqual(8);
  expect(top + 190).toBeLessThanOrEqual(232);
  expect(
    within(menu).getByRole<HTMLButtonElement>('menuitemcheckbox', { name: '全宽阅读' }).disabled,
  ).toBe(true);
  fireEvent(window, new Event('resize'));
  expect(screen.queryByRole('menu')).toBeNull();
});

it('既有AI审阅入口仅在当前文稿可用时调用一次，锁定后不能离开', () => {
  const onOpenReview = vi.fn();
  const actions = props();
  const { rerender } = render(<DocumentPageToolbar {...actions} onOpenReview={onOpenReview} />);
  fireEvent.click(within(open()).getByRole('menuitem', { name: 'AI 审阅' }));
  expect(onOpenReview).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).toBeNull();
  const menu = open();
  const action = within(menu).getByRole<HTMLButtonElement>('menuitem', { name: 'AI 审阅' });
  rerender(<DocumentPageToolbar {...actions} disabled onOpenReview={onOpenReview} />);
  expect(action.disabled).toBe(true);
  fireEvent.click(action);
  expect(onOpenReview).toHaveBeenCalledTimes(1);
});
