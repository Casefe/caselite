// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor, EditorContent } from '@tiptap/react';
import * as Y from 'yjs';
import DocumentReview, { WritingSkillMenu, type WritingSkillHandle } from './DocumentReview';
import { createRef } from 'react';
import { EditorSurface } from '../../../editors/RichEditor';
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
function mount(variant: 'review' | 'assistant' = 'review', withToolbar = false) {
  const skillHandle = createRef<WritingSkillHandle>();
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
    if (request.operation === 'preview_page')
      return {
        ...response(),
        page_preview: {
          id: previewId,
          title: '合成当前文档',
          mode: request.selected_text ? 'selection' : 'page',
          characters: request.selected_text?.length ?? 99,
        },
      };
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
      {withToolbar ? (
        <EditorSurface
          editor={editor}
          mode="simple"
          documentScheme="markdown"
          selectionActions={
            <WritingSkillMenu
              editor={editor}
              enabled
              revision={1}
              onPick={(request) => skillHandle.current?.pick(request)}
            />
          }
        />
      ) : (
        <>
          <EditorContent editor={editor} />
          <WritingSkillMenu
            editor={editor}
            enabled
            revision={1}
            onPick={(request) => skillHandle.current?.pick(request)}
          />
        </>
      )}
      <InspectorLayout properties={null}>
        <DocumentReview
          editor={editor}
          skillHandle={skillHandle}
          identity={identity}
          variant={variant}
          blocked={false}
          onApplyBusy={vi.fn()}
          onSaved={onSaved}
        />
      </InspectorLayout>
    </>,
  );
  return { editor, doc, agent, onSaved, view, skillHandle };
}
// 保留既有门禁识别标题；本轮用户授权已改为点技能即执行，打开菜单仍不派发。
it.each(['review', 'assistant'] as const)(
  'loads a writing skill into %s without preparing a run and keeps selection intact',
  async (variant) => {
    const { editor, doc, agent } = mount(variant, true);
    await waitFor(() => expect(editor.isInitialized).toBe(true));
    await act(async () => {
      editor.view.dom.focus();
      editor.commands.setTextSelection({ from: 1, to: 5 });
    });
    await screen.findByRole('button', { name: '更多技能…' });
    const before = Y.encodeStateAsUpdate(doc);
    const shortcuts = screen.getByRole('region', { name: '常用写作技能' });
    const panel = shortcuts.closest('.selection-menu-panel')!;
    expect(panel.querySelector('[aria-label="选区格式"]')).toBeTruthy();
    expect(
      [...shortcuts.querySelectorAll('.writing-skill-quick')].map((b) =>
        b.textContent?.replace('↗', ''),
      ),
    ).toEqual(['提升法律表达', '校对与一致性检查', '解释条款']);
    expect(agent.mock.calls.every(([r]) => r.operation === 'read')).toBe(true);
    const quick = screen.getByRole('button', { name: '提升法律表达', exact: true });
    fireEvent.click(quick);
    fireEvent.click(quick);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLTextAreaElement>('textbox', { name: '本轮问题' }).value,
      ).toContain('改进所选文字'),
    );
    expect(screen.getByRole('button', { name: '收起 AI 对话' })).toBeTruthy();
    expect(editor.state.selection.toJSON()).toEqual({ type: 'text', anchor: 1, head: 5 });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    await screen.findByText('确认写回');
    expect(agent.mock.calls.filter(([r]) => r.operation === 'start')).toHaveLength(1);
    expect(agent.mock.calls.find(([r]) => r.operation === 'start')?.[0]).toMatchObject({
      prompt: expect.stringContaining('改进所选文字'),
    });
    expect(agent.mock.calls.find(([r]) => r.operation === 'preview_review')?.[0]).toMatchObject({
      range: { text: '原文条款', from: 0, to: 4 },
    });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: '拒绝', exact: true }));
    fireEvent.change(screen.getByRole('textbox', { name: '本轮问题' }), {
      target: { value: '不要串入这条未发送的问题' },
    });
    await act(async () => {
      editor.view.dom.focus();
      editor.commands.setTextSelection({ from: 1, to: 5 });
    });
    fireEvent.click(await screen.findByRole('button', { name: '更多技能…' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '摘要与要点提炼' }));
    await screen.findByRole('button', { name: '确认写回' });
    const starts = agent.mock.calls.filter(([r]) => r.operation === 'start');
    expect(starts).toHaveLength(2);
    expect(starts.at(-1)?.[0]).toMatchObject({
      prompt: expect.stringContaining('精简概括所选文字'),
    });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  },
);
it('closes stale skill menus on selection or document changes, keeps IME native, and rejects a stale handoff', async () => {
  const { editor, skillHandle, agent } = mount();
  await act(async () => {
    editor.commands.setTextSelection({ from: 1, to: 5 });
  });
  const stale = {
    id: 'stale',
    skill: { id: 'custom', name: '旧技能', instruction: '不应写入', enabled: true },
    doc: editor.state.doc,
    from: 1,
    to: 5,
    revision: 1,
  };
  fireEvent.click(screen.getByRole('button', { name: '更多技能…' }));
  await screen.findByRole('menu', { name: '写作技能' });
  await act(async () => {
    editor.commands.setTextSelection({ from: 7, to: 9 });
  });
  expect(screen.queryByRole('menu')).toBeNull();
  await act(async () => {
    skillHandle.current?.pick(stale);
  });
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '本轮问题' }).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '更多技能…' }));
  await screen.findByRole('menu', { name: '写作技能' });
  await act(async () => {
    editor.commands.insertContent('新');
  });
  expect(screen.queryByRole('menu')).toBeNull();
  await act(async () => {
    editor.commands.setTextSelection({ from: 1, to: 3 });
  });
  const composing = vi.spyOn(editor.view, 'composing', 'get').mockReturnValue(true);
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  composing.mockRestore();
  expect(agent.mock.calls.every(([r]) => r.operation === 'read')).toBe(true);
});
it.each(['review', 'assistant'] as const)(
  'automatically quotes selection in %s and freezes it before one dispatch',
  async (variant) => {
    const { editor, agent } = mount(variant);
    await act(async () => {
      editor.commands.setTextSelection({ from: 1, to: 5 });
    });
    expect(screen.getByRole('region', { name: '本轮引用' }).textContent).toContain(
      '选中内容 · 4 字符',
    );
    expect(screen.getByRole('region', { name: '本轮引用' }).textContent).not.toContain('原文条款');
    expect(
      agent.mock.calls.filter(([r]) => r.operation === 'preview_review' || r.operation === 'start'),
    ).toHaveLength(0);
    const input = screen.getByRole('textbox', { name: '本轮问题' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '改写为明确条款' } });
    expect(screen.getByRole('region', { name: '本轮引用' }).textContent).toContain(
      '选中内容 · 4 字符',
    );
    expect(screen.getByRole('region', { name: '本轮引用' }).textContent).not.toContain('原文条款');
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
    expect(screen.getByRole('region', { name: '本轮引用' }).textContent).toContain(
      '选中内容 · 4 字符',
    );
    expect(screen.getByRole('region', { name: '本轮引用' }).textContent).not.toContain('原文条款');
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
it.each([false, true])(
  'blocks stale content during asynchronous input validation and preserves the question',
  async (shortcut) => {
    const { editor, agent } = mount('review', shortcut);
    await waitFor(() => expect(editor.isInitialized).toBe(true));
    await act(async () => {
      editor.view.dom.focus();
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
    fireEvent.click(
      screen.getByRole('button', { name: shortcut ? '提升法律表达' : '发送本轮审阅', exact: true }),
    );
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
    expect(
      (screen.getByRole('textbox', { name: '本轮问题' }) as HTMLTextAreaElement).value,
    ).toContain(shortcut ? '改进所选文字' : '保留本轮问题');
  },
);
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
