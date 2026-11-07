// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  render(<DocumentLibrary onOpen={vi.fn()} onDirty={onDirty} />);
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
