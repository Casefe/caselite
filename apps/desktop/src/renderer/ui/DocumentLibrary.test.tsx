// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import {
  invalidateOrdinaryCatalog,
  useProjectCatalog,
} from '../shared/data/ordinary-catalog-query';
import { createWorkbenchQueryClient } from '../shared/data/workbench-query-client';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CatalogDocument, CatalogRequest, CatalogResponse } from '../../preload/caselite-api';
import DocumentLibrary from './DocumentLibrary';

vi.mock('../features/documents/BodyEditor', () => ({
  default: ({
    task,
    disabled,
    onDirty,
  }: {
    task: { title: string };
    disabled: boolean;
    onDirty(v: boolean): void;
  }) => (
    <>
      <p data-testid="inline-body">{task.title}原位编辑</p>
      <input aria-label="模拟正文输入" disabled={disabled} onChange={() => onDirty(true)} />
    </>
  ),
}));
vi.mock('./AgentPanel', () => ({ default: () => null }));
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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

async function draft(text: string) {
  if (!screen.queryByRole('button', { name: '添加标签' }))
    fireEvent.click(await screen.findByRole('button', { name: entry.title, exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: '添加标签' }));
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: '新标签' });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '添加', exact: true }));
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
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '双栏预览' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '添加', exact: true }));
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
  fireEvent.click(await screen.findByRole('button', { name: entry.title, exact: true }));
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
  expect(await screen.findByRole('button', { name: entry.title, exact: true })).toBeTruthy();
  await act(async () => complete[0](projection({ ...entry, title: '过期目录' })));
  expect(screen.queryByRole('button', { name: '过期目录', exact: true })).toBeNull();
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
  fireEvent.click(screen.getByRole('button', { name: '合成甲', exact: true }));
  await waitFor(() => expect(finishA).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: '合成乙', exact: true }));
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
  await screen.findByRole('button', { name: '合同1', exact: true });
  expect(screen.queryByLabelText('搜索文档')).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getAllByRole('button', { name: /^合同\d+$/ })).toHaveLength(20);
  fireEvent.click(screen.getByText('个人资料', { selector: 'summary span' }));
  expect(screen.getAllByRole('button', { name: /^合同\d+$/ })).toHaveLength(25);
  fireEvent.click(screen.getByRole('button', { name: '合同25', exact: true }));
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
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: '合同1', exact: true }).disabled,
  ).toBe(true);
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
    fireEvent.click(await screen.findByRole('button', { name: '合成甲', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '双栏预览' }));
    fireEvent.click(screen.getByRole('button', { name: '副预览' }));
    fireEvent.click(screen.getByRole('button', { name: '合成乙', exact: true }));
    const primary = screen.getByRole('region', { name: '主预览' }),
      secondary = screen.getByRole('region', { name: '副预览' });
    expect(within(primary).getByText('合成甲')).toBeTruthy();
    expect(within(secondary).getByText('合成乙')).toBeTruthy();
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
    expect(within(secondary).getByText('合成乙')).toBeTruthy();
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
    fireEvent.click(await screen.findByRole('button', { name: entry.title, exact: true }));
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
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '双栏预览' }).disabled).toBe(true);
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
  fireEvent.click(await screen.findByRole('button', { name: a.title, exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '双栏预览' }));
  fireEvent.click(screen.getByRole('button', { name: '副预览' }));
  fireEvent.click(screen.getByRole('button', { name: a.title, exact: true }));
  expect(screen.queryByRole('button', { name: '已归档', exact: true })).toBeNull();
  archived = true;
  await act(async () => {
    await invalidateOrdinaryCatalog(client, true, true);
  });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: a.title, exact: true })).toBeNull(),
  );
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
  fireEvent.click(await screen.findByRole('button', { name: entry.title, exact: true }));
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
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '双栏预览' }).disabled).toBe(true);
  expect(refreshed.value).toBe('刷新完成后的新输入');
});
