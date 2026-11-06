// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import AgentHome from './AgentHome';

vi.mock('./AgentPanel', async () => {
  const React = await import('react');
  return {
    default: function MockAgentPanel({
      editorRef,
      onDraft,
      onConversationChange,
    }: {
      editorRef: React.Ref<{ append(text: string): void }>;
      onDraft(value: { text: string; state: null }): void;
      onConversationChange(value: boolean): void;
    }) {
      React.useImperativeHandle(editorRef, () => ({
        append: (text: string) => onDraft({ text, state: null }),
      }));
      return (
        <div>
          AI 输入
          <textarea aria-label="演示草稿" />
          <button onClick={() => onConversationChange(true)}>模拟进入对话</button>
        </div>
      );
    },
  };
});
afterEach(cleanup);

it('shows stored rounds, opens details, and sends only a pin command', async () => {
  const run = { id: '1', prompt: '示例问题', output: '示例回答', scope: 'home', pinned: false };
  const agent = vi.fn(async (request: { operation: string }) => ({
    ok: true,
    model: 'gpt-4.1-mini',
    configured: false,
    providers: { openai: false, deepseek: false },
    runs: [{ ...run, pinned: request.operation === 'pin_history' }],
  }));
  window.caselite = {
    agent,
    catalog: vi.fn(async () => ({
      ok: true,
      projects: [],
      documents: [],
      state: null,
      target_id: null,
      receipt: null,
    })),
  } as unknown as Window['caselite'];
  render(
    <AgentHome
      prompt={{ text: '', state: null }}
      onPrompt={vi.fn()}
      onNavigate={vi.fn()}
      tasks={[]}
      onOpen={vi.fn()}
    />,
  );
  const row = await screen.findByRole('button', { name: /示例问题.*首页对话/ });
  const history = screen.getByRole('region', { name: '历史对话' });
  expect(screen.getByLabelText('Agent 首页').querySelector('.agent-main')?.contains(history)).toBe(
    true,
  );
  fireEvent.click(row);
  expect(screen.getByText('示例回答')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '置顶：示例问题' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '取消置顶：示例问题' })).toBeTruthy(),
  );
  expect(agent.mock.calls.map(([request]) => request.operation)).toEqual([
    'history',
    'pin_history',
  ]);
});
