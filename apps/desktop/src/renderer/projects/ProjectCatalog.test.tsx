// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CatalogRequest, CatalogResponse, Matter, Task } from '../../preload/caselite-api';
import ProjectCatalog from './ProjectCatalog';
vi.mock('../editors/RichEditor', () => ({
  emptyDraft: () => ({ text: '', state: null }),
  DraftEditor: ({
    value,
    onChange,
    label,
    disabled,
  }: {
    value: { text: string };
    onChange(v: { text: string; state: number[] | null }): void;
    label: string;
    disabled: boolean;
  }) => (
    <textarea
      aria-label={label}
      value={value.text}
      disabled={disabled}
      onChange={(e) => onChange({ text: e.target.value, state: [1, e.target.value.length] })}
    />
  ),
}));
beforeAll(() => {
  // jsdom不实现原生模态窗口；焦点圈定和Escape另在真实Electron走查。
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const project = (id = '11111111-1111-4111-8111-111111111111', title = 'A'): Matter => ({
  id,
  title,
  status: 'planned',
  version: 1,
  archived_at: null,
  body_id: crypto.randomUUID(),
  body_revision: 0,
  editor_schema: 1,
  updated_at: '2026-11-05',
  task_count: 0,
});
const response = (
  projects: Matter[],
  target: string | null = null,
): Extract<CatalogResponse, { ok: true }> => ({
  ok: true,
  projects,
  documents: [],
  state: null,
  target_id: target,
  receipt: null,
});
function show() {
  const changed = vi.fn();
  render(<ProjectCatalog tasks={[]} onOpen={vi.fn()} onDirty={vi.fn()} onChanged={changed} />);
  return changed;
}
describe('durable project UI receipts and target identity', () => {
  it('filters and sorts committed projects without mutations, then opens the filtered identity', async () => {
    const a = project(undefined, '甲项目');
    const b = {
      ...project('22222222-2222-4222-8222-222222222222', '乙项目'),
      status: 'active' as const,
      updated_at: '2026-11-06',
    };
    const requests: CatalogRequest[] = [];
    window.caselite = {
      catalog: vi.fn(async (r: CatalogRequest) => {
        requests.push(r);
        return response([a, b]);
      }),
    } as unknown as Window['caselite'];
    show();
    const table = await screen.findByRole('table', { name: '项目列表' });
    await within(table).findByRole('button', { name: '乙项目' });
    expect(within(table).getAllByRole('row')[1].textContent).toContain('乙项目');
    fireEvent.change(screen.getByLabelText('项目排序'), { target: { value: 'status' } });
    expect(within(table).getAllByRole('row')[1].textContent).toContain('甲项目');
    fireEvent.change(screen.getByLabelText('筛选项目状态'), { target: { value: 'active' } });
    expect(within(table).queryByRole('button', { name: '甲项目' })).toBeNull();
    fireEvent.change(screen.getByLabelText('搜索项目'), { target: { value: '  不存在  ' } });
    await screen.findByText('没有匹配的项目。');
    fireEvent.click(screen.getByText('清除筛选'));
    expect(within(table).getAllByRole('button')).toHaveLength(2);
    const display = screen.getByText('显示').closest('summary')!;
    fireEvent.click(display);
    expect(display.parentElement!.hasAttribute('open')).toBe(true);
    const tasksColumn = screen.getByRole('checkbox', { name: '任务', exact: true });
    fireEvent.click(tasksColumn);
    expect(within(table).queryByRole('columnheader', { name: '任务' })).toBeNull();
    fireEvent.keyDown(tasksColumn, { key: 'Escape' });
    expect(display.parentElement!.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(display);
    fireEvent.change(screen.getByLabelText('搜索项目'), { target: { value: '乙' } });
    fireEvent.click(within(table).getByRole('button', { name: '乙项目' }));
    await waitFor(() =>
      expect(requests.some((r) => r.operation === 'read_project' && r.id === b.id)).toBe(true),
    );
    expect(requests.every((r) => r.operation === 'list' || r.operation === 'read_project')).toBe(
      true,
    );
  });
  it('keeps one project across tabs, exposes unavailable sections and protects an unsaved overview', async () => {
    const p = project();
    const original = { id: crypto.randomUUID(), title: '项目原任务', matter_id: p.id } as Task;
    const open = vi.fn();
    const catalog = vi.fn(async (request: CatalogRequest) =>
      request.operation === 'list_activity'
        ? { ...response([p], p.id), activity: [], activity_has_more: false }
        : request.operation === 'list_discussion'
          ? { ...response([], null), discussion: { entries: [], next: null } }
          : response([p], p.id),
    );
    window.caselite = { catalog } as unknown as Window['caselite'];
    render(
      <ProjectCatalog tasks={[original]} onOpen={open} onDirty={vi.fn()} onChanged={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'A', exact: true }));
    await screen.findByText('暂无项目评论。');
    fireEvent.click(screen.getByRole('tab', { name: '任务', exact: true }));
    fireEvent.click(
      within(screen.getByRole('tabpanel', { name: '任务', exact: true })).getByText('项目原任务'),
    );
    expect(open).toHaveBeenCalledWith(
      original.id,
      expect.objectContaining({ projectId: p.id, section: 'tasks', returnTaskId: original.id }),
    );
    for (const label of ['文件', '交付物', '活动']) {
      fireEvent.click(screen.getByRole('tab', { name: label, exact: true }));
      const panel = screen.getByRole('tabpanel', { name: label, exact: true });
      if (label === '文件') expect(within(panel).getByLabelText('搜索项目文件')).toBeTruthy();
      else if (label === '活动') {
        expect(within(panel).getByLabelText('真实业务活动')).toBeTruthy();
        await within(panel).findByText('暂无项目更新。');
      } else expect(panel.textContent).toContain('尚未接入');
    }
    fireEvent.click(screen.getByRole('tab', { name: '概述', exact: true }));
    expect(document.querySelector('.catalog-actions')?.getAttribute('data-project-id')).toBe(p.id);
    fireEvent.change(screen.getByLabelText('编辑项目名称'), { target: { value: '未保存更正' } });
    expect(
      (screen.getByRole('tab', { name: '文件', exact: true }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: '文件', exact: true }));
    expect(screen.getByRole('tabpanel', { name: '概述', exact: true })).toBeTruthy();
    await screen.findByText('暂无项目评论。');
    const requests = catalog.mock.calls.map(([request]) => request);
    expect(
      requests.filter((r) => r.operation !== 'list_discussion').map((r) => r.operation),
    ).toEqual(['list', 'read_project', 'list_activity', 'list_activity', 'list_activity']);
    expect(requests.filter((r) => r.operation === 'list_discussion').map((r) => r.scope)).toEqual([
      { kind: 'project_comment', project_id: p.id },
      { kind: 'update', project_id: p.id },
      { kind: 'project_comment', project_id: p.id },
    ]);
  });
  it('opens the exact saved project, including when creating from the archive view', async () => {
    const p = project(undefined, '中文项目');
    const requests: CatalogRequest[] = [];
    let rows: Matter[] = [];
    window.caselite = {
      catalog: vi.fn(async (r: CatalogRequest) => {
        requests.push(r);
        if (r.operation === 'create_project') rows = [p];
        return response(rows, p.id);
      }),
    } as unknown as Window['caselite'];
    show();
    await screen.findByText('暂无项目，独立任务仍可直接使用。');
    fireEvent.change(screen.getByLabelText('筛选项目状态'), { target: { value: 'archived' } });
    fireEvent.click(screen.getByText('创建项目'));
    const name = screen.getByLabelText('项目名称');
    expect(document.activeElement).toBe(name);
    expect((screen.getByText('保存项目') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(name, { target: { value: ' 中文项目 ' } });
    fireEvent.click(screen.getByText('保存项目'));
    await waitFor(() =>
      expect((screen.getByLabelText('编辑项目名称') as HTMLInputElement).value).toBe('中文项目'),
    );
    expect(requests.filter((r) => r.operation === 'create_project')).toHaveLength(1);
    expect(requests.find((r) => r.operation === 'create_project')).toMatchObject({
      title: '中文项目',
    });
    expect(requests.find((r) => r.operation === 'read_project')).toMatchObject({ id: p.id });
    fireEvent.click(screen.getByText('返回项目列表'));
    expect(screen.getByRole('button', { name: '中文项目' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '中文项目' }));
    await screen.findByLabelText('编辑项目名称');
  });
  it('keeps input after a rejected write and never submits an IME confirmation', async () => {
    const sent: CatalogRequest[] = [];
    window.caselite = {
      catalog: vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> => {
        if (r.operation === 'status')
          return { ok: false, code: 'NOT_FOUND', message: '原键未落盘' };
        if (r.operation === 'create_project') {
          sent.push(r);
          return { ok: false, code: 'INVALID_REQUEST', message: '未保存，请修改后重试。' };
        }
        return response([]);
      }),
    } as unknown as Window['caselite'];
    show();
    await screen.findByText('暂无项目，独立任务仍可直接使用。');
    fireEvent.click(screen.getByText('创建项目'));
    const name = screen.getByLabelText('项目名称');
    fireEvent.change(name, { target: { value: '验收项目' } });
    fireEvent.compositionStart(name);
    fireEvent.submit(name.closest('form')!);
    expect(sent).toHaveLength(0);
    fireEvent.compositionEnd(name);
    fireEvent.click(screen.getByText('保存项目'));
    await screen.findByRole('alert');
    expect((name as HTMLInputElement).value).toBe('验收项目');
    expect(screen.getByRole('dialog', { name: '新建项目' })).toBeTruthy();
    expect(screen.queryByLabelText('编辑项目名称')).toBeNull();
  });
  it('requires discarding a named draft and restores focus without creating a project', async () => {
    const catalog = vi.fn(async () => response([]));
    window.caselite = { catalog } as unknown as Window['caselite'];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    show();
    await screen.findByText('暂无项目，独立任务仍可直接使用。');
    const trigger = screen.getByText('创建项目');
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '未提交项目' } });
    fireEvent.click(screen.getByText('取消'));
    expect(screen.getByLabelText('项目名称')).toBeTruthy();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(catalog.mock.calls).toHaveLength(1);
  });
  it('retries opening a saved ID after a read failure without creating a second project', async () => {
    const p = project();
    let reads = 0;
    const creates: CatalogRequest[] = [];
    window.caselite = {
      catalog: vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> => {
        if (r.operation === 'create_project') creates.push(r);
        if (r.operation === 'read_project' && ++reads === 1)
          return { ok: false, code: 'UNAVAILABLE', message: '读取暂不可用' };
        return response(creates.length ? [p] : [], p.id);
      }),
    } as unknown as Window['caselite'];
    show();
    await screen.findByText('暂无项目，独立任务仍可直接使用。');
    fireEvent.click(screen.getByText('创建项目'));
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: 'A' } });
    fireEvent.click(screen.getByText('保存项目'));
    fireEvent.click(await screen.findByText('重新打开已创建项目'));
    await screen.findByLabelText('编辑项目名称');
    expect(creates).toHaveLength(1);
    expect(reads).toBe(2);
  });
  it('reconciles unknown create with the same identity and closes the create form once', async () => {
    const p = project();
    let rows: Matter[] = [];
    const sent: CatalogRequest[] = [];
    const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> => {
      if (r.operation === 'status') return { ok: false, code: 'NOT_FOUND', message: '原键未落盘' };
      if (r.operation === 'create_project') {
        sent.push(r);
        rows = [p];
        if (sent.length === 1) return { ok: false, code: 'RESULT_UNKNOWN', message: '结果未知' };
        return response(rows, p.id);
      }
      return response(rows);
    });
    window.caselite = { catalog } as unknown as Window['caselite'];
    const changed = show();
    await screen.findByText('暂无项目，独立任务仍可直接使用。');
    fireEvent.click(screen.getByText('创建项目'));
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: 'A' } });
    fireEvent.click(screen.getByText('保存项目'));
    await screen.findByText('核对原提交');
    expect((screen.getByText('保存项目') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('核对原提交'));
    await waitFor(() => expect(screen.queryByLabelText('项目名称')).toBeNull());
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('保存项目')).toBeNull();
  });
  it('reloads the edited version after an unknown update instead of reusing the stale editor', async () => {
    let p = project();
    const writes: Extract<CatalogRequest, { operation: 'update_project' }>[] = [];
    const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> => {
      if (r.operation === 'status') return { ok: false, code: 'NOT_FOUND', message: '原键未落盘' };
      if (r.operation === 'update_project') {
        writes.push(r);
        if (writes.length === 1) return { ok: false, code: 'RESULT_UNKNOWN', message: '结果未知' };
        p = { ...p, title: r.title, version: p.version + 1 };
      }
      return response([p], p.id);
    });
    window.caselite = { catalog } as unknown as Window['caselite'];
    show();
    const name = await screen.findByLabelText('侧栏项目名称');
    fireEvent.change(name, { target: { value: 'B' } });
    fireEvent.blur(name);
    fireEvent.click(await screen.findByText('核对原属性提交'));
    await screen.findByRole('button', { name: 'B', exact: true });
    expect(writes[0]).toEqual(writes[1]);
    fireEvent.change(name, { target: { value: 'C' } });
    fireEvent.blur(name);
    await waitFor(() => expect(writes.map((r) => r.expected_version)).toEqual([1, 1, 2]));
  });
  it('drops a delayed initial list after a newer post-commit list has arrived', async () => {
    let resolveOld: (r: CatalogResponse) => void = () => {};
    const old = new Promise<CatalogResponse>((r) => {
      resolveOld = r;
    });
    let reads = 0;
    const p = project();
    const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> =>
      r.operation === 'list' && ++reads === 1 ? old : response([p], p.id),
    );
    window.caselite = { catalog } as unknown as Window['caselite'];
    show();
    await waitFor(() => expect(reads).toBe(1));
    fireEvent.click(screen.getByText('创建项目'));
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: 'A' } });
    fireEvent.click(screen.getByText('保存项目'));
    await screen.findByText('返回项目列表');
    await act(async () => {
      resolveOld(response([]));
      await old;
    });
    expect(screen.queryByText('暂无项目，独立任务仍可直接使用。')).toBeNull();
    expect(screen.getByText('返回项目列表')).toBeTruthy();
  });
  it('closes the archived editor and keeps properties on the visible target', async () => {
    let p = { ...project(), status: 'active' as const, archived_at: null as string | null };
    const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> => {
      if (r.operation === 'archive_project')
        p = { ...p, archived_at: r.archived ? '2026-11-05' : null, version: p.version + 1 };
      return response([p], 'id' in r ? r.id : null);
    });
    window.caselite = { catalog } as unknown as Window['caselite'];
    show();
    // 归档后关闭编辑能力，同一项目保留只读属性与恢复入口。
    const status = (await screen.findByLabelText('项目状态')) as HTMLSelectElement;
    fireEvent.change(status, { target: { value: 'archived' } });
    await waitFor(() => expect(status.value).toBe('archived'));
    expect((screen.getByLabelText('筛选项目状态') as HTMLSelectElement).value).toBe('archived');
    expect((screen.getByLabelText('侧栏项目名称') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(status, { target: { value: 'restore' } });
    await waitFor(() => expect(status.value).toBe('active'));
    expect(
      catalog.mock.calls.filter(([r]) => r.operation === 'archive_project').map(([r]) => r),
    ).toMatchObject([
      { archived: true, expected_version: 1 },
      { archived: false, expected_version: 2 },
    ]);
  });
  it('discards unsaved input when reloading the same stored version', async () => {
    const p = project();
    window.caselite = {
      catalog: vi.fn(async () => response([p], p.id)),
    } as unknown as Window['caselite'];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    show();
    await screen.findByRole('button', { name: 'A', exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'A', exact: true }));
    await screen.findByLabelText('编辑项目名称');
    fireEvent.change(screen.getByLabelText('项目概述'), { target: { value: '未保存B' } });
    fireEvent.click(screen.getByText('放弃修改并重读'));
    await waitFor(() =>
      expect((screen.getByLabelText('编辑项目名称') as HTMLInputElement).value).toBe('A'),
    );
    expect((screen.getByText('返回项目列表') as HTMLButtonElement).disabled).toBe(false);
    vi.restoreAllMocks();
  });
});

it.each(['编辑项目名称', '项目概述'])(
  'preserves a new %s draft when an activity project target resolves late',
  async (label) => {
    const p = project();
    let finish!: (r: CatalogResponse) => void;
    const event = {
      id: 'event',
      origin: 'catalog' as const,
      operation: 'update_project',
      target_id: p.id,
      target_type: 'project' as const,
      committed_at: '2026-11-07T00:00:00Z',
      actor: null,
      recorded_version: null,
    };
    const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> =>
      r.operation === 'activity_target'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : r.operation === 'list_activity'
          ? { ...response([p]), activity: [event], activity_has_more: false }
          : response([p], p.id),
    );
    window.caselite = {
      catalog,
      material: vi.fn(async () => ({ ok: true, materials: [] })),
    } as unknown as Window['caselite'];
    render(<ProjectCatalog tasks={[]} onOpen={vi.fn()} onDirty={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'A', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: /打开当前项目/ }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText(label), { target: { value: '未保存草稿' } });
    const before = catalog.mock.calls.filter(([r]) => r.operation === 'read_project').length;
    await act(async () =>
      finish({
        ...response([p]),
        activity_target: { type: 'project', id: p.id, current_version: 1 },
      }),
    );
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('未保存草稿');
    expect(catalog.mock.calls.filter(([r]) => r.operation === 'read_project')).toHaveLength(before);
    expect(
      screen.getByText(
        label === '项目概述' ? '有未保存的说明修改，请保存后切换。' : '项目属性等待保存，请稍候。',
      ),
    ).toBeTruthy();
  },
);

it('edits list properties without opening detail and keeps drafts during filtering, composition and unknown reconciliation', async () => {
  let p = {
    ...project(),
    body_revision: 1,
    attributes: {
      project_type: 'general' as const,
      assignee: null as string | null,
      priority: 0,
      start_date: '2024-02-29',
      target_date: null,
      tags: [] as string[],
    },
  };
  const writes: Extract<CatalogRequest, { operation: 'update_project' }>[] = [];
  const calls: CatalogRequest[] = [];
  window.caselite = {
    catalog: vi.fn(async (r: CatalogRequest) => {
      calls.push(r);
      if (r.operation === 'update_project') {
        writes.push(r);
        p = {
          ...p,
          title: r.title,
          version: p.version + 1,
          attributes: r.attributes! as typeof p.attributes,
        };
        return { ok: false, code: 'RESULT_UNKNOWN', message: '结果未知' };
      }
      return { ...response([p], p.id), receipt: writes[0]?.idempotency_key ?? null };
    }),
  } as unknown as Window['caselite'];
  show();
  await screen.findByLabelText('侧栏项目名称');
  fireEvent.change(screen.getByLabelText('项目负责人'), { target: { value: '合成负责人' } });
  for (const name of ['搜索项目', '筛选项目状态', '项目排序'])
    expect((screen.getByLabelText(name) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('tab', { name: 'AI 助手' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('tab', { name: 'AI 助手' }));
  expect((screen.getByLabelText('项目负责人') as HTMLInputElement).value).toBe('合成负责人');
  expect(screen.queryByText('返回项目列表')).toBeNull();
  const name = screen.getByLabelText('项目负责人');
  fireEvent.compositionStart(name);
  fireEvent.keyDown(name, { key: 'Enter', isComposing: true });
  fireEvent.submit(name.closest('form')!);
  expect(writes).toHaveLength(0);
  fireEvent.compositionEnd(name);
  await screen.findByText('核对原属性提交');
  expect((screen.getByRole('tab', { name: 'AI 助手' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('tab', { name: 'AI 助手' }));
  fireEvent.click(await screen.findByText('核对原属性提交'));
  await waitFor(() =>
    expect((screen.getByLabelText('侧栏项目名称') as HTMLInputElement).disabled).toBe(false),
  );
  expect(writes).toHaveLength(1);
  expect(writes[0].attributes?.start_date).toBe('2024-02-29');
  expect(writes[0].state).toBeUndefined();
  expect(writes[0].expected_body_revision).toBe(1);
  expect(
    calls.some((r) => r.operation === 'status' && r.idempotency_key === writes[0].idempotency_key),
  ).toBe(true);
  expect(screen.queryByText('返回项目列表')).toBeNull();
  expect((screen.getByLabelText('项目负责人') as HTMLInputElement).value).toBe('合成负责人');
});

it('keeps one property draft across tabs and omits untouched saved Yjs from a detail property update', async () => {
  let p = { ...project(), body_revision: 1 };
  const writes: CatalogRequest[] = [];
  window.caselite = {
    catalog: vi.fn(async (r: CatalogRequest) => {
      if (r.operation === 'update_project') {
        writes.push(r);
        p = { ...p, version: 2 };
      }
      return { ...response([p], p.id), state: [1, 2] };
    }),
  } as unknown as Window['caselite'];
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'A', exact: true }));
  await screen.findByLabelText('编辑项目名称');
  for (const tab of ['任务', '文件', '活动']) {
    fireEvent.click(screen.getByRole('tab', { name: tab, exact: true }));
    expect((screen.getByLabelText('项目负责人') as HTMLInputElement).disabled).toBe(false);
  }
  fireEvent.change(screen.getByLabelText('项目优先级'), { target: { value: '3' } });
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).not.toHaveProperty('state');
  expect(writes[0]).toMatchObject({ expected_body_revision: 1, attributes: { priority: 3 } });
});

it('separates a confirmed property save from a failed list refresh and recovers by reading only', async () => {
  let p = project(),
    fail = false;
  let writes = 0;
  window.caselite = {
    catalog: vi.fn(async (r: CatalogRequest) => {
      if (r.operation === 'update_project') {
        writes++;
        p = { ...p, title: r.title, version: 2 };
        fail = true;
        return response([p], p.id);
      }
      if (r.operation === 'list' && fail) throw new Error('synthetic read failure');
      return response([p], p.id);
    }),
  } as unknown as Window['caselite'];
  show();
  await screen.findByLabelText('侧栏项目名称');
  fireEvent.change(screen.getByLabelText('侧栏项目名称'), { target: { value: '保存后的名称' } });
  await screen.findByText('重新读取项目列表');
  expect(screen.queryByText('核对原属性提交')).toBeNull();
  expect((screen.getByLabelText('侧栏项目名称') as HTMLInputElement).value).toBe('保存后的名称');
  fail = false;
  fireEvent.click(screen.getByText('重新读取项目列表'));
  await waitFor(() => expect(screen.queryByText('重新读取项目列表')).toBeNull());
  expect(writes).toBe(1);
});

it('discards incomplete date validation together with its property draft', async () => {
  window.caselite = {
    catalog: vi.fn(async () => response([project()])),
  } as unknown as Window['caselite'];
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  show();
  await screen.findByLabelText('侧栏项目名称');
  const target = screen.getByLabelText('项目目标日') as HTMLInputElement;
  fireEvent.change(target, { target: { value: '2024-02-29' } });
  const validity = vi
    .spyOn(target, 'validity', 'get')
    .mockReturnValue({ valid: false, badInput: true } as ValidityState);
  fireEvent.change(target, { target: { value: '' } });
  validity.mockRestore();
  expect(screen.getByRole('alert').textContent).toContain('输入已保留');
  fireEvent.click(screen.getByText('放弃属性修改并重读'));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect((screen.getByLabelText('项目目标日') as HTMLInputElement).value).toBe('');
});

it('serializes edits during a late receipt without reloading or saving the open description', async () => {
  let p = { ...project(), body_revision: 1 };
  const writes: Extract<CatalogRequest, { operation: 'update_project' }>[] = [];
  let release!: () => void;
  const catalog = vi.fn(async (r: CatalogRequest) => {
    if (r.operation === 'update_project') {
      writes.push(r);
      if (writes.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      p = {
        ...p,
        title: r.title,
        status: r.status,
        attributes: r.attributes ?? p.attributes,
        version: p.version + 1,
        body_revision: p.body_revision + Number(Boolean(r.state)),
      };
    }
    return response([p], p.id);
  });
  window.caselite = { catalog } as unknown as Window['caselite'];
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'A', exact: true }));
  const name = await screen.findByLabelText('编辑项目名称');
  const body = screen.getByLabelText('项目概述');
  fireEvent.change(body, { target: { value: '说明草稿' } });
  fireEvent.change(name, { target: { value: 'B' } });
  fireEvent.blur(name);
  await waitFor(() => expect(writes).toHaveLength(1));
  fireEvent.change(name, { target: { value: 'C' } });
  fireEvent.blur(name);
  await act(async () => release());
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes).toMatchObject([
    { title: 'B', expected_version: 1, expected_body_revision: 1 },
    { title: 'C', expected_version: 2, expected_body_revision: 1 },
  ]);
  expect(writes.every((r) => r.state === undefined)).toBe(true);
  expect(screen.getByLabelText('项目概述')).toBe(body);
  expect((body as HTMLTextAreaElement).value).toBe('说明草稿');
  expect(screen.queryByText('保存项目属性')).toBeNull();
  expect(screen.queryByText('打开项目')).toBeNull();
  expect(document.querySelector('.project-properties')?.textContent).not.toContain('归入已有任务');
  const save = screen.getByText('保存项目概述') as HTMLButtonElement;
  await waitFor(() => expect(save.disabled).toBe(false));
  fireEvent.click(save);
  await waitFor(() => expect(writes).toHaveLength(3));
  expect(writes[2]).toMatchObject({
    title: 'C',
    expected_version: 3,
    expected_body_revision: 1,
    state: [1, 4],
  });
  expect(writes[2].attributes).toBeUndefined();
  expect(catalog.mock.calls.filter(([r]) => r.operation === 'read_project')).toHaveLength(1);
});

it('coalesces composing text and holds a conflicting draft until an explicit reread', async () => {
  let p = project();
  const updates = vi.fn();
  window.caselite = {
    catalog: vi.fn(async (r: CatalogRequest) => {
      if (r.operation === 'update_project') {
        updates(r);
        p = { ...p, title: '外部新名称', version: 2 };
        return { ok: false, code: 'CONFLICT', message: '项目已有更新，请重新读取。' };
      }
      return response([p], p.id);
    }),
  } as unknown as Window['caselite'];
  show();
  const name = await screen.findByLabelText('侧栏项目名称');
  fireEvent.compositionStart(name);
  fireEvent.change(name, { target: { value: 'han' } });
  fireEvent.blur(name);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 380)));
  expect(updates).not.toHaveBeenCalled();
  fireEvent.change(name, { target: { value: '汉' } });
  fireEvent.compositionEnd(name);
  fireEvent.change(name, { target: { value: '汉字' } });
  fireEvent.blur(name);
  await screen.findByText(/项目属性保存未确认/);
  expect(updates).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: '汉字', expected_version: 1 }),
  );
  expect((name as HTMLInputElement).value).toBe('汉字');
  expect(screen.queryByText('重试保存属性')).toBeNull();
  fireEvent.click(screen.getByText('放弃属性修改并重读'));
  await waitFor(() =>
    expect((screen.getByLabelText('侧栏项目名称') as HTMLInputElement).value).toBe('外部新名称'),
  );
  expect(updates).toHaveBeenCalledTimes(1);
});

it('keeps detail properties read-only after confirmed update when read_project fails, then only re-reads', async () => {
  let p = project();
  let rejectRead = false;
  const writes = vi.fn();
  window.caselite = {
    catalog: vi.fn(async (r: CatalogRequest) => {
      if (r.operation === 'update_project') {
        writes(r);
        p = { ...p, title: r.title, version: 2 };
      }
      if (r.operation === 'read_project' && rejectRead) throw new Error('synthetic read failure');
      return response([p], p.id);
    }),
  } as unknown as Window['caselite'];
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'A', exact: true }));
  const name = await screen.findByLabelText('编辑项目名称');
  fireEvent.change(name, { target: { value: '已确认名称' } });
  fireEvent.blur(name);
  await waitFor(() =>
    expect(document.querySelector('.project-detail-heading strong')?.textContent).toBe(
      '已确认名称',
    ),
  );
  rejectRead = true;
  fireEvent.click(screen.getByText('放弃修改并重读'));
  await screen.findByText('无法读取来源项目说明，请重试。');
  expect((name as HTMLInputElement).value).toBe('已确认名称');
  rejectRead = false;
  fireEvent.click(screen.getByText('放弃修改并重读'));
  await waitFor(() => expect(screen.queryByText('无法读取来源项目说明，请重试。')).toBeNull());
  expect(writes).toHaveBeenCalledTimes(1);
});

it('locks the description during its reread and during an unresolved archive', async () => {
  let p = project();
  let releaseRead!: (result: CatalogResponse) => void;
  let releaseArchive!: (result: CatalogResponse) => void;
  let reads = 0;
  const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> => {
    if (r.operation === 'read_project' && ++reads === 2)
      return new Promise((resolve) => {
        releaseRead = resolve;
      });
    if (r.operation === 'archive_project')
      return new Promise((resolve) => {
        releaseArchive = resolve;
      });
    return response([p], p.id);
  });
  window.caselite = { catalog } as unknown as Window['caselite'];
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'A', exact: true }));
  const editor = (await screen.findByLabelText('项目概述')) as HTMLTextAreaElement;
  fireEvent.click(screen.getByText('放弃修改并重读'));
  expect(editor.disabled).toBe(true);
  await act(async () => releaseRead(response([p], p.id)));
  const reloaded = screen.getByLabelText('项目概述') as HTMLTextAreaElement;
  expect(reloaded.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('项目状态'), { target: { value: 'archived' } });
  expect(reloaded.disabled).toBe(true);
  await waitFor(() => expect(releaseArchive).toBeTypeOf('function'));
  p = { ...p, archived_at: '2026-11-07', version: 2 };
  await act(async () => releaseArchive(response([p], p.id)));
  expect(reloaded.disabled).toBe(true);
  await waitFor(() =>
    expect((screen.getByLabelText('项目状态') as HTMLSelectElement).disabled).toBe(false),
  );
});

it('keeps an unknown description receipt owned by the description until original-key recovery', async () => {
  let p = project();
  let receipt: CatalogResponse;
  const writes: CatalogRequest[] = [];
  const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> => {
    if (r.operation === 'update_project') {
      writes.push(r);
      p = { ...p, version: 2, body_revision: 1 };
      receipt = response([p], p.id);
      return { ok: false, code: 'RESULT_UNKNOWN', message: '说明结果未知' };
    }
    if (r.operation === 'status') return receipt;
    return response([p], p.id);
  });
  window.caselite = { catalog } as unknown as Window['caselite'];
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'A', exact: true }));
  const editor = (await screen.findByLabelText('项目概述')) as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: '原说明' } });
  fireEvent.click(screen.getByText('保存项目概述'));
  const retry = await screen.findByText('核对原说明提交');
  expect(editor.disabled).toBe(true);
  expect((screen.getByLabelText('编辑项目名称') as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByText('核对原属性提交')).toBeNull();
  fireEvent.click(retry);
  await waitFor(() => expect(editor.disabled).toBe(false));
  expect(editor.value).toBe('原说明');
  expect(writes).toHaveLength(1);
  expect(catalog.mock.calls.map(([r]) => r)).toContainEqual({
    operation: 'status',
    protocol_version: 1,
    idempotency_key: (writes[0] as Extract<CatalogRequest, { operation: 'update_project' }>)
      .idempotency_key,
  });
});
