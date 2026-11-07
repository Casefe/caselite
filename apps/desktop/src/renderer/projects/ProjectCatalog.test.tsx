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
    onChange(v: { text: string; state: null }): void;
    label: string;
    disabled: boolean;
  }) => (
    <textarea
      aria-label={label}
      value={value.text}
      disabled={disabled}
      onChange={(e) => onChange({ text: e.target.value, state: null })}
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
        : response([p], p.id),
    );
    window.caselite = { catalog } as unknown as Window['caselite'];
    render(
      <ProjectCatalog tasks={[original]} onOpen={open} onDirty={vi.fn()} onChanged={vi.fn()} />,
    );
    fireEvent.click(await screen.findByText('打开项目'));
    await screen.findByLabelText('编辑项目名称');
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
      else if (label === '活动') expect(within(panel).getByLabelText('真实业务活动')).toBeTruthy();
      else expect(panel.textContent).toContain('尚未接入');
    }
    fireEvent.click(screen.getByRole('tab', { name: '概述', exact: true }));
    expect(document.querySelector('.catalog-actions')?.getAttribute('data-project-id')).toBe(p.id);
    fireEvent.change(screen.getByLabelText('编辑项目名称'), { target: { value: '未保存更正' } });
    expect(
      (screen.getByRole('tab', { name: '文件', exact: true }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: '文件', exact: true }));
    expect(screen.getByRole('tabpanel', { name: '概述', exact: true })).toBeTruthy();
    expect(catalog.mock.calls.filter(([r]) => r.operation !== 'list_activity')).toHaveLength(2);
    expect(catalog.mock.calls.filter(([r]) => r.operation === 'list_activity')).toHaveLength(1);
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
    fireEvent.click(screen.getByText('已归档'));
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
    let updates = 0;
    const versions: number[] = [];
    const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> => {
      if (r.operation === 'status') return { ok: false, code: 'NOT_FOUND', message: '原键未落盘' };
      if (r.operation === 'update_project') {
        versions.push(r.expected_version);
        updates++;
        if (updates === 1) {
          p = { ...p, title: r.title, version: 2 };
          return { ok: false, code: 'RESULT_UNKNOWN', message: '结果未知' };
        }
        if (updates > 2) p = { ...p, title: r.title, version: 3 };
      }
      return response([p], p.id);
    });
    window.caselite = { catalog } as unknown as Window['caselite'];
    show();
    await screen.findByText('打开项目');
    fireEvent.click(screen.getByText('打开项目'));
    await screen.findByLabelText('编辑项目名称');
    fireEvent.change(screen.getByLabelText('编辑项目名称'), { target: { value: 'B' } });
    fireEvent.click(screen.getByText('保存项目概述'));
    await screen.findByText('核对原提交');
    fireEvent.click(screen.getByText('核对原提交'));
    await waitFor(() =>
      expect((screen.getByLabelText('编辑项目名称') as HTMLInputElement).value).toBe('B'),
    );
    await waitFor(() =>
      expect((screen.getByText('保存项目概述') as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.change(screen.getByLabelText('编辑项目名称'), { target: { value: 'C' } });
    fireEvent.click(screen.getByText('保存项目概述'));
    await waitFor(() => expect(versions).toEqual([1, 1, 2]));
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
    await screen.findByText('打开项目');
    await act(async () => {
      resolveOld(response([]));
      await old;
    });
    expect(screen.queryByText('暂无项目，独立任务仍可直接使用。')).toBeNull();
    expect(screen.getByText('打开项目')).toBeTruthy();
  });
  it('closes the archived editor and keeps properties on the visible target', async () => {
    let rows = [project(), project('22222222-2222-4222-8222-222222222222', 'B')];
    const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> => {
      if (r.operation === 'archive_project')
        rows = rows.map((p) =>
          p.id === r.id ? { ...p, archived_at: '2026-11-05', version: 2 } : p,
        );
      return response(rows, 'id' in r ? r.id : null);
    });
    window.caselite = { catalog } as unknown as Window['caselite'];
    show();
    await screen.findByText('打开项目');
    fireEvent.click(screen.getByText('打开项目'));
    await screen.findByLabelText('编辑项目名称');
    fireEvent.click(screen.getByText('归档项目'));
    await waitFor(() => expect(screen.queryByLabelText('编辑项目名称')).toBeNull());
    expect(screen.getByRole('heading', { name: 'B' })).toBeTruthy();
  });
  it('discards unsaved input when reloading the same stored version', async () => {
    const p = project();
    window.caselite = {
      catalog: vi.fn(async () => response([p], p.id)),
    } as unknown as Window['caselite'];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    show();
    await screen.findByText('打开项目');
    fireEvent.click(screen.getByText('打开项目'));
    await screen.findByLabelText('编辑项目名称');
    fireEvent.change(screen.getByLabelText('编辑项目名称'), { target: { value: '未保存B' } });
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
    fireEvent.click(await screen.findByText('打开项目'));
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
    expect(screen.getByText('有未保存修改，请保存后切换。')).toBeTruthy();
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
      start_date: null,
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
  fireEvent.click(screen.getByText('保存项目属性'));
  await screen.findByText('核对原提交');
  expect((screen.getByRole('tab', { name: 'AI 助手' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('tab', { name: 'AI 助手' }));
  fireEvent.click(await screen.findByText('核对原提交'));
  await waitFor(() =>
    expect((screen.getByLabelText('侧栏项目名称') as HTMLInputElement).disabled).toBe(false),
  );
  expect(writes).toHaveLength(1);
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
  fireEvent.click(await screen.findByText('打开项目'));
  await screen.findByLabelText('编辑项目名称');
  for (const tab of ['任务', '文件', '活动']) {
    fireEvent.click(screen.getByRole('tab', { name: tab, exact: true }));
    expect((screen.getByLabelText('项目负责人') as HTMLInputElement).disabled).toBe(false);
  }
  fireEvent.change(screen.getByLabelText('项目优先级'), { target: { value: '3' } });
  fireEvent.click(screen.getByText('保存项目属性'));
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
  fireEvent.click(screen.getByText('保存项目属性'));
  await screen.findByText('重新读取已保存属性');
  expect(screen.queryByText('核对原提交')).toBeNull();
  expect((screen.getByText('打开项目') as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByLabelText('侧栏项目名称') as HTMLInputElement).disabled).toBe(true);
  fail = false;
  fireEvent.click(screen.getByText('重新读取已保存属性'));
  await waitFor(() =>
    expect((screen.getByLabelText('侧栏项目名称') as HTMLInputElement).disabled).toBe(false),
  );
  expect((screen.getByLabelText('侧栏项目名称') as HTMLInputElement).value).toBe('保存后的名称');
  expect(writes).toBe(1);
});

it('discards incomplete date validation together with its property draft', async () => {
  window.caselite = {
    catalog: vi.fn(async () => response([project()])),
  } as unknown as Window['caselite'];
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  show();
  await screen.findByLabelText('侧栏项目名称');
  const start = screen.getByLabelText('项目开始日') as HTMLInputElement;
  fireEvent.change(start, { target: { value: '2024-02-29' } });
  const validity = vi
    .spyOn(start, 'validity', 'get')
    .mockReturnValue({ valid: false, badInput: true } as ValidityState);
  fireEvent.change(start, { target: { value: '' } });
  validity.mockRestore();
  expect((screen.getByText('保存项目属性') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('放弃属性修改'));
  fireEvent.change(screen.getByLabelText('项目目标日'), { target: { value: '2024-03-01' } });
  expect((screen.getByText('保存项目属性') as HTMLButtonElement).disabled).toBe(false);
});

it('keeps detail properties read-only after confirmed update when read_project fails, then only re-reads', async () => {
  let p = project(),
    failed = false,
    writes = 0;
  window.caselite = {
    catalog: vi.fn(async (r: CatalogRequest) => {
      if (r.operation === 'update_project') {
        writes++;
        p = { ...p, title: r.title, version: 2 };
        failed = true;
        return response([p], p.id);
      }
      if (r.operation === 'read_project' && failed) throw new Error('synthetic read failure');
      return response([p], p.id);
    }),
  } as unknown as Window['caselite'];
  show();
  fireEvent.click(await screen.findByText('打开项目'));
  await screen.findByLabelText('编辑项目名称');
  fireEvent.change(screen.getByLabelText('项目负责人'), { target: { value: '合成负责人' } });
  fireEvent.click(screen.getByText('保存项目属性'));
  await screen.findByText('重新读取已保存项目');
  expect((screen.getByLabelText('项目负责人') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByText('保存项目概述') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('核对原提交')).toBeNull();
  failed = false;
  fireEvent.click(screen.getByText('重新读取已保存项目'));
  await waitFor(() =>
    expect((screen.getByLabelText('项目负责人') as HTMLInputElement).disabled).toBe(false),
  );
  expect(writes).toBe(1);
});
