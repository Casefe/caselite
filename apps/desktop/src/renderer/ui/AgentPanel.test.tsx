// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentRequest, AgentResponse } from '../../preload/caselite-api';
import AgentPanel from './AgentPanel';
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
describe('AI submission UI lifecycle', () => {
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
    const refill = await screen.findByRole('button', { name: '重新填写上次要求 · 附件请重新添加' });
    expect(screen.getByText('部分结果')).toBeTruthy();
    fireEvent.click(refill);
    expect((screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement).value).toBe(
      '上次工作要求',
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
