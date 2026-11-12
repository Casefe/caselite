// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentRequest, AgentResponse, AgentRun } from '../../preload/caselite-api';
import AgentPanel from './AgentPanel';
import InspectorLayout from './InspectorLayout';
import EditorConversation from '../features/documents/review/EditorConversation';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function api(runs: AgentRun[] = []) {
  const agent = vi.fn(async (request: AgentRequest): Promise<AgentResponse> => ({
    ok: true,
    configured: true,
    providers: { openai: true },
    model: 'gpt-4.1-mini',
    runs,
    ...(request.operation === 'preview_page'
      ? {
          page_preview: {
            id: crypto.randomUUID(),
            title: '合成页面',
            mode: 'page',
            characters: 20,
          },
        }
      : {}),
  }));
  window.caselite = {
    agent,
    material: vi.fn(async () => ({ ok: true, materials: [] })),
  } as unknown as Window['caselite'];
  return agent;
}

it.each([
  ['document:', '总结此页面', '尝试剖析'],
  ['project:', '总结此项目', '梳理下一步'],
  ['', '总结此任务', '拆解工作步骤'],
  ['contact:', '总结客户信息', '梳理沟通要点'],
])(
  'offers relevant actions for %s without dispatching or crossing page scope',
  async (prefix, summary, analysis) => {
    const agent = api();
    const scope = `${prefix}${crypto.randomUUID()}`;
    render(
      <InspectorLayout properties={null}>
        <AgentPanel
          scope={scope}
          variant="compact"
          page={{ version: '1', archived: false }}
          project={prefix === 'project:' ? { version: 1, archived: false } : undefined}
        />
      </InspectorLayout>,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开 AI 对话' }));
    expect(screen.getByRole('heading', { name: '新的 AI 对话' })).toBeTruthy();
    const actions = within(screen.getByRole('group', { name: 'AI 常用功能' }));
    expect(actions.getAllByRole('button')).toHaveLength(3);
    expect(actions.getByRole('button', { name: analysis })).toBeTruthy();
    expect(actions.getByRole('button', { name: '创建任务' })).toBeTruthy();
    await userEvent.click(actions.getByRole('button', { name: summary }));
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>('询问 Caselite AI');
    expect(input.value).toContain('请总结当前引用');
    expect(document.activeElement).toBe(input);
    await waitFor(() =>
      expect(agent.mock.calls.some(([r]) => r.operation === 'preview_page')).toBe(true),
    );
    expect(agent.mock.calls.some(([r]) => r.operation === 'start')).toBe(false);
    expect(agent.mock.calls.every(([r]) => !('scope' in r) || r.scope === scope)).toBe(true);
  },
);

it('appends an editable task request and preserves the original draft across collapse and maximize', async () => {
  const agent = api();
  render(
    <InspectorLayout properties={null}>
      <AgentPanel
        scope={`document:${crypto.randomUUID()}`}
        variant="compact"
        page={{ version: '1', archived: false }}
      />
    </InspectorLayout>,
  );
  const input = screen.getByPlaceholderText<HTMLTextAreaElement>('询问 Caselite AI');
  fireEvent.change(input, { target: { value: '请保留我的要求。' } });
  await userEvent.click(screen.getByRole('button', { name: '创建任务' }));
  expect(input.value).toContain('请保留我的要求。\n');
  expect(input.value).toContain('供我核对后手动创建');
  const draft = input.value;
  fireEvent.click(screen.getByRole('button', { name: '收起 AI 对话' }));
  fireEvent.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
  expect(screen.getByRole('heading', { name: '新的 AI 对话' })).toBeTruthy();
  expect(screen.getByPlaceholderText('询问 Caselite AI')).toBe(input);
  expect(input.value).toBe(draft);
  expect(agent.mock.calls.some(([r]) => r.operation === 'start')).toBe(false);
});

it.each([false, true])(
  'disables shortcuts for an active run or archived page (archived=%s)',
  async (archived) => {
    const scope = `document:${crypto.randomUUID()}`;
    const agent = api(
      archived
        ? []
        : [
            {
              id: crypto.randomUUID(),
              scope,
              prompt: '合成运行',
              output: '',
              model: 'gpt-4.1-mini',
              provider: 'openai',
              status: 'running',
              sequence: 1,
              message: '',
              usage: null,
            },
          ],
    );
    render(<AgentPanel scope={scope} variant="compact" page={{ version: '1', archived }} />);
    const actions = within(screen.getByRole('group', { name: 'AI 常用功能' }));
    await waitFor(() => {
      for (const button of actions.getAllByRole<HTMLButtonElement>('button'))
        expect(button.disabled).toBe(true);
    });
    await userEvent.click(actions.getByRole('button', { name: '创建任务' }));
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>('询问 Caselite AI').value).toBe('');
    expect(agent.mock.calls.some(([r]) => r.operation === 'start')).toBe(false);
  },
);

it.each(
  ['document:', 'project:', ''].flatMap((prefix) => [
    { prefix, inputKind: 'content', original: `  ${'甲'.repeat(3996)}  ` },
    { prefix, inputKind: 'leading whitespace', original: `${' '.repeat(3999)}甲` },
  ]),
)(
  'preserves all 4000 characters for $prefix / $inputKind, blocks dispatch and recovers after editing',
  async ({ prefix, original }) => {
    const agent = api();
    render(
      <InspectorLayout properties={null}>
        <AgentPanel
          scope={`${prefix}${crypto.randomUUID()}`}
          variant="compact"
          page={{ version: '1', archived: false }}
          project={prefix === 'project:' ? { version: 1, archived: false } : undefined}
        />
      </InspectorLayout>,
    );
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>('询问 Caselite AI');
    await userEvent.click(input);
    await waitFor(() =>
      expect(agent.mock.calls.some(([request]) => request.operation === 'preview_page')).toBe(true),
    );
    fireEvent.change(input, { target: { value: original } });
    const send = screen.getByRole<HTMLButtonElement>('button', { name: '发送' });
    await waitFor(() => expect(send.disabled).toBe(false));
    await userEvent.click(screen.getByRole('button', { name: '创建任务' }));
    expect(input.value.startsWith(`${original}\n`)).toBe(true);
    expect(input.value.length).toBeGreaterThan(4000);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').id).toBe(input.getAttribute('aria-describedby'));
    expect(screen.getByRole('alert').textContent).toContain('全部输入已保留');
    expect(send.disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    fireEvent.submit(input.closest('form')!);
    expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
    fireEvent.change(input, { target: { value: '精简后的请求' } });
    expect(input.value).toBe('精简后的请求');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(send.disabled).toBe(false);
    expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
  },
);

it('blocks the document review button and Enter for an over-limit shortcut without truncating the draft', async () => {
  const original = '乙'.repeat(4000);
  const send = vi.fn();
  function Review() {
    const [question, setQuestion] = React.useState(original);
    return (
      <EditorConversation
        messages={[]}
        question={question}
        onQuestion={setQuestion}
        send={send}
        stop={() => {}}
        running={false}
        disabled={false}
      />
    );
  }
  render(<Review />);
  const input = screen.getByPlaceholderText<HTMLTextAreaElement>('询问 Caselite AI');
  const button = screen.getByRole<HTMLButtonElement>('button', { name: '发送本轮审阅' });
  expect(button.disabled).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: '总结此页面' }));
  expect(input.value.startsWith(`${original}\n`)).toBe(true);
  expect(input.value.length).toBeGreaterThan(4000);
  expect(button.disabled).toBe(true);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('alert').id).toBe(input.getAttribute('aria-describedby'));
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  fireEvent.submit(input.closest('form')!);
  expect(send).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: original } });
  expect(input.value).toBe(original);
  expect(button.disabled).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
  await userEvent.click(button);
  expect(send).toHaveBeenCalledTimes(1);
});

it('keeps shortcuts disabled while the original dispatch receipt is unknown', async () => {
  const agent = api();
  const read = agent.getMockImplementation()!;
  agent.mockImplementation(async (request) => {
    if (request.operation === 'start') throw new Error('Synthetic lost receipt');
    return read(request);
  });
  render(
    <InspectorLayout properties={null}>
      <AgentPanel
        scope={`document:${crypto.randomUUID()}`}
        variant="compact"
        page={{ version: '1', archived: false }}
      />
    </InspectorLayout>,
  );
  const input = screen.getByPlaceholderText<HTMLTextAreaElement>('询问 Caselite AI');
  await userEvent.click(input);
  fireEvent.change(input, { target: { value: '保留原发送草稿' } });
  const send = screen.getByRole<HTMLButtonElement>('button', { name: '发送' });
  await waitFor(() => expect(send.disabled).toBe(false));
  await userEvent.click(send);
  await screen.findByRole('button', { name: '核对原发送（同一标识）' });
  const actions = within(screen.getByRole('group', { name: 'AI 常用功能' }));
  for (const button of actions.getAllByRole<HTMLButtonElement>('button'))
    expect(button.disabled).toBe(true);
  await userEvent.click(actions.getByRole('button', { name: '创建任务' }));
  expect(input.value).toBe('保留原发送草稿');
  expect(agent.mock.calls.filter(([request]) => request.operation === 'start')).toHaveLength(1);
  const nextDraft = `${' '.repeat(4000)}后写草稿`;
  fireEvent.change(input, { target: { value: nextDraft } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() =>
    expect(agent.mock.calls.filter(([request]) => request.operation === 'start')).toHaveLength(2),
  );
  const requests = agent.mock.calls.flatMap(([request]) =>
    request.operation === 'start' ? [request] : [],
  );
  expect(requests[1].run_id).toBe(requests[0].run_id);
  expect(requests[1].prompt).toBe('保留原发送草稿');
  expect(input.value).toBe(nextDraft);
});

it('keeps shortcut drafts separate when switching document pages and restores the same page draft', async () => {
  api();
  const first = `document:${crypto.randomUUID()}`;
  const second = `document:${crypto.randomUUID()}`;
  const page = (scope: string) => (
    <AgentPanel
      key={scope}
      scope={scope}
      variant="compact"
      page={{ version: '1', archived: false }}
    />
  );
  const view = render(page(first));
  await userEvent.click(screen.getByRole('button', { name: '尝试剖析' }));
  const firstDraft = screen.getByPlaceholderText<HTMLTextAreaElement>('询问 Caselite AI').value;
  view.rerender(page(second));
  expect(screen.getByPlaceholderText<HTMLTextAreaElement>('询问 Caselite AI').value).toBe('');
  await userEvent.click(screen.getByRole('button', { name: '总结此页面' }));
  expect(screen.getByPlaceholderText<HTMLTextAreaElement>('询问 Caselite AI').value).not.toBe(
    firstDraft,
  );
  view.rerender(page(first));
  expect(screen.getByPlaceholderText<HTMLTextAreaElement>('询问 Caselite AI').value).toBe(
    firstDraft,
  );
});
