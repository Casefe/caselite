// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentRequest, MaterialPreview } from '../../preload/caselite-api';
const state = vi.hoisted(() => ({ preview: vi.fn(), signature: 'selected-original' }));
vi.mock('./useMaterials', () => ({
  useMaterials: () => ({
    available: true,
    items: [],
    error: '',
    busy: false,
    staged: null,
    reading: null,
    selected: { one: '' },
    signature: state.signature,
    canNewHome: false,
    preview: state.preview,
  }),
}));
vi.mock('./PdfAttachments', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
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
      value={value.text}
      disabled={disabled}
      onChange={(e) => onChange({ text: e.target.value, state: null })}
    />
  ),
}));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
import AgentPanel from './AgentPanel';
afterEach(() => {
  cleanup();
  state.preview.mockReset();
  state.signature = 'selected-original';
});
const profile = {
  ok: true,
  configured: true,
  model: 'gpt-4.1-mini',
  providers: { openai: true, deepseek: false },
  runs: [],
};
const context: MaterialPreview = {
  id: '22222222-2222-4222-8222-222222222222',
  task_id: '33333333-3333-4333-8333-333333333333',
  instruction: '核对材料',
  model: 'gpt-4.1-mini',
  payload: '合同.pdf 物理页1 合成材料',
  sha256: '0'.repeat(64),
  selections: [],
};
it('discards an asynchronous material preview when the instruction changes', async () => {
  let finish!: (value: MaterialPreview) => void;
  state.preview.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  window.caselite = { agent: vi.fn(async () => profile) } as unknown as Window['caselite'];
  render(<AgentPanel scope="55555555-5555-4555-8555-555555555555" />);
  const input = screen.getByLabelText('AI 工作要求');
  fireEvent.change(input, { target: { value: '核对材料' } });
  fireEvent.submit(input.closest('form')!);
  fireEvent.change(input, { target: { value: '新的要求' } });
  await act(async () => finish(context));
  expect(screen.queryByLabelText('发送预览')).toBeNull();
});
it('restores the same material manifest when an unknown send is reopened', async () => {
  state.preview.mockResolvedValue(context);
  const agent = vi.fn(async (r: AgentRequest) =>
    r.operation === 'start' ? { ok: false, code: 'RESULT_UNKNOWN', message: '结果未知' } : profile,
  );
  window.caselite = { agent } as unknown as Window['caselite'];
  const scope = '66666666-6666-4666-8666-666666666666';
  const view = render(<AgentPanel scope={scope} />);
  const input = screen.getByLabelText('AI 工作要求');
  fireEvent.change(input, { target: { value: '核对材料' } });
  fireEvent.submit(input.closest('form')!);
  await screen.findByText(context.payload);
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '确认发送' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '确认发送' }));
  await screen.findByText('结果未知');
  view.unmount();
  render(<AgentPanel scope={scope} />);
  expect(screen.getByText(context.payload)).toBeTruthy();
  expect(screen.getByLabelText('发送预览').textContent).toContain('包含下列指令和所选材料文字');
  expect(agent.mock.calls.filter(([r]) => r.operation === 'start')).toHaveLength(1);
});
