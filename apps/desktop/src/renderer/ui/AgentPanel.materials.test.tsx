// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  AgentRequest,
  AgentResponse,
  AgentRun,
  MaterialResponse,
  Material,
} from '../../preload/caselite-api';
import AgentPanel from './AgentPanel';
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(cleanup);
const file: Material = {
  id: '22222222-2222-4222-8222-222222222222',
  task_id: '33333333-3333-4333-8333-333333333333',
  asset_version_id: '22222222-2222-4222-8222-222222222222',
  name: '合同.pdf',
  sha256: '0'.repeat(64),
  bytes: 100,
  page_count: 1,
  derivation_id: null,
  status: 'imported',
  pages: [],
};
const context = {
  id: '44444444-4444-4444-8444-444444444444',
  task_id: file.task_id,
  instruction: '核对材料',
  model: 'gpt-4.1-mini',
  payload: '唯一附件内容',
  sha256: '0'.repeat(64),
  selections: [
    {
      source_id: file.id,
      derivation_id: '55555555-5555-4555-8555-555555555555',
      name: file.name,
      pages: [1],
    },
  ],
};
function addPdf() {
  fireEvent.click(screen.getByRole('button', { name: '添加文件与材料' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '文件' }));
}
function fixture() {
  let finishImport!: (r: MaterialResponse) => void;
  let finishRun!: (r: AgentResponse) => void;
  let items: Material[] = [];
  let runs: AgentRun[] = [];
  const sent: Extract<AgentRequest, { operation: 'start' }>[] = [];
  const profile = (): AgentResponse => ({
    ok: true,
    configured: true,
    providers: { openai: true, deepseek: false },
    model: 'gpt-4.1-mini',
    runs,
  });
  const material = vi.fn(async (r) => {
    if (r.operation === 'commit') {
      const result = await new Promise<MaterialResponse>((done) => {
        finishImport = done;
      });
      if (result.ok) items = result.materials;
      return result;
    }
    if (r.operation === 'preview') return { ok: true, materials: items, preview: context };
    return { ok: true, materials: items };
  });
  window.caselite = {
    pickPdf: vi.fn(async () => ({
      ok: true,
      materials: [],
      staged: { token: file.id, name: file.name, bytes: file.bytes },
    })),
    material,
    agent: vi.fn(async (r: AgentRequest) => {
      if (r.operation !== 'start') return profile();
      sent.push(r);
      return new Promise<AgentResponse>((done) => {
        finishRun = done;
      });
    }),
  } as unknown as Window['caselite'];
  return {
    material,
    sent,
    finishImport: (r: MaterialResponse) => finishImport(r),
    finishRun: (r: AgentResponse) => finishRun(r),
    accept() {
      const r = sent[0];
      runs = [
        {
          id: r.run_id,
          scope: r.scope,
          model: 'gpt-4.1-mini',
          provider: 'openai',
          prompt: r.prompt,
          output: '合成回答',
          attachments: [{ source_id: file.id, task_id: file.task_id, name: file.name, pages: [1] }],
          status: 'succeeded',
          sequence: 1,
          message: '完成',
          usage: null,
        },
      ];
      finishRun(profile());
    },
  };
}
it('cancelling the system file picker preserves existing text and selected attachments without starting an Agent run', async () => {
  const f = fixture();
  render(<AgentPanel scope="d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2" />);
  await screen.findByText('已配置 · 模型设置');
  addPdf();
  await waitFor(() =>
    expect(f.material.mock.calls.some(([r]) => r.operation === 'commit')).toBe(true),
  );
  await act(async () => f.finishImport({ ok: true, materials: [file] }));
  const input = screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '原有工作要求' } });
  vi.mocked(window.caselite.pickPdf).mockResolvedValueOnce({ ok: true, materials: [] });
  addPdf();
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '添加文件与材料' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(input.value).toBe('原有工作要求');
  expect(screen.getByLabelText('待发送附件').textContent).toContain(file.name);
  expect(f.material.mock.calls.filter(([r]) => r.operation === 'commit')).toHaveLength(1);
  expect(f.sent).toHaveLength(0);
});
it('waits for pending import on one Send, then moves the attachment to the message and clears the composer', async () => {
  const f = fixture();
  render(<AgentPanel scope="abababab-abab-4bab-8bab-abababababab" />);
  await screen.findByText('已配置 · 模型设置');
  addPdf();
  await waitFor(() =>
    expect(f.material.mock.calls.some(([r]) => r.operation === 'commit')).toBe(true),
  );
  const input = screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '核对材料' } });
  expect(f.sent).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(f.sent).toHaveLength(0);
  await act(async () => f.finishImport({ ok: true, materials: [file] }));
  await waitFor(() => expect(f.sent).toHaveLength(1));
  expect(f.sent[0]).toMatchObject({ prompt: '核对材料', context_id: context.id });
  await act(async () => f.accept());
  await waitFor(() => expect(input.value).toBe(''));
  expect(screen.queryByLabelText('待发送附件')).toBeNull();
  expect(document.querySelector('.message-attachments')?.textContent).toContain('合同.pdf');
});
it('does not erase next-round typing on late acceptance and never dispatches missing attachments', async () => {
  const f = fixture();
  render(<AgentPanel scope="bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc" />);
  await screen.findByText('已配置 · 模型设置');
  addPdf();
  await waitFor(() =>
    expect(f.material.mock.calls.some(([r]) => r.operation === 'commit')).toBe(true),
  );
  const input = screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '核对材料' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  fireEvent.change(input, { target: { value: '下一轮要求' } });
  await act(async () => f.finishImport({ ok: false, code: 'FAILED', message: '文件无法导入' }));
  await screen.findAllByText('文件无法导入');
  expect(f.sent).toHaveLength(0);
  expect(input.value).toBe('下一轮要求');
});
it('preserves later edits after a successful attachment submission', async () => {
  const f = fixture();
  render(<AgentPanel scope="cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd" />);
  await screen.findByText('已配置 · 模型设置');
  addPdf();
  await waitFor(() =>
    expect(f.material.mock.calls.some(([r]) => r.operation === 'commit')).toBe(true),
  );
  const input = screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '核对材料' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  fireEvent.change(input, { target: { value: '不要擦掉下一轮' } });
  await act(async () => f.finishImport({ ok: true, materials: [file] }));
  await waitFor(() => expect(f.sent).toHaveLength(1));
  await act(async () => f.accept());
  expect(input.value).toBe('不要擦掉下一轮');
  expect(screen.queryByLabelText('待发送附件')).toBeNull();
});

it('an old unmounted instance cannot erase a new controlled draft when its acknowledgement arrives', async () => {
  const f = fixture();
  const scope = 'dededede-dede-4ede-8ede-dededededede';
  function Host() {
    const [visible, setVisible] = React.useState(true);
    const [draft, setDraft] = React.useState({ text: '', state: null });
    return (
      <>
        <button onClick={() => setVisible(!visible)}>切换面板</button>
        {visible && <AgentPanel scope={scope} draft={draft} onDraft={setDraft} />}
      </>
    );
  }
  render(<Host />);
  await screen.findByText('已配置 · 模型设置');
  fireEvent.change(screen.getByLabelText('AI 工作要求'), { target: { value: 'A' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(f.sent).toHaveLength(1));
  fireEvent.click(screen.getByText('切换面板'));
  fireEvent.click(screen.getByText('切换面板'));
  fireEvent.change(screen.getByLabelText('AI 工作要求'), { target: { value: 'B' } });
  await act(async () => f.accept());
  await waitFor(() => expect(document.querySelector('.assistant-message')).toBeTruthy());
  expect((screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement).value).toBe('B');
  expect(f.sent).toHaveLength(1);
});
it('a new edit with identical text is still a new draft and survives acknowledgement', async () => {
  const f = fixture();
  render(<AgentPanel scope="efefefef-efef-4fef-8fef-efefefefefef" />);
  await screen.findByText('已配置 · 模型设置');
  const input = screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '继续' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(f.sent).toHaveLength(1));
  fireEvent.change(input, { target: { value: '新的问题' } });
  fireEvent.change(input, { target: { value: '继续' } });
  await act(async () => f.accept());
  expect(input.value).toBe('继续');
});
it('cancels a pending upload submission without starting a paid run', async () => {
  const f = fixture();
  render(<AgentPanel scope="fafafafa-fafa-4afa-8afa-fafafafafafa" />);
  await screen.findByText('已配置 · 模型设置');
  addPdf();
  await waitFor(() =>
    expect(f.material.mock.calls.some(([r]) => r.operation === 'commit')).toBe(true),
  );
  fireEvent.change(screen.getByLabelText('AI 工作要求'), { target: { value: '核对材料' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  fireEvent.click(screen.getByText('取消发送'));
  await act(async () => f.finishImport({ ok: true, materials: [file] }));
  expect(f.sent).toHaveLength(0);
  expect((screen.getByLabelText('AI 工作要求') as HTMLTextAreaElement).value).toBe('核对材料');
});

it('restores a pending staged upload without locking forever when Add is clicked again', async () => {
  const staged = { token: file.id, name: file.name, bytes: file.bytes };
  const material = vi.fn(async (r) =>
    r.operation === 'list' ? { ok: true, materials: [], staged } : { ok: true, materials: [file] },
  );
  const agent = vi.fn(async () => ({
    ok: true,
    configured: false,
    providers: { openai: false, deepseek: false },
    model: 'gpt-4.1-mini',
    runs: [],
  }));
  window.caselite = { material, agent } as unknown as Window['caselite'];
  render(<AgentPanel scope="a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1" />);
  await screen.findByText('上次附件尚未完成');
  addPdf();
  await waitFor(() =>
    expect((screen.getByText('继续添加') as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByText('继续添加'));
  await waitFor(() =>
    expect(material.mock.calls.some(([r]) => r.operation === 'commit' && r.token === file.id)).toBe(
      true,
    ),
  );
  expect(agent.mock.calls.some(([r]) => (r as AgentRequest)?.operation === 'start')).toBe(false);
});

it('retries a restored original with its original operation and target, without adding it as a chat attachment', async () => {
  const staged = {
    token: 'b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1',
    name: file.name,
    bytes: file.bytes,
    restore_source_id: file.id,
  };
  const material = vi.fn(async (r) =>
    r.operation === 'list'
      ? { ok: true, materials: [file], staged }
      : { ok: true, materials: [file] },
  );
  window.caselite = {
    material,
    agent: vi.fn(async () => ({
      ok: true,
      configured: false,
      providers: { openai: false, deepseek: false },
      model: 'gpt-4.1-mini',
      runs: [],
    })),
  } as unknown as Window['caselite'];
  render(<AgentPanel scope="c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1" />);
  await screen.findByText('上次原件恢复尚未完成');
  fireEvent.click(screen.getByText('重试恢复'));
  await waitFor(() =>
    expect(
      material.mock.calls.some(
        ([r]) => r.operation === 'restore' && r.source_id === file.id && r.token === staged.token,
      ),
    ).toBe(true),
  );
  expect(material.mock.calls.some(([r]) => r.operation === 'commit')).toBe(false);
  expect(screen.queryByLabelText('待发送附件')).toBeNull();
});
