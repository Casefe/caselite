// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useAgentController } from './useAgentController';
import type { AgentRun, AgentRequest } from '../../../preload/caselite-api';
vi.mock('../../ui/useMaterials', () => ({
  useMaterials: () => ({ preview: vi.fn(), acknowledge: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('requires explicit candidate selection, permits removal and freezes unknown sends without clearing newer selection', async () => {
  const scope = `contact:${crypto.randomUUID()}`;
  const candidate = {
    kind: 'contact_record' as const,
    title: '候选甲',
    channel: 'other' as const,
    occurred_on: null,
    summary: '唯一旧候选',
  };
  const a: AgentRun = {
    id: crypto.randomUUID(),
    scope,
    prompt: '原问题',
    output: JSON.stringify(candidate),
    contact_record_candidate: candidate,
    status: 'succeeded',
    model: 'gpt-4.1-mini',
    provider: 'openai',
    sequence: 2,
    message: '完成',
    usage: null,
  };
  const b = {
    ...a,
    id: crypto.randomUUID(),
    contact_record_candidate: { ...candidate, title: '候选乙' },
  };
  const profile = {
    ok: true,
    configured: true,
    model: 'gpt-4.1-mini',
    providers: { openai: true },
    runs: [a, b],
  };
  const writes: Extract<AgentRequest, { operation: 'start' }>[] = [];
  let unknown = false;
  let finish: ((value: unknown) => void) | undefined;
  const agent = vi.fn(async (request: AgentRequest) => {
    if (request.operation === 'preview_page')
      return {
        ...profile,
        page_preview: { id: crypto.randomUUID(), title: '合成客户', mode: 'page', characters: 4 },
      };
    if (request.operation === 'start') {
      writes.push(request);
      if (unknown && !finish) return { ok: false, code: 'RESULT_UNKNOWN', message: '合成回执丢失' };
      if (unknown)
        return new Promise((resolve) => {
          finish = resolve;
        });
      return {
        ...profile,
        runs: [...profile.runs, { ...a, id: request.run_id, prompt: request.prompt }],
      };
    }
    return profile;
  });
  vi.stubGlobal('caselite', { agent });
  const hook = renderHook(() =>
    useAgentController({ scope, page: { version: '1', archived: false } }),
  );
  await waitFor(() => expect(hook.result.current.configured).toBe(true));
  await act(async () => hook.result.current.loadPageReference());
  act(() => hook.result.current.setDraft({ text: '修改合同需要注意什么', state: null }));
  await act(async () => hook.result.current.send());
  expect(writes[0]).not.toHaveProperty('contact_record_context_id');
  act(() => hook.result.current.selectContactRecord(a));
  expect(hook.result.current.contactReference?.title).toBe('候选甲');
  act(() => hook.result.current.removeContactRecord());
  act(() => hook.result.current.setDraft({ text: '补充协议是什么意思', state: null }));
  await act(async () => hook.result.current.send());
  expect(writes[1]).not.toHaveProperty('contact_record_context_id');
  act(() => hook.result.current.selectContactRecord(a));
  act(() => hook.result.current.setDraft({ text: '日期用今天', state: null }));
  unknown = true;
  await act(async () => hook.result.current.send());
  expect(writes[2].contact_record_context_id).toBe(a.id);
  expect(hook.result.current.unknown).toBe(true);
  // 下一次发送仍是原请求；等待期间选择乙，原甲的迟到回执不能清除乙。
  finish = () => {};
  let sending: Promise<void>;
  act(() => {
    sending = hook.result.current.send();
  });
  await waitFor(() => expect(writes).toHaveLength(4));
  expect(writes[3]).toEqual(writes[2]);
  act(() => hook.result.current.selectContactRecord(b));
  await act(async () => {
    finish!({ ...profile, runs: [...profile.runs, { ...a, id: writes[2].run_id }] });
    await sending!;
  });
  expect(hook.result.current.contactReference?.run_id).toBe(b.id);
  expect(hook.result.current.unknown).toBe(false);
});
