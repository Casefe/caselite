// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { useAgentController } from './useAgentController';
import { createAgentApplication } from '../../../../../../packages/application/src/agent-application';
import DocumentReview from '../documents/review/DocumentReview';
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('../../ui/useMaterials', () => ({
  useMaterials: () => ({ preview: vi.fn(async () => undefined), acknowledge: vi.fn() }),
}));
afterEach(cleanup);
it('preserves the active page reference and continuation after the document revision changes', async () => {
  const scope = 'document:b2345678-1234-4234-8234-123456789abc';
  const profile = { ok: true, model: 'gpt-4.1-mini', providers: { openai: true }, runs: [] };
  let complete: ((result: unknown) => void) | undefined;
  let requested: Record<string, unknown> | undefined;
  const agent = vi.fn(async (request: Record<string, unknown>) => {
    if (request.operation === 'preview_page')
      return {
        ...profile,
        page_preview: {
          id: 'a2345678-1234-4234-8234-123456789abc',
          title: '合成文档',
          mode: 'page',
          characters: 5,
        },
      };
    if (request.operation === 'start') {
      requested = request;
      return await new Promise((resolve) => {
        complete = resolve;
      });
    }
    return profile;
  });
  window.caselite = { agent } as unknown as Window['caselite'];
  const identity = {
    task_id: 'c2345678-1234-4234-8234-123456789abc',
    document_id: scope.slice(9),
    body_id: 'd2345678-1234-4234-8234-123456789abc',
    revision: 1,
  };
  const props = { editor: null, identity, blocked: false, onApplyBusy() {}, onSaved() {} };
  const view = render(<DocumentReview {...props} />);
  fireEvent.change(screen.getByRole('textbox', { name: '本轮问题' }), {
    target: { value: '合成问题' },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送本轮审阅' }));
  await waitFor(() => expect(complete).toBeDefined());
  view.rerender(<DocumentReview {...props} identity={{ ...identity, revision: 2 }} />);
  await act(async () => {
    complete!({
      ...profile,
      runs: [
        {
          id: requested!.run_id,
          scope,
          prompt: '合成问题',
          status: 'succeeded',
          output: '合成回答',
          sequence: 1,
          model: 'gpt-4.1-mini',
          provider: 'openai',
          message: '',
          usage: null,
        },
      ],
    });
  });
  await screen.findByRole('button', { name: '继续提问' });
});
it('keeps a page-send failure recoverable', async () => {
  const profile = { ok: true, model: 'gpt-4.1-mini', providers: { openai: false }, runs: [] };
  const agent = vi.fn(async (request: { operation: string }) => {
    if (request.operation === 'preview_page')
      return {
        ...profile,
        page_preview: {
          id: '62345678-1234-4234-8234-123456789abc',
          title: '合成文档',
          mode: 'page',
          characters: 5,
        },
      };
    if (request.operation === 'start')
      return { ok: false, code: 'NO_KEY', message: '合成未派发失败' };
    return profile;
  });
  window.caselite = { agent } as unknown as Window['caselite'];
  render(
    <DocumentReview
      editor={null}
      identity={{
        task_id: '72345678-1234-4234-8234-123456789abc',
        document_id: '82345678-1234-4234-8234-123456789abc',
        body_id: '92345678-1234-4234-8234-123456789abc',
        revision: 1,
      }}
      blocked={false}
      onApplyBusy={() => {}}
      onSaved={() => {}}
    />,
  );
  const input = screen.getByRole('textbox', { name: '本轮问题' });
  fireEvent.change(input, { target: { value: '合成问题' } });
  fireEvent.click(screen.getByRole('button', { name: '发送本轮审阅' }));
  await screen.findByText('合成未派发失败');
  expect(
    (input as HTMLTextAreaElement).disabled &&
      !screen.queryByRole('button', { name: /核对本轮结果|继续提问|重新提问|结束本轮|重试/ }),
  ).toBe(false);
});
it('recovers unknown retry after the server definitively rejects a stale page reference', async () => {
  const scope = 'document:12345678-1234-4234-8234-123456789abc';
  const profile = {
    ok: true,
    configured: true,
    model: 'gpt-4.1-mini',
    providers: { openai: true },
    runs: [],
  };
  let attempts = 0;
  const agent = vi.fn(async (request: { operation: string }) => {
    if (request.operation === 'preview_page')
      return {
        ...profile,
        page_preview: {
          id: '22345678-1234-4234-8234-123456789abc',
          title: '合成页面',
          mode: 'page',
          characters: 5,
        },
      };
    if (request.operation === 'start') {
      attempts++;
      if (attempts === 1) throw new Error('transport failed before dispatch');
      return { ok: false, code: 'STALE_PAGE_CONTEXT', message: '引用已失效，原Run未派发' };
    }
    return profile;
  });
  window.caselite = { agent } as unknown as Window['caselite'];
  const { result } = renderHook(() =>
    useAgentController({ scope, page: { version: '1', archived: false } }),
  );
  await waitFor(() => expect(result.current.configured).toBe(true));
  await act(async () => {
    await result.current.loadPageReference();
  });
  act(() => result.current.setDraft({ text: '合成要求', state: null }));
  await act(async () => {
    await result.current.send();
  });
  expect(result.current.unknown).toBe(true);
  await act(async () => {
    await result.current.send();
  });
  expect(result.current.pageReference).toBeUndefined();
  expect(result.current.unknown).toBe(false);
  const previewsBefore = agent.mock.calls.filter(([r]) => r.operation === 'preview_page').length;
  await act(async () => {
    await result.current.loadPageReference();
  });
  expect(agent.mock.calls.filter(([r]) => r.operation === 'preview_page')).toHaveLength(
    previewsBefore + 1,
  );
  expect(result.current.pageReference).toBeDefined();
});

it('never sends another scope or owner page, rejects stale selection and page, and replays the exact Run without dispatch', async () => {
  const first = '32345678-1234-4234-8234-123456789abc';
  const second = '42345678-1234-4234-8234-123456789abc';
  let version = '1';
  const start = vi.fn(() => ({ cancel() {} }));
  const app = createAgentApplication({
    credentials: {
      get: () => 'synthetic-review-key',
      set() {},
      clear() {},
      getDefaultModel: () => 'gpt-4.1-mini',
      setDefaultModel() {},
    },
    taskExists: (id) => [first, second].includes(id),
    runtime: { start },
    page: {
      read: (scope) =>
        [first, second].includes(scope)
          ? {
              title: '合成任务',
              text: scope === first ? '选中片段 不可自动外发的其他文字' : '另一页面',
              version,
              archived: false,
            }
          : undefined,
    },
  });
  const preview = (scope: string, selected_text?: string) =>
    app.execute(
      {
        protocol_version: 1,
        operation: 'preview_page',
        scope,
        ...(selected_text ? { selected_text } : {}),
      },
      'first-owner',
    );
  expect(await preview(first, '页面中没有的文字')).toMatchObject({
    ok: false,
    code: 'STALE_PAGE_CONTEXT',
  });
  const local = await preview(first, '选中片段');
  if (!local.ok || !local.page_preview) throw new Error('preview unavailable');
  expect(start).not.toHaveBeenCalled();
  const request = {
    protocol_version: 1,
    operation: 'start',
    scope: first,
    run_id: '52345678-1234-4234-8234-123456789abc',
    model: 'gpt-4.1-mini',
    prompt: '合成问题',
    confirmed: true,
    page_context_id: local.page_preview.id,
  };
  expect(await app.execute({ ...request, scope: second }, 'first-owner')).toMatchObject({
    ok: false,
    code: 'STALE_PAGE_CONTEXT',
  });
  expect(await app.execute(request, 'other-owner')).toMatchObject({
    ok: false,
    code: 'STALE_PAGE_CONTEXT',
  });
  version = '2';
  expect(await app.execute(request, 'first-owner')).toMatchObject({
    ok: false,
    code: 'STALE_PAGE_CONTEXT',
  });
  expect(start).not.toHaveBeenCalled();
  const current = await preview(first, '选中片段');
  if (!current.ok || !current.page_preview) throw new Error('preview unavailable');
  const send = { ...request, page_context_id: current.page_preview.id };
  expect(await app.execute(send, 'first-owner')).toMatchObject({ ok: true });
  expect(start).toHaveBeenCalledTimes(1);
  expect(start.mock.calls[0][0].prompt).toContain('选中片段');
  expect(start.mock.calls[0][0].prompt).not.toContain('不可自动外发');
  version = '3';
  expect(await app.execute(send, 'first-owner')).toMatchObject({ ok: true });
  expect(start).toHaveBeenCalledTimes(1);
});
