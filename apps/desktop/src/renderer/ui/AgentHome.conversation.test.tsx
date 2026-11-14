// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
const render = (node: ReactNode) =>
  rtlRender(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {node}
    </QueryClientProvider>,
  );
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AgentHome from './AgentHome';

// 验证子树保全，分栏几何与命中由同包 Electron 入口另验。
vi.mock('react-resizable-panels', async () => {
  const React = await import('react');
  return {
    Group: ({ children, groupRef }: { children: ReactNode; groupRef: React.Ref<unknown> }) => {
      React.useImperativeHandle(groupRef, () => ({ setLayout() {} }));
      return <div>{children}</div>;
    },
    Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Separator: () => null,
  };
});
vi.mock('./AgentPanel', () => ({
  AgentRunReadOnly: () => <p>只读记录</p>,
  default: ({ onConversationChange }: { onConversationChange(value: boolean): void }) => (
    <div>
      <textarea aria-label="保留的对话草稿" />
      <button onClick={() => onConversationChange(true)}>显示已有对话</button>
    </div>
  ),
}));
afterEach(cleanup);

it('returns from overview to the same conversation without remounting the unsent draft', async () => {
  const agent = vi.fn<(request: { operation: string }) => Promise<{ ok: boolean; runs: [] }>>(
    async () => ({ ok: true, runs: [] }),
  );
  window.caselite = {
    agent,
    catalog: vi.fn(async () => ({ ok: true, projects: [], documents: [] })),
  } as unknown as Window['caselite'];
  const props = {
    prompt: { text: '', state: null },
    onPrompt: vi.fn(),
    onStart: vi.fn(),
    onNavigate: vi.fn(),
    tasks: [],
    onOpen: vi.fn(),
  };
  render(<AgentHome {...props} />);
  const draft = screen.getByRole('textbox', { name: '保留的对话草稿' });
  fireEvent.change(draft, { target: { value: '尚未发送的中文要求' } });
  fireEvent.click(screen.getByRole('button', { name: '显示已有对话' }));
  expect(screen.getByLabelText('Agent 首页').classList.contains('home-conversation')).toBe(true);
  await screen.findByText('暂无运行中的智能体');
  for (const name of ['Agent 目录', '进行中的智能体']) {
    fireEvent.click(
      screen.getByRole('button', { name: `收起${name === 'Agent 目录' ? ' ' : ''}${name}` }),
    );
    expect(
      screen
        .getByRole('button', { name: `展开${name === 'Agent 目录' ? ' ' : ''}${name}` })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    fireEvent.click(
      screen.getByRole('button', { name: `展开${name === 'Agent 目录' ? ' ' : ''}${name}` }),
    );
  }
  for (const name of ['本轮材料', '成果', '重要日程', '对话信息']) {
    fireEvent.click(screen.getByRole('button', { name: `展开${name}` }));
    expect(screen.getByLabelText('首页辅助面板')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '保留的对话草稿' })).toBe(draft);
    fireEvent.click(screen.getByRole('button', { name: '收起辅助面板' }));
  }
  expect(screen.getByLabelText('Agent 首页').classList.contains('home-conversation')).toBe(true);
  expect(screen.getByRole('textbox', { name: '保留的对话草稿' })).toBe(draft);
  expect((draft as HTMLTextAreaElement).value).toBe('尚未发送的中文要求');
  expect(props.onNavigate).not.toHaveBeenCalled();
  expect(props.onStart).not.toHaveBeenCalled();
  expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
});
