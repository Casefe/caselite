// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClientProvider, onlineManager, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { TaskListQuery } from '../../packages/contracts/src';
import { createWorkbenchQueryClient } from '../../apps/desktop/src/renderer/shared/data/workbench-query-client';
import {
  useTaskPage,
  invalidateTaskPages,
} from '../../apps/desktop/src/renderer/ui/task-list-query';
import ReadTable from '../../apps/desktop/src/renderer/shared/ui/ReadTable';

const clients: QueryClient[] = [];
const query: TaskListQuery = {
  scope: { type: 'workspace' },
  text: '',
  status: null,
  priority: null,
  dates: 'all',
  from: null,
  to: null,
  body: 'all',
  sort: 'title',
  offset: 0,
};
const page = (total: number, offset = 0) => ({
  ok: true,
  tasks: [],
  page: { total, offset, has_more: false },
  receipt: null,
  state: null,
});
const originalApi = Object.getOwnPropertyDescriptor(window, 'caselite');
afterEach(() => {
  cleanup();
  for (const c of clients.splice(0)) c.clear();
  onlineManager.setOnline(true);
  vi.useRealTimers();
  if (originalApi) Object.defineProperty(window, 'caselite', originalApi);
  else Reflect.deleteProperty(window, 'caselite');
});
function mount(api: ReturnType<typeof vi.fn>, initial = { query, enabled: true }) {
  Object.defineProperty(window, 'caselite', { configurable: true, value: { task: api } });
  const client = createWorkbenchQueryClient();
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(({ query, enabled }) => useTaskPage(query, enabled), {
      initialProps: initial,
      wrapper,
    }),
    client,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it('still reads the local IPC-backed list while the browser online manager is offline', async () => {
  onlineManager.setOnline(false);
  const api = vi.fn().mockResolvedValue(page(3));
  const h = mount(api);
  await waitFor(() => expect(h.result.current.data?.page.total).toBe(3));
  expect(api).toHaveBeenCalledTimes(1);
  expect(h.result.current.fetchStatus).toBe('idle');
});
it('uses separate cache identities for empty search and literal all', async () => {
  const api = vi.fn(async (r: { query: TaskListQuery }) => page(r.query.text === 'all' ? 1 : 4));
  const h = mount(api);
  await waitFor(() => expect(h.result.current.data?.page.total).toBe(4));
  h.rerender({ query: { ...query, text: 'all' }, enabled: true });
  await waitFor(() => expect(h.result.current.data?.page.total).toBe(1));
  h.rerender({ query, enabled: true });
  await waitFor(() => expect(h.result.current.data?.page.total).toBe(4));
  expect(api).toHaveBeenCalledTimes(2);
});
it('keeps a late response for the previous page out of the currently selected page', async () => {
  const old = deferred<ReturnType<typeof page>>();
  const api = vi
    .fn()
    .mockImplementationOnce(() => old.promise)
    .mockResolvedValue(page(35, 20));
  const h = mount(api);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  h.rerender({ query: { ...query, offset: 20 }, enabled: true });
  await waitFor(() => expect(h.result.current.data?.page.offset).toBe(20));
  await act(async () => {
    old.resolve(page(99, 0));
    await old.promise;
  });
  expect(h.result.current.data?.page).toEqual({ total: 35, offset: 20, has_more: false });
});
it('drops an in-flight read when editing disables the list and rereads after editing', async () => {
  const old = deferred<ReturnType<typeof page>>();
  const api = vi
    .fn()
    .mockImplementationOnce(() => old.promise)
    .mockResolvedValue(page(2));
  const h = mount(api);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  h.rerender({ query, enabled: false });
  await act(async () => {
    old.resolve(page(100));
    await old.promise;
  });
  expect(h.result.current.data).toBeUndefined();
  h.rerender({ query, enabled: true });
  await waitFor(() => expect(h.result.current.data?.page.total).toBe(2));
  expect(api).toHaveBeenCalledTimes(2);
});
it('invalidates old pages without letting an uncancellable IPC response overwrite the replacement', async () => {
  const old = deferred<ReturnType<typeof page>>();
  const api = vi
    .fn()
    .mockResolvedValueOnce(page(1))
    .mockImplementationOnce(() => old.promise)
    .mockResolvedValue(page(2));
  const h = mount(api);
  await waitFor(() => expect(h.result.current.data?.page.total).toBe(1));
  act(() => {
    void h.result.current.refetch();
  });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  act(() => invalidateTaskPages(h.client));
  await waitFor(() => expect(h.result.current.data?.page.total).toBe(2));
  await act(async () => {
    old.resolve(page(77));
    await old.promise;
  });
  expect(h.result.current.data?.page.total).toBe(2);
});
it('reports malformed pagination as an error instead of presenting it as an empty successful page', async () => {
  const h = mount(vi.fn().mockResolvedValue({ ok: true, tasks: [] }));
  await waitFor(() => expect(h.result.current.isError).toBe(true));
  expect(h.result.current.error?.message).toContain('分页信息');
  expect(h.result.current.data).toBeUndefined();
});
it('does not automatically retry a failed local read after time advances', async () => {
  vi.useFakeTimers();
  const api = vi.fn().mockRejectedValue(new Error('synthetic local read failure'));
  const h = mount(api);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120000);
  });
  expect(api).toHaveBeenCalledTimes(1);
  expect(h.result.current.isError).toBe(true);
  expect(h.result.current.error?.message).toBe('synthetic local read failure');
});

it('retains cell component identity by stable row id after the displayed order changes', () => {
  type Row = { id: string; name: string };
  function Cell({ name }: { name: string }) {
    const [initial] = useState(name);
    return <span>{initial}</span>;
  }
  const columns = [
    {
      id: 'name',
      accessorKey: 'name',
      header: '名称',
      cell: ({ row }: { row: { original: Row } }) => <Cell name={row.original.name} />,
    },
  ];
  const a = { id: 'a', name: '甲项' },
    b = { id: 'b', name: '乙项' };
  const r = render(<ReadTable data={[a, b]} columns={columns} getRowId={(row) => row.id} />);
  r.rerender(
    <ReadTable
      data={[
        { ...b, name: '乙项更新' },
        { ...a, name: '甲项更新' },
      ]}
      columns={columns}
      getRowId={(row) => row.id}
    />,
  );
  expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual(['乙项', '甲项']);
});
it('renders numeric zero and escaped labels without changing the supplied page order', () => {
  const rows = [
    { id: 'b', value: 0, name: '<script>合成标题</script>' },
    { id: 'a', value: 2, name: '普通标题' },
  ];
  Object.freeze(rows);
  const r = render(
    <ReadTable
      data={rows}
      columns={[
        { accessorKey: 'value', header: '值' },
        { accessorKey: 'name', header: '名称' },
      ]}
      getRowId={(row) => row.id}
    />,
  );
  expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual([
    '0',
    '<script>合成标题</script>',
    '2',
    '普通标题',
  ]);
  expect(r.container.querySelector('script')).toBeNull();
  expect(rows.map((row) => row.id)).toEqual(['b', 'a']);
});
