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

// 本测试聚焦发送身份与草稿生命周期；真实Tiptap/assistant-ui/Pi另由打包演示覆盖。
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
const profile: AgentResponse = { ok: true, configured: true, model: 'gpt-4.1-mini', runs: [] };
describe('AI submission UI lifecycle', () => {
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
    fireEvent.click(screen.getByText('预览发送'));
    await waitFor(() =>
      expect((screen.getByText('确认发送') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByText('确认发送'));
    await waitFor(() => expect(sent.length).toBe(1));
    first.unmount();
    accepted = true;
    render(<AgentPanel scope={scope} />);
    await waitFor(() =>
      expect((screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement).disabled).toBe(false),
    );
    fireEvent.change(screen.getByLabelText('AI 工作要求'), { target: { value: 'B' } });
    fireEvent.click(screen.getByText('预览发送'));
    fireEvent.click(screen.getByText('确认发送'));
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
    fireEvent.click(screen.getByText('预览发送'));
    await waitFor(() =>
      expect((screen.getByText('确认发送') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByText('确认发送'));
    await screen.findByText('核对原发送（同一标识）');
    expect((screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement).disabled).toBe(true);
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
});
