// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Task, TaskRequest, TaskResponse } from '../../preload/caselite-api';
import RecordList, { initialTaskListState, type TaskListState } from './RecordList';
vi.mock('./AgentPanel', () => ({ default: () => null }));
afterEach(() => {
  cleanup();
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
function show(api: (r: TaskRequest) => Promise<TaskResponse>, initial = initialTaskListState) {
  window.caselite = {
    task: api,
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
  function Host() {
    const [state, setState] = useState<TaskListState>(initial),
      [blocked, setBlocked] = useState(false),
      [opened, setOpened] = useState('');
    return opened ? (
      <button onClick={() => setOpened('')}>返回列表</button>
    ) : (
      <RecordList
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
        onTaskChanged={vi.fn()}
      />
    );
  }
  return { ...render(<Host />), changed };
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
  fireEvent.change(screen.getByLabelText('搜索任务'), { target: { value: '乙' } });
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => pending[1].finish(result([b])));
  expect(screen.getByRole('row', { name: '选择任务：新范围乙' })).toBeTruthy();
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
  expect(document.querySelector('.collection-total')?.textContent).toBe('2');
  fireEvent.change(screen.getByLabelText('搜索任务'), { target: { value: '乙' } });
  expect(document.querySelector('.collection-total')?.textContent).toBe('…');
  expect(document.querySelector('.collection-footer')?.textContent).toContain('正在读取任务');
  await act(async () => finish(result([b])));
  expect(document.querySelector('.collection-total')?.textContent).toBe('1');
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
  fireEvent.change(screen.getByLabelText('任务状态'), { target: { value: 'done' } });
  await waitFor(() => expect(screen.queryByRole('row', { name: '选择任务：待办甲' })).toBeNull());
  expect(await screen.findByRole('row', { name: '选择任务：待办乙' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '待办乙' })).toBeNull();
  expect(api.mock.calls.filter(([r]) => r.operation === 'change_status')).toHaveLength(1);
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
