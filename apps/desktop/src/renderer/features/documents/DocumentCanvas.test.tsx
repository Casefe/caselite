// @vitest-environment jsdom
import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  }: {
    task: Task;
    disabled: boolean;
    onSaved(t: Task, s: number[]): void;
    onDirty(v: boolean): void;
  }) {
    useEffect(() => {
      mounted();
    }, []);
    return (
      <>
        <input aria-label="原位正文" disabled={disabled} onChange={() => onDirty(true)} />
        <button onClick={() => onSaved({ ...task, body_revision: task.body_revision + 1 }, [1])}>
          确认保存
        </button>
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
  const view = (doc = document, mirror = false) => (
    <QueryClientProvider client={client}>
      <DocumentCanvas
        document={doc}
        mirror={mirror}
        disabled={false}
        onSaved={onSaved}
        onDirty={onDirty}
      />
    </QueryClientProvider>
  );
  const result = render(view());
  return { ...result, read, onSaved, onDirty, view };
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
