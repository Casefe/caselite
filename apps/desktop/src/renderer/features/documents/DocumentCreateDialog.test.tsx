// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CatalogDocument, CatalogRequest } from '../../../preload/caselite-api';
import DocumentCreateDialog from './DocumentCreateDialog';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const document: CatalogDocument = {
  id: 'personal',
  owner_kind: 'personal',
  task_id: null,
  matter_id: null,
  body_id: 'body',
  body_revision: 1,
  editor_schema: 1,
  title: '独立稿',
  version: 1,
  archived_at: null,
  collection: '',
  tags: [],
  favorite: false,
  in_library: false,
  updated_at: '2026-11-15',
};

it('unknown creation checks the original key and reopens by stable ID without creating a Task or duplicating an acknowledged document', async () => {
  let original: Extract<CatalogRequest, { operation: 'create_document' }> | undefined;
  const task = vi.fn();
  const catalog = vi.fn(async (request: CatalogRequest) => {
    if (request.operation === 'create_document') {
      original = request;
      throw new Error('合成传输失败');
    }
    return {
      ok: true,
      projects: [],
      documents: [document],
      state: null,
      target_id: document.id,
      receipt: original!.idempotency_key,
    };
  });
  const opened = vi.fn().mockRejectedValueOnce(Error('目录重读失败')).mockResolvedValue(undefined);
  const cancelled = vi.fn();
  vi.stubGlobal('caselite', { catalog, task });
  render(<DocumentCreateDialog onCreated={opened} onCancel={cancelled} />);
  fireEvent.change(screen.getByRole('textbox', { name: '文档名称' }), {
    target: { value: '独立稿' },
  });
  fireEvent.click(screen.getByRole('button', { name: '创建文档' }));
  await screen.findByRole('alert');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '取消' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '核对并打开文档' }));
  await waitFor(() => expect(opened).toHaveBeenCalledWith('personal'));
  expect(catalog.mock.calls[1][0]).toEqual({
    protocol_version: 1,
    operation: 'status',
    idempotency_key: original!.idempotency_key,
  });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('目录重读失败'));
  fireEvent.click(screen.getByRole('button', { name: '核对并打开文档' }));
  await waitFor(() => expect(opened).toHaveBeenCalledTimes(2));
  expect(catalog).toHaveBeenCalledTimes(2);
  expect(task).not.toHaveBeenCalled();
  expect(cancelled).not.toHaveBeenCalled();
});

it('rejects mismatched receipts and only retries the identical request after explicit NOT_FOUND', async () => {
  let original: CatalogRequest;
  let calls = 0;
  const catalog = vi.fn(async (request: CatalogRequest) => {
    calls++;
    if (calls === 1) {
      original = request;
      return {
        ok: true,
        projects: [],
        documents: [document],
        state: null,
        target_id: document.id,
        receipt: 'wrong',
      };
    }
    if (request.operation === 'status') return { ok: false, code: 'NOT_FOUND', message: '不存在' };
    expect(request).toEqual(original);
    return {
      ok: true,
      projects: [],
      documents: [document],
      state: null,
      target_id: document.id,
      receipt: 'idempotency_key' in request ? request.idempotency_key : null,
    };
  });
  vi.stubGlobal('caselite', { catalog });
  const opened = vi.fn().mockResolvedValue(undefined);
  render(<DocumentCreateDialog onCreated={opened} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: '文档名称' }), {
    target: { value: '独立稿' },
  });
  fireEvent.click(screen.getByRole('button', { name: '创建文档' }));
  expect((await screen.findByRole('alert')).textContent).toContain('回执不一致');
  expect(opened).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '核对并打开文档' }));
  await waitFor(() => expect(opened).toHaveBeenCalledWith('personal'));
  expect(catalog).toHaveBeenCalledTimes(3);
});
