// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import InspectorLayout from './InspectorLayout';
import {
  InlinePropertiesSlot,
  ResponsiveWorkspaceProvider,
  useResponsiveWorkspace,
  workspaceSize,
} from './ResponsiveWorkspace';

const initialWidth = window.innerWidth;
const initialScreen = Object.getOwnPropertyDescriptor(window.screen, 'width');
const mounts = vi.fn(),
  unmounts = vi.fn(),
  save = vi.fn();
beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(
      this.classList.contains('workspace-main') ? 0 : window.innerWidth - 300,
      44,
      this.classList.contains('workspace-main') ? window.innerWidth : 300,
      756,
    );
  });
  Object.defineProperty(window.screen, 'width', { configurable: true, value: 1920 });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
});
afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-responsive-css-test]').forEach((node) => node.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: initialWidth });
  if (initialScreen) Object.defineProperty(window.screen, 'width', initialScreen);
  else Reflect.deleteProperty(window.screen, 'width');
});

it.each([
  [1920, false, false],
  [1280, false, false],
  [1279, false, true],
  [960, false, true],
  [959, true, false],
  [640, true, false],
  [639, true, true],
  [360, true, true],
])(
  'classifies logical screen 1920 / viewport %i at exact proportional boundaries (MOCK_ONLY geometry)',
  (width, navigationHidden, inlineProperties) => {
    expect(workspaceSize(width, 1920)).toEqual({ navigationHidden, inlineProperties });
  },
);

function Conversation() {
  useEffect(() => {
    mounts();
    return unmounts;
  }, []);
  return (
    <>
      <p>运行中的原会话</p>
      <textarea aria-label="AI 原草稿" defaultValue="保留追问" />
    </>
  );
}
function Scene() {
  const layout = useResponsiveWorkspace();
  const [inspectorOpen, setInspectorOpen] = useState(true);
  return (
    <main
      className="workbench"
      data-inspector-open={inspectorOpen}
      data-navigation-hidden={layout.navigationHidden && !layout.drawerOpen}
    >
      <button onClick={() => setInspectorOpen((value) => !value)}>切换辅助栏</button>
      <button onClick={layout.toggleDrawer}>切换临时导航</button>
      <button onClick={layout.closeDrawer}>设置导航</button>
      <div className="workspace-main">
        <section className="task-layout">
          <section aria-label="标题下属性" onKeyDownCapture={save}>
            <h1>同一任务</h1>
            <InlinePropertiesSlot />
          </section>
          <aside className="task-inspector">
            <InspectorLayout properties={<input aria-label="属性草稿" defaultValue="未保存称呼" />}>
              <Conversation />
            </InspectorLayout>
          </aside>
        </section>
      </div>
    </main>
  );
}
function show() {
  return render(
    <ResponsiveWorkspaceProvider>
      <Scene />
    </ResponsiveWorkspaceProvider>,
  );
}
function resize(width: number) {
  act(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    window.dispatchEvent(new Event('resize'));
  });
}

it('keeps the same property form, focus and AI across all four modes, without forwarding property shortcuts to the title editor', () => {
  show();
  const property = screen.getByLabelText('属性草稿') as HTMLInputElement;
  const conversation = screen.getByLabelText('AI 原草稿') as HTMLTextAreaElement;
  fireEvent.change(property, { target: { value: '后续称呼' } });
  fireEvent.change(conversation, { target: { value: '正在填写的问题' } });
  property.focus();
  for (const width of [1100, 800, 500, 1920, 1100, 800, 500]) {
    resize(width);
    expect(screen.getByLabelText('属性草稿')).toBe(property);
    expect(screen.getByLabelText('AI 原草稿')).toBe(conversation);
    expect(property.value).toBe('后续称呼');
    expect(conversation.value).toBe('正在填写的问题');
    expect(document.activeElement).toBe(property);
    const inline = workspaceSize(width, 1920).inlineProperties;
    expect(screen.getByRole('region', { name: '标题下属性' }).contains(property)).toBe(inline);
  }
  fireEvent.keyDown(property, { key: 'Enter', ctrlKey: true });
  expect(save).not.toHaveBeenCalled();
  expect(mounts).toHaveBeenCalledTimes(1);
  expect(unmounts).not.toHaveBeenCalled();
});

it('clears effective maximization in both directions so a cross-mode hidden AI cannot hide the work page', () => {
  show();
  const dock = document.querySelector('.inspector-split')!;
  const conversation = screen.getByLabelText('AI 原草稿');
  fireEvent.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
  expect(dock.getAttribute('data-ai-maximized')).toBe('true');
  resize(1100);
  expect(dock.getAttribute('data-ai-maximized')).toBe('false');
  expect(dock.getAttribute('data-ai-expanded')).toBe('false');
  expect(document.querySelector('.inspector-ai-region')?.hasAttribute('hidden')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '打开 AI 对话' }));
  fireEvent.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
  expect(dock.getAttribute('data-ai-maximized')).toBe('true');
  resize(800);
  expect(dock.getAttribute('data-ai-maximized')).toBe('false');
  expect(dock.getAttribute('data-ai-expanded')).toBe('false');
  expect(screen.getByLabelText('AI 原草稿')).toBe(conversation);
  expect(document.querySelector('.inspector-ai-region')?.hasAttribute('hidden')).toBe(false);
  resize(1100);
  expect(dock.getAttribute('data-ai-expanded')).toBe('false');
});

it('returns Escape focus to the visible brand launcher after commit and preserves the draft', () => {
  vi.useFakeTimers();
  show();
  resize(1100);
  const launcher = screen.getByRole('button', { name: '打开 AI 对话' });
  fireEvent.click(launcher);
  const draft = screen.getByLabelText('AI 原草稿');
  draft.focus();
  fireEvent.keyDown(draft, { key: 'Escape' });
  act(() => vi.advanceTimersByTime(30));
  expect(document.activeElement).toBe(launcher);
  expect(document.querySelector('.inspector-ai-region')?.hasAttribute('hidden')).toBe(true);
  expect((screen.getByLabelText('AI 原草稿') as HTMLTextAreaElement).value).toBe('保留追问');
});

it('does not retain a temporary navigation drawer across narrow-wide-narrow or a settings navigation', () => {
  show();
  resize(500);
  const root = document.querySelector('main')!;
  fireEvent.click(screen.getByText('切换临时导航'));
  expect(root.getAttribute('data-navigation-hidden')).toBe('false');
  resize(1920);
  resize(500);
  expect(root.getAttribute('data-navigation-hidden')).toBe('true');
  fireEvent.click(screen.getByText('切换临时导航'));
  fireEvent.click(screen.getByText('设置导航'));
  expect(root.getAttribute('data-navigation-hidden')).toBe('true');
});

it('updates proportional presentation when the logical screen changes without a resize event (MOCK_ONLY display)', () => {
  vi.useFakeTimers();
  show();
  resize(1100);
  expect(
    document.querySelector('.inspector-split')?.getAttribute('data-responsive-inspector'),
  ).toBe('inline');
  act(() => {
    Object.defineProperty(window.screen, 'width', { configurable: true, value: 1440 });
    vi.advanceTimersByTime(1000);
  });
  expect(
    document.querySelector('.inspector-split')?.getAttribute('data-responsive-inspector'),
  ).toBe('sidebar');
});

it('honors the existing manual inspector choice for the moved form without unmounting it (MOCK_ONLY CSS)', () => {
  const style = document.createElement('style');
  style.dataset.responsiveCssTest = '';
  style.textContent =
    readFileSync('apps/desktop/src/renderer/styles/workspace-tabs.css', 'utf8') +
    readFileSync('apps/desktop/src/renderer/styles/responsive-workspace.css', 'utf8');
  document.head.append(style);
  show();
  resize(1100);
  const property = screen.getByLabelText('属性草稿');
  const slot = document.querySelector('.inline-properties-slot')!;
  expect(slot.contains(property)).toBe(true);
  fireEvent.click(screen.getByText('切换辅助栏'));
  expect(getComputedStyle(slot).display).toBe('none');
  fireEvent.click(screen.getByText('切换辅助栏'));
  expect(getComputedStyle(slot).display).not.toBe('none');
  expect(screen.getByLabelText('属性草稿')).toBe(property);
});

it('preserves expansion and maximization for an inspector without an admitted property slot across all ratios', () => {
  render(
    <ResponsiveWorkspaceProvider>
      <div className="workspace-main">
        <aside>
          <InspectorLayout properties={<input aria-label="未接入属性" />}>
            <textarea aria-label="未接入AI" defaultValue="保留原选择" />
          </InspectorLayout>
        </aside>
      </div>
    </ResponsiveWorkspaceProvider>,
  );
  const ai = screen.getByLabelText('未接入AI');
  fireEvent.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
  const dock = document.querySelector('.inspector-split')!;
  for (const width of [1100, 800, 500, 1920]) {
    resize(width);
    expect(dock.getAttribute('data-ai-expanded')).toBe('true');
    expect(dock.getAttribute('data-ai-maximized')).toBe('true');
    expect(screen.getByLabelText('未接入AI')).toBe(ai);
    expect((ai as HTMLTextAreaElement).value).toBe('保留原选择');
  }
});

it('keeps two simultaneous business layouts in their own slots and leaves an extra inspector in its home', () => {
  render(
    <ResponsiveWorkspaceProvider>
      <div className="workspace-main">
        <section className="task-layout" aria-label="布局A">
          <InlinePropertiesSlot />
          <InspectorLayout properties={<input aria-label="属性A" />}>
            <textarea aria-label="会话A" />
          </InspectorLayout>
          <InspectorLayout properties={<input aria-label="附加属性" />}>
            <textarea aria-label="附加会话" />
          </InspectorLayout>
        </section>
        <section className="project-catalog" aria-label="布局B">
          <InlinePropertiesSlot />
          <InspectorLayout properties={<input aria-label="属性B" />}>
            <textarea aria-label="会话B" />
          </InspectorLayout>
        </section>
      </div>
    </ResponsiveWorkspaceProvider>,
  );
  resize(1100);
  const a = screen.getByRole('region', { name: '布局A' }).querySelector('.inline-properties-slot')!;
  const b = screen.getByRole('region', { name: '布局B' }).querySelector('.inline-properties-slot')!;
  expect(a.contains(screen.getByLabelText('属性A'))).toBe(true);
  expect(b.contains(screen.getByLabelText('属性B'))).toBe(true);
  expect(a.contains(screen.getByLabelText('附加属性'))).toBe(false);
  expect(b.contains(screen.getByLabelText('属性A'))).toBe(false);
  expect(a.querySelectorAll('.inspector-properties-scroll')).toHaveLength(1);
  expect(b.querySelectorAll('.inspector-properties-scroll')).toHaveLength(1);
});
