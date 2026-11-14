// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useLocalFolder } from './useLocalFolder';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const root = {
  root_id: '00000000-0000-4000-8000-000000000001',
  root_entry_id: '00000000-0000-4000-8000-000000000002',
  generation: 1,
  display_name: '根目录',
};
const file = {
  entry_id: '00000000-0000-4000-8000-000000000003',
  display_name: '示例.pdf',
  kind: 'file' as const,
  bytes: 123,
  mapping_revision: 0,
};
function host(folder?: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, 'caselite', {
    configurable: true,
    value: folder ? { folder } : {},
  });
}
it('恢复根目录，按需读取首层并拒绝缺少能力的旧入口', async () => {
  host();
  const view = renderHook(() => useLocalFolder(true));
  await waitFor(() => expect(view.result.current.message).toContain('暂不支持'));
  view.unmount();
  const folder = vi.fn(async (request: { operation: string }) => {
    if (request.operation === 'restore_default') return { ok: true, state: 'ready', root };
    if (request.operation === 'list_directory')
      return { ok: true, state: 'listed', entries: [file], next_cursor: null };
    return { ok: true, state: 'listed', pending: [], saved: [] };
  });
  host(folder);
  const current = renderHook(() => useLocalFolder(true));
  await waitFor(() =>
    expect(current.result.current.directories[root.root_entry_id]?.entries).toEqual([file]),
  );
  expect(
    folder.mock.calls.filter(([request]) => request.operation === 'list_directory'),
  ).toHaveLength(1);
});
it('切换项目后延迟返回的旧根不能覆盖当前根', async () => {
  let release!: (value: unknown) => void;
  const old = new Promise((resolve) => {
    release = resolve;
  });
  const folder = vi.fn((request: { operation: string; scope?: { project_id?: string } }) => {
    if (request.operation === 'restore_default')
      return request.scope?.project_id === 'old'
        ? old
        : Promise.resolve({ ok: true, state: 'ready', root });
    return Promise.resolve({ ok: true, state: 'listed', entries: [], pending: [], saved: [] });
  });
  host(folder);
  const view = renderHook(({ id }) => useLocalFolder(true, id), { initialProps: { id: 'old' } });
  view.rerender({ id: 'new' });
  await waitFor(() => expect(view.result.current.root?.display_name).toBe('根目录'));
  await act(async () => {
    release({ ok: true, state: 'ready', root: { ...root, display_name: '旧目录' } });
  });
  expect(view.result.current.root?.display_name).toBe('根目录');
});
it('打开结果未知时核对并取消同一请求，不发第二次打开', async () => {
  const folder = vi.fn(async (request: { operation: string }) => {
    if (request.operation === 'restore_default') return { ok: true, state: 'ready', root };
    if (request.operation === 'list_directory')
      return { ok: true, state: 'listed', entries: [file], next_cursor: null };
    if (request.operation === 'open_entry')
      return { ok: false, code: 'RESULT_UNKNOWN', message: '结果未知' };
    if (request.operation === 'query_capture')
      return { ok: true, state: 'pending', phase: 'reserved' };
    if (request.operation === 'cancel_capture')
      return { ok: true, state: 'cancelled', phase: 'cancelled' };
    return { ok: true, state: 'listed', pending: [], saved: [] };
  });
  host(folder);
  const view = renderHook(() => useLocalFolder(true));
  await waitFor(() =>
    expect(view.result.current.directories[root.root_entry_id]?.entries).toEqual([file]),
  );
  act(() => view.result.current.open(file));
  await waitFor(() => expect(view.result.current.pending).toHaveLength(1));
  const item = view.result.current.pending[0];
  act(() => view.result.current.query(item));
  await waitFor(() => expect(view.result.current.busy).toBe(false));
  act(() => view.result.current.cancel(item));
  await waitFor(() => expect(view.result.current.pending).toHaveLength(0));
  const calls = folder.mock.calls.map(
    ([request]) => request as { operation: string; request_id?: string },
  );
  expect(calls.filter((request) => request.operation === 'open_entry')).toHaveLength(1);
  expect(calls.find((request) => request.operation === 'query_capture')?.request_id).toBe(
    item.request_id,
  );
  expect(calls.find((request) => request.operation === 'cancel_capture')?.request_id).toBe(
    item.request_id,
  );
});

function revisionHost(options: { unknown?: boolean; paged?: boolean; project?: string } = {}) {
  const versions = new Map<string, number>();
  const identities = new Map<string, string>();
  const receipts = new Map<string, object>();
  const readers = new Map<string, ReturnType<typeof material>>();
  let sequence = 10;
  const id = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const nested = { ...file, entry_id: id(), display_name: '子目录', kind: 'directory' as const };
  const names = options.paged
    ? [
        'A.pdf',
        ...Array.from({ length: 30 }, (_, i) => `占位${i}.pdf`),
        '子目录',
        'B.pdf',
        ...Array.from({ length: 37 }, (_, i) => `后续${i}.pdf`),
      ]
    : ['A.pdf', 'B.pdf'];
  const cursors = new Map<string, { entries: (typeof file)[]; offset: number }>();
  function material(name: string) {
    return {
      id: id(),
      owner_kind: 'personal' as const,
      asset_version_id: id(),
      name,
      kind: 'pdf' as const,
      sha256: 'a'.repeat(64),
      bytes: 16,
      page_count: 1,
      derivation_id: id(),
      status: 'ready' as const,
      pages: [
        {
          page: 1,
          text: name,
          origin: 'pdf_text' as const,
          blocks: [],
          width: 1,
          height: 1,
          rotation: 0,
        },
      ],
    };
  }
  const fixed = new Map<string, ReturnType<typeof material>>();
  const folder = vi.fn(
    async (request: {
      operation: string;
      entry_id?: string;
      mapping_revision?: number;
      request_id?: string;
      cursor?: string;
      saved_handle?: string;
    }) => {
      if (request.operation === 'restore_default') return { ok: true, state: 'ready', root };
      if (request.operation === 'list_directory') {
        if (request.entry_id !== root.root_entry_id)
          return { ok: true, state: 'listed', entries: [], next_cursor: null };
        let page = request.cursor ? cursors.get(request.cursor) : undefined;
        if (request.cursor && !page)
          return { ok: false, code: 'CURSOR_EXPIRED', message: '游标已失效' };
        if (!page) {
          const entries = names.map((name) => {
            const entry_id = id();
            identities.set(entry_id, name);
            return {
              ...file,
              entry_id,
              display_name: name,
              kind: name === '子目录' ? ('directory' as const) : ('file' as const),
            };
          });
          page = { entries: entries as (typeof file)[], offset: 0 };
        }
        if (request.cursor) cursors.delete(request.cursor);
        const entries = page.entries
          .slice(page.offset, page.offset + 32)
          .map((entry) => ({ ...entry, mapping_revision: versions.get(entry.display_name) ?? 0 }));
        page.offset += entries.length;
        const next_cursor = page.offset < page.entries.length ? id() : null;
        if (next_cursor) cursors.set(next_cursor, page);
        return { ok: true, state: 'listed', entries, next_cursor };
      }
      if (request.operation === 'open_entry') {
        const name = identities.get(request.entry_id!)!;
        if (request.mapping_revision !== (versions.get(name) ?? 0))
          return { ok: false, code: 'REVISION_CONFLICT', message: '映射版本冲突' };
        let source = fixed.get(name);
        if (!source) {
          source = material(name);
          fixed.set(name, source);
          versions.set(name, (versions.get(name) ?? 0) + 1);
        }
        const handle = id();
        readers.set(handle, source);
        const result = {
          ok: true,
          state: 'ready',
          phase: 'ready',
          request_id: request.request_id,
          source,
          saved_handle: handle,
        };
        receipts.set(request.request_id!, result);
        if (options.unknown && receipts.size === 1)
          return { ok: false, code: 'RESULT_UNKNOWN', message: '未知回执' };
        return result;
      }
      if (request.operation === 'query_capture' || request.operation === 'resume_capture')
        return receipts.get(request.request_id!)!;
      if (request.operation === 'read_saved')
        return {
          ok: true,
          state: 'ready',
          source: readers.get(request.saved_handle!),
          data: new Uint8Array([1]),
        };
      return { ok: true, state: 'listed', pending: [], saved: [] };
    },
  );
  host(folder);
  const view = renderHook(({ project }) => useLocalFolder(true, project), {
    initialProps: { project: options.project },
  });
  const choose = (name: string) =>
    view.result.current.directories[root.root_entry_id].entries.find(
      (entry) => entry.display_name === name,
    )!;
  const open = async (name: string) => {
    act(() => view.result.current.open(choose(name)));
    await waitFor(() => expect(view.result.current.busy).toBe(false));
  };
  return { view, folder, open, choose, nested };
}
it('同一棵未手动刷新目录先开A再开B再回A，使用服务器实际映射修订', async () => {
  const s = revisionHost();
  await waitFor(() =>
    expect(s.view.result.current.directories[root.root_entry_id]?.entries).toHaveLength(2),
  );
  await s.open('A.pdf');
  await s.open('B.pdf');
  await s.open('A.pdf');
  expect(s.view.result.current.opened?.source.name).toBe('A.pdf');
  expect(s.view.result.current.message).not.toContain('版本冲突');
  const calls = s.folder.mock.calls.map(([r]) => r).filter((r) => r.operation === 'open_entry');
  expect(calls.map((r) => r.mapping_revision)).toEqual([0, 0, 1]);
  expect(s.folder.mock.calls.filter(([r]) => r.operation === 'restore_default')).toHaveLength(1);
});
it('未知回执核对ready后再打开同一文件，更新缓存且不重发原捕获', async () => {
  const s = revisionHost({ unknown: true });
  await waitFor(() =>
    expect(s.view.result.current.directories[root.root_entry_id]?.entries).toHaveLength(2),
  );
  await s.open('A.pdf');
  const pending = s.view.result.current.pending[0];
  expect(pending).toBeTruthy();
  act(() => s.view.result.current.query(pending));
  await waitFor(() => expect(s.view.result.current.opened?.source.name).toBe('A.pdf'));
  await waitFor(() => expect(s.view.result.current.busy).toBe(false));
  await s.open('B.pdf');
  await s.open('A.pdf');
  expect(s.view.result.current.opened?.source.name).toBe('A.pdf');
  expect(s.view.result.current.message).not.toContain('版本冲突');
  const writes = s.folder.mock.calls.map(([r]) => r).filter((r) => r.operation === 'open_entry');
  expect(writes).toHaveLength(3);
  expect(writes[2].mapping_revision).toBe(1);
  expect(s.folder.mock.calls.find(([r]) => r.operation === 'query_capture')?.[0].request_id).toBe(
    writes[0].request_id,
  );
});
it('定向修订更新保留已加载分页、文件能力和子目录展开', async () => {
  const s = revisionHost({ paged: true });
  await waitFor(() =>
    expect(s.view.result.current.directories[root.root_entry_id]?.entries).toHaveLength(32),
  );
  act(() => s.view.result.current.more(root.root_entry_id));
  await waitFor(() =>
    expect(s.view.result.current.directories[root.root_entry_id]?.entries).toHaveLength(64),
  );
  const child = s.choose('子目录');
  act(() => s.view.result.current.toggle(child.entry_id));
  await waitFor(() =>
    expect(s.view.result.current.directories[child.entry_id]?.entries).toEqual([]),
  );
  const a = s.choose('A.pdf').entry_id,
    b = s.choose('B.pdf').entry_id;
  await s.open('A.pdf');
  await s.open('B.pdf');
  await s.open('A.pdf');
  expect(s.view.result.current.opened?.source.name).toBe('A.pdf');
  expect(s.choose('A.pdf').entry_id).toBe(a);
  expect(s.choose('B.pdf').entry_id).toBe(b);
  expect(s.view.result.current.expanded).toContain(child.entry_id);
  expect(s.view.result.current.directories[root.root_entry_id].entries).toHaveLength(64);
  act(() => s.view.result.current.more(root.root_entry_id));
  await waitFor(() =>
    expect(s.view.result.current.directories[root.root_entry_id]?.entries).toHaveLength(70),
  );
});

it('恢复原捕获ready后重新打开使用权威修订，不新建原请求', async () => {
  const s = revisionHost({ unknown: true });
  await waitFor(() =>
    expect(s.view.result.current.directories[root.root_entry_id]?.entries).toHaveLength(2),
  );
  await s.open('A.pdf');
  const pending = s.view.result.current.pending[0];
  act(() => s.view.result.current.resume({ ...pending, phase: 'placed' }));
  await waitFor(() => expect(s.view.result.current.opened?.source.name).toBe('A.pdf'));
  await waitFor(() => expect(s.view.result.current.busy).toBe(false));
  await s.open('B.pdf');
  await s.open('A.pdf');
  expect(s.view.result.current.opened?.source.name).toBe('A.pdf');
  expect(
    s.folder.mock.calls
      .filter(([r]) => r.operation === 'resume_capture')
      .map(([r]) => r.request_id),
  ).toEqual([pending.request_id]);
  expect(s.folder.mock.calls.filter(([r]) => r.operation === 'open_entry')).toHaveLength(3);
});
it('capture后的迟到目录修订不能覆盖切换后的项目树', async () => {
  const s = revisionHost({ project: '00000000-0000-4000-8000-000000000100' });
  const original = s.folder.getMockImplementation()!;
  let listCalls = 0;
  let release!: (value: Awaited<ReturnType<typeof original>>) => void;
  const delayed = new Promise<Awaited<ReturnType<typeof original>>>((resolve) => {
    release = resolve;
  });
  s.folder.mockImplementation(async (request) => {
    if (request.operation === 'list_directory' && ++listCalls === 2) return delayed;
    return original(request);
  });
  await waitFor(() =>
    expect(s.view.result.current.directories[root.root_entry_id]?.entries).toHaveLength(2),
  );
  const oldEntries = s.view.result.current.directories[root.root_entry_id].entries;
  act(() => s.view.result.current.open(s.choose('A.pdf')));
  await waitFor(() => expect(listCalls).toBe(2));
  s.view.rerender({ project: '00000000-0000-4000-8000-000000000200' });
  await waitFor(() =>
    expect(s.view.result.current.directories[root.root_entry_id]?.entries[0].mapping_revision).toBe(
      1,
    ),
  );
  await act(async () => {
    release({
      ok: true,
      state: 'listed',
      entries: oldEntries.map((entry) => ({ ...entry, mapping_revision: 99 })),
      next_cursor: null,
    });
  });
  expect(s.view.result.current.directories[root.root_entry_id].entries[0].mapping_revision).toBe(1);
  expect(s.view.result.current.opened).toBeUndefined();
});
