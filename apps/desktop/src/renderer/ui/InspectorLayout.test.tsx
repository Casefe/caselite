// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    expect(panel.style.width).toBe('480px');
    expect(panel.style.height).toBe('510px');
    expect(outer.scrollTop).toBe(900);
    expect(history.scrollTop).toBe(640);
    const handle = screen.getByRole('separator', { name: '调整 AI 对话宽度' });
    handle.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(panel.style.width).toBe('504px');
    await userEvent.keyboard('{End}');
    expect(panel.style.width).toBe(`${window.innerWidth - 36}px`);
    await userEvent.keyboard('{Home}');
    expect(panel.style.width).toBe('320px');
    fireEvent.click(screen.getByTitle('最小化 AI 对话'));
    expect(panel.style.width).toBe('320px');
    fireEvent.click(screen.getByText('点击会话区域'));
    expect(panel.style.width).toBe('480px');
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
