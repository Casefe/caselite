import type { TaskCompletionActions } from '../../ui/SharedTaskTable';
import WorkspacePageChrome, {
  closeWorkspaceDisplayOnEscape,
} from '../../shared/ui/WorkspacePageChrome';
import { usePageNavigation } from '../../shared/navigation/PageNavigation';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Task } from '../../../preload/caselite-api';
import { calendarQuery, localDate, shiftDate, useCalendar } from './calendar-query';
import ImportantSchedules from './ImportantSchedules';
import CalendarTaskRow from './CalendarTaskRow';
import ResizeSeparator from '../../ui/ResizeSeparator';
import { useCalendarLayout } from './useCalendarLayout';

export default function CalendarView({
  date,
  onCreate,
  onDate,
  selected,
  inspector,
  blocked,
  onOpen,
  onClose,
  completion,
}: {
  date: string;
  completion?: TaskCompletionActions;
  onCreate?(mode: 'task' | 'schedule'): void;
  onDate(date: string): void;
  selected: Task | null;
  inspector: ReactNode;
  blocked: boolean;
  onOpen(id: string): void;
  onClose(): void;
  onReminders(): void;
  onSettings(): void;
}) {
  const chromeFiltersId = useId();
  const pageNavigation = usePageNavigation();
  const layoutRoot = useRef<HTMLElement>(null);
  const layout = useCalendarLayout(layoutRoot);
  useLayoutEffect(() => {
    const root = layoutRoot.current;
    const chrome = root?.querySelector<HTMLElement>(':scope > .workspace-page-chrome');
    if (!root || !chrome) return;
    // 浮动区使用视口坐标；标题筛选换行或容器位置变化时同步实际底边。
    const measure = () =>
      root.style.setProperty(
        '--calendar-chrome-bottom',
        `${chrome.getBoundingClientRect().bottom}px`,
      );
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(chrome);
    observer?.observe(root);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('pageshow', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('pageshow', measure);
      root.style.removeProperty('--calendar-chrome-bottom');
    };
  }, []);
  const [datesOpen, setDatesOpen] = useState(false),
    [offset, setOffset] = useState(0),
    [timedOffset, setTimedOffset] = useState(0),
    [undatedOffset, setUndatedOffset] = useState(0),
    [closed, setClosed] = useState(false),
    [range, setRange] = useState<'day' | 'past' | 'future'>('day'),
    [rangeOffset, setRangeOffset] = useState(0),
    [calendarOptionsOpen, setCalendarOptionsOpen] = useState(false);
  const today = localDate(),
    first = date.slice(0, 7) + '-01';
  const start = shiftDate(first, -((new Date(`${first}T12:00:00`).getDay() + 6) % 7)),
    days = Array.from({ length: 42 }, (_, i) => shiftDate(start, i));
  const stripStart = date >= today && date <= shiftDate(today, 6) ? today : date;
  const stripDates = Array.from({ length: 7 }, (_, i) => shiftDate(stripStart, i));
  const stripEnd = stripDates[6];
  const counts = useCalendar(
    calendarQuery('counts', {
      date,
      from: days[0] < stripStart ? days[0] : stripStart,
      to: days[41] > stripEnd ? days[41] : stripEnd,
      include_closed: closed,
    }),
  );
  const timed = useCalendar(
    calendarQuery('timed', { date, offset: timedOffset, include_closed: closed }),
  );
  const day = useCalendar(
    calendarQuery('untimed', {
      date,
      offset,
      include_closed: closed,
      include_overdue: false,
    }),
  );
  const undated = useCalendar(
    calendarQuery('undated', { date, offset: undatedOffset, include_closed: closed }),
  );
  const past = useCalendar(
    calendarQuery('past', {
      date: stripStart,
      include_closed: closed,
      offset: range === 'past' ? rangeOffset : 0,
    }),
  );
  const future = useCalendar(
    calendarQuery('future', {
      date: stripEnd,
      include_closed: closed,
      offset: range === 'future' ? rangeOffset : 0,
    }),
  );
  function chooseRange(value: 'past' | 'future') {
    if (blocked) return;
    setRange(value);
    setRangeOffset(0);
    onClose();
  }
  function choose(value: string) {
    if (blocked) return;
    onDate(value);
    setRange('day');
    setRangeOffset(0);
    setOffset(0);
    setTimedOffset(0);
    setDatesOpen(false);
  }
  const dayRows = day.data?.tasks ?? [];
  function rows(items: Task[], time = false) {
    return items.map((task) => (
      <CalendarTaskRow
        key={task.id}
        task={task}
        date={date}
        timed={time}
        selected={selected?.id === task.id}
        blocked={blocked}
        onOpen={onOpen}
        completion={completion}
      />
    ));
  }
  function page(read: typeof day, value: number, set: (n: number) => void) {
    if (!value && !read.data?.page?.has_more) return null;
    return (
      <div className="calendar-pagination">
        <button disabled={!value || blocked} onClick={() => set(Math.max(0, value - 50))}>
          上一页
        </button>
        <small>共{read.data?.page?.total ?? 0}项</small>
        <button disabled={!read.data?.page?.has_more || blocked} onClick={() => set(value + 50)}>
          下一页
        </button>
      </div>
    );
  }
  return (
    <section
      ref={layoutRoot}
      style={layout.style}
      className={`calendar-workbench workspace-has-page-chrome ${datesOpen ? 'calendar-dates-open' : ''} ${selected ? 'calendar-task-open' : ''}`}
      aria-label="日历工作台"
    >
      <WorkspacePageChrome
        title="日历"
        createLabel="新建日历"
        create={{ onClick: onCreate ? () => onCreate('schedule') : undefined, disabled: blocked }}
        navigation={
          <>
            <button
              type="button"
              aria-label="筛选栏上个月"
              disabled={blocked}
              onClick={() => {
                const value = new Date(`${first}T12:00:00`);
                value.setMonth(value.getMonth() - 1);
                choose(localDate(value));
              }}
            >
              ‹
            </button>
            <span>{date.slice(0, 7)}</span>
            <button
              type="button"
              aria-label="筛选栏下个月"
              disabled={blocked}
              onClick={() => {
                const value = new Date(`${first}T12:00:00`);
                value.setMonth(value.getMonth() + 1);
                choose(localDate(value));
              }}
            >
              ›
            </button>
            <button type="button" disabled={blocked} onClick={() => choose(today)}>
              今天
            </button>
            <details className="workspace-page-more" onKeyDown={closeWorkspaceDisplayOnEscape}>
              <summary>更多</summary>
              <button
                type="button"
                disabled={blocked || !onCreate}
                onClick={() => onCreate?.('task')}
              >
                新建任务
              </button>
            </details>
          </>
        }
        search={{ unavailableReason: '日历暂不支持全范围搜索' }}
        filter={{
          expanded: calendarOptionsOpen,
          controls: chromeFiltersId,
          disabled: blocked,
          onClick: () => {
            if (!calendarOptionsOpen) setDatesOpen(true);
            setCalendarOptionsOpen((open) => !open);
          },
        }}
        displayAction={{
          expanded: calendarOptionsOpen,
          controls: chromeFiltersId,
          disabled: blocked,
          onClick: () => {
            if (!calendarOptionsOpen) setDatesOpen(true);
            setCalendarOptionsOpen((open) => !open);
          },
        }}
        inspector={
          pageNavigation
            ? {
                expanded: pageNavigation.inspector.open,
                disabled: blocked,
                onClick: () => pageNavigation.inspector.setOpen((open) => !open),
              }
            : undefined
        }
      />
      <aside className="calendar-dates" aria-label="日期与安排">
        <header>
          <h2>日历</h2>
          <button className="calendar-close-dates" onClick={() => setDatesOpen(false)}>
            关闭日期
          </button>
        </header>
        <nav className="calendar-month">
          <button
            aria-label="上个月"
            disabled={blocked}
            onClick={() => {
              const d = new Date(`${first}T12:00:00`);
              d.setMonth(d.getMonth() - 1);
              choose(localDate(d));
            }}
          >
            ‹
          </button>
          <strong>{date.slice(0, 7)}</strong>
          <button
            aria-label="下个月"
            disabled={blocked}
            onClick={() => {
              const d = new Date(`${first}T12:00:00`);
              d.setMonth(d.getMonth() + 1);
              choose(localDate(d));
            }}
          >
            ›
          </button>
        </nav>
        <div className="calendar-weekdays">
          {'一二三四五六日'.split('').map((v) => (
            <small key={v}>{v}</small>
          ))}
        </div>
        <div className="calendar-date-grid">
          {days.map((d) => (
            <button
              key={d}
              disabled={blocked}
              className={d.slice(0, 7) === date.slice(0, 7) ? '' : 'muted'}
              aria-label={
                counts.data
                  ? `${d}，${counts.data.calendar_counts?.find((v) => v.date === d)?.count ?? 0}个任务`
                  : `${d}，任务数尚未读取`
              }
              aria-pressed={d === date}
              onClick={() => choose(d)}
            >
              <span>{+d.slice(8)}</span>
              <small>{counts.data?.calendar_counts?.find((v) => v.date === d)?.count || ''}</small>
            </button>
          ))}
        </div>
        <button disabled={blocked} onClick={() => choose(today)}>
          返回今日
        </button>
        <ImportantSchedules onOpen={onOpen} compact title="重要日期" blocked={blocked} />
        <details
          className="calendar-options"
          id={chromeFiltersId}
          open={
            calendarOptionsOpen || !!layout.preferences.error || layout.preferences.phase !== 'idle'
          }
          onToggle={(event) => setCalendarOptionsOpen(event.currentTarget.open)}
        >
          <summary>日历选项</summary>
          <label>
            <input
              type="checkbox"
              checked={closed}
              disabled={blocked}
              onChange={(e) => {
                setClosed(e.target.checked);
                setOffset(0);
                setTimedOffset(0);
                setUndatedOffset(0);
                setRangeOffset(0);
              }}
            />
            显示已完成／已取消
          </label>
          <div className="calendar-layout-controls" aria-label="日历布局偏好">
            <button disabled={layout.pending} onClick={layout.reset}>
              重置布局
            </button>
            <button disabled={layout.pending} onClick={() => void layout.preferences.reload()}>
              重读布局偏好
            </button>
            {layout.preferences.error && <p role="alert">{layout.preferences.error}</p>}
            {layout.preferences.phase === 'verify' && (
              <button
                disabled={layout.preferences.pending}
                onClick={() => void layout.preferences.verify()}
              >
                核对布局保存结果
              </button>
            )}
            {layout.preferences.phase === 'retry' && (
              <button
                disabled={layout.preferences.pending}
                onClick={() => void layout.preferences.retry()}
              >
                重试原布局提交
              </button>
            )}
            {layout.preferences.error && layout.preferences.phase === 'idle' && (
              <>
                {layout.dirty && (
                  <button disabled={layout.pending} onClick={layout.save}>
                    保存当前布局
                  </button>
                )}
              </>
            )}
          </div>
        </details>
        {layout.preferences.notice && <small role="status">{layout.preferences.notice}</small>}
      </aside>
      <ResizeSeparator
        label="调整日期区宽度"
        className="calendar-left-separator"
        value={layout.limits.dates}
        min={220}
        max={layout.limits.datesMax}
        disabled={layout.pending}
        onPreview={(value) => layout.change('dates_width', value)}
        onCommit={(value) => layout.commit('dates_width', value)}
        onCancel={layout.cancel}
      />
      <main className="calendar-agenda">
        <nav className="calendar-forecast-strip" aria-label="预测日期">
          <button className="calendar-open-dates" onClick={() => setDatesOpen(true)}>
            日期与重要日程
          </button>
          <button
            disabled={blocked}
            aria-pressed={range === 'past'}
            onClick={() => chooseRange('past')}
          >
            <span>过去</span>
            <strong>{past.data?.page?.total ?? '…'}</strong>
          </button>
          {stripDates.map((value) => (
            <button
              key={value}
              disabled={blocked}
              aria-label={`查看${value}任务`}
              aria-pressed={range === 'day' && value === date}
              onClick={() => choose(value)}
            >
              <span>
                {value === today
                  ? '今天'
                  : `${'日一二三四五六'[new Date(`${value}T12:00:00`).getDay()]} ${+value.slice(8)}`}
              </span>
              <strong>
                {counts.data
                  ? (counts.data.calendar_counts?.find((v) => v.date === value)?.count ?? 0)
                  : '…'}
              </strong>
            </button>
          ))}
          <button
            disabled={blocked}
            aria-pressed={range === 'future'}
            onClick={() => chooseRange('future')}
          >
            <span>将来</span>
            <strong>{future.data?.page?.total ?? '…'}</strong>
          </button>
        </nav>
        {[counts, day, timed, undated, past, future].some((r) => r.error) && (
          <div role="alert">
            日历读取失败，未修改原数据。
            <button
              onClick={() => {
                void counts.refetch();
                void day.refetch();
                void timed.refetch();
                void undated.refetch();
                void past.refetch();
                void future.refetch();
              }}
            >
              重读日历
            </button>
          </div>
        )}
        {(range === 'day'
          ? day.isPending || timed.isPending
          : range === 'past'
            ? past.isPending
            : future.isPending) && <p role="status">正在读取日历…</p>}
        {range !== 'day' ? (
          <section aria-label={range === 'past' ? '过去任务' : '将来任务'}>
            <h2>{range === 'past' ? '日期已过 · 待核对' : '后续任务'}</h2>
            {rows((range === 'past' ? past : future).data?.tasks ?? [])}
            {page(range === 'past' ? past : future, rangeOffset, setRangeOffset)}
          </section>
        ) : (
          <>
            <section aria-label="当日工作安排">
              <h2>
                工作安排 <small>{timed.data?.page?.total ?? 0}</small>
              </h2>
              {rows(timed.data?.tasks ?? [], true)}
              {page(timed, timedOffset, setTimedOffset)}
            </section>
            <section aria-label="当日任务">
              <h2>其他当日任务</h2>
              {rows(dayRows)}
              {!dayRows.length && !day.isPending && <p>本页暂无其他当日任务</p>}
              {page(day, offset, setOffset)}
            </section>
          </>
        )}
        <details className="calendar-undated-tasks">
          <summary>无日期任务</summary>
          <section aria-label="待安排任务">
            <h2>待安排／无日期任务</h2>
            {undated.isPending && <p role="status">正在读取无日期任务…</p>}
            {rows(undated.data?.tasks ?? [])}
            {page(undated, undatedOffset, setUndatedOffset)}
          </section>
        </details>
      </main>
      <ResizeSeparator
        label="调整任务属性栏宽度"
        className="calendar-right-separator"
        value={layout.limits.inspector}
        min={280}
        max={layout.limits.inspectorMax}
        direction={-1}
        disabled={layout.pending}
        onPreview={(value) => layout.change('inspector_width', value)}
        onCommit={(value) => layout.commit('inspector_width', value)}
        onCancel={layout.cancel}
      />
      <div className="calendar-task-inspector" aria-label="日历所选任务">
        {selected ? (
          <>
            <button className="calendar-close-inspector" disabled={blocked} onClick={onClose}>
              关闭任务详情
            </button>
            {inspector}
          </>
        ) : (
          <p>选择任意任务查看真实属性与AI对话。</p>
        )}
      </div>
    </section>
  );
}
