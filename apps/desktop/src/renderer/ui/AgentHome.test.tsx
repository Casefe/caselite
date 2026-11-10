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
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import type { Task } from '../../preload/caselite-api';
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

it('shows current projects and fills a prompt without navigating from shortcuts', async () => {
  window.caselite = {
    agent: vi.fn(async () => ({
      ok: true,
      runs: [],
      model: 'gpt-4.1-mini',
      configured: false,
      providers: { openai: false, deepseek: false },
    })),
    catalog: vi.fn(async () => ({
      ok: true,
      projects: [
        { id: 'p1', title: '示例项目', archived_at: null, task_count: 2 },
        { id: 'p2', title: '已归档项目', archived_at: '2026-01-01', task_count: 0 },
      ],
      documents: [],
      state: null,
      target_id: null,
      receipt: null,
    })),
  } as unknown as Window['caselite'];
  const onNavigate = vi.fn();
  const onPrompt = vi.fn();
  const onOpen = vi.fn();
  render(
    <AgentHome
      prompt={{ text: '', state: null }}
      onPrompt={onPrompt}
      onNavigate={onNavigate}
      tasks={[{ id: 't1', title: '示例任务' } as Task]}
      onOpen={onOpen}
    />,
  );
  await screen.findByText('暂无运行中的智能体');
  const agents = screen.getByRole('region', { name: '智能体' });
  const reminders = screen.getByLabelText('Agent 工作上下文');
  expect(reminders.contains(agents)).toBe(true);
  expect(screen.queryByRole('region', { name: '最近任务' })).toBeNull();
  expect(screen.queryByRole('region', { name: '最近项目' })).toBeNull();
  expect(screen.queryByText('重要文档')).toBeNull();
  expect(screen.queryByText('示例项目')).toBeNull();
  expect(window.caselite.catalog).not.toHaveBeenCalled();
  expect(Array.from(reminders.querySelectorAll('h3'), (h) => h.textContent?.trim())).toEqual([
    '重要日程',
    '智能体0 运行中',
  ]);
  expect(screen.queryByText('工作提醒')).toBeNull();
  expect(screen.getByLabelText('Agent 首页').querySelector('.agent-topline')).toBeNull();
  expect(reminders.style.borderLeft).toBe('0px');
  fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
  expect(screen.getByRole('button', { name: '创建任务' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(onPrompt).toHaveBeenCalledWith(
    expect.objectContaining({ text: expect.stringContaining('拟定任务') }),
  );
  expect(onNavigate).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '新建任务' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重要日程' }));
  expect(reminders.querySelector('header > button')).toBeNull();
  fireEvent.click(screen.getByText('历史对话', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('button', { name: '查看全部对话' }));
  expect(onNavigate.mock.calls).toEqual([['calendar'], ['agent-history']]);
  expect(screen.getByRole('button', { name: '创建项目' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '生成文书' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '合同审查' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '法律研究' })).toBeTruthy();
  const draft = screen.getByRole('textbox', { name: '演示草稿' });
  fireEvent.change(draft, { target: { value: '保留待发送草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '模拟进入对话' }));
  const overview = screen.getByRole('button', { name: '工作概览与快捷项' });
  expect(overview.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(overview);
  expect(screen.getByRole('button', { name: '返回对话' }).getAttribute('aria-expanded')).toBe(
    'true',
  );
  expect(screen.getByLabelText('Agent 工作上下文').contains(agents)).toBe(true);
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '返回对话' }));
  expect(screen.getByRole('textbox', { name: '演示草稿' })).toBe(draft);
  expect((draft as HTMLTextAreaElement).value).toBe('保留待发送草稿');
});

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
  fireEvent.click(screen.getByText('历史对话', { selector: 'summary' }));
  const row = await screen.findByRole('button', { name: /示例问题.*首页对话/ });
  const history = screen.getByRole('region', { name: '历史对话' });
  expect(screen.getByLabelText('Agent 首页').querySelector('.home-topbar')?.contains(history)).toBe(
    true,
  );
  fireEvent.click(row);
  expect(screen.getByText('示例回答')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '置顶：示例问题' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '取消置顶：示例问题' })).toBeTruthy(),
  );
  expect(agent.mock.calls.map(([request]) => request.operation)).toEqual([
    'active_runs',
    'history',
    'pin_history',
  ]);
});
