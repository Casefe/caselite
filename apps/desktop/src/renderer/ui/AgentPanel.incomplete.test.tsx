// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentRun } from '../../preload/caselite-api';
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

it('shows completeness beside the corresponding historical answer after remount', async () => {
  const scope = crypto.randomUUID();
  const base: AgentRun = {
    id: crypto.randomUUID(),
    scope,
    model: 'gpt-4.1-mini',
    provider: 'openai',
    prompt: '第一问',
    output: '未完成的回答',
    status: 'succeeded',
    sequence: 1,
    message: '达到输出上限',
    usage: null,
    output_incomplete: true,
  };
  const runs: AgentRun[] = [
    base,
    {
      ...base,
      id: crypto.randomUUID(),
      prompt: '第二问',
      output: '完整回答',
      output_incomplete: false,
    },
    {
      ...base,
      id: crypto.randomUUID(),
      prompt: '第三问',
      output: '旧版回答',
      output_incomplete: undefined,
    },
    {
      ...base,
      id: crypto.randomUUID(),
      prompt: '第四问',
      output: '失败部分',
      status: 'failed',
      message: '运行失败',
    },
  ];
  window.caselite = {
    agent: vi.fn(async () => ({
      ok: true,
      configured: true,
      model: 'gpt-4.1-mini',
      providers: { openai: true },
      runs,
    })),
  } as unknown as Window['caselite'];
  const assertHistory = async () => {
    expect(await screen.findByText('回答不完整 · 待人工核对')).toBeTruthy();
    const incomplete = screen.getByText('未完成的回答').closest('.assistant-message');
    expect(within(incomplete as HTMLElement).getByText('回答不完整 · 待人工核对')).toBeTruthy();
    for (const text of ['完整回答', '旧版回答']) {
      const message = screen.getByText(text).closest('.assistant-message');
      expect(message).toBeTruthy();
      expect(within(message as HTMLElement).queryByText('回答不完整 · 待人工核对')).toBeNull();
      expect(within(message as HTMLElement).getByText('待人工核对')).toBeTruthy();
    }
    const failed = screen.getByText('失败部分').closest('.assistant-message');
    expect(within(failed as HTMLElement).getByText('运行失败')).toBeTruthy();
  };
  const view = render(<AgentPanel scope={scope} />);
  await assertHistory();
  view.unmount();
  render(<AgentPanel scope={scope} />);
  await assertHistory();
});
