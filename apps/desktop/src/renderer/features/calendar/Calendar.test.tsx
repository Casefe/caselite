// @vitest-environment jsdom
import { useCalendarCommit } from './useCalendarCommit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  act,
  renderHook,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyTaskCalendar, defaultCalendarTypes } from '@caselite/contracts';
import type { Task, TaskRequest, TaskResponse } from '../../../preload/caselite-api';
import ImportantSchedules from './ImportantSchedules';
import CalendarView from './CalendarView';
import TaskCalendarEditor from './TaskCalendarEditor';
import CalendarSettings from './CalendarSettings';
const task = (title: string, calendar = emptyTaskCalendar): Task => ({
  id: crypto.randomUUID(),
  document_id: crypto.randomUUID(),
  body_id: crypto.randomUUID(),
  title,
  objective: '',
  status: 'todo',
  priority: 0,
  due_date: null,
  matter_id: null,
  body_revision: 0,
  editor_schema: 1,
  version: 1,
  updated_at: '2026-11-09',
  calendar,
});
const success = (tasks: Task[] = [], receipt: string | null = null): TaskResponse => ({
  ok: true,
  tasks,
  state: null,
  receipt,
  calendar_types: defaultCalendarTypes,
  page: { offset: 0, total: tasks.length, has_more: false },
  calendar_pending_count: 2,
});
const show = (node: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {node}
    </QueryClientProvider>,
  );
afterEach(cleanup);
it('shares complete important query/cache and original IDs between home/calendar, including hidden pending-date summary beyond the preview', async () => {
  const rows = Array.from({ length: 8 }, (_, i) =>
    task(`合成重要${i}`, { ...emptyTaskCalendar, important: true, type_id: 'hearing' }),
  );
  const api = vi.fn(async () => success(rows));
  window.caselite = { task: api } as unknown as Window['caselite'];
  const open = vi.fn();
  show(
    <>
      <ImportantSchedules onOpen={open} />
      <ImportantSchedules home onOpen={open} />
    </>,
  );
  await screen.findAllByText('合成重要0');
  expect(screen.getAllByText(/日期待确认 2 项/)).toHaveLength(2);
  expect(
    within(screen.getByRole('region', { name: '首页重要日程' })).queryByText('合成重要7'),
  ).toBeNull();
  fireEvent.click(
    within(screen.getByRole('region', { name: '首页重要日程' })).getByRole('button', {
      name: /查看全部/,
    }),
  );
  fireEvent.click(
    within(screen.getByRole('region', { name: '首页重要日程' })).getByText('合成重要7'),
  );
  expect(open).toHaveBeenCalledWith(rows[7].id);
  expect(api.mock.calls).toHaveLength(2);
});
it('shows only timed Tasks in the lower sidebar, including explicit important points; date-only goes to day group and all entries open original IDs', async () => {
  const a = task('普通时段', {
      ...emptyTaskCalendar,
      schedule: { date: '2026-11-09', start: '09:00', end: '10:00', timezone: 'Asia/Shanghai' },
    }),
    b = task('重要时点', {
      ...emptyTaskCalendar,
      important: true,
      type_id: 'meeting',
      attention_source: 'custom',
      attention_date: '2026-11-09',
      attention_time: '11:00',
    }),
    c = task('重要只有日期', {
      ...emptyTaskCalendar,
      important: true,
      type_id: 'payment',
      attention_source: 'custom',
      attention_date: '2026-11-09',
    }),
    d = task('无日期普通任务');
  window.caselite = {
    task: vi.fn(async (r: TaskRequest) =>
      r.operation === 'calendar_query'
        ? success(
            r.query.view === 'timed'
              ? [a, b]
              : r.query.view === 'day'
                ? [a, b, c]
                : r.query.view === 'undated'
                  ? [d]
                  : r.query.view === 'important'
                    ? [b, c]
                    : [],
          )
        : success(),
    ),
  } as unknown as Window['caselite'];
  const open = vi.fn();
  show(
    <CalendarView
      date="2026-11-09"
      onDate={vi.fn()}
      selected={null}
      inspector={null}
      blocked={false}
      onOpen={open}
      onClose={vi.fn()}
      onReminders={vi.fn()}
      onSettings={vi.fn()}
    />,
  );
  const left = screen.getByRole('region', { name: '本日工作安排' });
  await within(left).findByText('重要时点');
  expect(within(left).queryByText('重要只有日期')).toBeNull();
  expect(left.querySelectorAll('[data-calendar-task]')).toHaveLength(2);
  fireEvent.click(within(left).getByText('重要时点'));
  expect(open).toHaveBeenCalledWith(b.id);
  fireEvent.click(
    within(screen.getByRole('region', { name: '待安排任务' })).getByText('无日期普通任务'),
  );
  expect(open).toHaveBeenLastCalledWith(d.id);
  expect(
    within(screen.getByRole('region', { name: '当日任务' })).getByText('重要只有日期'),
  ).toBeTruthy();
  expect(
    within(screen.getByRole('region', { name: '当日任务' })).queryByText('普通时段'),
  ).toBeNull();
});
it('blocks navigation through unknown calendar ACK and recovers the original key, then reads the current Task before accepting it', async () => {
  const initial = task('合成保存');
  let submitted: Extract<TaskRequest, { operation: 'update_calendar' }> | null = null;
  let confirmed = initial;
  const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation === 'calendar_query') return success();
    if (r.operation === 'update_calendar') {
      submitted = r;
      confirmed = { ...initial, version: 2, calendar: r.calendar };
      return { ok: false, code: 'RESULT_UNKNOWN', message: '合成未知回执' };
    }
    if (r.operation === 'status') return success([confirmed], r.idempotency_key);
    return success([confirmed]);
  });
  window.caselite = { task: api } as unknown as Window['caselite'];
  function Host() {
    const [current, setCurrent] = useState(initial),
      [blocked, setBlocked] = useState(false);
    return (
      <>
        <button disabled={blocked}>离开任务</button>
        <TaskCalendarEditor
          key={current.id}
          task={current}
          disabled={false}
          onBlocked={setBlocked}
          onChanged={setCurrent}
        />
      </>
    );
  }
  show(<Host />);
  const input = screen.getByLabelText('任务计划日');
  fireEvent.change(input, { target: { value: '2026-11-10' } });
  fireEvent.blur(input);
  await screen.findByText('合成未知回执');
  expect((screen.getByText('离开任务') as HTMLButtonElement).disabled).toBe(true);
  expect((input as HTMLInputElement).value).toBe('2026-11-10');
  fireEvent.click(screen.getByText('核对并重试原提交'));
  await waitFor(() =>
    expect((screen.getByText('离开任务') as HTMLButtonElement).disabled).toBe(false),
  );
  expect(api.mock.calls.filter(([r]) => r.operation === 'update_calendar')).toHaveLength(1);
  expect(api.mock.calls.find(([r]) => r.operation === 'status')?.[0]).toMatchObject({
    idempotency_key: submitted!.idempotency_key,
  });
});
it('keeps partial timed input and blocks switching until a valid same-day range is saved or discarded', async () => {
  const t = task('未完成时段');
  const api = vi.fn(async (r: TaskRequest) => {
    void r;
    return success();
  });
  window.caselite = { task: api } as unknown as Window['caselite'];
  const blocked = vi.fn();
  show(<TaskCalendarEditor task={t} disabled={false} onBlocked={blocked} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByText('工作时段'));
  fireEvent.change(screen.getByLabelText('工作时段日期'), { target: { value: '2026-11-09' } });
  fireEvent.blur(screen.getByLabelText('工作时段日期'));
  await screen.findByText(/请补全有效的日期/);
  expect(blocked).toHaveBeenLastCalledWith(true);
  expect(
    api.mock.calls.every(([r]) => (r as unknown as TaskRequest).operation !== 'update_calendar'),
  ).toBe(true);
});
it('saves stable type ID/expected version and keeps draft controls locked until confirmed readback', async () => {
  let rows = defaultCalendarTypes;
  const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation === 'set_calendar_type') {
      rows = rows.map((t) => (t.id === r.type.id ? { ...r.type, version: r.type.version + 1 } : t));
      return { ...success([], r.idempotency_key), calendar_types: rows };
    }
    return { ...success(), calendar_types: rows };
  });
  window.caselite = { task: api } as unknown as Window['caselite'];
  show(<CalendarSettings onBlocked={vi.fn()} />);
  fireEvent.click(await screen.findByText('编辑开庭'));
  fireEvent.click(screen.getByLabelText('类型启用'));
  fireEvent.click(screen.getByLabelText('类型首页显示'));
  fireEvent.change(screen.getByLabelText('重要类型名称'), { target: { value: '庭审安排' } });
  fireEvent.click(screen.getByText('保存类型'));
  await waitFor(() => expect(screen.queryByRole('form', { name: '编辑重要类型' })).toBeNull());
  expect(api.mock.calls.find(([r]) => r.operation === 'set_calendar_type')?.[0]).toMatchObject({
    type: { id: 'hearing', version: 0, name: '庭审安排', enabled: false, show_home: false },
  });
});

it('retains the original unknown key when status read fails and forbids clear until a later confirmed ACK, without a second mutation', async () => {
  const initial = task('合成未知恢复'),
    calendar = { ...emptyTaskCalendar, planned_date: '2026-11-10' },
    saved = { ...initial, version: 2, calendar };
  const command = {
    protocol_version: 1 as const,
    operation: 'update_calendar' as const,
    request_id: crypto.randomUUID(),
    idempotency_key: crypto.randomUUID(),
    task_id: initial.id,
    expected_version: 1,
    calendar,
  };
  let lookups = 0;
  const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation === 'update_calendar')
      return { ok: false, code: 'RESULT_UNKNOWN', message: '合成原写未知' };
    if (r.operation === 'status') {
      lookups++;
      return lookups === 1
        ? { ok: false, code: 'READ_FAILED', message: '合成原键暂不可读' }
        : success([saved], command.idempotency_key);
    }
    throw Error('Unexpected calendar recovery operation');
  });
  window.caselite = { task: api } as unknown as Window['caselite'];
  const confirm = vi.fn(async () => {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useCalendarCommit(confirm), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(() => result.current.save(command));
  expect(result.current.phase).toBe('unknown');
  expect(result.current.clear()).toBe(false);
  await act(() => result.current.recover());
  expect(result.current.error).toBe('合成原键暂不可读');
  expect(result.current.phase).toBe('unknown');
  expect(result.current.locked).toBe(true);
  expect(result.current.clear()).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  await act(() => result.current.recover());
  expect(result.current.phase).toBe('idle');
  expect(result.current.locked).toBe(false);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(api.mock.calls.filter(([r]) => r.operation === 'update_calendar')).toHaveLength(1);
  expect(
    api.mock.calls
      .filter(([r]) => r.operation === 'status')
      .map(([r]) => (r.operation === 'status' ? r.idempotency_key : null)),
  ).toEqual([command.idempotency_key, command.idempotency_key]);
});
