// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  invalidateOrdinaryCatalog,
  useProjectCatalog,
} from '../shared/data/ordinary-catalog-query';
import { createWorkbenchQueryClient } from '../shared/data/workbench-query-client';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { PageNavigationProvider } from '../shared/navigation/PageNavigation';
import type { CatalogDocument, CatalogRequest, CatalogResponse } from '../../preload/caselite-api';
import type { Task } from '../../preload/caselite-api';
import type { BodySaveState } from '../features/documents/BodyEditor';
import DocumentLibrary from './DocumentLibrary';

const bodyControl = vi.hoisted(() => ({ enabled: false, retry: vi.fn() }));
vi.mock('../features/documents/BodyEditor', () => ({
  default: ({
    task,
    disabled,
    onDirty,
    onSaved,
    autosave,
    onSaveState,
  }: {
    task: Task;
    disabled: boolean;
    onDirty(v: boolean): void;
    onSaved(task: Task, state: number[]): void | Promise<void>;
    autosave?: boolean;
    onSaveState?(state: BodySaveState): void;
  }) => (
    <>
      <p data-testid="inline-body" data-autosave={String(!!autosave)}>
        {task.title}原位编辑
      </p>
      <input aria-label="模拟正文输入" disabled={disabled} onChange={() => onDirty(true)} />
      {bodyControl.enabled && (
        <>
          <button
            onClick={async () => {
              await onSaved({ ...task, body_revision: task.body_revision + 1 }, [1]);
            }}
          >
            模拟在途保存回执
          </button>
          <button
            onClick={() =>
              onSaveState?.({
                bodyId: task.body_id,
                revision: task.body_revision,
                phase: 'unknown',
                message: '保存结果未知，输入已保留',
                canRetry: true,
                retry: bodyControl.retry,
              })
            }
          >
            模拟未知保存状态
          </button>
        </>
      )}
    </>
  ),
}));
vi.mock('./AgentPanel', () => ({ default: () => null }));
vi.mock('./PdfReader', () => ({
  default: ({ name }: { name: string }) => <p>原件阅读：{name}</p>,
}));
beforeEach(() => {
  bodyControl.enabled = false;
  bodyControl.retry.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

it.each([false, true])(
  '只有文档工作稿启用自动保存，知识库默认保持（知识库=%s）',
  async (library) => {
    vi.stubGlobal('caselite', {
      catalog: vi.fn(async () => projection(entry)),
      task: vi.fn(async () => ({
        ok: true,
        tasks: [
          {
            id: entry.task_id,
            document_id: entry.id,
            body_id: entry.body_id,
            body_revision: entry.body_revision,
            matter_id: null,
          },
        ],
        state: null,
      })),
    });
    render(
      <QueryClientProvider client={createWorkbenchQueryClient()}>
        <DocumentLibrary library={library} onOpen={vi.fn()} onDirty={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: entry.title }));
    expect((await screen.findByTestId('inline-body')).dataset.autosave).toBe(String(!library));
  },
);

it('自己的保存ACK先取消旧目录再发布投影，不额外重读、不自锁或覆盖新输入', async () => {
  bodyControl.enabled = true;
  let finish: ((result: CatalogResponse) => void) | undefined;
  let slow = false;
  const catalog = vi.fn(async () =>
    slow
      ? new Promise<CatalogResponse>((resolve) => {
          finish = resolve;
        })
      : projection(entry),
  );
  const client = createWorkbenchQueryClient();
  vi.stubGlobal('caselite', {
    catalog,
    task: vi.fn(async () => ({
      ok: true,
      tasks: [
        {
          id: entry.task_id,
          document_id: entry.id,
          body_id: entry.body_id,
          body_revision: entry.body_revision,
          matter_id: null,
          title: entry.title,
          document_metadata_version: entry.version,
        },
      ],
      state: null,
    })),
  });
  render(
    <QueryClientProvider client={client}>
      <DocumentLibrary onOpen={vi.fn()} onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: entry.title }));
  const input = await screen.findByLabelText<HTMLInputElement>('模拟正文输入');
  fireEvent.change(input, { target: { value: 'r1后继续输入的r2' } });
  slow = true;
  act(() => {
    void invalidateOrdinaryCatalog(client, true, true);
  });
  await waitFor(() => expect(input.disabled).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: '模拟在途保存回执' }));
  await waitFor(() => expect(input.disabled).toBe(false));
  expect(screen.getByLabelText('模拟正文输入')).toBe(input);
  expect(input.value).toBe('r1后继续输入的r2');
  expect(catalog).toHaveBeenCalledTimes(2);
  const read = () =>
    client.getQueryData<Extract<CatalogResponse, { ok: true }>>(['catalog', 'ordinary'])!;
  expect(read().documents[0].body_revision).toBe(4);
  await act(async () => finish?.(projection(entry)));
  expect(read().documents[0].body_revision).toBe(4);
  expect(input.disabled).toBe(false);
  expect(catalog).toHaveBeenCalledTimes(2);
});

it('保存ACK不倒退外部高修订和元数据，真正冲突继续锁定并保留草稿', async () => {
  bodyControl.enabled = true;
  const client = createWorkbenchQueryClient();
  vi.stubGlobal('caselite', {
    catalog: vi.fn(async () => projection(entry)),
    task: vi.fn(async () => ({
      ok: true,
      tasks: [
        {
          id: entry.task_id,
          document_id: entry.id,
          body_id: entry.body_id,
          body_revision: 3,
          matter_id: null,
          title: entry.title,
          document_metadata_version: 9,
        },
      ],
      state: null,
    })),
  });
  render(
    <QueryClientProvider client={client}>
      <DocumentLibrary onOpen={vi.fn()} onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: entry.title }));
  const input = await screen.findByLabelText<HTMLInputElement>('模拟正文输入');
  fireEvent.change(input, { target: { value: '外部冲突仍保留' } });
  act(() =>
    client.setQueryData(
      ['catalog', 'ordinary'],
      projection({ ...entry, body_revision: 5, version: 12 }),
    ),
  );
  await waitFor(() => expect(input.disabled).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: '模拟在途保存回执' }));
  await waitFor(() =>
    expect(
      client.getQueryData<{ task: Task }>(['document-edit', entry.id, 0])?.task.body_revision,
    ).toBe(4),
  );
  expect(
    client.getQueryData<Extract<CatalogResponse, { ok: true }>>(['catalog', 'ordinary'])
      ?.documents[0].body_revision,
  ).toBe(5);
  expect(
    client.getQueryData<Extract<CatalogResponse, { ok: true }>>(['catalog', 'ordinary'])
      ?.documents[0].version,
  ).toBe(12);
  expect(input.value).toBe('外部冲突仍保留');
  expect(input.disabled).toBe(true);
});

it('右栏在正文dirty/blocked时仍可核对原提交，原属性字段保持', async () => {
  bodyControl.enabled = true;
  vi.stubGlobal('caselite', {
    catalog: vi.fn(async () => projection(entry)),
    task: vi.fn(async () => ({
      ok: true,
      tasks: [
        {
          id: entry.task_id,
          document_id: entry.id,
          body_id: entry.body_id,
          body_revision: 3,
          matter_id: null,
          title: entry.title,
        },
      ],
      state: null,
    })),
  });
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <DocumentLibrary onOpen={vi.fn()} onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: entry.title }));
  fireEvent.change(await screen.findByLabelText('模拟正文输入'), {
    target: { value: '待核对的草稿' },
  });
  fireEvent.click(screen.getByRole('button', { name: '模拟未知保存状态' }));
  const retry = await screen.findByRole<HTMLButtonElement>('button', { name: '核对保存结果' });
  expect(retry.disabled).toBe(false);
  expect(screen.getByLabelText('文档保存状态').textContent).toContain('输入已保留');
  for (const field of ['文档版本', '关联项目', '关联任务', '文档 ID'])
    expect(screen.getByText(field)).toBeTruthy();
  fireEvent.click(retry);
  expect(bodyControl.retry).toHaveBeenCalledTimes(1);
});

it('自动保存还有草稿时，外部归档不卸载草稿；恢复后同节点继续可写', async () => {
  const client = createWorkbenchQueryClient();
  vi.stubGlobal('caselite', {
    catalog: vi.fn(async () => projection(entry)),
    task: vi.fn(async () => ({
      ok: true,
      tasks: [
        {
          id: entry.task_id,
          document_id: entry.id,
          body_id: entry.body_id,
          body_revision: 3,
          matter_id: null,
          title: entry.title,
        },
      ],
      state: null,
    })),
  });
  render(
    <QueryClientProvider client={client}>
      <DocumentLibrary onOpen={vi.fn()} onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: entry.title }));
  const input = await screen.findByLabelText<HTMLInputElement>('模拟正文输入');
  fireEvent.change(input, { target: { value: '外部归档前的未保存文字' } });
  act(() =>
    client.setQueryData(
      ['catalog', 'ordinary'],
      projection({ ...entry, archived_at: '2026-11-12' }),
    ),
  );
  await waitFor(() => {
    expect(screen.queryByLabelText('模拟正文输入')).toBe(input);
    expect(input.disabled).toBe(true);
  });
  expect(input.value).toBe('外部归档前的未保存文字');
  expect(input.disabled).toBe(true);
  act(() => client.setQueryData(['catalog', 'ordinary'], projection(entry)));
  await waitFor(() => expect(input.disabled).toBe(false));
  expect(screen.getByLabelText('模拟正文输入')).toBe(input);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const entry: CatalogDocument = {
  id: crypto.randomUUID(),
  body_id: crypto.randomUUID(),
  task_id: crypto.randomUUID(),
  matter_id: null,
  title: '合成文档',
  body_revision: 3,
  version: 9,
  archived_at: null,
  collection: '',
  tags: [],
  favorite: false,
  in_library: true,
  updated_at: '2026-11-07',
};

const projection = (doc: CatalogDocument): CatalogResponse => ({
  ok: true,
  projects: [],
  documents: [doc],
  state: null,
  receipt: null,
  target_id: doc.id,
});

function show(catalog: (request: CatalogRequest) => Promise<CatalogResponse>, library = false) {
  vi.stubGlobal('caselite', { catalog });
  const onDirty = vi.fn();
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <DocumentLibrary library={library} onOpen={vi.fn()} onDirty={onDirty} />
    </QueryClientProvider>,
  );
  return onDirty;
}

function splitAction(library = false) {
  if (library) return screen.getByRole<HTMLButtonElement>('button', { name: '双栏预览' });
  if (!screen.queryByRole('menu', { name: '文档页面操作' }))
    fireEvent.click(screen.getByRole('button', { name: '更多文档操作' }));
  return within(screen.getByRole('menu', { name: '文档页面操作' })).getByRole<HTMLButtonElement>(
    'menuitemcheckbox',
    { name: '双栏预览' },
  );
}

async function draft(text: string) {
  if (!screen.queryByRole('button', { name: '添加标签' }))
    fireEvent.click(await screen.findByRole('button', { name: entry.title }));
  fireEvent.click(await screen.findByRole('button', { name: '添加标签' }));
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: '新标签' });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '添加' }));
  return input;
}

it.each([false, true])('保留明确失败的标签输入，允许使用原文本重试', async (library) => {
  let current = entry;
  const catalog = vi.fn(async (request: CatalogRequest): Promise<CatalogResponse> => {
    if (request.operation === 'organize_document') {
      if (request.tags.includes('合成标签') && current === entry) {
        current = { ...entry };
        return { ok: false, code: 'CONFLICT', message: '保存失败' };
      }
      current = { ...current, tags: request.tags, version: current.version + 1 };
    }
    return projection(current);
  });
  const onDirty = show(catalog, library);
  const input = await draft('合成标签');
  await screen.findByText('保存失败');
  expect(input.value).toBe('合成标签');
  expect(onDirty).toHaveBeenLastCalledWith(true);
  expect(splitAction(library).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '添加' }));
  await screen.findByRole('button', { name: '移除标签 合成标签' });
  expect(screen.queryByRole('textbox', { name: '新标签' })).toBeNull();
  expect(onDirty).toHaveBeenLastCalledWith(false);
});

it.each([false, true])('未知时核对原键，确认后读取失败只允许重读目录', async (library) => {
  let current = entry;
  let failRead = false;
  const catalog = vi.fn(async (request: CatalogRequest): Promise<CatalogResponse> => {
    if (request.operation === 'organize_document') {
      current = { ...entry, tags: request.tags, version: entry.version + 1 };
      return { ok: false, code: 'RESULT_UNKNOWN', message: '结果未知' };
    }
    if (request.operation === 'status') {
      failRead = true;
      return projection(current);
    }
    if (failRead) throw new Error('read unavailable');
    return projection(current);
  });
  const onDirty = show(catalog, library);
  const input = await draft('合成标签');
  const reconcile = await screen.findByRole('button', { name: '核对原提交' });
  expect(input.value).toBe('合成标签');
  fireEvent.click(reconcile);
  await screen.findByText('无法读取本地目录，请重试。');
  const organize = catalog.mock.calls[1][0];
  expect(catalog.mock.calls[2][0]).toMatchObject({
    operation: 'status',
    idempotency_key: 'idempotency_key' in organize ? organize.idempotency_key : null,
  });
  expect(onDirty).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '添加标签' }).disabled).toBe(true);
  failRead = false;
  fireEvent.click(screen.getByRole('button', { name: '重读目录' }));
  await screen.findByRole('button', { name: '移除标签 合成标签' });
  await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(false));
  expect(catalog.mock.calls.map(([request]) => request.operation)).toEqual([
    'list',
    'organize_document',
    'status',
    'list',
    'list',
  ]);
});

it('提交确认晚于切页时，新页面仍读回同一份目录', async () => {
  const original = { ...entry };
  const saved = { ...original, tags: ['迟到标签'], version: original.version + 1 };
  let current = original;
  let confirm: (() => void) | undefined;
  const catalog = vi.fn(async (request: CatalogRequest): Promise<CatalogResponse> => {
    if (request.operation === 'organize_document') {
      return new Promise((resolve) => {
        confirm = () => {
          current = saved;
          resolve(projection(saved));
        };
      });
    }
    return projection(current);
  });
  vi.stubGlobal('caselite', { catalog });
  const client = createWorkbenchQueryClient();
  const onDirty = vi.fn(),
    onOpen = vi.fn();
  const view = (library: boolean) => (
    <QueryClientProvider client={client}>
      <DocumentLibrary key={String(library)} library={library} onOpen={onOpen} onDirty={onDirty} />
    </QueryClientProvider>
  );
  const projectKey = ['catalog', 'project-properties'];
  client.setQueryData(projectKey, projection(original));
  const { rerender } = render(view(false));
  await draft('迟到标签');
  await waitFor(() => expect(confirm).toBeDefined());
  rerender(view(true));
  fireEvent.click(await screen.findByRole('button', { name: entry.title }));
  confirm!();
  expect(await screen.findByRole('button', { name: '移除标签 迟到标签' })).toBeTruthy();
  expect(client.getQueryState(projectKey)?.isInvalidated).toBe(true);

  function ProjectDirectory() {
    const read = useProjectCatalog();
    return (
      <p>
        {read.data?.documents[0]?.tags.includes('迟到标签') ? '项目目录已读到新版本' : '旧版本'}
      </p>
    );
  }
  rerender(
    <QueryClientProvider client={client}>
      <ProjectDirectory />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('项目目录已读到新版本')).toBeTruthy();
  expect(catalog.mock.calls.map(([request]) => request.operation)).toEqual([
    'list',
    'organize_document',
    'list',
    'list',
  ]);
  expect(catalog.mock.calls.at(-1)?.[0]).toMatchObject({ project_properties: true });
});

it('外部提交使首次在途目录过期后，会补发读取并忽略迟到旧结果', async () => {
  const complete: ((value: CatalogResponse) => void)[] = [];
  const catalog = vi.fn(() => new Promise<CatalogResponse>((resolve) => complete.push(resolve)));
  vi.stubGlobal('caselite', { catalog });
  const client = createWorkbenchQueryClient();
  render(
    <QueryClientProvider client={client}>
      <DocumentLibrary onOpen={vi.fn()} onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(complete).toHaveLength(1));
  act(() => {
    void invalidateOrdinaryCatalog(client, true, true);
  });
  await waitFor(() => expect(complete).toHaveLength(2));
  await act(async () => complete[1](projection(entry)));
  expect(await screen.findByRole('button', { name: entry.title })).toBeTruthy();
  await act(async () => complete[0](projection({ ...entry, title: '过期目录' })));
  expect(screen.queryByRole('button', { name: '过期目录' })).toBeNull();
});

it('按项目分组，快速切换后只显示当前文档的读取结果，版本不符可重读', async () => {
  const a = { ...entry, title: '合成甲' };
  const b = {
    ...entry,
    id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    matter_id: crypto.randomUUID(),
    title: '合成乙',
  };
  let revision = b.body_revision;
  let finishA: ((value: unknown) => void) | undefined;
  const catalog = vi.fn(async () => ({
    ...projection(a),
    documents: [a, { ...b, body_revision: revision }],
    projects: [{ id: b.matter_id, title: '合成项目' }],
  }));
  const task = vi.fn(async (request: { task_id: string }) => {
    if (request.task_id === a.task_id) return new Promise((resolve) => (finishA = resolve));
    return {
      ok: true,
      tasks: [
        {
          id: b.task_id,
          document_id: b.id,
          matter_id: b.matter_id,
          body_revision: b.body_revision + 1,
          body_id: b.body_id,
          title: b.title,
        },
      ],
      state: null,
    };
  });
  vi.stubGlobal('caselite', { catalog, task });
  const onOpen = vi.fn();
  const { container } = render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <DocumentLibrary onOpen={onOpen} onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByText('合成项目', { selector: 'summary span' }));
  expect(screen.getByText('我的文档')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '合成甲' }));
  await waitFor(() => expect(finishA).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: '合成乙' }));
  await screen.findByText('文档版本或归属已变化，请先刷新目录。');
  await act(async () => finishA?.({ ok: false, message: '甲的迟到错误' }));
  expect(screen.queryByText('甲的迟到错误')).toBeNull();

  revision += 1;
  fireEvent.click(screen.getByRole('button', { name: '重新读取文档' }));
  await screen.findByText('合成乙原位编辑');
  expect(screen.queryByRole('button', { name: '打开编辑' })).toBeNull();
  expect(onOpen).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: '返回文件夹' }));
  expect(container.querySelector('[data-directory-view="list"]')).toBeTruthy();
});

it('paginates by stable document identity and resets filtering without losing pending edits', async () => {
  // 用户移除分页/搜索，保留同一批25文档的完整可达性、稳定身份及脏状态保护。
  const docs = Array.from({ length: 25 }, (_, i) => ({
    ...entry,
    id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    title: `合同${i + 1}`,
    collection: i < 20 ? '' : '个人资料',
  }));
  show(async () => ({ ...projection(entry), documents: docs }) as CatalogResponse);
  await screen.findByRole('button', { name: '合同1' });
  expect(screen.queryByLabelText('搜索文档')).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getAllByRole('button', { name: /^合同\d+$/ })).toHaveLength(20);
  fireEvent.click(screen.getByText('个人资料', { selector: 'summary span' }));
  expect(screen.getAllByRole('button', { name: /^合同\d+$/ })).toHaveLength(25);
  fireEvent.click(screen.getByRole('button', { name: '合同25' }));
  expect(
    document
      .querySelector('[data-document-id][aria-pressed="true"]')
      ?.getAttribute('data-document-id'),
  ).toBe(docs[24].id);
  fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
  fireEvent.change(screen.getByLabelText('新标签'), { target: { value: '尚未提交' } });
  const folder = screen.getByText('个人资料', { selector: 'summary span' }).closest('details')!;
  fireEvent.click(folder.querySelector('summary')!);
  expect(folder.open).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '合同1' }).disabled).toBe(true);
});

it.each([false, true])(
  '双预览分别读取固定Document，属性和打开编辑跟随活动栏，未保存标签阻止换栏',
  async (library) => {
    const a = { ...entry, title: '合成甲', updated_at: '2026-11-09T10:00:00Z' };
    const b = {
      ...entry,
      id: crypto.randomUUID(),
      task_id: crypto.randomUUID(),
      title: '合成乙',
      updated_at: '2026-11-09T09:00:00Z',
    };
    const documents = [a, b];
    const task = vi.fn(async (request: { task_id: string }) => {
      const doc = documents.find((value) => value.task_id === request.task_id)!;
      return {
        ok: true,
        tasks: [
          {
            id: doc.task_id,
            document_id: doc.id,
            matter_id: doc.matter_id,
            body_revision: doc.body_revision,
            body_id: doc.body_id,
            title: doc.title,
          },
        ],
        state: null,
      };
    });
    const catalog = vi.fn(async () => ({ ...projection(a), documents }));
    vi.stubGlobal('caselite', { catalog, task });
    const onOpen = vi.fn();
    render(
      <QueryClientProvider client={createWorkbenchQueryClient()}>
        <DocumentLibrary library={library} onOpen={onOpen} onDirty={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '合成甲' }));
    fireEvent.click(splitAction(library));
    fireEvent.click(screen.getByRole('button', { name: '副预览' }));
    fireEvent.click(screen.getByRole('button', { name: '合成乙' }));
    const primary = screen.getByRole('region', { name: '主预览' }),
      secondary = screen.getByRole('region', { name: '副预览' });
    expect(
      within(primary).getByText('合成甲', { selector: '.split-preview-pane-heading strong' }),
    ).toBeTruthy();
    expect(
      within(secondary).getByText('合成乙', { selector: '.split-preview-pane-heading strong' }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(task).toHaveBeenCalledWith(expect.objectContaining({ task_id: b.task_id })),
    );
    expect(screen.getByLabelText('文档属性').textContent).toContain(b.id);
    await within(secondary).findByText('合成乙原位编辑');
    expect(screen.queryByRole('button', { name: '打开编辑' })).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
    fireEvent.change(screen.getByLabelText('新标签'), { target: { value: '待保存标签' } });
    const tagInput = screen.getByLabelText<HTMLInputElement>('新标签');
    const divider = screen.getByRole('separator', {
      name: library ? '调整知识库属性栏宽度' : '调整文档属性栏宽度',
    });
    const reads = [catalog.mock.calls.length, task.mock.calls.length];
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    fireEvent.keyUp(divider, { key: 'ArrowLeft' });
    expect(screen.getByLabelText('新标签')).toBe(tagInput);
    expect(tagInput.value).toBe('待保存标签');
    expect(screen.getByRole('region', { name: '主预览' })).toBe(primary);
    expect(screen.getByRole('region', { name: '副预览' })).toBe(secondary);
    expect([catalog.mock.calls.length, task.mock.calls.length]).toEqual(reads);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '主预览' }).disabled).toBe(true);
    fireEvent.pointerDown(primary);
    expect(screen.getByLabelText('文档属性').textContent).toContain(b.id);
    expect(
      within(secondary).getByText('合成乙', { selector: '.split-preview-pane-heading strong' }),
    ).toBeTruthy();
  },
);

it.each([false, true])(
  '正文草稿在属性调宽与复位后保持同一节点，且不触发保存（知识库=%s）',
  async (library) => {
    const catalog = vi.fn(async () => projection(entry));
    const task = vi.fn(async () => ({
      ok: true,
      tasks: [
        {
          id: entry.task_id,
          document_id: entry.id,
          body_id: entry.body_id,
          body_revision: entry.body_revision,
          matter_id: null,
        },
      ],
      state: null,
    }));
    vi.stubGlobal('caselite', { catalog, task });
    const onDirty = vi.fn();
    render(
      <QueryClientProvider client={createWorkbenchQueryClient()}>
        <DocumentLibrary library={library} onOpen={vi.fn()} onDirty={onDirty} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: entry.title }));
    const input = await screen.findByLabelText<HTMLInputElement>('模拟正文输入');
    fireEvent.change(input, { target: { value: '调宽时保留的正文草稿' } });
    const divider = screen.getByRole('separator', {
      name: library ? '调整知识库属性栏宽度' : '调整文档属性栏宽度',
    });
    const reads = [catalog.mock.calls.length, task.mock.calls.length];
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    fireEvent.keyUp(divider, { key: 'ArrowLeft' });
    fireEvent.doubleClick(divider);
    expect(screen.getByLabelText('模拟正文输入')).toBe(input);
    expect(input.value).toBe('调宽时保留的正文草稿');
    expect(onDirty).toHaveBeenLastCalledWith(true);
    expect(splitAction(library).disabled).toBe(true);
    expect([catalog.mock.calls.length, task.mock.calls.length]).toEqual(reads);
    const workspace = input.closest('.document-workspace');
    expect(workspace?.querySelector(':scope > .collection-main')).toBeTruthy();
    expect(workspace?.querySelector(':scope > .document-center-workspace')).toBeTruthy();
    expect(workspace?.querySelector(':scope > .document-directory-sidebar')).toBeTruthy();
  },
);

it('归档筛选后不会从另一预览栏继续展示已离开当前筛选的正文', async () => {
  const a = { ...entry, title: '合成当前稿' };
  let archived = false;
  const catalog = vi.fn(async () =>
    projection({ ...a, archived_at: archived ? '2026-11-09' : null }),
  );
  const task = vi.fn(async () => ({
    ok: true,
    tasks: [
      {
        id: a.task_id,
        document_id: a.id,
        body_id: a.body_id,
        matter_id: a.matter_id,
        body_revision: a.body_revision,
      },
    ],
    state: null,
  }));
  vi.stubGlobal('caselite', { catalog, task });
  const client = createWorkbenchQueryClient();
  render(
    <QueryClientProvider client={client}>
      <DocumentLibrary onOpen={vi.fn()} onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: a.title }));
  fireEvent.click(splitAction());
  fireEvent.click(screen.getByRole('button', { name: '副预览' }));
  fireEvent.click(screen.getByRole('button', { name: a.title }));
  expect(screen.queryByRole('button', { name: '已归档' })).toBeNull();
  archived = true;
  await act(async () => {
    await invalidateOrdinaryCatalog(client, true, true);
  });
  await waitFor(() => expect(screen.queryByRole('button', { name: a.title })).toBeNull());
  expect(screen.getByRole('region', { name: '主预览' }).textContent).not.toContain(a.title);
  expect(screen.getByRole('region', { name: '副预览' }).textContent).not.toContain(a.title);
});

it('目录刷新期间锁正文，迟到读取不会重挂载用户刚输入的正文', async () => {
  let finish: ((value: CatalogResponse) => void) | undefined;
  let delayed = false;
  const catalog = vi.fn(async () =>
    delayed
      ? new Promise<CatalogResponse>((resolve) => {
          finish = resolve;
        })
      : projection(entry),
  );
  vi.stubGlobal('caselite', {
    catalog,
    task: vi.fn(async () => ({
      ok: true,
      tasks: [
        {
          id: entry.task_id,
          document_id: entry.id,
          body_id: entry.body_id,
          body_revision: entry.body_revision,
          matter_id: null,
        },
      ],
      state: null,
    })),
  });
  const client = createWorkbenchQueryClient();
  render(
    <QueryClientProvider client={client}>
      <DocumentLibrary onOpen={vi.fn()} onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: entry.title }));
  const input = await screen.findByLabelText<HTMLInputElement>('模拟正文输入');
  delayed = true;
  act(() => {
    void invalidateOrdinaryCatalog(client, true, true);
  });
  await waitFor(() => expect(input.disabled).toBe(true));
  await act(async () => finish?.(projection(entry)));
  const refreshed = await screen.findByLabelText<HTMLInputElement>('模拟正文输入');
  await waitFor(() => expect(refreshed.disabled).toBe(false));
  fireEvent.change(refreshed, { target: { value: '刷新完成后的新输入' } });
  expect(splitAction().disabled).toBe(true);
  expect(refreshed.value).toBe('刷新完成后的新输入');
});

it('文档页用新顶栏和正文大标题，切换阅读宽度保留草稿/属性且不触发数据写入', async () => {
  const catalog = vi.fn(async () => projection(entry));
  const task = vi.fn(async () => ({
    ok: true,
    tasks: [
      {
        id: entry.task_id,
        document_id: entry.id,
        body_id: entry.body_id,
        body_revision: entry.body_revision,
        matter_id: null,
      },
    ],
    state: null,
  }));
  vi.stubGlobal('caselite', { catalog, task });
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <DocumentLibrary onOpen={vi.fn()} onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: entry.title }));
  const body = await screen.findByLabelText<HTMLInputElement>('模拟正文输入');
  const properties = screen.getByLabelText('文档属性');
  const originalProperties = properties.textContent;
  expect(screen.getByRole('heading', { name: entry.title, level: 1 })).toBeTruthy();
  expect(screen.getByLabelText('文档页面顶栏')).toBeTruthy();
  expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
  expect(screen.queryByRole('button', { name: '双栏预览' })).toBeNull();
  const workspace = body.closest('.document-workspace')!;
  const reads = [catalog.mock.calls.length, task.mock.calls.length];
  fireEvent.change(body, { target: { value: '改变阅读宽度时仍未保存的正文' } });
  fireEvent.click(screen.getByRole('button', { name: '更多文档操作' }));
  expect(
    screen.getByRole<HTMLButtonElement>('menuitemcheckbox', { name: '双栏预览' }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '全宽阅读' }));
  expect(workspace.getAttribute('data-reading-width')).toBe('full');
  expect(screen.getByLabelText('模拟正文输入')).toBe(body);
  expect(body.value).toBe('改变阅读宽度时仍未保存的正文');
  expect(screen.getByLabelText('文档属性')).toBe(properties);
  expect(properties.textContent).toBe(originalProperties);
  expect(properties.textContent).toContain(entry.id);
  expect([catalog.mock.calls.length, task.mock.calls.length]).toEqual(reads);
  fireEvent.click(screen.getByRole('button', { name: '更多文档操作' }));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '全宽阅读' }));
  expect(workspace.getAttribute('data-reading-width')).toBe('standard');
  expect(screen.getByLabelText('模拟正文输入')).toBe(body);
});

it('知识库共享消费者仍用原默认工具条，不接入文档专属菜单和标题外壳', async () => {
  show(async () => projection(entry), true);
  fireEvent.click(await screen.findByRole('button', { name: entry.title }));
  expect(screen.getByRole('button', { name: '双栏预览' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '更多文档操作' })).toBeNull();
  expect(document.querySelector('.document-page')).toBeNull();
  expect(screen.getByLabelText('文档属性').textContent).toContain(entry.id);
});

it('项目恢复旧选择时不会打开其他项目文档', async () => {
  const foreign = { ...entry, matter_id: 'project-B', title: '其他项目文档' };
  vi.stubGlobal('caselite', {
    catalog: vi.fn(async () => projection(foreign)),
    material: vi.fn(async () => ({ ok: true, materials: [] })),
  });
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <DocumentLibrary
        projectId="project-A"
        initialDocumentId={foreign.id}
        onOpen={vi.fn()}
        onDirty={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await screen.findByText('该文档已归档或不在当前目录，请返回目录重新选择。');
  expect(screen.queryByText('其他项目文档原位编辑')).toBeNull();
  expect(screen.queryByRole('button', { name: '其他项目文档' })).toBeNull();
});

it('项目工作台从同一目录打开原件并使用项目范围读取', async () => {
  const project = { id: 'project-original', title: '合成项目' };
  const original = {
    id: 'source-original',
    name: '证据.pdf',
    status: 'ready',
    pages: [],
    page_count: 1,
    bytes: 3,
  };
  const material = vi.fn(async (request: { operation: string }) =>
    request.operation === 'read_project'
      ? { ok: true, materials: [original], data: new Uint8Array([1, 2, 3]) }
      : { ok: true, materials: [original] },
  );
  vi.stubGlobal('caselite', {
    catalog: vi.fn(async () => ({ ...projection(entry), projects: [project], documents: [] })),
    material,
  });
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <DocumentLibrary projectId={project.id} onOpen={vi.fn()} onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  const folder = await screen.findByText('合成项目');
  await waitFor(() =>
    expect(folder.closest('summary')?.getAttribute('aria-disabled')).toBe('false'),
  );
  fireEvent.click(folder);
  const file = await screen.findByRole('button', { name: /证据.pdf/ });
  await waitFor(() => expect((file as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(file);
  expect(await screen.findByText('原件阅读：证据.pdf')).toBeTruthy();
  expect(material).toHaveBeenCalledWith({
    protocol_version: 1,
    operation: 'read_project',
    project_id: project.id,
    source_id: original.id,
  });
});

it('文档工具栏切换原有侧栏并保留未保存正文与属性节点', async () => {
  const catalog = vi.fn(async () => projection(entry));
  const task = vi.fn(async () => ({
    ok: true,
    tasks: [
      {
        id: entry.task_id,
        document_id: entry.id,
        body_id: entry.body_id,
        body_revision: entry.body_revision,
        matter_id: null,
      },
    ],
    state: null,
  }));
  vi.stubGlobal('caselite', { catalog, task });
  const onDirty = vi.fn();
  function WithNavigation() {
    const [open, setOpen] = useState(false);
    return (
      <PageNavigationProvider
        value={{
          initial: null,
          register: () => () => {},
          report: () => {},
          beforeChange: () => {},
          inspector: { open, setOpen, pageKey: 'documents:doc-1', initialize: () => {} },
        }}
      >
        <div data-testid="host" data-inspector-open={open}>
          <DocumentLibrary onOpen={vi.fn()} onDirty={onDirty} />
        </div>
      </PageNavigationProvider>
    );
  }
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <WithNavigation />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: entry.title }));
  const body = await screen.findByLabelText<HTMLInputElement>('模拟正文输入');
  const properties = screen.getByLabelText('文档属性');
  const workspace = body.closest('.document-workspace')!;
  const reads = [catalog.mock.calls.length, task.mock.calls.length];
  expect(workspace.getAttribute('data-focus-document')).toBe('true');
  fireEvent.change(body, { target: { value: '折叠前的未保存正文' } });
  fireEvent.click(screen.getByRole('button', { name: '展开文档属性与 AI' }));
  expect(screen.getByTestId('host').getAttribute('data-inspector-open')).toBe('true');
  expect(screen.getByLabelText('模拟正文输入')).toBe(body);
  expect(screen.getByLabelText('文档属性')).toBe(properties);
  expect(body.value).toBe('折叠前的未保存正文');
  fireEvent.click(screen.getByRole('button', { name: '收起文档属性与 AI' }));
  expect(screen.getByTestId('host').getAttribute('data-inspector-open')).toBe('false');
  expect(screen.getByLabelText('模拟正文输入')).toBe(body);
  expect(body.value).toBe('折叠前的未保存正文');
  expect([catalog.mock.calls.length, task.mock.calls.length]).toEqual(reads);
});

it.each(
  [1440, 820].flatMap((width) =>
    (['RESULT_UNKNOWN', 'UNAVAILABLE'] as const).map((code) => ({ width, code })),
  ),
)('单文稿焦点视图在 $width px 遇 $code 时恢复目录以核对原提交', async ({ width, code }) => {
  let current = entry;
  const catalog = vi.fn(async (request: CatalogRequest): Promise<CatalogResponse> => {
    if (request.operation === 'organize_document') {
      current = { ...entry, tags: request.tags, version: entry.version + 1 };
      return { ok: false, code, message: '结果未知，请核对' };
    }
    return projection(current);
  });
  const task = vi.fn(async () => ({
    ok: true,
    tasks: [
      {
        id: entry.task_id,
        document_id: entry.id,
        body_id: entry.body_id,
        body_revision: entry.body_revision,
        matter_id: null,
      },
    ],
    state: null,
  }));
  vi.stubGlobal('caselite', { catalog, task });
  vi.stubGlobal('innerWidth', width);
  const source = resolve('apps/desktop/src/renderer/ui-design.css');
  const fullCss = readFileSync(source, 'utf8').replace(
    /^@import '([^']+)';/gm,
    (_match, relative: string) => readFileSync(resolve(dirname(source), relative), 'utf8'),
  );
  const style = document.createElement('style');
  style.dataset.documentRecoveryTest = '';
  style.textContent = fullCss;
  document.head.append(style);
  const onDirty = vi.fn();
  try {
    render(
      <QueryClientProvider client={createWorkbenchQueryClient()}>
        <div className="workbench" data-inspector-open="true" data-properties-layout="sidebar">
          <div className="workspace-main">
            <DocumentLibrary onOpen={vi.fn()} onDirty={onDirty} />
          </div>
        </div>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: entry.title }));
    const body = await screen.findByLabelText<HTMLInputElement>('模拟正文输入');
    const workspace = body.closest('.document-workspace')!;
    const directory = workspace.querySelector(':scope > .collection-main');
    expect(directory).not.toBeNull();
    expect(workspace.getAttribute('data-focus-document')).toBe('true');
    expect(workspace.getAttribute('data-directory-view')).toBe('preview');
    const input = await draft('合成标签');
    const retry = await screen.findByRole<HTMLButtonElement>('button', { name: '核对原提交' });
    // jsdom 只证实节点/状态与完整样式表共存；@media 的实际显示由同包浏览器验证。
    expect(workspace.getAttribute('data-focus-document')).toBeNull();
    expect(workspace.getAttribute('data-directory-view')).toBe('list');
    expect(workspace.querySelector(':scope > .collection-main')).toBe(directory);
    expect(directory?.contains(retry)).toBe(true);
    expect(input.value).toBe('合成标签');
    expect(onDirty).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '返回文件夹' }).disabled).toBe(
      true,
    );
    expect(splitAction().disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    const submit = catalog.mock.calls
      .map(([request]) => request)
      .find((request) => request.operation === 'organize_document');
    expect(submit && 'idempotency_key' in submit).toBe(true);
    fireEvent.click(retry);
    await screen.findByRole('button', { name: '移除标签 合成标签' });
    await waitFor(() => {
      expect(onDirty).toHaveBeenLastCalledWith(false);
      expect(workspace.getAttribute('data-focus-document')).toBe('true');
      expect(workspace.getAttribute('data-directory-view')).toBe('preview');
    });
    const requests = catalog.mock.calls.map(([request]) => request);
    expect(requests.filter((request) => request.operation === 'organize_document')).toHaveLength(1);
    expect(requests.find((request) => request.operation === 'status')).toMatchObject({
      operation: 'status',
      idempotency_key: submit && 'idempotency_key' in submit ? submit.idempotency_key : null,
    });
    expect(screen.getByLabelText('模拟正文输入')).toBe(body);
  } finally {
    style.remove();
  }
});

it('文档审阅沿原任务身份打开，菜单已打开后正文变脏仍阻止离开', async () => {
  const onOpen = vi.fn();
  vi.stubGlobal('caselite', {
    catalog: vi.fn(async () => projection(entry)),
    task: vi.fn(async () => ({
      ok: true,
      tasks: [
        {
          id: entry.task_id,
          document_id: entry.id,
          body_id: entry.body_id,
          body_revision: entry.body_revision,
          matter_id: null,
        },
      ],
      state: null,
    })),
  });
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <DocumentLibrary onOpen={onOpen} onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: entry.title }));
  const input = await screen.findByLabelText<HTMLInputElement>('模拟正文输入');
  fireEvent.click(screen.getByRole('button', { name: '更多文档操作' }));
  const action = screen.getByRole<HTMLButtonElement>('menuitem', { name: 'AI 审阅' });
  await waitFor(() => expect(action.disabled).toBe(false));
  fireEvent.click(action);
  expect(onOpen.mock.calls).toEqual([[entry.task_id]]);
  fireEvent.click(screen.getByRole('button', { name: '更多文档操作' }));
  const openAction = screen.getByRole<HTMLButtonElement>('menuitem', { name: 'AI 审阅' });
  fireEvent.change(input, { target: { value: '仍未保存的正文' } });
  await waitFor(() => expect(openAction.disabled).toBe(true));
  fireEvent.click(openAction);
  expect(onOpen.mock.calls).toEqual([[entry.task_id]]);
  expect(screen.getByLabelText('模拟正文输入')).toBe(input);
  expect(input.value).toBe('仍未保存的正文');
});

it('知识库不把既有onOpen当作已接通的写入审阅动作', async () => {
  const onOpen = vi.fn();
  vi.stubGlobal('caselite', { catalog: vi.fn(async () => projection(entry)) });
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <DocumentLibrary library onOpen={onOpen} onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: entry.title }));
  expect(screen.queryByRole('menuitem', { name: 'AI 审阅' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'AI 审阅' })).toBeNull();
  expect(onOpen).not.toHaveBeenCalled();
});

it('审阅只跟随活动文稿，二栏镜像和固定版本不能跳成当前工作稿', async () => {
  const b = {
    ...entry,
    id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    body_id: crypto.randomUUID(),
    title: '另一份审阅文稿',
  };
  const documents = [entry, b];
  const onOpen = vi.fn();
  vi.stubGlobal('caselite', {
    catalog: vi.fn(async () => ({ ...projection(entry), documents })),
    task: vi.fn(async (request: { operation: string; task_id: string }) => {
      const doc = documents.find((value) => value.task_id === request.task_id)!;
      if (request.operation === 'list_snapshots')
        return {
          ok: true,
          snapshots: [
            {
              id: 'fixed-review-snapshot',
              task_id: doc.task_id,
              document_id: doc.id,
              body_id: doc.body_id,
              body_revision: 2,
              note: '审阅固定旧版',
              created_at: '2026-11-07T00:00:00Z',
            },
          ],
          page: { offset: 0, has_more: false },
        };
      if (request.operation === 'read_snapshot') return { ok: false, message: '只读样本' };
      return {
        ok: true,
        tasks: [
          {
            id: doc.task_id,
            document_id: doc.id,
            body_id: doc.body_id,
            body_revision: doc.body_revision,
            matter_id: null,
            title: doc.title,
          },
        ],
        state: null,
      };
    }),
  });
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <DocumentLibrary onOpen={onOpen} onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: entry.title }));
  await screen.findByTestId('inline-body');
  fireEvent.click(splitAction());
  fireEvent.click(screen.getByRole('button', { name: '副预览' }));
  fireEvent.click(screen.getByRole('button', { name: b.title }));
  await within(screen.getByRole('region', { name: '副预览' })).findByText(b.title + '原位编辑');
  const action = () => {
    if (!screen.queryByRole('menu'))
      fireEvent.click(screen.getByRole('button', { name: '更多文档操作' }));
    return screen.getByRole<HTMLButtonElement>('menuitem', { name: 'AI 审阅' });
  };
  await waitFor(() => expect(action().disabled).toBe(false));
  fireEvent.click(action());
  expect(onOpen.mock.calls).toEqual([[b.task_id]]);
  fireEvent.click(screen.getByRole('button', { name: entry.title }));
  await waitFor(() => expect(action().disabled).toBe(true));
  fireEvent.click(action());
  expect(onOpen.mock.calls).toEqual([[b.task_id]]);
  fireEvent.click(screen.getByRole('button', { name: '更多文档操作' }));
  fireEvent.click(screen.getByRole('button', { name: '主预览' }));
  fireEvent.click(await screen.findByRole('button', { name: /审阅固定旧版/ }));
  await waitFor(() => expect(action().disabled).toBe(true));
  fireEvent.click(action());
  expect(onOpen.mock.calls).toEqual([[b.task_id]]);
});
