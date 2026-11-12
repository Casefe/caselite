// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import { readFileSync } from 'node:fs';
import { createPortal } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentRequest, AgentResponse } from '../../preload/caselite-api';
import SidebarAgent from './SidebarAgent';
import userEvent from '@testing-library/user-event';
import InspectorLayout from './InspectorLayout';
import EditorConversation from '../features/documents/review/EditorConversation';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(cleanup);
it('shows optional quick actions only after expansion while preserving the same conversation input', () => {
  const action = vi.fn();
  render(
    <InspectorLayout properties={null} expandedActions={<button onClick={action}>快速操作</button>}>
      <textarea aria-label="原会话输入" defaultValue="未发出的要求" />
    </InspectorLayout>,
  );
  const input = screen.getByLabelText('原会话输入');
  expect(screen.queryByRole('button', { name: '快速操作' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '展开 AI 对话' }));
  fireEvent.click(screen.getByRole('button', { name: '快速操作' }));
  expect(action).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '收起 AI 对话' }));
  expect(screen.queryByRole('button', { name: '快速操作' })).toBeNull();
  expect(screen.getByLabelText('原会话输入')).toBe(input);
  expect((input as HTMLTextAreaElement).value).toBe('未发出的要求');
});
it('floats at property width, expands on conversation click, supports keyboard width and resets on minimize', async () => {
  const geometry = vi
    .spyOn(HTMLDivElement.prototype, 'getBoundingClientRect')
    .mockImplementation(
      () => ({ width: 320, right: window.innerWidth - 24, bottom: 700, height: 600 }) as DOMRect,
    );
  try {
    render(
      <InspectorLayout properties={<p>属性内容</p>}>
        <div className="assistant-viewport" data-testid="历史滚动区">
          <p>点击会话区域</p>
        </div>
        <textarea aria-label="草稿" defaultValue="保留输入" />
      </InspectorLayout>,
    );
    const panel = screen.getByRole('region', { name: 'AI 对话' });
    const outer = panel.querySelector<HTMLElement>('.inspector-ai-scroll')!;
    const history = screen.getByTestId('历史滚动区');
    Object.defineProperty(outer, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(history, 'scrollHeight', { configurable: true, value: 640 });
    expect(panel.style.width).toBe('320px');
    expect(screen.queryByRole('separator')).toBeNull();
    fireEvent.click(screen.getByText('点击会话区域'));
    expect(panel.style.width).toBe(`${Math.max(320, window.innerWidth / 4)}px`);
    expect(panel.style.height).toBe('510px');
    expect(outer.scrollTop).toBe(900);
    expect(history.scrollTop).toBe(640);
    const handle = screen.getByRole('separator', { name: '调整 AI 对话宽度' });
    handle.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(panel.style.width).toBe(`${Math.max(320, window.innerWidth / 4) + 24}px`);
    await userEvent.keyboard('{End}');
    expect(panel.style.width).toBe(`${window.innerWidth - 36}px`);
    await userEvent.keyboard('{Home}');
    expect(panel.style.width).toBe('320px');
    fireEvent.click(screen.getByTitle('最小化 AI 对话'));
    expect(panel.style.width).toBe('320px');
    fireEvent.click(screen.getByText('点击会话区域'));
    expect(panel.style.width).toBe(`${Math.max(320, window.innerWidth / 4)}px`);
    expect((screen.getByLabelText('草稿') as HTMLTextAreaElement).value).toBe('保留输入');
  } finally {
    geometry.mockRestore();
  }
});

it('preserves the mounted conversation and dock, draft, attachment and running state across keyboard resizing', async () => {
  const mounted = vi.fn();
  const stopped = vi.fn();
  const sent = vi.fn();
  const dock = vi.fn();
  function Conversation() {
    const [draft, setDraft] = useState('未发送草稿');
    const [attachment] = useState('合成附件.pdf');
    useEffect(() => {
      mounted();
      return stopped;
    }, []);
    return (
      <div ref={dock}>
        <p>原会话历史</p>
        <p>{attachment}</p>
        <p>流式部分输出</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            sent();
          }}
        >
          <textarea aria-label="问题" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit">发送</button>
          <button type="button" onClick={stopped}>
            停止
          </button>
        </form>
      </div>
    );
  }
  render(
    <InspectorLayout properties={<input aria-label="属性" />}>
      <Conversation />
    </InspectorLayout>,
  );
  const user = userEvent.setup();
  const toggle = screen.getByRole('button', { name: '展开 AI 对话' });
  const input = screen.getByLabelText('问题');
  const node = input.parentElement;
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  screen.getByLabelText('属性').focus();
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(toggle);
  for (let i = 0; i < 3; i++) {
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(input);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(input.parentElement).toBe(node);
    expect((input as HTMLTextAreaElement).value).toBe('未发送草稿');
    expect(screen.getByText('合成附件.pdf')).toBeTruthy();
    expect(screen.getByText('原会话历史')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
    expect(input.parentElement).toBe(node);
    expect(screen.getByText('流式部分输出')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '还原 AI 对话' }));
    expect(input.parentElement).toBe(node);
  }
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(toggle);
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(dock).toHaveBeenCalledTimes(1);
  expect(stopped).not.toHaveBeenCalled();
  expect(sent).not.toHaveBeenCalled();
  fireEvent.submit(input.closest('form')!);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(sent).toHaveBeenCalledTimes(1);
});

it('retains an expanded conversation and collapse control while property guards block activation', () => {
  const view = render(
    <InspectorLayout properties={<input aria-label="属性" />}>
      <textarea aria-label="问题" />
    </InspectorLayout>,
  );
  const input = screen.getByLabelText('问题');
  fireEvent.focus(input);
  view.rerender(
    <InspectorLayout blocked properties={<input aria-label="属性" />}>
      <textarea aria-label="问题" />
    </InspectorLayout>,
  );
  const toggle = screen.getByRole<HTMLButtonElement>('button', { name: '收起 AI 对话' });
  expect(toggle.disabled).toBe(false);
  fireEvent.click(toggle);
  expect(toggle.disabled).toBe(true);
  fireEvent.focus(input);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});

it('leaves Escape inside a modal reader to its own cancel behavior', () => {
  const escape = vi.fn();
  render(
    <InspectorLayout properties={null}>
      <dialog
        open
        onKeyDown={(event) => {
          escape(event.defaultPrevented);
        }}
      >
        <button>原件阅读控件</button>
      </dialog>
    </InspectorLayout>,
  );
  const toggle = screen.getByRole('button', { name: '展开 AI 对话' });
  fireEvent.click(toggle);
  const target = screen.getByRole('button', { name: '原件阅读控件' });
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(escape).toHaveBeenCalledWith(false);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
});

it('expands on the actual editor conversation send action after collapsing with a draft', async () => {
  const send = vi.fn();
  render(
    <InspectorLayout properties={null}>
      <EditorConversation
        messages={[]}
        question="保留审阅要求"
        onQuestion={() => {}}
        send={send}
        stop={() => {}}
        running={false}
        disabled={false}
      />
    </InspectorLayout>,
  );
  const button = screen.getByRole('button', { name: '发送本轮审阅' });
  expect(button.getAttribute('type')).toBe('button');
  expect(screen.getByRole('button', { name: '展开 AI 对话' })).toBeTruthy();
  fireEvent.click(button);
  expect(screen.getByRole('button', { name: '收起 AI 对话' })).toBeTruthy();
  expect(send).toHaveBeenCalledTimes(1);
});

it('activates and collapses the real conversation across a portal without replacing its dock', () => {
  const send = vi.fn();
  function PortalDock() {
    const [dock, setDock] = useState<HTMLDivElement | null>(null);
    return (
      <>
        <InspectorLayout properties={null}>
          <div ref={setDock} />
        </InspectorLayout>
        {dock &&
          createPortal(
            <EditorConversation
              messages={[]}
              question="portal 草稿"
              onQuestion={() => {}}
              send={send}
              stop={() => {}}
              running={false}
              disabled={false}
            />,
            dock,
          )}
      </>
    );
  }
  render(<PortalDock />);
  const input = screen.getByRole('textbox', { name: '本轮问题' });
  const dock = input.closest('.editor-agent-thread')?.parentElement;
  fireEvent.focusIn(input);
  const toggle = screen.getByRole('button', { name: '收起 AI 对话' });
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: '发送本轮审阅' }));
  expect(send).toHaveBeenCalledTimes(1);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
  expect(input.closest('.editor-agent-thread')?.parentElement).toBe(dock);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(toggle);
  expect(input).toBe(screen.getByRole('textbox', { name: '本轮问题' }));
  expect(input.closest('.editor-agent-thread')?.parentElement).toBe(dock);
});

it('composes several cards while preserving the property form and active AI when statistics moves or closes', () => {
  function Host() {
    const [position, setPosition] = useState<'top' | 'middle' | 'bottom'>('top');
    const [enabled, setEnabled] = useState(true);
    return (
      <>
        <button onClick={() => setPosition(position === 'top' ? 'middle' : 'bottom')}>
          移动统计
        </button>
        <button onClick={() => setEnabled(!enabled)}>开关统计</button>
        <InspectorLayout
          properties={<input aria-label="属性草稿" defaultValue="原属性" />}
          cards={[
            ...(enabled
              ? [
                  {
                    id: 'statistics',
                    position,
                    content: <input aria-label="卡片输入" defaultValue="卡片草稿" />,
                  },
                ]
              : []),
            { id: 'information', position: 'top', content: <p>第二张组合卡</p> },
          ]}
        >
          <textarea aria-label="会话草稿" defaultValue="原会话" />
          <p>合成附件.pdf · 运行 ID：synthetic-run-1</p>
        </InspectorLayout>
      </>
    );
  }
  render(<Host />);
  const property = screen.getByLabelText<HTMLInputElement>('属性草稿');
  const ai = screen.getByLabelText<HTMLTextAreaElement>('会话草稿');
  const card = screen.getByLabelText<HTMLInputElement>('卡片输入');
  const region = screen.getByRole('region', { name: 'AI 对话' });
  fireEvent.change(property, { target: { value: '未保存属性' } });
  fireEvent.change(ai, { target: { value: '未发送会话' } });
  fireEvent.click(screen.getByRole('button', { name: '展开 AI 对话' }));
  for (const position of ['middle', 'bottom']) {
    fireEvent.click(screen.getByRole('button', { name: '移动统计' }));
    expect(
      document
        .querySelector('[data-inspector-card="statistics"]')
        ?.getAttribute('data-card-position'),
    ).toBe(position);
    expect(screen.getByLabelText('卡片输入')).toBe(card);
    expect(screen.getByLabelText('属性草稿')).toBe(property);
    expect(screen.getByLabelText('会话草稿')).toBe(ai);
    expect(screen.getByRole('region', { name: 'AI 对话' })).toBe(region);
  }
  fireEvent.click(screen.getByRole('button', { name: '开关统计' }));
  expect(screen.queryByLabelText('卡片输入')).toBeNull();
  expect(screen.getByText('第二张组合卡')).toBeTruthy();
  expect(screen.getByLabelText('属性草稿')).toBe(property);
  expect(property.value).toBe('未保存属性');
  expect(screen.getByLabelText('会话草稿')).toBe(ai);
  expect(ai.value).toBe('未发送会话');
  expect(screen.getByRole('button', { name: '收起 AI 对话' })).toBeTruthy();
  expect(screen.getByText('合成附件.pdf · 运行 ID：synthetic-run-1')).toBeTruthy();
});

it('maximizes the original dock as an Agent workspace and minimizes without replacing its state', () => {
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function Conversation() {
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return <textarea aria-label="持续会话草稿" defaultValue="追问要求" />;
  }
  render(
    <InspectorLayout properties={<input aria-label="原属性" defaultValue="未保存属性" />}>
      <Conversation />
    </InspectorLayout>,
  );
  const panel = screen.getByRole('region', { name: 'AI 对话' });
  const input = screen.getByLabelText<HTMLTextAreaElement>('持续会话草稿');
  const properties = screen.getByLabelText('原属性');
  fireEvent.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
  expect(panel.style.width).toBe(`${window.innerWidth}px`);
  expect(panel.style.height).toBe(`${window.innerHeight}px`);
  expect(screen.getByRole('heading', { name: '新的 AI 对话' })).toBeTruthy();
  expect(screen.queryByRole('separator')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '还原 AI 对话' }));
  expect(screen.getByRole('heading', { name: '新的 AI 对话' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
  fireEvent.click(screen.getByRole('button', { name: '收起 AI 对话' }));
  expect(panel.closest('.inspector-split')?.getAttribute('data-ai-maximized')).toBe('false');
  expect(screen.getByLabelText('持续会话草稿')).toBe(input);
  expect(input.value).toBe('追问要求');
  expect(screen.getByLabelText('原属性')).toBe(properties);
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
});

it.each([
  [1440, 900, 600, 360, 510],
  [1920, 1080, 800, 480, 680],
  [640, 500, 300, 280, 255],
  [260, 160, 100, 224, 85],
])(
  'clamps floating geometry to the visible viewport at %s by %s (MOCK_ONLY geometry)',
  (viewportWidth, viewportHeight, propertyHeight, expectedWidth, expectedHeight) => {
    const previousWidth = window.innerWidth,
      previousHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewportHeight });
    const geometry = vi
      .spyOn(HTMLDivElement.prototype, 'getBoundingClientRect')
      .mockImplementation(
        () =>
          new DOMRect(
            viewportWidth - 244,
            viewportHeight - 24 - propertyHeight,
            220,
            propertyHeight,
          ),
      );
    try {
      render(
        <InspectorLayout properties={<p>属性</p>}>
          <textarea aria-label="尺寸草稿" />
        </InspectorLayout>,
      );
      const panel = screen.getByRole('region', { name: 'AI 对话' });
      expect(panel.style.width).toBe('220px');
      fireEvent.click(screen.getByRole('button', { name: '展开 AI 对话' }));
      expect(panel.style.width).toBe(`${expectedWidth}px`);
      expect(panel.style.height).toBe(`${expectedHeight}px`);
      expect(panel.style.right).toBe('24px');
      const handle = screen.getByRole('separator', { name: '调整 AI 对话宽度' });
      fireEvent.keyDown(handle, { key: 'End' });
      expect(panel.style.width).toBe(`${viewportWidth - 36}px`);
      fireEvent.keyDown(handle, { key: 'Home' });
      expect(Number.parseFloat(panel.style.width)).toBeLessThanOrEqual(viewportWidth - 36);
      fireEvent.click(screen.getByRole('button', { name: '收起 AI 对话' }));
      expect(panel.style.width).toBe('220px');
    } finally {
      geometry.mockRestore();
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: previousHeight });
    }
  },
);

it('maximizes inside the workspace, keeps navigation and property scroll state, and follows resize without moving the dock', () => {
  const previousWidth = window.innerWidth,
    previousHeight = window.innerHeight;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  const geometry = vi
    .spyOn(HTMLDivElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function () {
      return this.classList.contains('workspace-main')
        ? new DOMRect(200, 48, window.innerWidth - 200, window.innerHeight - 48)
        : new DOMRect(window.innerWidth - 320, 48, 320, window.innerHeight - 48);
    });
  try {
    render(
      <>
        <nav aria-label="工作台导航">
          <button>项目导航</button>
        </nav>
        <div className="workspace-main">
          <InspectorLayout
            properties={<input aria-label="仍在编辑的属性" defaultValue="未保存属性" />}
          >
            <textarea aria-label="工作面草稿" defaultValue="追问" />
          </InspectorLayout>
        </div>
      </>,
    );
    const panel = screen.getByRole('region', { name: 'AI 对话' });
    const properties = screen.getByLabelText('属性滚动区域');
    const input = screen.getByLabelText('工作面草稿');
    properties.scrollTop = 180;
    fireEvent.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
    expect(panel.style.left).toBe('200px');
    expect(panel.style.top).toBe('48px');
    expect(panel.style.width).toBe('1240px');
    expect(panel.style.height).toBe('852px');
    expect(screen.getByRole('navigation', { name: '工作台导航' })).toBeTruthy();
    fireEvent.scroll(properties);
    expect(properties.scrollTop).toBe(180);
    expect(panel.style.top).toBe('48px');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 420 });
    fireEvent(window, new Event('resize'));
    expect(panel.style.width).toBe('600px');
    expect(panel.style.height).toBe('372px');
    const restore = screen.getByRole('button', { name: '还原 AI 对话' });
    restore.focus();
    fireEvent.click(restore);
    expect(document.activeElement).toBe(restore);
    expect(panel.style.width).toBe('320px');
    expect(screen.getByLabelText('工作面草稿')).toBe(input);
    expect(properties.scrollTop).toBe(180);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '展开 AI 对话' }));
  } finally {
    geometry.mockRestore();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: previousHeight });
  }
});

it.each([1440, 800, 640, 260])(
  'keeps expansion, pointer and keyboard resizing above property width within the safe viewport at %s (MOCK_ONLY geometry)',
  (viewportWidth) => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
    const geometry = vi
      .spyOn(HTMLDivElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => new DOMRect(viewportWidth - 464, 48, 440, 600));
    try {
      render(
        <InspectorLayout properties={null}>
          <textarea aria-label="宽度草稿" defaultValue="保留原节点" />
        </InspectorLayout>,
      );
      const panel = screen.getByRole('region', { name: 'AI 对话' });
      const draft = screen.getByLabelText('宽度草稿');
      const floor = Math.min(440, viewportWidth - 36);
      expect(panel.style.width).toBe(`${Math.min(440, viewportWidth - 24)}px`);
      fireEvent.click(screen.getByRole('button', { name: '展开 AI 对话' }));
      expect(panel.style.width).toBe(`${floor}px`);
      const handle = screen.getByRole('separator', { name: '调整 AI 对话宽度' });
      expect(handle.getAttribute('aria-valuemin')).toBe(`${floor}`);
      for (const key of ['End', 'Home', 'ArrowRight']) fireEvent.keyDown(handle, { key });
      expect(panel.style.width).toBe(`${floor}px`);
      handle.setPointerCapture = vi.fn();
      for (const [type, clientX] of [
        ['pointerdown', 100],
        ['pointermove', 900],
      ] as const) {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
        Object.defineProperty(event, 'pointerId', { value: 7 });
        fireEvent(handle, event);
      }
      fireEvent.pointerUp(handle);
      expect(panel.style.width).toBe(`${floor}px`);
      fireEvent.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
      expect(panel.style.width).toBe(`${viewportWidth}px`);
      fireEvent.click(screen.getByRole('button', { name: '还原 AI 对话' }));
      expect(panel.style.width).toBe(`${floor}px`);
      expect(screen.getByLabelText('宽度草稿')).toBe(draft);
      expect((draft as HTMLTextAreaElement).value).toBe('保留原节点');
    } finally {
      geometry.mockRestore();
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
    }
  },
);

it('follows live property width changes after custom resizing and max restore without remounting', () => {
  const previousObserver = globalThis.ResizeObserver;
  let resized = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resized = () => callback([], this as unknown as ResizeObserver);
      }
      observe() {}
      disconnect() {}
    },
  );
  let propertyWidth = 320;
  const geometry = vi
    .spyOn(HTMLDivElement.prototype, 'getBoundingClientRect')
    .mockImplementation(
      () => new DOMRect(window.innerWidth - propertyWidth, 48, propertyWidth, 600),
    );
  try {
    render(
      <InspectorLayout properties={null}>
        <textarea aria-label="动态草稿" defaultValue="保留附件和运行的原会话" />
      </InspectorLayout>,
    );
    const panel = screen.getByRole('region', { name: 'AI 对话' });
    const draft = screen.getByLabelText('动态草稿');
    fireEvent.click(screen.getByRole('button', { name: '展开 AI 对话' }));
    fireEvent.keyDown(screen.getByRole('separator', { name: '调整 AI 对话宽度' }), { key: 'Home' });
    expect(panel.style.width).toBe('320px');
    propertyWidth = 520;
    act(resized);
    expect(panel.style.width).toBe('520px');
    fireEvent.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
    propertyWidth = 560;
    act(resized);
    fireEvent.click(screen.getByRole('button', { name: '还原 AI 对话' }));
    expect(panel.style.width).toBe('560px');
    fireEvent.click(screen.getByRole('button', { name: '收起 AI 对话' }));
    expect(panel.style.width).toBe('560px');
    expect(screen.getByLabelText('动态草稿')).toBe(draft);
    expect((draft as HTMLTextAreaElement).value).toBe('保留附件和运行的原会话');
  } finally {
    geometry.mockRestore();
    vi.stubGlobal('ResizeObserver', previousObserver);
  }
});

it('preserves the actual SidebarAgent unknown receipt and request identity through repeated max/min', async () => {
  const scope = crypto.randomUUID();
  const profile: AgentResponse = {
    ok: true,
    configured: true,
    model: 'gpt-4.1-mini',
    providers: { openai: true, deepseek: false },
    runs: [],
  };
  const agent = vi.fn(async (request: AgentRequest): Promise<AgentResponse> => {
    if (request.operation === 'preview_page')
      return {
        ...profile,
        page_preview: { id: crypto.randomUUID(), title: '合成任务', mode: 'page', characters: 4 },
      };
    if (request.operation === 'start') throw new Error('模拟回执未知');
    return profile;
  });
  window.caselite = { agent } as unknown as Window['caselite'];
  render(
    <InspectorLayout properties={null}>
      <SidebarAgent taskId={scope} />
    </InspectorLayout>,
  );
  const input = screen.getByRole('textbox', { name: 'AI 工作要求' });
  await waitFor(() => expect(agent).toHaveBeenCalled());
  fireEvent.focus(input);
  await screen.findByLabelText('页面引用文件');
  fireEvent.change(input, { target: { value: '核对原请求，保留草稿' } });
  fireEvent.submit(input.closest('form')!);
  await screen.findByRole('button', { name: '核对原发送（同一标识）' });
  const starts = () =>
    agent.mock.calls.map(([request]) => request).filter((request) => request.operation === 'start');
  const original = starts()[0];
  for (let i = 0; i < 3; i++) {
    fireEvent.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
    fireEvent.click(screen.getByRole('button', { name: '收起 AI 对话' }));
  }
  expect(starts()).toEqual([original]);
  expect(agent.mock.calls.some(([request]) => request.operation === 'cancel')).toBe(false);
  expect(screen.getByRole('textbox', { name: 'AI 工作要求' })).toBe(input);
  expect((input as HTMLTextAreaElement).value).toBe('核对原请求，保留草稿');
  expect(screen.getByRole('button', { name: '核对原发送（同一标识）' })).toBeTruthy();
});

it('hides the covered work page while keeping the same Agent dock and navigation visible (MOCK_ONLY CSS)', () => {
  const style = document.createElement('style');
  style.textContent = readFileSync('apps/desktop/src/renderer/styles/project-document.css', 'utf8');
  document.head.append(style);
  try {
    render(
      <>
        <nav aria-label="主导航">
          <button>回到项目</button>
        </nav>
        <div className="workspace-main">
          <section>
            <input aria-label="底页输入" defaultValue="底页草稿" />
            <InspectorLayout properties={<input aria-label="属性输入" defaultValue="属性草稿" />}>
              <textarea aria-label="最大化会话输入" defaultValue="会话草稿" />
            </InspectorLayout>
          </section>
        </div>
      </>,
    );
    const page = screen.getByLabelText('底页输入');
    const properties = screen.getByLabelText('属性输入');
    const ai = screen.getByLabelText('最大化会话输入');
    fireEvent.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
    expect(getComputedStyle(page).visibility).toBe('hidden');
    expect(getComputedStyle(properties).visibility).toBe('hidden');
    expect(getComputedStyle(ai).visibility).toBe('visible');
    expect(getComputedStyle(screen.getByRole('navigation', { name: '主导航' })).visibility).toBe(
      'visible',
    );
    fireEvent.click(screen.getByRole('button', { name: '收起 AI 对话' }));
    expect(getComputedStyle(page).visibility).toBe('visible');
    expect(getComputedStyle(properties).visibility).toBe('visible');
    expect(screen.getByLabelText('最大化会话输入')).toBe(ai);
    expect((page as HTMLInputElement).value).toBe('底页草稿');
  } finally {
    style.remove();
  }
});
