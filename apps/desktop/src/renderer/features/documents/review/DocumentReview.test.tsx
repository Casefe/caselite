// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor, EditorContent } from '@tiptap/react';
import * as Y from 'yjs';
import DocumentReview from './DocumentReview';
import InspectorLayout from '../../../ui/InspectorLayout';
import { localExtensions, reviewUpdateOrigin } from '../../../editors/editor-config';
import { draftDoc } from '../../../editors/editor-state';
import type { AgentRequest, AgentResponse, AgentRun } from '../../../../preload/caselite-api';
import { reviewBodyRange } from '../../../../../../../packages/local-db/src/body-schema';

const identity = {
  task_id: '11111111-1111-4111-8111-111111111111',
  document_id: '22222222-2222-4222-8222-222222222222',
  body_id: '33333333-3333-4333-8333-333333333333',
  revision: 1,
};
const previewId = '44444444-4444-4444-8444-444444444444';
const scopes: { editor: Editor; doc: Y.Doc }[] = [];
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [new DOMRect(0, 0, 1, 20)],
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 20),
  });
});
afterEach(() => {
  cleanup();
  for (const { editor, doc } of scopes.splice(0)) {
    editor.destroy();
    doc.destroy();
  }
  vi.unstubAllGlobals();
});
function mount(variant: 'review' | 'assistant' = 'review') {
  const doc = draftDoc({ text: '原文条款\n不能外发的第二段', state: null });
  const editor = new Editor({ extensions: localExtensions(doc), injectCSS: false });
  scopes.push({ editor, doc });
  let run: AgentRun | undefined;
  const response = (): AgentResponse => ({
    ok: true,
    runs: run ? [run] : [],
    providers: { openai: true },
    model: 'gpt-4.1-mini',
  });
  const agent = vi.fn(async (request: AgentRequest): Promise<AgentResponse> => {
    if (request.operation === 'preview_review')
      return { ...response(), review_preview: { id: previewId, range: request.range } };
    if (request.operation === 'start')
      run = {
        id: request.run_id,
        scope: request.scope,
        prompt: request.prompt,
        context_id: request.context_id,
        model: 'gpt-4.1-mini',
        provider: 'openai',
        created_at: '2026-11-08T00:00:00Z',
        status: 'succeeded',
        sequence: 2,
        output: '修改后的条款\n新增说明',
        message: '',
        usage: null,
      };
    return response();
  });
  Object.defineProperty(window, 'caselite', { configurable: true, value: { agent } });
  const onSaved = vi.fn();
  const view = render(
    <>
      <EditorContent editor={editor} />
      <InspectorLayout properties={null}>
        <DocumentReview
          editor={editor}
          identity={identity}
          variant={variant}
          blocked={false}
          onApplyBusy={vi.fn()}
          onSaved={onSaved}
        />
      </InspectorLayout>
    </>,
  );
  return { editor, doc, agent, onSaved, view };
}
it.each(['review', 'assistant'] as const)(
  'automatically quotes selection in %s and freezes it before one dispatch',
  async (variant) => {
    const { editor, agent } = mount(variant);
    await act(async () => {
      editor.commands.setTextSelection({ from: 1, to: 5 });
    });
    expect(screen.getByRole('region', { name: '本轮引用' }).textContent).toContain('原文条款');
    expect(
      agent.mock.calls.filter(([r]) => r.operation === 'preview_review' || r.operation === 'start'),
    ).toHaveLength(0);
    const input = screen.getByRole('textbox', { name: '本轮问题' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '改写为明确条款' } });
    expect(screen.getByRole('region', { name: '本轮引用' }).textContent).toContain('原文条款');
    fireEvent.click(screen.getByRole('button', { name: '收起 AI 对话' }));
    expect(screen.getByRole('button', { name: '展开 AI 对话' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '发送本轮审阅' }));
    expect(screen.getByRole('button', { name: '收起 AI 对话' })).toBeTruthy();
    await screen.findByText('确认写回');
    expect(agent.mock.calls.filter(([r]) => r.operation === 'start')).toHaveLength(1);
    const preview = agent.mock.calls.find(([r]) => r.operation === 'preview_review')![0];
    expect(preview).toMatchObject({ range: { ...identity, text: '原文条款', from: 0, to: 4 } });
    expect(editor.getText({ blockSeparator: '\n' })).toBe('原文条款\n不能外发的第二段');
    await act(async () => {
      editor.commands.setTextSelection({ from: 7, to: 9 });
    });
    expect(screen.getByRole('region', { name: '本轮引用' }).textContent).toContain('原文条款');
    fireEvent.change(screen.getByRole('combobox', { name: '接受方式' }), {
      target: { value: 'append' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认写回' }));
    await waitFor(() =>
      expect(
        agent.mock.calls.some(([r]) => r.operation === 'apply_review' && r.action === 'append'),
      ).toBe(true),
    );
  },
);
it('blocks stale content during asynchronous input validation and preserves the question', async () => {
  const { editor, agent } = mount();
  await act(async () => {
    editor.commands.setTextSelection({ from: 1, to: 5 });
  });
  const fallback = agent.getMockImplementation()!;
  let finish!: (r: AgentResponse) => void;
  agent.mockImplementation((r) =>
    r.operation === 'preview_review'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : fallback(r),
  );
  fireEvent.change(screen.getByRole('textbox', { name: '本轮问题' }), {
    target: { value: '保留本轮问题' },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送本轮审阅' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => {
    editor.commands.insertContent('本地新字');
    finish({
      ok: true,
      runs: [],
      providers: { openai: true },
      model: 'gpt-4.1-mini',
      review_preview: {
        id: previewId,
        range: { ...identity, paragraph: 0, from: 0, to: 4, text: '原文条款' },
      },
    });
  });
  expect(agent.mock.calls.some(([r]) => r.operation === 'start')).toBe(false);
  expect((screen.getByRole('textbox', { name: '本轮问题' }) as HTMLTextAreaElement).value).toBe(
    '保留本轮问题',
  );
});
it('tracks the acknowledged Yjs update in Tiptap undo and redo without rebuilding the document', () => {
  const { editor, doc } = mount();
  const state = reviewBodyRange(
    Y.encodeStateAsUpdate(doc),
    { paragraph: 0, from: 0, to: 4, text: '原文条款' },
    '修改条款',
  );
  expect(state).toBeTruthy();
  act(() => Y.applyUpdate(doc, state!, reviewUpdateOrigin));
  expect(editor.getText({ blockSeparator: '\n' })).toBe('修改条款\n不能外发的第二段');
  act(() => editor.commands.undo());
  expect(editor.getText({ blockSeparator: '\n' })).toBe('原文条款\n不能外发的第二段');
  act(() => editor.commands.redo());
  expect(editor.getText({ blockSeparator: '\n' })).toBe('修改条款\n不能外发的第二段');
});

it.each(['review', 'assistant'] as const)(
  'recovers failed %s input only after reading the original run without automatic redispatch',
  async (variant) => {
    const { editor, agent } = mount(variant);
    const original = agent.getMockImplementation()!;
    let fail = true;
    agent.mockImplementation(async (request) => {
      if (request.operation === 'start' && fail) {
        fail = false;
        return { ok: false, code: 'NO_KEY', message: '合成发送失败' };
      }
      return original(request);
    });
    await act(async () => {
      editor.commands.setTextSelection({ from: 1, to: 5 });
    });
    fireEvent.change(screen.getByRole('textbox', { name: '本轮问题' }), {
      target: { value: '失败后保留问题' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送本轮审阅' }));
    await screen.findByRole('button', { name: '核对本轮结果' });
    expect(agent.mock.calls.filter(([r]) => r.operation === 'start')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '核对本轮结果' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: '发送本轮审阅' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect((screen.getByRole('textbox', { name: '本轮问题' }) as HTMLTextAreaElement).value).toBe(
      '失败后保留问题',
    );
    expect(agent.mock.calls.filter(([r]) => r.operation === 'start')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '发送本轮审阅' }));
    await screen.findByRole('button', { name: '确认写回' });
    expect(agent.mock.calls.filter(([r]) => r.operation === 'start')).toHaveLength(2);
  },
);
