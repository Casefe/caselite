// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MaterialBatchImport from './MaterialBatchImport';
import type { MaterialBatch } from '../../preload/caselite-api';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const id = '11111111-1111-4111-8111-111111111111';
const token = '22222222-2222-4222-8222-222222222222';
function preview(): MaterialBatch {
  return {
    id,
    scope: 'home',
    title: '客户补件',
    state: 'ready',
    items: [
      {
        token,
        relative_name: '客户补件/合同.pdf',
        bytes: 100,
        state: 'pending',
        message: '待保存',
      },
    ],
  };
}
it('previews relative names before saving and adds only explicitly selected saved material to the next message', async () => {
  let batch: MaterialBatch | null = null;
  const api = vi.fn(async (request) => {
    if (request.operation === 'pick') batch = preview();
    if (request.operation === 'run' && batch)
      batch = {
        ...batch,
        state: 'finished',
        items: batch.items.map((item) => ({ ...item, state: 'saved', message: '原件已保存' })),
      };
    if (request.operation === 'dismiss') batch = null;
    return { ok: true, batch };
  });
  const agent = vi.fn(),
    select = vi.fn(),
    requested = vi.fn();
  Object.defineProperty(window, 'caselite', {
    configurable: true,
    value: { materialBatch: api, agent },
  });
  render(
    <MaterialBatchImport scope="home" mode="folder" onRequested={requested} onSelect={select} />,
  );
  await screen.findByText('客户补件/合同.pdf');
  expect(api.mock.calls.some(([request]) => request.operation === 'run')).toBe(false);
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存本批材料' }));
  await screen.findByRole('button', { name: '将已保存材料加入本轮' });
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '将已保存材料加入本轮' }));
  expect(select).toHaveBeenCalledExactlyOnceWith([token]);
  expect(agent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '收起清单' }));
  await waitFor(() => expect(screen.queryByText('客户补件/合同.pdf')).toBeNull());
});
it('retains failed items and offers same-batch continuation without selecting them for AI', async () => {
  const batch = preview();
  batch.state = 'paused';
  batch.items[0].state = 'failed';
  batch.items[0].message = '文件位置或权限已变化，请重新选择原文件。';
  const api = vi.fn(async () => ({ ok: true, batch }));
  Object.defineProperty(window, 'caselite', { configurable: true, value: { materialBatch: api } });
  const select = vi.fn();
  render(<MaterialBatchImport scope="home" mode={null} onRequested={vi.fn()} onSelect={select} />);
  await screen.findByText('客户补件/合同.pdf');
  expect(screen.queryByRole('button', { name: '将已保存材料加入本轮' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '继续保存未完成项' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith({
      protocol_version: 1,
      operation: 'run',
      scope: 'home',
      batch_id: id,
    }),
  );
  expect(select).not.toHaveBeenCalled();
});
