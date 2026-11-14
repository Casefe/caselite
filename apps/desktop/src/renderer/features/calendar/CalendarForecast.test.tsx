// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultCalendarTypes, emptyTaskCalendar } from '@caselite/contracts';
import type { Task, TaskRequest, TaskResponse } from '../../../preload/caselite-api';
import CalendarView from './CalendarView';
import ImportantSchedules from './ImportantSchedules';
import { localDate, shiftDate } from './calendar-query';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const today = localDate();
const makeTask = (title: string, fields: Partial<Task> = {}): Task => ({
  id: crypto.randomUUID(),
  document_id: crypto.randomUUID(),
  body_id: crypto.randomUUID(),
  title,
  objective: '',
  status: 'todo',
  priority: 2,
  due_date: today,
  matter_id: null,
  version: 1,
  body_revision: 0,
  editor_schema: 1,
  updated_at: today,
  calendar: emptyTaskCalendar,
  ...fields,
});
function setup(blocked = false, initialDate = today) {
  const current = makeTask('合成预测任务', {
    matter_title: '合成项目',
    tags: ['待核对'],
    assignee: '示例负责人',
    calendar: { ...emptyTaskCalendar, planned_date: today },
  });
  const timed = makeTask('合成具体时间', {
    calendar: {
      ...emptyTaskCalendar,
      schedule: { date: today, start: '09:00', end: '10:00', timezone: 'Asia/Shanghai' },
    },
  });
  const pending = makeTask('合成无日期', { due_date: null });
  const past = makeTask('合成日期已过', {
    due_date: shiftDate(today, -1),
    calendar: {
      ...emptyTaskCalendar,
      important: true,
      type_id: 'payment',
      attention_source: 'due',
    },
  });
  const future = makeTask('合成远期', {
    due_date: shiftDate(today, 10),
    calendar: {
      ...emptyTaskCalendar,
      important: true,
      type_id: 'hearing',
      attention_source: 'due',
    },
  });
  const last = makeTask('合成远期第二页', { due_date: shiftDate(today, 20) });
  const tasks = [current, timed, pending, past, future, last];
  const api = vi.fn(async (r: TaskRequest): Promise<TaskResponse> => {
    if (r.operation !== 'calendar_query') throw Error('Unexpected write in forecast view');
    const rows =
      r.query.view === 'timed'
        ? [timed]
        : r.query.view === 'untimed'
          ? [current]
          : r.query.view === 'undated'
            ? [pending]
            : r.query.view === 'past'
              ? [past]
              : r.query.view === 'future'
                ? r.query.offset
                  ? [last]
                  : [future]
                : r.query.view === 'important'
                  ? [past, future]
                  : [];
    return {
      ok: true,
      tasks: rows,
      receipt: null,
      state: null,
      calendar_types: defaultCalendarTypes,
      calendar_counts: r.query.view === 'counts' ? [{ date: today, count: 2 }] : undefined,
      page: {
        offset: r.query.offset,
        total: r.query.view === 'future' ? 51 : rows.length,
        has_more: r.query.view === 'future' && r.query.offset === 0,
      },
    };
  });
  window.caselite = { task: api } as unknown as Window['caselite'];
  let mounts = 0;
  function SharedInspector({ task }: { task: Task }) {
    useEffect(() => {
      mounts++;
    }, []);
    return (
      <aside aria-label="共用属性与 AI">
        <span>{task.id}</span>
        <textarea aria-label="AI 对话草稿" defaultValue="" />
      </aside>
    );
  }
  function Host() {
    const [selected, select] = useState<Task | null>(current);
    const [date, setDate] = useState(initialDate);
    return (
      <CalendarView
        date={date}
        onDate={setDate}
        selected={selected}
        blocked={blocked}
        onOpen={(id) => select(tasks.find((t) => t.id === id)!)}
        onClose={() => select(null)}
        inspector={selected && <SharedInspector task={selected} />}
        onReminders={vi.fn()}
        onSettings={vi.fn()}
      />
    );
  }
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Host />
    </QueryClientProvider>,
  );
  return { api, current, past, future, mounts: () => mounts };
}

it('renders forecast dates first and real attributes below titles, while retaining the passed shared inspector and its AI draft', async () => {
  const s = setup();
  const row = await within(screen.getByRole('region', { name: '当日任务' })).findByRole('button', {
    name: /合成预测任务/,
  });
  const metadata = row.closest('[data-calendar-task]');
  expect(metadata?.textContent).toContain('合成项目');
  expect(metadata?.textContent).toContain('待核对');
  expect(metadata?.textContent).toContain(`计划 ${today}`);
  expect(metadata?.textContent).toContain(`截止 ${today}`);
  expect(metadata?.textContent).toContain('示例负责人');
  expect(
    document.querySelector('.calendar-agenda')?.firstElementChild?.getAttribute('aria-label'),
  ).toBe('预测日期');
  expect(screen.queryByRole('heading', { name: '预测' })).toBeNull();
  expect(screen.queryByRole('button', { name: '显示属性' })).toBeNull();
  const draft = screen.getByLabelText('AI 对话草稿');
  fireEvent.change(draft, { target: { value: '保留当前事项草稿' } });
  fireEvent.click(screen.getByText('无日期任务'));
  fireEvent.click(screen.getByText('日历选项'));
  expect((screen.getByLabelText('AI 对话草稿') as HTMLTextAreaElement).value).toBe(
    '保留当前事项草稿',
  );
  expect(s.mounts()).toBe(1);
  expect(screen.getByRole('complementary', { name: '共用属性与 AI' }).textContent).toContain(
    s.current.id,
  );
});

it('opens original IDs from dated/undated and forecast pages, preserving full-range pagination and a compact important-date preview', async () => {
  const s = setup();
  const important = screen.getByRole('region', { name: '跨日期重要日程' });
  await within(important).findByText('合成日期已过');
  expect(within(important).getByText('合成远期')).toBeTruthy();
  fireEvent.click(within(important).getByRole('button', { name: /查看全部/ }));
  fireEvent.click(await within(important).findByText('合成远期'));
  expect(screen.getByRole('complementary', { name: '共用属性与 AI' }).textContent).toContain(
    s.future.id,
  );
  fireEvent.click(
    within(screen.getByRole('navigation', { name: '预测日期' })).getByRole('button', {
      name: /将来/,
    }),
  );
  const future = screen.getByRole('region', { name: '将来任务' });
  await within(future).findByText('合成远期');
  fireEvent.click(within(future).getByRole('button', { name: '下一页' }));
  await within(future).findByText('合成远期第二页');
  expect(
    s.api.mock.calls.some(
      ([r]) =>
        r.operation === 'calendar_query' && r.query.view === 'future' && r.query.offset === 50,
    ),
  ).toBe(true);
  fireEvent.click(screen.getByText('无日期任务'));
  fireEvent.click(
    within(screen.getByRole('region', { name: '待安排任务' })).getByText('合成无日期'),
  );
  expect(screen.getByRole('complementary', { name: '共用属性与 AI' })).toBeTruthy();
});

it('keeps unknown-save navigation protection across forecast days, range pages and row selection', async () => {
  setup(true);
  const nav = screen.getByRole('navigation', { name: '预测日期' });
  await screen.findByText('合成预测任务');
  expect(within(nav).getByRole('button', { name: /过去/ }).hasAttribute('disabled')).toBe(true);
  expect(
    within(nav)
      .getByRole('button', { name: `查看${today}任务` })
      .hasAttribute('disabled'),
  ).toBe(true);
  expect(screen.getByRole('button', { name: /合成预测任务/ }).hasAttribute('disabled')).toBe(true);
  expect(
    within(screen.getByRole('region', { name: '跨日期重要日程' }))
      .getByRole('button', { name: /合成日期已过/ })
      .hasAttribute('disabled'),
  ).toBe(true);
});

it('includes visible keys before the month grid in the actual count query at a month boundary', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-29T12:00:00'));
  const { api } = setup(false, '2026-12-02');
  await waitFor(() =>
    expect(
      api.mock.calls.some(
        ([request]) =>
          request.operation === 'calendar_query' &&
          request.query.view === 'counts' &&
          request.query.from === '2026-11-29',
      ),
    ).toBe(true),
  );
  expect(screen.getByRole('button', { name: '查看2026-11-29任务' })).toBeTruthy();
});

it('keeps historical due-only tasks in Past instead of inflating the selected-day list beyond its date count', async () => {
  const { api } = setup();
  await within(screen.getByRole('region', { name: '当日任务' })).findByText('合成预测任务');
  expect(
    within(screen.getByRole('region', { name: '当日任务' })).queryByText('合成日期已过'),
  ).toBeNull();
  expect(
    api.mock.calls.some(
      ([request]) =>
        request.operation === 'calendar_query' &&
        request.query.view === 'untimed' &&
        request.query.include_overdue === false,
    ),
  ).toBe(true);
  fireEvent.click(
    within(screen.getByRole('navigation', { name: '预测日期' })).getByRole('button', {
      name: /过去/,
    }),
  );
  await within(screen.getByRole('region', { name: '过去任务' })).findByText('合成日期已过');
});

it.each(['future', 'pending', 'mixed'] as const)(
  'retains the original important-date order for %s in compact, default and home previews',
  async (scenario) => {
    const important = (title: string, due_date: string | null) =>
      makeTask(title, {
        due_date,
        calendar: {
          ...emptyTaskCalendar,
          important: true,
          type_id: 'hearing',
          attention_source: 'due',
        },
      });
    const rows =
      scenario === 'future'
        ? [important('仅未来重要事项', shiftDate(today, 20))]
        : scenario === 'pending'
          ? [important('仅待确认重要事项', null)]
          : [
              important('过去重要事项', shiftDate(today, -2)),
              important('未来重要事项', shiftDate(today, 20)),
            ];
    const api = vi.fn(async (request: TaskRequest): Promise<TaskResponse> => {
      if (request.operation !== 'calendar_query' || request.query.view !== 'important')
        throw Error('Unexpected query');
      return {
        ok: true,
        tasks: rows,
        state: null,
        receipt: null,
        calendar_types: defaultCalendarTypes,
        calendar_pending_count: scenario === 'pending' ? 1 : 0,
        page: { offset: 0, total: rows.length, has_more: false },
      };
    });
    window.caselite = { task: api } as unknown as Window['caselite'];
    const open = vi.fn();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <div data-testid="compact">
          <ImportantSchedules compact onOpen={open} />
        </div>
        <div data-testid="default">
          <ImportantSchedules onOpen={open} />
        </div>
        <div data-testid="home">
          <ImportantSchedules home onOpen={open} />
        </div>
      </QueryClientProvider>,
    );
    for (const mode of ['compact', 'default', 'home']) {
      const container = screen.getByTestId(mode);
      await within(container).findByText(rows[0].title);
      expect(
        Array.from(container.querySelectorAll('[data-important-task]')).map((el) =>
          el.getAttribute('data-important-task'),
        ),
      ).toEqual(rows.map((row) => row.id));
      fireEvent.click(within(container).getByText(rows[0].title));
      expect(open).toHaveBeenLastCalledWith(rows[0].id);
    }
    expect(api.mock.calls.some(([r]) => r.operation === 'calendar_query' && r.query.home)).toBe(
      true,
    );
  },
);
