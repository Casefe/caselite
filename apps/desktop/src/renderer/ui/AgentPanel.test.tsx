// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentRequest, AgentResponse, AgentRun } from '../../preload/caselite-api';
import AgentPanel from './AgentPanel';
import SidebarAgent from './SidebarAgent';
import InspectorLayout from './InspectorLayout';
import userEvent from '@testing-library/user-event';
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// 本测试聚焦发送身份与草稿生命周期；真实 assistant-ui/Pi 联动另由打包演示覆盖。
vi.mock('../editors/RichEditor', () => ({
  emptyDraft: () => ({ text: '', state: null }),
  DraftEditor: ({
    value,
    onChange,
    label,
    disabled,
  }: {
    value: { text: string };
    onChange(v: { text: string; state: null }): void;
    label: string;
    disabled: boolean;
  }) => (
    <textarea
      aria-label={label}
      disabled={disabled}
      value={value.text}
      onChange={(e) => onChange({ text: e.target.value, state: null })}
    />
  ),
}));
afterEach(cleanup);
const profile: AgentResponse = {
  ok: true,
  configured: true,
  model: 'gpt-4.1-mini',
  providers: { openai: true, deepseek: false },
  runs: [],
};
it('uses a metadata-only page card, prioritizes external selection, and separates document from task history', async () => {
  const taskId = crypto.randomUUID(),
    documentId = crypto.randomUUID();
  const pageId = crypto.randomUUID();
  const foreign: AgentRun = {
    id: crypto.randomUUID(),
    scope: taskId,
    prompt: '任务页的其他聊天',
    output: '不能进入文档页',
    model: 'gpt-4.1-mini',
    provider: 'openai',
    status: 'succeeded',
    sequence: 1,
    message: '',
    usage: null,
  };
  const agent = vi.fn(async (request: AgentRequest): Promise<AgentResponse> =>
    request.operation === 'preview_page'
      ? {
          ...profile,
          page_preview: {
            id: pageId,
            title: '本页文件',
            mode: request.selected_text ? 'selection' : 'page',
            characters: request.selected_text?.length ?? 80,
          },
        }
      : { ...profile, runs: [foreign] },
  );
  window.caselite = { agent } as unknown as Window['caselite'];
  render(
    <>
      <p data-testid="page-content">本页选中的文字</p>
      <InspectorLayout properties={null}>
        <SidebarAgent taskId={taskId} document={{ id: documentId, revision: 1, archived: false }} />
      </InspectorLayout>
    </>,
  );
  const selected = screen.getByTestId('page-content');
  const range = document.createRange();
  range.selectNodeContents(selected);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.pointerDown(screen.getByRole('heading', { name: 'AI 对话' }));
  await screen.findByLabelText('选区引用文件');
  expect(screen.getByLabelText('选区引用文件').textContent).toContain('本页文件.txt');
  expect(screen.getByLabelText('选区引用文件').textContent).not.toContain('本页选中的文字');
  expect(screen.queryByText('任务页的其他聊天')).toBeNull();
  expect(agent.mock.calls.find(([r]) => r.operation === 'preview_page')![0]).toMatchObject({
    scope: `document:${documentId}`,
    selected_text: '本页选中的文字',
  });
  expect(agent.mock.calls.some(([r]) => r.operation === 'start')).toBe(false);
  expect(
    agent.mock.calls
      .filter(([r]) => r.operation === 'read')
      .every(([r]) => 'scope' in r && r.scope === `document:${documentId}`),
  ).toBe(true);
  window.getSelection()!.removeAllRanges();
});
it('keeps the shared composer disabled and performs no Agent or material IPC without a task', async () => {
  const agent = vi.fn();
  const material = vi.fn();
  const pickPdf = vi.fn();
  const dropPdf = vi.fn();
  window.caselite = { agent, material, pickPdf, dropPdf } as unknown as Window['caselite'];

  render(<SidebarAgent unavailable="请先选择项目任务。" />);
  const input = screen.getByTestId('assistant-input') as HTMLTextAreaElement;
  const attachment = screen.getByRole<HTMLButtonElement>('button', { name: '添加文件与材料' });
  const model = screen.getByRole<HTMLSelectElement>('combobox', { name: '选择大模型' });
  const send = screen.getByRole<HTMLButtonElement>('button', { name: '发送' });
  for (const control of [input, attachment, model, send]) expect(control.disabled).toBe(true);
  expect(input.closest('form')).toHaveProperty('className', 'assistant-compose agent-prompt');
  expect(screen.getByRole('status').textContent).toBe('请先选择项目任务。');
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.submit(input.closest('form')!);
  await userEvent.click(attachment);
  await userEvent.click(send);
  expect(input.value).toBe('');
  expect(agent).not.toHaveBeenCalled();
  expect(material).not.toHaveBeenCalled();
  expect(pickPdf).not.toHaveBeenCalled();
  expect(dropPdf).not.toHaveBeenCalled();
});

describe('AI submission UI lifecycle', () => {
  it('keeps disclosure outside the composer and preserves Enter, Shift+Enter and IME submission semantics', async () => {
    const agent = vi.fn(async () => profile);
    window.caselite = { agent } as unknown as Window['caselite'];
    const view = render(<AgentPanel scope="41414141-4141-4141-8141-414141414141" />);
    await screen.findByText('已配置 · 模型设置');
    const input = screen.getByLabelText('AI 工作要求');
    const composer = input.closest('form')!;
    expect(composer.querySelector('.composer-send-note')).toBeNull();
    expect(view.container.querySelector('.composer-send-note')).toBeNull();
    expect(screen.queryByRole('button', { name: '配置模型' })).toBeNull();
    expect(screen.queryByText(/仅发送本次文字与所选材料/)).toBeNull();
    expect(screen.queryByText('发送说明')).toBeNull();
    expect(screen.queryByText(/本次发送只包含输入框内的文字/)).toBeNull();
    expect(screen.queryByText('项目（未接入）')).toBeNull();
    const user = userEvent.setup();
    await user.click(input);
    await user.type(input, '第一行');
    await user.keyboard('{Shift>}{Enter}{/Shift}第二行');
    expect((input as HTMLTextAreaElement).value).toBe('第一行\n第二行');
    expect(
      agent.mock.calls.some(([request]) => (request as AgentRequest)?.operation === 'start'),
    ).toBe(false);
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: true });
    expect(
      agent.mock.calls.some(([request]) => (request as AgentRequest)?.operation === 'start'),
    ).toBe(false);
    fireEvent.compositionEnd(input);
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(
        agent.mock.calls.filter(([request]) => (request as AgentRequest)?.operation === 'start'),
      ).toHaveLength(1),
    );
  });
  it('renders safe Markdown, labels both roles, and copies the original output without dispatch', async () => {
    const output =
      '## 核对事项\n\n- **付款**待核实\n\n<script>alert(1)</script>\n\n[候选链接](javascript:alert)\n\n![图片](https://example.invalid/tracker.png)';
    let copyFails = false;
    const agent = vi.fn(async (request: AgentRequest) =>
      copyFails && request.operation === 'copy_output'
        ? { ok: false, code: 'COPY_FAILED', message: '复制失败' }
        : {
            ...profile,
            runs: [
              {
                id: '12121212-1212-4212-8212-121212121212',
                scope: 'home',
                prompt: '请核对',
                output,
                model: 'gpt-4.1-mini',
                provider: 'openai',
                status: 'succeeded',
                sequence: 1,
                message: '生成完成，内容待人工核对。',
                usage: null,
              },
            ],
          },
    );
    window.caselite = { agent } as unknown as Window['caselite'];
    const onConversationChange = vi.fn();
    render(<AgentPanel scope="home" onConversationChange={onConversationChange} />);
    await screen.findByRole('heading', { name: '核对事项' });
    expect(screen.getByText('你')).toBeTruthy();
    expect(screen.getByText('CaseLite')).toBeTruthy();
    expect(document.querySelector('.assistant-markdown strong')?.textContent).toBe('付款');
    expect(
      document.querySelector(
        '.assistant-markdown script, .assistant-markdown img, .assistant-markdown a',
      ),
    ).toBeNull();
    expect(onConversationChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await screen.findByRole('button', { name: '已复制' });
    expect(agent).toHaveBeenLastCalledWith({
      protocol_version: 1,
      operation: 'copy_output',
      scope: 'home',
      run_id: '12121212-1212-4212-8212-121212121212',
    });
    copyFails = true;
    fireEvent.click(screen.getByRole('button', { name: '已复制' }));
    await screen.findByRole('button', { name: '复制失败，请选择文字复制' });
    expect(screen.getByRole('heading', { name: '核对事项' })).toBeTruthy();
    expect(agent.mock.calls).toHaveLength(3);
  });
  it('keeps the answer and unsent draft when copy rejects', async () => {
    const run = {
      id: '12121212-1212-4212-8212-121212121212',
      scope: 'home',
      prompt: '原问题',
      output: '原回答',
      model: 'gpt-4.1-mini' as const,
      provider: 'openai' as const,
      status: 'succeeded' as const,
      sequence: 1,
      message: '',
      usage: null,
    };
    const agent = vi.fn(async (request: AgentRequest): Promise<AgentResponse> => {
      if (request.operation === 'copy_output') throw new Error('clipboard unavailable');
      return { ...profile, runs: [run] };
    });
    window.caselite = { agent } as unknown as Window['caselite'];
    render(<AgentPanel scope="home" />);
    await screen.findByText('原回答');
    const input = screen.getByTestId('agent-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '未发送草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await screen.findByRole('button', { name: '复制失败，请选择文字复制' });
    expect(screen.getByText('原回答')).toBeTruthy();
    expect(input.value).toBe('未发送草稿');
    expect(agent.mock.calls.filter(([request]) => request.operation === 'copy_output')).toEqual([
      [{ protocol_version: 1, operation: 'copy_output', scope: run.scope, run_id: run.id }],
    ]);
    expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
  });
  it('refills an interrupted prompt only on request, retaining partial output without automatically retrying', async () => {
    const agent = vi.fn(async () => ({
      ...profile,
      runs: [
        {
          id: '13131313-1313-4313-8313-131313131313',
          scope: '13131313-1313-4313-8313-131313131313',
          prompt: '上次工作要求',
          output: '部分结果',
          model: 'gpt-4.1-mini',
          provider: 'openai',
          status: 'interrupted',
          sequence: 1,
          message: '上次运行被中断',
          usage: null,
        },
      ],
    }));
    window.caselite = { agent } as unknown as Window['caselite'];
    render(<AgentPanel scope="13131313-1313-4313-8313-131313131313" />);
    const refill = await screen.findByRole('button', { name: '恢复上轮要求与原选段' });
    expect(screen.getByText('部分结果')).toBeTruthy();
    fireEvent.click(refill);
    await waitFor(() =>
      expect((screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement).value).toBe(
        '上次工作要求',
      ),
    );
    expect(agent.mock.calls).toHaveLength(1);
    expect((refill as HTMLButtonElement).disabled).toBe(true);
  });
  it('selects a configured model without starting an AI run', async () => {
    let current: AgentResponse = {
      ...profile,
      providers: { openai: true, deepseek: true },
    };
    const agent = vi.fn(async (request: AgentRequest): Promise<AgentResponse> => {
      if (request.operation === 'select_model') current = { ...current, model: request.model };
      return current;
    });
    window.caselite = { agent } as unknown as Window['caselite'];
    render(<AgentPanel scope="home" />);
    await waitFor(() =>
      expect(
        (screen.getByRole('option', { name: 'deepseek-flash' }) as HTMLOptionElement).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText('选择大模型'), { target: { value: 'deepseek-flash' } });
    await waitFor(() =>
      expect(agent).toHaveBeenCalledWith({
        protocol_version: 1,
        operation: 'select_model',
        model: 'deepseek-flash',
      }),
    );
    expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
  });
  it('typing and IME never dispatch; one submit sends the text without a confirmation screen', async () => {
    const agent = vi.fn(async () => profile);
    window.caselite = { agent } as unknown as Window['caselite'];
    render(<AgentPanel scope="10101010-1010-4010-8010-101010101010" />);
    await screen.findByText('已配置 · 模型设置');
    const input = screen.getByLabelText('AI 工作要求');
    fireEvent.change(input, { target: { value: '中文输入\n第二行' } });
    fireEvent.compositionStart(input);
    fireEvent.submit(input.closest('form')!);
    expect(agent.mock.calls.some(([r]) => (r as AgentRequest)?.operation === 'start')).toBe(false);
    fireEvent.compositionEnd(input);
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(agent.mock.calls.some(([r]) => (r as AgentRequest)?.operation === 'start')).toBe(true),
    );
    expect(screen.queryByLabelText('发送预览')).toBeNull();
  });
  it('a starter appends to the editable input without dispatch', () => {
    const agent = vi.fn(async () => profile);
    window.caselite = { agent } as unknown as Window['caselite'];
    function Home() {
      const [draft, setDraft] = React.useState<{ text: string; state: number[] | null }>({
        text: '',
        state: null,
      });
      const ref = React.useRef<{ append(text: string): void }>(null);
      return (
        <>
          <AgentPanel scope="home" draft={draft} onDraft={setDraft} editorRef={ref} />
          <button onClick={() => ref.current?.append('补充提示')}>追加</button>
        </>
      );
    }
    render(<Home />);
    fireEvent.change(screen.getByLabelText('Agent 工作目标'), { target: { value: '原始内容' } });
    fireEvent.click(screen.getByText('追加'));
    expect((screen.getByLabelText('Agent 工作目标') as HTMLTextAreaElement).value).toBe(
      '原始内容\n补充提示',
    );
    expect(agent.mock.calls.some(([r]) => (r as AgentRequest)?.operation === 'start')).toBe(false);
  });
  it('a late response from an unmounted panel cannot erase a newer unknown submission', async () => {
    let resolveA: (value: AgentResponse) => void = () => {};
    let resolveB: (value: AgentResponse) => void = () => {};
    const pendingA = new Promise<AgentResponse>((resolve) => {
      resolveA = resolve;
    });
    const pendingB = new Promise<AgentResponse>((resolve) => {
      resolveB = resolve;
    });
    const sent: Extract<AgentRequest, { operation: 'start' }>[] = [];
    let accepted = false;
    const snapshot = (): AgentResponse => ({
      ...profile,
      runs: accepted
        ? [
            {
              model: 'gpt-4.1-mini',
              provider: 'openai',
              id: sent[0].run_id,
              scope: sent[0].scope,
              prompt: sent[0].prompt,
              output: '已结束',
              status: 'succeeded',
              sequence: 1,
              message: '完成',
              usage: null,
            },
          ]
        : [],
    });
    window.caselite = {
      agent: vi.fn(async (request: AgentRequest) => {
        if (request.operation !== 'start') return snapshot();
        sent.push(request);
        return sent.length === 1
          ? pendingA
          : sent.length === 2
            ? pendingB
            : { ok: false, code: 'RESULT_UNKNOWN', message: '结果未知' };
      }),
    } as unknown as Window['caselite'];
    const scope = '88888888-8888-4888-8888-888888888888';
    const first = render(<AgentPanel scope={scope} />);
    fireEvent.change(screen.getByLabelText('AI 工作要求'), { target: { value: 'A' } });
    await screen.findByText('已配置 · 模型设置');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(sent.length).toBe(1));
    first.unmount();
    accepted = true;
    render(<AgentPanel scope={scope} />);
    await waitFor(() =>
      expect((screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement).disabled).toBe(false),
    );
    fireEvent.change(screen.getByLabelText('AI 工作要求'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(sent.length).toBe(2));
    await act(async () => {
      resolveA(snapshot());
      await pendingA;
    });
    await act(async () => {
      resolveB({ ok: false, code: 'RESULT_UNKNOWN', message: '结果未知' });
      await pendingB;
    });
    await screen.findByText('核对原发送（同一标识）');
    fireEvent.click(screen.getByText('核对原发送（同一标识）'));
    await waitFor(() => expect(sent.length).toBe(3));
    expect(sent[2].run_id).toBe(sent[1].run_id);
  });
  it('keeps the same submission ID after an unknown receipt, including remount', async () => {
    const sent: AgentRequest[] = [];
    window.caselite = {
      agent: vi.fn(async (request) => {
        if (request.operation === 'start') {
          sent.push(request);
          return {
            ok: false,
            code: sent.length === 2 ? 'BUSY' : 'RESULT_UNKNOWN',
            message: '结果未知',
          };
        }
        return profile;
      }),
    } as unknown as Window['caselite'];
    const scope = '55555555-5555-4555-8555-555555555555';
    const first = render(<AgentPanel scope={scope} />);
    fireEvent.change(screen.getByLabelText('AI 工作要求'), { target: { value: '保留发送身份' } });
    await screen.findByText('已配置 · 模型设置');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('核对原发送（同一标识）');
    expect((screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement).disabled).toBe(false);
    first.unmount();
    render(<AgentPanel scope={scope} />);
    await waitFor(() =>
      expect((screen.getByText('核对原发送（同一标识）') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByText('核对原发送（同一标识）'));
    await waitFor(() => expect(sent.length).toBe(2));
    expect(sent[1]).toEqual(sent[0]);
    await waitFor(() =>
      expect((screen.getByText('核对原发送（同一标识）') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByText('核对原发送（同一标识）'));
    await waitFor(() => expect(sent.length).toBe(3));
    expect(sent[2]).toEqual(sent[0]);
  });
  it('preserves an unsent draft on remount and isolates another task', async () => {
    window.caselite = { agent: vi.fn(async () => profile) } as unknown as Window['caselite'];
    const scope = '66666666-6666-4666-8666-666666666666';
    const first = render(<AgentPanel scope={scope} />);
    fireEvent.change(screen.getByLabelText('AI 工作要求'), { target: { value: '此任务草稿' } });
    first.unmount();
    const second = render(<AgentPanel scope={scope} />);
    expect((screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement).value).toBe('此任务草稿');
    second.unmount();
    render(<AgentPanel scope="77777777-7777-4777-8777-777777777777" />);
    expect((screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement).value).toBe('');
  });
  it('retains the draft when the host rejects a changed model', async () => {
    const sent: AgentRequest[] = [];
    window.caselite = {
      agent: vi.fn(async (r: AgentRequest) => {
        if (r.operation === 'start') {
          sent.push(r);
          return { ok: false, code: 'MODEL_CHANGED', message: '默认模型已变化，本次未发送。' };
        }
        return { ...profile, model: 'deepseek-flash', providers: { openai: true, deepseek: true } };
      }),
    } as unknown as Window['caselite'];
    render(<AgentPanel scope="99999999-9999-4999-8999-999999999999" />);
    await screen.findByText('DeepSeek · deepseek-flash');
    fireEvent.change(screen.getByLabelText('AI 工作要求'), { target: { value: '冻结目标测试' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('默认模型已变化，本次未发送。');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ model: 'deepseek-flash' });
    expect((screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement).value).toBe(
      '冻结目标测试',
    );
  });
});

it('shows a credential failure without blocking manual input or discarding readable output', async () => {
  const agent = vi.fn(async () => ({
    ...profile,
    configured: false,
    providers: { openai: false, deepseek: false },
    credential_errors: { openai: 'UNAVAILABLE' },
  }));
  window.caselite = { agent } as unknown as Window['caselite'];
  render(<AgentPanel scope="credential-unavailable-test" />);
  await screen.findByText(/系统安全凭据暂不可读/);
  const input = screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement;
  expect(input.disabled).toBe(false);
  fireEvent.change(input, { target: { value: '保留人工输入' } });
  expect(input.value).toBe('保留人工输入');
  expect(
    agent.mock.calls.every(([request]) => (request as AgentRequest).operation === 'read'),
  ).toBe(true);
});

it('opens a local project preview on focus, preserves scoped drafts, and sends only the displayed revision', async () => {
  const a = { id: crypto.randomUUID(), version: 1, archived: false };
  const b = { ...a, id: crypto.randomUUID() };
  const firstScope = `project:${a.id}`;
  const failed = { ok: false, code: 'UNAVAILABLE', message: '合成读取失败' } as const;
  const fingerprint = 'a'.repeat(64);
  let finish: ((result: AgentResponse) => void) | undefined;
  let failFirst = true;
  const preview = (title: string, value = fingerprint): AgentResponse => ({
    ...profile,
    project_preview: {
      fields: {
        title,
        status: 'active',
        project_type: 'civil_litigation',
        priority: 2,
        target_date: '2027-02-03',
      },
      fingerprint: value,
      archived: false,
    },
  });
  const agent = vi.fn(async (request: AgentRequest): Promise<AgentResponse> => {
    if (request.operation === 'preview_project') {
      if (request.scope !== firstScope) return preview('项目乙');
      if (failFirst) {
        failFirst = false;
        return failed;
      }
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
    if (request.operation === 'start')
      return { ok: false, code: 'RESULT_UNKNOWN', message: '回执未知' };
    return profile;
  });
  const material = vi.fn();
  window.caselite = { agent, material } as unknown as Window['caselite'];
  const view = render(<AgentPanel key={a.id} scope={firstScope} project={a} variant="compact" />);
  const input = () => screen.getByTestId('assistant-input') as HTMLTextAreaElement;
  const send = () => screen.getByRole<HTMLButtonElement>('button', { name: '发送', exact: true });
  expect(agent.mock.calls.some(([request]) => request.operation === 'preview_project')).toBe(false);
  fireEvent.focus(input());
  await screen.findByText(/合成读取失败/);
  fireEvent.change(input(), { target: { value: '项目甲草稿' } });
  expect(send().disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '读取项目上下文' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => finish?.(preview('项目甲')));
  expect(await screen.findByText('民事诉讼')).toBeTruthy();
  expect(send().disabled).toBe(false);
  expect(screen.queryByLabelText('添加文件与材料')).toBeNull();

  view.rerender(
    <AgentPanel key={a.id} scope={firstScope} project={{ ...a, version: 2 }} variant="compact" />,
  );
  expect(send().disabled).toBe(true);
  expect(screen.queryByText('项目甲')).toBeNull();
  expect(input().value).toBe('项目甲草稿');
  const oldResponse = finish;
  view.rerender(<AgentPanel key={b.id} scope={`project:${b.id}`} project={b} variant="compact" />);
  expect(input().value).toBe('');
  await act(async () => oldResponse?.(preview('不应显示的迟到结果')));
  expect(screen.queryByText('不应显示的迟到结果')).toBeNull();
  fireEvent.focus(input());
  expect(await screen.findByText('项目乙')).toBeTruthy();
  fireEvent.change(input(), { target: { value: '项目乙草稿' } });

  view.rerender(
    <AgentPanel key={a.id} scope={firstScope} project={{ ...a, version: 2 }} variant="compact" />,
  );
  expect(input().value).toBe('项目甲草稿');
  expect(send().disabled).toBe(true);
  fireEvent.focus(input());
  const newFingerprint = 'b'.repeat(64);
  await act(async () => finish?.(preview('项目甲更新版', newFingerprint)));
  await screen.findByText('项目甲更新版');
  fireEvent.click(send());
  const retry = await screen.findByRole('button', { name: '核对原发送（同一标识）' });
  fireEvent.click(retry);
  await waitFor(() =>
    expect(agent.mock.calls.filter(([r]) => r.operation === 'start')).toHaveLength(2),
  );
  const requests = agent.mock.calls.map(([r]) => r).filter((r) => r.operation === 'start');
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]).toMatchObject({
    scope: firstScope,
    project_fingerprint: newFingerprint,
    prompt: '项目甲草稿',
  });
  expect(material).not.toHaveBeenCalled();
});

it.each(['succeeded', 'failed', 'cancelled', 'running'] as const)(
  'keeps dedicated date %s output out of chat while retaining the scope run guard',
  async (status) => {
    const scope = `date-purpose-${status}`;
    const ordinary: AgentRun = {
      id: '77777777-7777-4777-8777-777777777777',
      scope,
      prompt: '普通聊天问题',
      output: '普通聊天回答',
      model: 'gpt-4.1-mini',
      provider: 'openai',
      status: 'succeeded',
      sequence: 1,
      message: '普通聊天完成',
      usage: null,
    };
    const dateRun: AgentRun = {
      ...ordinary,
      id: '88888888-8888-4888-8888-888888888888',
      purpose: 'important_dates',
      prompt: '内部日期提取要求',
      output: '{"candidates":[{"internal":"date-only-facts"}]}',
      message: '内部日期结果',
      status,
    };
    const agent = vi.fn(async (request: AgentRequest) => {
      if (request.operation === 'cancel') dateRun.status = 'cancelled';
      return { ...profile, runs: [ordinary, { ...dateRun }] };
    });
    window.caselite = { agent } as unknown as Window['caselite'];
    const changed = vi.fn();
    render(<AgentPanel scope={scope} variant="compact" onConversationChange={changed} />);
    await screen.findByText('普通聊天回答');
    expect(screen.queryByText('内部日期提取要求')).toBeNull();
    expect(screen.queryByText(/date-only-facts/)).toBeNull();
    expect(screen.queryByText(/内部日期结果/)).toBeNull();
    expect(screen.queryByText('恢复上轮要求与原选段')).toBeNull();
    expect(changed).toHaveBeenLastCalledWith(true);
    const input = screen.getByLabelText('AI 工作要求');
    fireEvent.change(input, { target: { value: '新问题草稿' } });
    if (status === 'running') {
      await screen.findByText('重要日期识别正在运行，请在重要日期面板查看候选与来源。');
      expect((screen.getByLabelText('选择大模型') as HTMLSelectElement).disabled).toBe(true);
      fireEvent.submit(input.closest('form')!);
      expect(agent.mock.calls.some(([r]) => r.operation === 'start')).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
      await waitFor(() =>
        expect(agent).toHaveBeenCalledWith({
          protocol_version: 1,
          operation: 'cancel',
          scope,
          run_id: dateRun.id,
        }),
      );
      await screen.findByRole('button', { name: '发送' });
      expect((input as HTMLTextAreaElement).value).toBe('新问题草稿');
    }
    expect(screen.getByText('普通聊天回答')).toBeTruthy();
    expect(agent.mock.calls.some(([r]) => r.operation === 'start')).toBe(false);
  },
);

it('does not enter ordinary conversation layout for a date-only history', async () => {
  const agent = vi.fn(async () => ({
    ...profile,
    runs: [
      {
        id: '99999999-9999-4999-8999-999999999999',
        scope: 'date-only-history',
        purpose: 'important_dates',
        prompt: '内部日期请求',
        output: '{"candidates":[]}',
        model: 'gpt-4.1-mini',
        provider: 'openai',
        status: 'succeeded',
        sequence: 1,
        message: '日期已完成',
        usage: null,
      },
    ],
  }));
  window.caselite = { agent } as unknown as Window['caselite'];
  const changed = vi.fn();
  const view = render(<AgentPanel scope="date-only-history" onConversationChange={changed} />);
  await screen.findByText('已配置 · 模型设置');
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(view.container.querySelector('.assistant-panel--conversation')).toBeNull();
  expect(screen.queryByText(/candidates/)).toBeNull();
});

it.each(['running', 'failed', 'reading', 'unknown'] as const)(
  'resizing a %s sidebar preserves its controller and guards without extra IPC',
  async (state) => {
    const scope = '91919191-9191-4191-8191-919191919191';
    const run: AgentRun = {
      id: '92929292-9292-4292-8292-929292929292',
      scope,
      prompt: '历史问题',
      output: '已有部分回答',
      model: 'gpt-4.1-mini',
      provider: 'openai',
      status: state === 'running' ? 'running' : 'failed',
      sequence: 1,
      message: '合成运行状态',
      usage: null,
    };
    const agent = vi.fn(async (request: AgentRequest): Promise<AgentResponse> => {
      if (request.operation === 'preview_page')
        return {
          ...profile,
          page_preview: {
            id: crypto.randomUUID(),
            title: '合成页面',
            mode: 'page',
            characters: 12,
          },
        };
      if (request.operation === 'start') throw new Error('Unknown receipt');
      return {
        ...profile,
        credential_reading: state === 'reading',
        runs: state === 'reading' || state === 'unknown' ? [] : [run],
      };
    });
    window.caselite = { agent } as unknown as Window['caselite'];
    render(
      <InspectorLayout properties={<input aria-label="属性" />}>
        <SidebarAgent taskId={scope} />
      </InspectorLayout>,
    );
    const input = screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement;
    await waitFor(() => expect(agent).toHaveBeenCalled());
    if (state === 'reading') await screen.findByText(/正在读取系统安全凭据/);
    if (state === 'running') await screen.findByRole('button', { name: '停止生成' });
    if (state === 'failed') await screen.findByText('已有部分回答');
    fireEvent.change(input, { target: { value: '保留这份草稿' } });
    if (state === 'unknown') {
      fireEvent.focus(input);
      await screen.findByLabelText('页面引用文件');
      fireEvent.submit(input.closest('form')!);
      await screen.findByRole('button', { name: '核对原发送（同一标识）' });
    }
    const before = agent.mock.calls.length;
    const toggle = screen.getByRole('button', { name: /展开 AI 对话|收起 AI 对话/ });
    for (let i = 0; i < 4; i++) fireEvent.click(toggle);
    expect(input).toBe(screen.getByLabelText('AI 工作要求'));
    expect(input.value).toBe('保留这份草稿');
    expect(agent.mock.calls).toHaveLength(before);
    expect(agent.mock.calls.filter(([r]) => r.operation === 'start')).toHaveLength(
      state === 'unknown' ? 1 : 0,
    );
    expect(agent.mock.calls.some(([r]) => r.operation === 'cancel')).toBe(false);
  },
);

it('lets the attachment menu consume Escape before the layout collapses', async () => {
  const agent = vi.fn(async () => profile);
  const material = vi.fn(async () => ({ ok: true, materials: [], staged: null }));
  window.caselite = { agent, material } as unknown as Window['caselite'];
  render(
    <InspectorLayout properties={null}>
      <SidebarAgent taskId="93939393-9393-4393-8393-939393939393" />
    </InspectorLayout>,
  );
  await waitFor(() => expect(agent).toHaveBeenCalled());
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('AI 工作要求'));
  const toggle = screen.getByRole('button', { name: '收起 AI 对话' });
  await user.click(screen.getByRole('button', { name: '添加文件与材料' }));
  expect(screen.getByRole('menu', { name: '添加文件与材料' })).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu', { name: '添加文件与材料' })).toBeNull();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  await user.keyboard('{Escape}');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(
    agent.mock.calls.some(([request]) =>
      ['start', 'cancel'].includes((request as AgentRequest).operation),
    ),
  ).toBe(false);
});
