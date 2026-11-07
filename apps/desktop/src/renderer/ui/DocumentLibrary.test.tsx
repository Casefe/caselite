// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import {
  invalidateOrdinaryCatalog,
  useProjectCatalog,
} from '../shared/data/ordinary-catalog-query';
import { createWorkbenchQueryClient } from '../shared/data/workbench-query-client';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CatalogDocument, CatalogRequest, CatalogResponse } from '../../preload/caselite-api';
import DocumentLibrary from './DocumentLibrary';

vi.mock('./AgentPanel', () => ({ default: () => null }));
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

function show(catalog: (request: CatalogRequest) => Promise<CatalogResponse>) {
  vi.stubGlobal('caselite', { catalog });
  const onDirty = vi.fn();
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <DocumentLibrary onOpen={vi.fn()} onDirty={onDirty} />
    </QueryClientProvider>,
  );
  return onDirty;
}

async function draft(text: string) {
  fireEvent.click(await screen.findByRole('button', { name: '添加标签' }));
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: '新标签' });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '添加', exact: true }));
  return input;
}

it('保留明确失败的标签输入，允许使用原文本重试', async () => {
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
  const onDirty = show(catalog);
  const input = await draft('合成标签');
  await screen.findByText('保存失败');
  expect(input.value).toBe('合成标签');
  expect(onDirty).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '打开正文' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '添加', exact: true }));
  await screen.findByRole('button', { name: '移除标签 合成标签' });
  expect(screen.queryByRole('textbox', { name: '新标签' })).toBeNull();
  expect(onDirty).toHaveBeenLastCalledWith(false);
});

it('未知时核对原键，确认后读取失败只允许重读目录', async () => {
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
  const onDirty = show(catalog);
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
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
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
  const original = { ...entry, in_library: false };
  const saved = { ...original, in_library: true, version: original.version + 1 };
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
  fireEvent.click(await screen.findByRole('button', { name: '加入知识库' }));
  await waitFor(() => expect(confirm).toBeDefined());
  rerender(view(true));
  expect(screen.getByText(/知识库暂无选定文档/)).toBeTruthy();
  confirm!();
  expect(await screen.findByRole('button', { name: '移出知识库' })).toBeTruthy();
  expect(client.getQueryState(projectKey)?.isInvalidated).toBe(true);

  function ProjectDirectory() {
    const read = useProjectCatalog();
    return <p>{read.data?.documents[0]?.in_library ? '项目目录已读到新版本' : '旧版本'}</p>;
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
    void invalidateOrdinaryCatalog(client);
  });
  await waitFor(() => expect(complete).toHaveLength(2));
  await act(async () => complete[1](projection(entry)));
  expect(await screen.findByRole('row', { name: /合成文档/ })).toBeTruthy();
  await act(async () => complete[0](projection({ ...entry, title: '过期目录' })));
  expect(screen.queryByRole('row', { name: /过期目录/ })).toBeNull();
});
