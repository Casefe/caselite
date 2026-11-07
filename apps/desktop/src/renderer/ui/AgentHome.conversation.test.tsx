// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AgentHome from './AgentHome';

vi.mock('./AgentPanel', () => ({
  default: ({ onConversationChange }: { onConversationChange(value: boolean): void }) => (
    <div>
      <textarea aria-label="保留的对话草稿" />
      <button onClick={() => onConversationChange(true)}>显示已有对话</button>
    </div>
  ),
}));
afterEach(cleanup);

it('returns from overview to the same conversation without remounting the unsent draft', () => {
  const agent = vi.fn(async () => ({ ok: true, runs: [] }));
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
  fireEvent.click(screen.getByRole('button', { name: '工作概览与快捷项' }));
  expect(screen.getByRole('button', { name: '返回对话' }).getAttribute('aria-expanded')).toBe(
    'true',
  );
  expect(screen.getByLabelText('Agent 首页').classList.contains('home-conversation')).toBe(false);
  expect(screen.getByLabelText('Agent 工作上下文')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '返回对话' }));
  expect(screen.getByRole('textbox', { name: '保留的对话草稿' })).toBe(draft);
  expect((draft as HTMLTextAreaElement).value).toBe('尚未发送的中文要求');
  expect(props.onNavigate).not.toHaveBeenCalled();
  expect(props.onStart).not.toHaveBeenCalled();
});
