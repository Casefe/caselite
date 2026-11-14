import { LocalPreferencesProvider, initialLocalPreferences } from '../shared/data/LocalPreferences';
// @vitest-environment jsdom
import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { invalidateTaskPages } from './task-list-query';
import { createWorkbenchQueryClient } from '../shared/data/workbench-query-client';
import { useCallback, useState } from 'react';
import { PageNavigationProvider } from '../shared/navigation/PageNavigation';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Task, TaskRequest, TaskResponse } from '../../preload/caselite-api';
import RecordList, { initialTaskListState, type TaskListState } from './RecordList';
import { useTaskCompletion, type TaskCompletionActions } from '../features/tasks/useTaskCompletion';
vi.mock('./AgentPanel', () => ({ default: () => null, UnavailableAgentPanel: () => null }));
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
const task = (title: string): Task => ({
  id: crypto.randomUUID(),
  title,
  objective: '',
  status: 'todo',
  priority: 0,
  due_date: null,
  matter_id: null,
  version: 1,
  document_id: crypto.randomUUID(),
  body_id: crypto.randomUUID(),
  body_revision: 0,
  editor_schema: 1,
  updated_at: '2026-11-07',
});
const result = (rows: Task[], offset = 0): TaskResponse => ({
  ok: true,
  tasks: rows,
  state: null,
  receipt: null,
  page: { offset, total: rows.length + offset, has_more: false },
});
const source: Task[] = [];
function show(
  api: (r: TaskRequest) => Promise<TaskResponse>,
  initial = initialTaskListState,
  sharedInspector = false,
  completion?: TaskCompletionActions,
) {
  window.caselite = {
    // 新增类型查询不属于本组任务页IPC计数；该通道在Calendar专项中单独验收。
    task: (r: TaskRequest) =>
      r.operation === 'calendar_query'
        ? Promise.resolve({ ...result([]), calendar_types: [] })
        : api(r),
    catalog: async () => ({
      ok: true,
      projects: [],
      documents: [],
      state: null,
      target_id: null,
      receipt: null,
    }),
  } as unknown as Window['caselite'];
  const changed = vi.fn();
  window.caselite = {
    ...window.caselite,
    preferences:
      window.caselite.preferences ??
      vi.fn(async () => ({ ok: true, preferences: initialLocalPreferences, receipt: null })),
  };
  const client = createWorkbenchQueryClient();
  let force = () => {};
  function Host() {
    const [revision, setRevision] = useState(0);
    force = () => setRevision(revision + 1);
    const [state, setState] = useState<TaskListState>(initial),
      [blocked, setBlocked] = useState(false),
      [opened, setOpened] = useState(''),
      [inspectorOpen, setInspectorOpen] = useState(false);
    const initialize = useCallback((_key: string, open: boolean) => setInspectorOpen(open), []);
    const content = opened ? (
      <button onClick={() => setOpened('')}>返回列表</button>
    ) : (
      <RecordList
        completion={completion}
        tasks={source}
        viewState={state}
        onViewState={(v) => {
          changed(v);
          setState(v);
        }}
        onNew={vi.fn()}
        onOpen={setOpened}
        propertiesBlocked={blocked}
        onPropertiesBlocked={setBlocked}
        onTaskChanged={() => invalidateTaskPages(client)}
      />
    );
    return sharedInspector ? (
      <PageNavigationProvider
        value={{
          initial: null,
          register: () => () => {},
          report: () => {},
          beforeChange: () => {},
          inspector: {
            open: inspectorOpen,
            setOpen: setInspectorOpen,
            pageKey: 'tasks',
            initialize,
          },
        }}
      >
        <button onClick={() => setInspectorOpen((open) => !open)}>顶栏属性开关</button>
        {content}
      </PageNavigationProvider>
    ) : (
      content
    );
  }
  return {
    ...render(
      <QueryClientProvider client={client}>
        <LocalPreferencesProvider>
          <Host />
        </LocalPreferencesProvider>
      </QueryClientProvider>,
    ),
    changed,
    client,
    force: () => force(),
  };
}
it('invalidates query A before B and never displays its late rows or count under B filters', async () => {
  const a = task('旧范围甲'),
    b = task('新范围乙');
  const pending: { text: string; finish: (r: TaskResponse) => void }[] = [];
  show(
    (r) =>
      new Promise((resolve) => {
        if (r.operation === 'list') pending.push({ text: r.query?.text ?? '', finish: resolve });
      }),
  );
  await waitFor(() => expect(pending).toHaveLength(1));
  const filter = screen.getByRole('button', { name: '筛选任务' });
  expect(filter.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(filter);
  expect(filter.getAttribute('aria-expanded')).toBe('true');
  fireEvent.change(screen.getByLabelText('搜索任务'), { target: { value: '乙' } });
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => pending[1].finish(result([b])));
  expect(await screen.findByRole('row', { name: '选择任务：新范围乙' })).toBeTruthy();
  await act(async () => pending[0].finish(result([a])));
  expect(screen.queryByRole('row', { name: '选择任务：旧范围甲' })).toBeNull();
});

it('hides the completed A count while query B is pending rather than assigning it to B filters', async () => {
  const a = task('甲'),
    b = task('乙');
  let finish!: (r: TaskResponse) => void;
  show((r) =>
    r.operation === 'list' && !r.query?.text
      ? Promise.resolve(result([a, b]))
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  await screen.findByRole('row', { name: '选择任务：甲' });
  expect(document.querySelector('.collection-footer')?.textContent).toContain('2 个任务');
  fireEvent.click(screen.getByRole('button', { name: '打开任务搜索' }));
  fireEvent.change(screen.getByLabelText('搜索任务'), { target: { value: '乙' } });
  expect(document.querySelector('.collection-footer')?.textContent).toContain('正在读取任务');
  expect(document.querySelector('.collection-footer')?.textContent).not.toContain('2 个任务');
  await act(async () => finish(result([b])));
  await waitFor(() =>
    expect(document.querySelector('.collection-footer')?.textContent).toContain('1 个任务'),
  );
});
it('waits for Chinese composition end before querying and retains task property draft guards', async () => {
  const t = task('中文任务');
  const api = vi.fn(async () => result([t]));
  show(api);
  await screen.findByRole('row', { name: '选择任务：中文任务' });
  const input = screen.getByLabelText('搜索任务');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '中文' } });
  expect(api).toHaveBeenCalledTimes(1);
  fireEvent.compositionEnd(input, { data: '中文' });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  fireEvent.change(input, { target: { value: '中文' } });
  expect(api).toHaveBeenCalledTimes(2);
  await screen.findByRole('row', { name: '选择任务：中文任务' });
  fireEvent.click(screen.getByRole('button', { name: '任务预览' }));
  fireEvent.change(screen.getByLabelText('任务状态'), { target: { value: 'done' } });
  expect((screen.getByLabelText('搜索任务') as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText('正在保存任务属性…')).toBeTruthy();
  expect(api.mock.calls[2][0].operation).toBe('change_status');
});

it('requeries after a confirmed property change and moves the inspector when the Task leaves the current filter', async () => {
  const a = task('待办甲'),
    b = task('待办乙'),
    saved = { ...a, status: 'done' as const, version: 2 };
  let lists = 0;
  const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation === 'list') return result(++lists === 1 ? [a, b] : [b]);
    if (r.operation === 'change_status')
      return { ok: true, tasks: [saved], state: null, receipt: r.idempotency_key };
    return { ok: true, tasks: [saved], state: null, receipt: null };
  });
  show(api, {
    ...initialTaskListState,
    query: { ...initialTaskListState.query, status: 'todo' },
    selected: a.id,
  });
  await screen.findByRole('row', { name: '选择任务：待办甲' });
  fireEvent.click(screen.getByRole('button', { name: '任务预览' }));
  fireEvent.change(screen.getByLabelText('任务状态'), { target: { value: 'done' } });
  await waitFor(() => expect(screen.queryByRole('row', { name: '选择任务：待办甲' })).toBeNull());
  expect(await screen.findByRole('row', { name: '选择任务：待办乙' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '待办乙' })).toBeNull();
  expect(api.mock.calls.filter(([r]) => r.operation === 'change_status')).toHaveLength(1);
});
it('opens a task from a single row click with preview closed', async () => {
  const row = task('单击打开');
  show(async () => result([row]));
  expect(screen.queryByRole('complementary', { name: '任务属性' })).toBeNull();
  fireEvent.click(await screen.findByRole('row', { name: '选择任务：单击打开' }));
  expect(screen.getByRole('button', { name: '返回列表' })).toBeTruthy();
});
it('remembers the keyboard-opened target, filter, page and scroll when returning from detail', async () => {
  const a = task('任务甲'),
    b = task('任务乙'),
    api = vi.fn(async () => result([a, b], 20));
  const { changed } = show(api, {
    ...initialTaskListState,
    query: { ...initialTaskListState.query, text: '任务', offset: 20 },
    selected: a.id,
    scroll: 123,
  });
  const row = await screen.findByRole('row', { name: '选择任务：任务乙' });
  const area = document.querySelector('.collection-scroll') as HTMLElement;
  area.scrollTop = 123;
  fireEvent.keyDown(row, { key: 'Enter' });
  expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({
    selected: b.id,
    scroll: 123,
    query: { text: '任务', offset: 20 },
  });
  fireEvent.click(screen.getByText('返回列表'));
  await screen.findByRole('row', { name: '选择任务：任务乙' });
  await waitFor(() =>
    expect(screen.getByRole('row', { name: '选择任务：任务乙' }).getAttribute('aria-current')).toBe(
      'true',
    ),
  );
  expect((document.querySelector('.collection-scroll') as HTMLElement).scrollTop).toBe(123);
});

it('keeps the project assignment guard until a confirmed write can be read back', async () => {
  const original = task('合成归组任务');
  const project = { id: crypto.randomUUID(), title: '合成项目', archived_at: null };
  const assigned = { ...original, matter_id: project.id, matter_title: project.title, version: 2 };
  let readFailed = true;
  let writes = 0;
  const changed = vi.fn();
  const client = createWorkbenchQueryClient();
  window.caselite = {
    task: async (request: TaskRequest) => {
      if (request.operation === 'read' && readFailed) throw new Error('read failure');
      return result([writes ? assigned : original]);
    },
    catalog: async (request: { operation: string }) => {
      if (request.operation === 'assign_task') writes++;
      return {
        ok: true,
        projects: [project],
        documents: [],
        state: null,
        target_id: null,
        receipt: null,
      };
    },
  } as unknown as Window['caselite'];
  function Host() {
    const [state, setState] = useState(initialTaskListState);
    const [propertiesBlocked, setPropertiesBlocked] = useState(false);
    const [projectDirty, setProjectDirty] = useState(false);
    return (
      <RecordList
        tasks={source}
        viewState={state}
        onViewState={setState}
        onOpen={vi.fn()}
        onNew={vi.fn()}
        propertiesBlocked={propertiesBlocked}
        onPropertiesBlocked={setPropertiesBlocked}
        projectDirty={projectDirty}
        onProjectDirty={setProjectDirty}
        onTaskChanged={(saved, state) => {
          changed(saved, state);
          invalidateTaskPages(client);
        }}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <LocalPreferencesProvider>
        <Host />
      </LocalPreferencesProvider>
    </QueryClientProvider>,
  );
  if (screen.getByRole('button', { name: '筛选任务' }).getAttribute('aria-expanded') === 'false')
    fireEvent.click(screen.getByRole('button', { name: '筛选任务' }));
  fireEvent.click(screen.getByRole('button', { name: '任务预览' }));
  const field = await screen.findByRole<HTMLSelectElement>('combobox', { name: '所属项目' });
  await waitFor(() => expect(field.disabled).toBe(false));
  fireEvent.change(field, { target: { value: project.id } });
  const reread = await screen.findByRole('button', { name: '重新读取任务关联' });
  expect(field.disabled).toBe(true);
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '任务状态' }).disabled).toBe(true);
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '任务项目范围' }).disabled).toBe(
    true,
  );
  expect(changed).not.toHaveBeenCalled();
  readFailed = false;
  fireEvent.click(reread);
  await waitFor(() => expect(field.value).toBe(project.id));
  expect(changed).toHaveBeenCalledWith(assigned, null);
  expect(field.disabled).toBe(false);
  expect(writes).toBe(1);
});

it('reads when offline and reuses a revisited filter without another task IPC', async () => {
  onlineManager.setOnline(false);
  const a = task('查询甲'),
    b = task('查询乙');
  const api = vi.fn(async (r: TaskRequest) =>
    result(r.operation === 'list' && r.query?.text ? [b] : [a]),
  );
  show(api);
  await screen.findByRole('row', { name: '选择任务：查询甲' });
  const input = screen.getByLabelText('搜索任务');
  fireEvent.change(input, { target: { value: '乙' } });
  await screen.findByRole('row', { name: '选择任务：查询乙' });
  fireEvent.change(input, { target: { value: '' } });
  await screen.findByRole('row', { name: '选择任务：查询甲' });
  expect(api).toHaveBeenCalledTimes(2);
});

it('drops an in-flight page response once a confirmed change invalidates that page', async () => {
  const stale = task('过期任务'),
    fresh = task('当前任务');
  const pending: ((r: TaskResponse) => void)[] = [];
  const { client } = show(() => new Promise((resolve) => pending.push(resolve)));
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => invalidateTaskPages(client));
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => pending[1](result([fresh])));
  await screen.findByRole('row', { name: '选择任务：当前任务' });
  await act(async () => pending[0](result([stale])));
  expect(screen.queryByRole('row', { name: '选择任务：过期任务' })).toBeNull();
});

it('keeps a task tag draft when an earlier refresh completes during editing', async () => {
  const t = task('保留任务草稿');
  let finish: ((r: TaskResponse) => void) | undefined;
  let reads = 0;
  const { client } = show(() => {
    if (reads++ === 0) return Promise.resolve(result([t]));
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await screen.findByRole('row', { name: '选择任务：保留任务草稿' });
  fireEvent.click(screen.getByRole('button', { name: '任务预览' }));
  act(() => invalidateTaskPages(client));
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.click(screen.getByText('添加标签'));
  fireEvent.change(screen.getByLabelText('新标签'), { target: { value: '未保存草稿' } });
  expect((screen.getByLabelText('搜索任务') as HTMLInputElement).disabled).toBe(true);
  await act(async () => finish!(result([])));
  expect(screen.getByDisplayValue('未保存草稿')).toBeTruthy();
});

it('groups the loaded page, keeps display changes local, and opens the original task', async () => {
  const pending = task('待办样例');
  const complete = { ...task('已办样例'), status: 'done' } satisfies Task;
  const request = vi.fn(async () => result([complete, pending]));
  const { changed } = show(request);
  const pendingRow = await screen.findByRole('row', { name: '选择任务：待办样例' });
  expect(pendingRow).toBeDefined();
  fireEvent.click(screen.getByLabelText('任务显示设置'));
  fireEvent.click(screen.getByRole('checkbox', { name: '按状态分组（当前页）' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '负责人' }));
  for (const label of ['待办', '已完成']) {
    const group = within(screen.getByRole('region', { name: label }));
    expect(group.getByRole('heading', { level: 2 }).textContent).toContain(label);
    expect(group.queryByRole('columnheader', { name: '负责人' })).toBeNull();
  }
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole('row', { name: '选择任务：已办样例' }), { key: 'Enter' });
  expect(changed.mock.lastCall?.[0].selected).toBe(complete.id);
  expect(screen.getByRole('button', { name: '返回列表' })).toBeDefined();
});

it('retains the batch recovery lock while the preview is open and disables unrelated owners', async () => {
  const original = task('批量与预览');
  const saved = { ...original, version: 2, status: 'done' as const };
  let command: Extract<TaskRequest, { operation: 'change_status' }> | null = null;
  let stored = false;
  const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation === 'change_status') {
      command = r;
      stored = true;
      return { ok: false, code: 'RESULT_UNKNOWN', message: '等待核对批量原提交。' };
    }
    if (r.operation === 'status')
      return { ok: true, tasks: [saved], state: null, receipt: command!.idempotency_key };
    return result([stored ? saved : original]);
  });
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  show(api);
  await screen.findByRole('row', { name: '选择任务：批量与预览' });
  fireEvent.click(screen.getByRole('button', { name: '任务预览' }));
  fireEvent.click(screen.getByText('显示设置'));
  fireEvent.click(screen.getByLabelText('选择多个任务'));
  fireEvent.click(screen.getByLabelText('批量选择当前页任务'));
  fireEvent.click(screen.getByRole('button', { name: /标记完成/ }));
  await screen.findByText('等待核对批量原提交。');
  expect((screen.getByLabelText('任务状态') as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '设置任务提醒' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByLabelText('搜索任务') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '新建任务' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: '核对并继续原操作' }));
  await waitFor(() =>
    expect((screen.getByLabelText('搜索任务') as HTMLInputElement).disabled).toBe(false),
  );
  expect(api.mock.calls.filter(([r]) => r.operation === 'change_status')).toHaveLength(1);
  expect(
    api.mock.calls.some(
      ([r]) => r.operation === 'status' && r.idempotency_key === command!.idempotency_key,
    ),
  ).toBe(true);
});

// 保留原回归场景名；按本轮确认的简化设计，空预览不再显示统计或启用无任务 AI。
it('retains workspace statistics in an empty preview without enabling a task AI', async () => {
  show(async () => result([]));
  await screen.findByText('没有匹配的任务。可以新建任务，或调整搜索条件。');
  expect(document.querySelector('[data-statistics-module]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '任务预览' }));
  const emptyPreview = screen.getByLabelText('任务辅助栏');
  expect(emptyPreview.querySelector('[data-statistics-module]')).toBeNull();
  expect(emptyPreview.querySelector('[aria-label="AI 对话"]')).toBeNull();
});

it('shares the titlebar inspector choice without remounting a hidden property draft', async () => {
  const row = task('共享右栏草稿');
  const api = vi.fn(async (request: TaskRequest) => {
    if (request.operation !== 'list') throw new Error('显隐不应提交任务命令');
    return result([row]);
  });
  show(api, initialTaskListState, true);
  await screen.findByRole('row', { name: '选择任务：共享右栏草稿' });
  const sidebar = screen.getByLabelText('任务辅助栏');
  expect(sidebar.hidden).toBe(true);
  expect(screen.getByRole('button', { name: '任务预览' }).getAttribute('aria-expanded')).toBe(
    'false',
  );
  fireEvent.click(screen.getByRole('button', { name: '顶栏属性开关' }));
  expect(sidebar.hidden).toBe(false);
  expect(screen.getByRole('button', { name: '任务预览' }).getAttribute('aria-expanded')).toBe(
    'true',
  );
  fireEvent.click(screen.getByText('添加标签'));
  const input = screen.getByLabelText('新标签');
  fireEvent.change(input, { target: { value: '保留未提交标签' } });
  fireEvent.click(screen.getByRole('button', { name: '顶栏属性开关' }));
  expect(sidebar.hidden).toBe(true);
  expect(input.isConnected).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '顶栏属性开关' }));
  expect(screen.getByLabelText('新标签')).toBe(input);
  expect((input as HTMLInputElement).value).toBe('保留未提交标签');
  expect((screen.getByRole('button', { name: '任务预览' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(
    api.mock.calls.every(
      (call) =>
        !['update', 'update_attributes', 'change_status'].includes(
          (call[0] as TaskRequest | undefined)?.operation ?? '',
        ),
    ),
  ).toBe(true);
});

it('offers row completion independently from task opening and page selection', async () => {
  const row = task('列表完成入口');
  const complete = vi.fn();
  show(async () => result([row]), initialTaskListState, false, {
    complete,
    busyIds: [],
    blocked: false,
  });
  fireEvent.click(await screen.findByRole('button', { name: '完成任务：列表完成入口' }));
  expect(complete).toHaveBeenCalledExactlyOnceWith(row);
  expect(screen.queryByRole('button', { name: '返回列表' })).toBeNull();
});

it('INDEPENDENT blocks every bulk write while shared completion is pending', async () => {
  const t = task('并发保护任务');
  const api = vi.fn(async () => result([t]));
  const completion = { complete: vi.fn(), busyIds: [] as string[], blocked: false };
  const view = show(api, initialTaskListState, false, completion);
  await screen.findByRole('button', { name: '完成任务：并发保护任务' });
  fireEvent.click(screen.getByLabelText('选择多个任务'));
  fireEvent.click(screen.getByRole('checkbox', { name: '勾选任务：并发保护任务' }));
  expect((screen.getByRole('button', { name: '✓ 标记完成' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  completion.blocked = true;
  completion.busyIds = [t.id];
  act(() => view.force());
  expect(
    (screen.getByRole('button', { name: '完成任务：并发保护任务' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((screen.getByRole('button', { name: '✓ 标记完成' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByLabelText('批量设置优先级') as HTMLSelectElement).disabled).toBe(true);
});

it('keeps its own bulk unknown recovery available while excluding the bulk-owned blocked feedback', async () => {
  const current = task('批量自身恢复');
  const saved = { ...current, status: 'done' as const, version: 2 };
  let key = '';
  const api = vi.fn(async (request: TaskRequest): Promise<TaskResponse> => {
    if (request.operation === 'change_status') {
      key = request.idempotency_key;
      return { ok: false, code: 'RESULT_UNKNOWN', message: '原批量未知' };
    }
    if (request.operation === 'status')
      return { ...result([saved]), receipt: request.idempotency_key };
    return result([key ? saved : current]);
  });
  show(api);
  await screen.findByRole('button', { name: '批量自身恢复' });
  fireEvent.click(screen.getByLabelText('选择多个任务'));
  fireEvent.click(screen.getByRole('checkbox', { name: '勾选任务：批量自身恢复' }));
  fireEvent.click(screen.getByRole('button', { name: '✓ 标记完成' }));
  await screen.findByText('原批量未知');
  const recover = screen.getByRole('button', { name: '核对并继续原操作' });
  expect((recover as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(recover);
  await waitFor(() => expect(screen.queryByText('原批量未知')).toBeNull());
  expect(api.mock.calls.filter(([r]) => r.operation === 'change_status')).toHaveLength(1);
  expect(api.mock.calls.find(([r]) => r.operation === 'status')?.[0]).toMatchObject({
    idempotency_key: key,
  });
});

it('PREVIEW locks real task property writes during shared completion', async () => {
  const t = task('预览互斥任务');
  const api = vi.fn(async () => result([t]));
  const completion = { complete: vi.fn(), busyIds: [] as string[], blocked: false };
  const view = show(api, initialTaskListState, false, completion);
  await screen.findByRole('button', { name: '完成任务：预览互斥任务' });
  fireEvent.click(screen.getByRole('button', { name: '任务预览' }));
  const status = screen.getByLabelText('任务状态') as HTMLSelectElement;
  expect(status.disabled).toBe(false);
  completion.blocked = true;
  completion.busyIds = [t.id];
  act(() => view.force());
  expect(
    (screen.getByRole('button', { name: '完成任务：预览互斥任务' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  const before = api.mock.calls.length;
  fireEvent.change(status, { target: { value: 'done' } });
  await act(async () => {});
  expect(
    api.mock.calls.slice(before).filter(([r]) => r.operation === 'change_status'),
  ).toHaveLength(0);
  expect(status.disabled).toBe(true);
});

it.each(['pending', 'unknown', 'confirmed-read'] as const)(
  'locks real preview controls while shared completion is %s',
  async (phase) => {
    const current = task('三态预览锁');
    const saved = { ...current, version: 2, status: 'done' as const };
    let release: ((value: TaskResponse) => void) | undefined;
    const api = vi.fn(async (request: TaskRequest): Promise<TaskResponse> => {
      if (request.operation === 'change_status') {
        if (phase === 'pending')
          return new Promise((resolve) => {
            release = resolve;
          });
        if (phase === 'unknown')
          return { ok: false, code: 'RESULT_UNKNOWN', message: '预览原结果未知' };
        return { ...result([saved]), receipt: request.idempotency_key };
      }
      if (request.operation === 'read') return result([saved]);
      return result(request.operation === 'calendar_query' ? [] : [current]);
    });
    window.caselite = {
      task: api,
      catalog: vi.fn(async () => ({
        ok: true,
        projects: [],
        documents: [],
        state: null,
        target_id: null,
        receipt: null,
      })),
      reminder: vi.fn(async () => ({ ok: true, reminders: [], receipt: null })),
      preferences: vi.fn(async () => ({
        ok: true,
        preferences: initialLocalPreferences,
        receipt: null,
      })),
    } as unknown as Window['caselite'];
    function Host() {
      const [state, setState] = useState(initialTaskListState);
      const [blocked, setBlocked] = useState(false);
      const [projectDirty, setProjectDirty] = useState(false);
      const completion = useTaskCompletion({
        disabled: blocked || projectDirty,
        onChanged: async () => false,
      });
      return (
        <>
          {completion.feedback}
          <RecordList
            tasks={[current]}
            viewState={state}
            onViewState={setState}
            onOpen={vi.fn()}
            onNew={vi.fn()}
            propertiesBlocked={blocked}
            onPropertiesBlocked={setBlocked}
            projectDirty={projectDirty}
            onProjectDirty={setProjectDirty}
            onTaskChanged={vi.fn()}
            completion={completion}
          />
        </>
      );
    }
    render(
      <QueryClientProvider client={createWorkbenchQueryClient()}>
        <LocalPreferencesProvider>
          <Host />
        </LocalPreferencesProvider>
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: '完成任务：三态预览锁' });
    fireEvent.click(screen.getByRole('button', { name: '任务预览' }));
    const status = screen.getByLabelText('任务状态') as HTMLSelectElement;
    const project = screen.getByLabelText('所属项目') as HTMLSelectElement;
    const reminder = screen.getByRole('button', { name: '设置任务提醒' }) as HTMLButtonElement;
    await waitFor(() => {
      expect(project.disabled).toBe(false);
      expect(reminder.disabled).toBe(false);
    });
    expect(status.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '完成任务：三态预览锁' }));
    if (phase === 'pending') await screen.findByText('正在确认任务完成…');
    else await screen.findByRole('alert');
    expect(status.disabled).toBe(true);
    expect((screen.getByLabelText('任务优先级') as HTMLSelectElement).disabled).toBe(true);
    expect(project.disabled).toBe(true);
    expect(reminder.disabled).toBe(true);
    const before = api.mock.calls.length;
    fireEvent.change(status, { target: { value: 'in_progress' } });
    fireEvent.click(reminder);
    await act(async () => {});
    expect(
      api.mock.calls.slice(before).filter(([r]) => r.operation === 'change_status'),
    ).toHaveLength(0);
    expect(api.mock.calls.filter(([r]) => r.operation === 'change_status')).toHaveLength(1);
    if (release)
      await act(async () =>
        release!({ ok: false, code: 'RESULT_UNKNOWN', message: '预览原结果未知' }),
      );
  },
);

it('keeps preview property unknown recovery available when the preview owns its own block', async () => {
  const current = task('预览自身恢复');
  const saved = { ...current, status: 'done' as const, version: 2 };
  let key = '';
  const api = vi.fn(async (request: TaskRequest): Promise<TaskResponse> => {
    if (request.operation === 'change_status') {
      key = request.idempotency_key;
      return { ok: false, code: 'RESULT_UNKNOWN', message: '预览属性原结果未知' };
    }
    if (request.operation === 'status')
      return { ...result([saved]), receipt: request.idempotency_key };
    return result([key ? saved : current]);
  });
  show(api, initialTaskListState, false, { complete: vi.fn(), busyIds: [], blocked: false });
  await screen.findByRole('button', { name: '完成任务：预览自身恢复' });
  fireEvent.click(screen.getByRole('button', { name: '任务预览' }));
  fireEvent.change(screen.getByLabelText('任务状态'), { target: { value: 'done' } });
  await screen.findByText('预览属性原结果未知');
  const recover = screen.getByRole('button', { name: '核对并重试原提交' });
  expect((recover as HTMLButtonElement).disabled).toBe(false);
  expect(
    (screen.getByRole('button', { name: '完成任务：预览自身恢复' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(recover);
  await waitFor(() => expect(screen.queryByText('预览属性原结果未知')).toBeNull());
  expect(api.mock.calls.filter(([r]) => r.operation === 'change_status')).toHaveLength(1);
  expect(api.mock.calls.find(([r]) => r.operation === 'status')?.[0]).toMatchObject({
    idempotency_key: key,
  });
});
