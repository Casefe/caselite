// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DefaultFolderSettings from './DefaultFolderSettings';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const configuration = {
  binding_id: '00000000-0000-4000-8000-000000000001',
  display_name: '原文件夹',
  revision: 1,
};
function host(folder?: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, 'caselite', {
    configurable: true,
    value: folder ? { folder } : {},
  });
}
it('旧入口缺少文件夹能力时提示不可用，不产生未知提交', async () => {
  host();
  render(<DefaultFolderSettings />);
  expect(await screen.findByText('当前版本暂不支持本地文件夹。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
  expect(await screen.findByText('当前版本暂不支持本地文件夹。')).toBeTruthy();
  expect(screen.queryByText('核对原操作')).toBeNull();
});
it('超时后按原请求核对，取消回执解除等待且不重新选择', async () => {
  const folder = vi.fn(async (request: { operation: string }) => {
    if (request.operation === 'configuration')
      return { ok: true, state: 'configured', configuration };
    if (request.operation === 'choose_default')
      return { ok: false, code: 'RESULT_UNKNOWN', message: '未知' };
    return { ok: true, state: 'cancelled' };
  });
  host(folder);
  render(<DefaultFolderSettings />);
  await screen.findByText('原文件夹');
  fireEvent.click(screen.getByRole('button', { name: '更换文件夹' }));
  fireEvent.click(await screen.findByRole('button', { name: '核对原操作' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '核对原操作' })).toBeNull());
  const submitted = folder.mock.calls.find(
    ([request]) => request.operation === 'choose_default',
  )![0] as { request_id: string };
  const queried = folder.mock.calls.find(
    ([request]) => request.operation === 'query_configuration',
  )![0] as { request_id: string };
  expect(queried.request_id).toBe(submitted.request_id);
  expect(
    folder.mock.calls.filter(([request]) => request.operation === 'choose_default'),
  ).toHaveLength(1);
});
it('核对得到明确失败回执后允许重新选择，找不到回执时继续等待', async () => {
  let queries = 0;
  const folder = vi.fn(async (request: { operation: string }) => {
    if (request.operation === 'configuration') return { ok: true, state: 'not_configured' };
    if (request.operation === 'choose_default')
      return { ok: false, code: 'RESULT_UNKNOWN', message: '未知' };
    return ++queries === 1
      ? { ok: false, code: 'NOT_FOUND', message: '未找到' }
      : { ok: false, code: 'ROOT_MISMATCH', message: '原文件夹已变化' };
  });
  host(folder);
  render(<DefaultFolderSettings />);
  await waitFor(() => expect(folder).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
  fireEvent.click(await screen.findByRole('button', { name: '核对原操作' }));
  expect(await screen.findByText(/原操作仍可能执行中/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '核对原操作' }));
  expect(await screen.findByText('原文件夹已变化')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '核对原操作' })).toBeNull();
});
it('项目切换后旧异步结果不能覆盖当前项目设置', async () => {
  let release!: (value: unknown) => void;
  const old = new Promise((resolve) => {
    release = resolve;
  });
  const folder = vi.fn((request: { scope?: { project_id?: string } }) =>
    request.scope?.project_id === 'old'
      ? old
      : Promise.resolve({
          ok: true,
          state: 'configured',
          configuration,
          project_directory_name: '新项目',
        }),
  );
  host(folder);
  const view = render(<DefaultFolderSettings projectId="old" />);
  view.rerender(<DefaultFolderSettings projectId="new" />);
  expect(await screen.findByText('新项目')).toBeTruthy();
  release({ ok: true, state: 'configured', configuration, project_directory_name: '旧项目' });
  await waitFor(() => expect(screen.queryByText('旧项目')).toBeNull());
});
