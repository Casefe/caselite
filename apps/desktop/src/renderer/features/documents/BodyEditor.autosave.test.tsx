// @vitest-environment jsdom
import { useState } from 'react';
import { EditorContent, type Editor } from '@tiptap/react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { validateBody } from '../../../../../../packages/local-db/src/body-schema';
import type { Task, TaskRequest, TaskResponse } from '../../../preload/caselite-api';
import BodyEditor, { type BodySaveState } from './BodyEditor';

let current: Editor | null = null;
vi.mock('../../editors/RichEditor', async (original) => ({
  ...(await original<typeof import('../../editors/RichEditor')>()),
  EditorSurface: ({ editor }: { editor: Editor | null }) => {
    current = editor;
    return <EditorContent editor={editor} />;
  },
}));
vi.mock('../../editors/DocumentAnnotations', () => ({ default: () => null }));
vi.mock('./review/DocumentReview', () => ({ default: () => null, WritingSkillMenu: () => null }));
vi.mock('./delivery/DeliverySnapshots', () => ({ default: () => null }));

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  cleanup();
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  current = null;
});
const task = {
  id: crypto.randomUUID(),
  document_id: crypto.randomUUID(),
  body_id: crypto.randomUUID(),
  title: '自动保存合成稿',
  body_revision: 3,
  editor_schema: 1,
  matter_id: null,
} as Task;
type Save = Extract<TaskRequest, { operation: 'save' }>;
function ack(request: Save): TaskResponse {
  return {
    ok: true,
    tasks: [{ ...task, body_revision: request.expected_revision + 1 }],
    state: null,
    receipt: request.idempotency_key,
  };
}
function body(request: Save) {
  const d = new Y.Doc();
  Y.applyUpdate(d, Uint8Array.from(request.state));
  const text = d.getXmlFragment('default').toString();
  d.destroy();
  return text;
}
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function setup(api: (request: TaskRequest) => Promise<TaskResponse>) {
  vi.stubGlobal('caselite', { task: api });
  const saved = vi.fn();
  const states = vi.fn();
  const dirty = vi.fn();
  function Parent({ disabled = false, archived = false }) {
    const [snapshot, setSnapshot] = useState<BodySaveState | null>(null);
    return (
      <>
        <output aria-label="父级保存状态">{snapshot?.message}</output>
        {(snapshot?.phase === 'failed' || snapshot?.phase === 'unknown') && (
          <button disabled={!snapshot.canRetry} onClick={snapshot.retry}>
            核对原提交
          </button>
        )}
        <BodyEditor
          task={archived ? { ...task, document_archived_at: '2026-11-12' } : task}
          initial={null}
          autosave
          onSaveState={(state) => {
            states(state);
            setSnapshot(state);
          }}
          disabled={disabled}
          onDirty={dirty}
          onSaved={saved}
          embedded
          reviewDock={null}
          reviewSaving={false}
          onReviewSaving={vi.fn()}
        />
      </>
    );
  }
  const view = render(<Parent />);
  await settle(20);
  expect(current).not.toBeNull();
  return {
    ...view,
    change: (props: { disabled?: boolean; archived?: boolean }) =>
      view.rerender(<Parent {...props} />),
    editor: current!,
    saved,
    states,
    dirty,
  };
}
it('真实Editor自动持久化Yjs；父state回授不循环、不重建实例或显示底部保存栏', async () => {
  const api = vi.fn(async (r: TaskRequest) => ack(r as Save));
  const s = await setup(api);
  const editor = s.editor;
  await settle(1000);
  expect(api).not.toHaveBeenCalled();
  act(() => editor.commands.insertContent('持续输入合成正文'));
  await settle(800);
  expect(api).toHaveBeenCalledTimes(1);
  const request = api.mock.calls[0][0] as Save;
  expect(request.expected_revision).toBe(3);
  expect(body(request)).toContain('持续输入合成正文');
  expect(screen.getByLabelText('父级保存状态').textContent).toContain('已保存到此设备');
  expect(screen.queryByTestId('save-body')).toBeNull();
  expect(screen.queryByTestId('save-status')).toBeNull();
  expect(current).toBe(editor);
  expect(editor.getText()).toBe('持续输入合成正文');
  expect(s.states.mock.calls.length).toBeLessThan(10);
  act(() => editor.commands.undo());
  expect(editor.getText()).toBe('');
});

it('真实validator拒绝201行表格后，修正正文经一次恢复提交为新key并显示strictACK已保存', async () => {
  const validations: string[] = [];
  const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation === 'status')
      return { ok: false, code: 'NOT_FOUND', message: '被拒绝提交没有成功回执' };
    try {
      validateBody(Uint8Array.from(r.state), true, r.editor_schema);
      validations.push('accepted');
      return ack(r);
    } catch (error) {
      validations.push(error instanceof Error ? error.message : String(error));
      return {
        ok: false,
        code: 'INVALID_REQUEST',
        message: '正文结构或格式不支持，原修订已保留。',
      };
    }
  });
  const s = await setup(api);
  act(() => s.editor.commands.insertTable({ rows: 201, cols: 1, withHeaderRow: false }));
  await settle(800);
  const rejected = api.mock.calls[0][0] as Save;
  expect(validations).toEqual(['Invalid table height']);
  expect(screen.getByLabelText('父级保存状态').textContent).toContain('正文结构或格式不支持');
  expect(screen.getByTestId('revision').textContent).toBe('3');
  expect(s.saved).not.toHaveBeenCalled();
  expect(s.dirty).toHaveBeenLastCalledWith(true);
  await settle(5000);
  expect(api).toHaveBeenCalledTimes(1);

  act(() => s.editor.commands.setContent('<p>已修正的合法正文</p>'));
  expect(s.editor.getText()).toBe('已修正的合法正文');
  fireEvent.click(screen.getByRole('button', { name: '核对原提交' }));
  await settle();

  expect(api).toHaveBeenCalledTimes(2);
  const corrected = api.mock.calls[1][0] as Save;
  expect(corrected.idempotency_key).not.toBe(rejected.idempotency_key);
  expect(corrected.expected_revision).toBe(3);
  expect(body(corrected)).toContain('已修正的合法正文');
  expect(validations).toEqual(['Invalid table height', 'accepted']);
  expect(screen.getByTestId('revision').textContent).toBe('4');
  expect(screen.getByLabelText('父级保存状态').textContent).toBe('已保存到此设备');
  expect(screen.queryByRole('button', { name: '核对原提交' })).toBeNull();
  expect(s.saved).toHaveBeenCalledTimes(1);
  expect(s.saved.mock.calls[0][0]).toMatchObject({ body_revision: 4 });
  expect(s.saved.mock.calls[0][1]).toEqual(corrected.state);
});

it('status的INVALID_REQUEST不清pending；NOT_FOUND重放实际save被拒后才释放原请求', async () => {
  let saveCount = 0;
  let statusCount = 0;
  const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation === 'save') {
      saveCount++;
      if (saveCount === 1)
        return { ok: false, code: 'RESULT_UNKNOWN', message: '合成首次结果未知' };
      try {
        validateBody(Uint8Array.from(r.state), true, r.editor_schema);
        return ack(r);
      } catch {
        return {
          ok: false,
          code: 'INVALID_REQUEST',
          message: '正文结构或格式不支持，原修订已保留。',
        };
      }
    }
    statusCount++;
    if (statusCount === 1) return { ok: false, code: 'READ_FAILED', message: '合成回执不可读' };
    if (statusCount === 2) return { ok: false, code: 'INVALID_REQUEST', message: '合成查询被拒' };
    if (statusCount === 3) return { ok: false, code: 'NOT_FOUND', message: '确认原提交无回执' };
    return { ok: false, code: 'NOT_FOUND', message: '新提交无回执' };
  });
  const s = await setup(api);
  act(() => s.editor.commands.insertTable({ rows: 201, cols: 1, withHeaderRow: false }));
  await settle(800);
  const original = api.mock.calls[0][0] as Save;
  expect(api.mock.calls.map(([r]) => r.operation)).toEqual(['save', 'status']);

  act(() => s.editor.commands.setContent('<p>未知结果期间已修正</p>'));
  await settle(5000);
  expect(api).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '核对原提交' }));
  await settle();
  expect(api).toHaveBeenCalledTimes(3);
  expect(api.mock.calls[2][0]).toMatchObject({
    operation: 'status',
    idempotency_key: original.idempotency_key,
  });
  expect(screen.getByRole('button', { name: '核对原提交' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '核对原提交' }));
  await settle();
  expect(api).toHaveBeenCalledTimes(5);
  expect(api.mock.calls[3][0]).toMatchObject({
    operation: 'status',
    idempotency_key: original.idempotency_key,
  });
  expect(api.mock.calls[4][0]).toBe(original);
  expect(screen.getByRole('button', { name: '核对原提交' })).toBeTruthy();
  expect(s.editor.getText()).toBe('未知结果期间已修正');
  expect(s.saved).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: '核对原提交' }));
  await settle();
  expect(api).toHaveBeenCalledTimes(6);
  const corrected = api.mock.calls[5][0] as Save;
  expect(corrected.idempotency_key).not.toBe(original.idempotency_key);
  expect(corrected.expected_revision).toBe(3);
  expect(body(corrected)).toContain('未知结果期间已修正');
  expect(screen.getByLabelText('父级保存状态').textContent).toBe('已保存到此设备');
  expect(s.saved).toHaveBeenCalledTimes(1);
});

it('r1在途允许r2；确认r1后才按新修订提交r2，旧ACK不能提前显示全部已保存', async () => {
  let resolve: ((value: TaskResponse) => void) | undefined;
  const api = vi.fn(async (r: TaskRequest) =>
    api.mock.calls.length === 1
      ? new Promise<TaskResponse>((done) => {
          resolve = done;
        })
      : ack(r as Save),
  );
  const s = await setup(api);
  act(() => s.editor.commands.insertContent('第一段'));
  await settle(800);
  expect(api).toHaveBeenCalledTimes(1);
  const first = api.mock.calls[0][0] as Save;
  act(() => s.editor.commands.insertContent('第二段'));
  await settle(1600);
  expect(api).toHaveBeenCalledTimes(1);
  expect(s.editor.isEditable).toBe(true);
  await act(async () => resolve?.(ack(first)));
  expect(screen.getByLabelText('父级保存状态').textContent).not.toBe('已保存到此设备');
  await settle(800);
  expect(api).toHaveBeenCalledTimes(2);
  const second = api.mock.calls[1][0] as Save;
  expect(second.expected_revision).toBe(4);
  expect(second.idempotency_key).not.toBe(first.idempotency_key);
  expect(body(first)).toContain('第一段');
  expect(body(first)).not.toContain('第二段');
  expect(body(second)).toContain('第一段第二段');
  expect(current).toBe(s.editor);
});

it('组合输入期间零提交，compositionend之后重新防抖保存最终文字（合成IME事件）', async () => {
  const api = vi.fn(async (r: TaskRequest) => ack(r as Save));
  const s = await setup(api);
  fireEvent.compositionStart(s.editor.view.dom);
  act(() => s.editor.commands.insertContent('中文组合输入'));
  await settle(2000);
  expect(api).not.toHaveBeenCalled();
  fireEvent.compositionEnd(s.editor.view.dom);
  act(() => s.editor.commands.insertContent('最终确认'));
  await settle(799);
  expect(api).not.toHaveBeenCalled();
  await settle(1);
  expect(api).toHaveBeenCalledTimes(1);
  expect(body(api.mock.calls[0][0] as Save)).toContain('中文组合输入最终确认');
});

it('未知暂停自动重试；同tick核对只执行一次，NOT_FOUND才重发冻结请求并继续r2', async () => {
  let firstSave = true;
  let firstStatus = true;
  const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation === 'save') {
      if (firstSave) {
        firstSave = false;
        return { ok: false, code: 'RESULT_UNKNOWN', message: '合成未知' };
      }
      return ack(r);
    }
    if (firstStatus) {
      firstStatus = false;
      return { ok: false, code: 'READ_FAILED', message: '合成回执不可读' };
    }
    return { ok: false, code: 'NOT_FOUND', message: '合成无回执' };
  });
  const s = await setup(api);
  act(() => s.editor.commands.insertContent('原提交'));
  await settle(800);
  const original = api.mock.calls[0][0] as Save;
  expect(api.mock.calls.map(([r]) => r.operation)).toEqual(['save', 'status']);
  act(() => s.editor.commands.insertContent('后续输入'));
  await settle(5000);
  expect(api).toHaveBeenCalledTimes(2);
  const retry = screen.getByRole('button', { name: '核对原提交' });
  act(() => {
    fireEvent.click(retry);
    fireEvent.click(retry);
  });
  await settle();
  expect(api.mock.calls.map(([r]) => r.operation)).toEqual(['save', 'status', 'status', 'save']);
  expect(api.mock.calls[2][0]).toMatchObject({ idempotency_key: original.idempotency_key });
  expect(api.mock.calls[3][0]).toBe(original);
  await settle(800);
  expect(api).toHaveBeenCalledTimes(5);
  expect(api.mock.calls[4][0]).toMatchObject({ operation: 'save', expected_revision: 4 });
  expect(body(api.mock.calls[4][0] as Save)).toContain('原提交后续输入');
  expect(s.editor.getText()).toBe('原提交后续输入');
});

it.each(['receipt', 'task', 'document', 'body', 'revision', 'schema'])(
  '拒绝不匹配的%s回执，保留原稿/原键且不自动自旋',
  async (field) => {
    const api = vi.fn(async (r: TaskRequest) => {
      const response = ack(r as Save);
      if (!response.ok) throw Error('fixture');
      if (field === 'receipt') response.receipt = crypto.randomUUID();
      else {
        const saved = response.tasks[0];
        if (field === 'task') saved.id = crypto.randomUUID();
        if (field === 'document') saved.document_id = crypto.randomUUID();
        if (field === 'body') saved.body_id = crypto.randomUUID();
        if (field === 'revision') saved.body_revision++;
        if (field === 'schema') saved.editor_schema = 2;
      }
      return response;
    });
    const s = await setup(api);
    act(() => s.editor.commands.insertContent('不能清除的输入'));
    await settle(800);
    expect(s.saved).not.toHaveBeenCalled();
    expect(s.dirty).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText('父级保存状态').textContent).toContain('回执与原提交不一致');
    await settle(5000);
    expect(api).toHaveBeenCalledTimes(1);
    expect(s.editor.getText()).toBe('不能清除的输入');
  },
);

it('未保存/在途/写失败时阻止正常关闭，失败不自旋，确认保存后才能离开', async () => {
  let rejectWrite = true;
  const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation === 'status') return { ok: false, code: 'NOT_FOUND', message: '没有回执' };
    return rejectWrite
      ? { ok: false, code: 'WRITE_FAILED', message: '合成磁盘写失败' }
      : ack(r as Save);
  });
  const s = await setup(api);
  const close = () => window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
  expect(close()).toBe(true);
  act(() => s.editor.commands.insertContent('失败仍保留'));
  expect(close()).toBe(false);
  await settle(800);
  expect(close()).toBe(false);
  await settle(5000);
  expect(api).toHaveBeenCalledTimes(1);
  expect(s.editor.getText()).toBe('失败仍保留');
  rejectWrite = false;
  fireEvent.click(screen.getByRole('button', { name: '核对原提交' }));
  await settle();
  expect(close()).toBe(true);
  expect(api.mock.calls[2][0]).toBe(api.mock.calls[0][0]);
});

it.each(['FORBIDDEN', 'EXCEPTION'] as const)(
  '%s不释放冻结请求，核对时只按原键和原bytes重放',
  async (failure) => {
    const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
      if (r.operation === 'status') return { ok: false, code: 'NOT_FOUND', message: '没有回执' };
      if (api.mock.calls.length === 1) {
        if (failure === 'EXCEPTION') throw Error('合成连接中断');
        return { ok: false, code: 'FORBIDDEN', message: '合成无权，但结果不证明未写' };
      }
      return ack(r);
    });
    const s = await setup(api);
    act(() => s.editor.commands.insertContent('冻结的第一次正文'));
    await settle(800);
    const original = api.mock.calls[0][0] as Save;
    act(() => s.editor.commands.insertContent('后续未冻结正文'));
    await settle(5000);
    expect(api).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '核对原提交' }));
    await settle();
    expect(api.mock.calls.map(([r]) => r.operation)).toEqual(['save', 'status', 'save']);
    expect(api.mock.calls[2][0]).toBe(original);
    expect(body(original)).toContain('冻结的第一次正文');
    expect(body(original)).not.toContain('后续未冻结正文');
  },
);

it.each(['disabled', 'archived'] as const)(
  '在保存函数内部保护%s，解除后继续同会话保存',
  async (lock) => {
    const api = vi.fn(async (r: TaskRequest) => ack(r as Save));
    const s = await setup(api);
    act(() => s.editor.commands.insertContent('等锁解除'));
    s.change({ [lock]: true });
    await settle(1000);
    expect(api).not.toHaveBeenCalled();
    expect(s.editor.isEditable).toBe(false);
    s.change({ [lock]: false });
    await settle(800);
    expect(api).toHaveBeenCalledTimes(1);
    expect(current).toBe(s.editor);
  },
);

it('落盘确认之后投影刷新失败不重写正文，卸载后清理计时器', async () => {
  const api = vi.fn(async (r: TaskRequest) => ack(r as Save));
  const s = await setup(api);
  s.saved.mockRejectedValueOnce(Error('合成刷新失败'));
  act(() => s.editor.commands.insertContent('已经落盘'));
  await settle(800);
  expect(screen.getByLabelText('父级保存状态').textContent).toContain('正文已保存，目录刷新失败');
  await settle(3000);
  expect(api).toHaveBeenCalledTimes(1);
  act(() => s.editor.commands.insertContent('未到计时'));
  s.unmount();
  await settle(1000);
  expect(api).toHaveBeenCalledTimes(1);
});

it('Editor卸载后的迟到ACK不通知另一会话，也不继续下一次保存', async () => {
  let resolve: ((value: TaskResponse) => void) | undefined;
  const api = vi.fn(
    async (request: TaskRequest) =>
      new Promise<TaskResponse>((done) => {
        expect(request.operation).toBe('save');
        resolve = done;
      }),
  );
  const s = await setup(api);
  act(() => s.editor.commands.insertContent('原会话'));
  await settle(800);
  const request = api.mock.calls[0][0] as Save;
  s.unmount();
  await act(async () => resolve?.(ack(request)));
  await settle(2000);
  expect(s.saved).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(1);
});

it('自己的修订已保存但存在外部更高修订时，保留明确核对提示而非整体已保存', async () => {
  const api = vi.fn(async (r: TaskRequest) => ack(r as Save));
  const s = await setup(api);
  s.saved.mockReturnValue('修订 4 已保存，文档已有其他修订，请核对。');
  act(() => s.editor.commands.insertContent('自己的修订'));
  await settle(800);
  expect(screen.getByLabelText('父级保存状态').textContent).toContain('已有其他修订');
  expect(s.editor.getText()).toBe('自己的修订');
  expect(api).toHaveBeenCalledTimes(1);
});

it('请求准备同步失败也释放串行锁并保留输入，尚未派发时可显式重试', async () => {
  const api = vi.fn(async (r: TaskRequest) => ack(r as Save));
  const s = await setup(api);
  act(() => s.editor.commands.insertContent('准备失败仍保留'));
  const inspect = vi.spyOn(s.editor.state.doc, 'descendants').mockImplementationOnce(() => {
    throw Error('合成格式检查失败');
  });
  await settle(800);
  expect(api).not.toHaveBeenCalled();
  expect(screen.getByLabelText('父级保存状态').textContent).toContain('合成格式检查失败');
  expect(s.editor.getText()).toBe('准备失败仍保留');
  inspect.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: '核对原提交' }));
  await settle();
  expect(api).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('父级保存状态').textContent).toBe('已保存到此设备');
});
