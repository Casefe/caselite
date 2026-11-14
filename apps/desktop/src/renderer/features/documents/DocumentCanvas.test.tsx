// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import type { BodySaveState } from './BodyEditor';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CatalogDocument, Task } from '../../../preload/caselite-api';
import { createWorkbenchQueryClient } from '../../shared/data/workbench-query-client';
import DocumentCanvas from './DocumentCanvas';
const mounted = vi.hoisted(() => vi.fn());
vi.mock('./BodyEditor', () => ({
  default: function MockBodyEditor({
    task,
    disabled,
    onSaved,
    onDirty,
    onReviewSaving,
    reviewSaving,
    autosave,
    onSaveState,
  }: {
    task: Task;
    disabled: boolean;
    onSaved(t: Task, s: number[]): void;
    onDirty(v: boolean): void;
    onReviewSaving(v: boolean): void;
    reviewSaving: boolean;
    autosave?: boolean;
    onSaveState?(state: BodySaveState): void;
  }) {
    const [revision] = useState(task.body_revision);
    useEffect(() => {
      mounted();
    }, []);
    useEffect(() => {
      if (autosave)
        onSaveState?.({
          bodyId: task.body_id,
          revision,
          phase: 'saved',
          message: '已保存',
          canRetry: false,
          retry: () => {},
        });
    }, [autosave, onSaveState, task.body_id, revision]);
    return (
      <>
        <input aria-label="原位正文" disabled={disabled} onChange={() => onDirty(true)} />
        <button onClick={() => onSaved({ ...task, body_revision: task.body_revision + 1 }, [1])}>
          确认保存
        </button>
        <button onClick={() => onDirty(false)}>正文已确认</button>
        <button onClick={() => onReviewSaving(true)}>导出待核对</button>
        <button onClick={() => onReviewSaving(false)}>导出已核对</button>
        <output aria-label="导出锁">{String(reviewSaving)}</output>
      </>
    );
  },
}));
vi.mock('./DocumentPreview', () => ({ default: () => <p>只读正文</p> }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mounted.mockClear();
});
const document: CatalogDocument = {
  id: 'doc',
  task_id: 'task',
  body_id: 'body',
  matter_id: null,
  title: '合成稿',
  body_revision: 3,
  version: 2,
  archived_at: null,
  collection: '',
  tags: [],
  favorite: false,
  in_library: false,
  updated_at: '2026-11-09',
};
const task = {
  id: 'task',
  document_id: 'doc',
  body_id: 'body',
  matter_id: null,
  title: '合成稿',
  body_revision: 3,
} as Task;
function setup(overrides: Partial<Task> = {}) {
  const read = vi.fn(async () => ({ ok: true, tasks: [{ ...task, ...overrides }], state: null }));
  vi.stubGlobal('caselite', { task: read });
  const client = createWorkbenchQueryClient(),
    onSaved = vi.fn(),
    onDirty = vi.fn();
  const view = (doc = document, mirror = false, autosave = false) => (
    <QueryClientProvider client={client}>
      <DocumentCanvas
        document={doc}
        mirror={mirror}
        autosave={autosave}
        disabled={false}
        onSaved={onSaved}
        onDirty={onDirty}
      />
    </QueryClientProvider>
  );
  const result = render(view());
  return { ...result, read, onSaved, onDirty, view, client };
}
it('拒绝同任务返回的另一正文身份，不显示编辑器', async () => {
  setup({ body_id: 'other' });
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    '文档版本或归属已变化，请先刷新目录。',
  );
  expect(screen.queryByLabelText('原位正文')).toBeNull();
});
it('保存后更新读取投影并保留当前编辑器实例，外部修订不能覆盖输入', async () => {
  const s = setup();
  const input = await screen.findByLabelText<HTMLInputElement>('原位正文');
  fireEvent.change(input, { target: { value: '保留修改' } });
  expect(s.onDirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByText('确认保存'));
  s.rerender(s.view({ ...document, body_revision: 4 }));
  expect(screen.getByLabelText('原位正文')).toBe(input);
  expect(input.value).toBe('保留修改');
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(s.read).toHaveBeenCalledTimes(1);
  expect(s.onSaved).toHaveBeenCalledWith(expect.objectContaining({ body_revision: 4 }));
  s.rerender(s.view({ ...document, body_revision: 5 }));
  expect(screen.getByRole('alert').textContent).toContain('保留当前输入');
  expect(input.disabled).toBe(true);
  expect(input.value).toBe('保留修改');
});
it('同文档对照栏只展示只读投影，不创建第二个写入会话', async () => {
  const s = setup();
  await screen.findByLabelText('原位正文');
  s.rerender(s.view(document, true));
  expect(screen.queryByLabelText('原位正文')).toBeNull();
  expect(screen.getByText('只读正文')).toBeTruthy();
  expect(s.read).toHaveBeenCalledTimes(1);
  expect(mounted).toHaveBeenCalledTimes(1);
});

it('较早ACK不覆盖较新read投影；高版本缓存不能误解锁尚在旧修订的编辑会话', async () => {
  const s = setup();
  s.rerender(s.view(document, false, true));
  const input = await screen.findByLabelText<HTMLInputElement>('原位正文');
  fireEvent.change(input, { target: { value: '原会话的后续草稿' } });
  fireEvent.click(screen.getByText('确认保存'));
  act(() =>
    s.client.setQueryData(['document-edit', document.id, 0], {
      task: { ...task, body_revision: 5 },
      state: [5],
    }),
  );
  s.rerender(s.view({ ...document, body_revision: 5 }, false, true));
  await waitFor(() => expect(s.onSaved).toHaveBeenCalled());
  expect(
    s.client.getQueryData<{ task: Task }>(['document-edit', document.id, 0])?.task.body_revision,
  ).toBe(5);
  expect(input.disabled).toBe(true);
  expect(input.value).toBe('原会话的后续草稿');
  expect(screen.getByLabelText('原位正文')).toBe(input);
  expect(mounted).toHaveBeenCalledTimes(1);
});

it('有缓存数据的后台读取失败保留dirty编辑器，重试只读取且不重挂草稿', async () => {
  const s = setup();
  s.rerender(s.view(document, false, true));
  const input = await screen.findByLabelText<HTMLInputElement>('原位正文');
  fireEvent.change(input, { target: { value: '后台失败仍保留的草稿' } });
  s.read.mockImplementationOnce(async () => {
    throw Error('合成读取失败');
  });
  await act(async () =>
    s.client.invalidateQueries({ queryKey: ['document-edit', document.id, 0] }),
  );
  expect((await screen.findByRole('alert')).textContent).toContain('当前输入已保留');
  expect(screen.getByLabelText('原位正文')).toBe(input);
  expect(input.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重试读取文档' }));
  await waitFor(() => expect(input.disabled).toBe(false));
  expect(input.value).toBe('后台失败仍保留的草稿');
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(s.onSaved).not.toHaveBeenCalled();
  expect(s.read).toHaveBeenCalledTimes(3);
});
it('干净正文导出和未知结果也锁定导航；正文与导出分别解除，卸载释放父锁', async () => {
  const s = setup();
  const input = await screen.findByLabelText<HTMLInputElement>('原位正文');
  fireEvent.click(screen.getByText('导出待核对'));
  expect(s.onDirty).toHaveBeenLastCalledWith(true);
  expect(screen.getByLabelText('导出锁').textContent).toBe('true');
  fireEvent.change(input, { target: { value: '草稿' } });
  fireEvent.click(screen.getByText('导出已核对'));
  expect(screen.getByLabelText('导出锁').textContent).toBe('false');
  expect(s.onDirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByText('导出待核对'));
  fireEvent.click(screen.getByText('正文已确认'));
  expect(s.onDirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByText('导出已核对'));
  expect(s.onDirty).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByText('导出待核对'));
  s.unmount();
  expect(s.onDirty).toHaveBeenLastCalledWith(false);
});
