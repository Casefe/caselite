import { useState, type ReactNode } from 'react';
import type { Task } from '../../../preload/caselite-api';
import { calendarQuery, localDate, shiftDate, useCalendar } from './calendar-query';
import ImportantSchedules from './ImportantSchedules';
import { taskPriorityNames } from '../../ui/task-priority';

function TimeLabel({ task, date }: { task: Task; date: string }) {
  const c = task.calendar;
  return (
    <span>
      {c?.schedule?.date === date
        ? `${c.schedule.start}–${c.schedule.end}`
        : `${c?.attention_time} · 重要关注`}
      <small>{c?.schedule?.date === date ? c.schedule.timezone : '关注时刻，未指定时区'}</small>
    </span>
  );
}
export default function CalendarView({
  date,
  onDate,
  selected,
  inspector,
  blocked,
  onOpen,
  onClose,
  onReminders,
  onSettings,
}: {
  date: string;
  onDate(date: string): void;
  selected: Task | null;
  inspector: ReactNode;
  blocked: boolean;
  onOpen(id: string): void;
  onClose(): void;
  onReminders(): void;
  onSettings(): void;
}) {
  const [datesOpen, setDatesOpen] = useState(false),
    [offset, setOffset] = useState(0),
    [timedOffset, setTimedOffset] = useState(0),
    [undatedOffset, setUndatedOffset] = useState(0),
    [closed, setClosed] = useState(false);
  const today = localDate(),
    first = date.slice(0, 7) + '-01';
  const start = shiftDate(first, -((new Date(`${first}T12:00:00`).getDay() + 6) % 7)),
    days = Array.from({ length: 42 }, (_, i) => shiftDate(start, i));
  const counts = useCalendar(
    calendarQuery('counts', { date, from: days[0], to: days[41], include_closed: closed }),
  );
  const timed = useCalendar(
    calendarQuery('timed', { date, offset: timedOffset, include_closed: closed }),
  );
  const day = useCalendar(
    calendarQuery('untimed', {
      date,
      offset,
      include_closed: closed,
      include_overdue: date === today,
    }),
  );
  const undated = useCalendar(
    calendarQuery('undated', { date, offset: undatedOffset, include_closed: closed }),
  );
  function choose(value: string) {
    if (blocked) return;
    onDate(value);
    setOffset(0);
    setTimedOffset(0);
    setDatesOpen(false);
  }
  const dayRows = day.data?.tasks ?? [];
  function rows(items: Task[], time = false) {
    return items.map((t) => (
      <button
        key={t.id}
        className={`calendar-task-row ${time ? 'is-timed' : ''}`}
        data-calendar-task={t.id}
        aria-pressed={selected?.id === t.id}
        onClick={() => onOpen(t.id)}
      >
        {time && <TimeLabel task={t} date={date} />}
        <span>
          <b>{t.title}</b>
          <small>
            {t.calendar?.important ? '☆ 重要 · ' : ''}
            {t.matter_title ?? '独立任务'}
            {t.due_date ? ` · 截止 ${t.due_date}` : ''}
          </small>
        </span>
        <small>{taskPriorityNames[t.priority]}</small>
      </button>
    ));
  }
  function page(read: typeof day, value: number, set: (n: number) => void) {
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
      className={`calendar-workbench ${datesOpen ? 'calendar-dates-open' : ''} ${selected ? 'calendar-task-open' : ''}`}
      aria-label="日历工作台"
    >
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
        <ImportantSchedules onOpen={onOpen} />
        <section aria-label="本日工作安排" className="calendar-timed-summary">
          <h3>本日工作安排</h3>
          <small>{date} · 仅具体时刻</small>
          {rows(timed.data?.tasks ?? [], true)}
          {!timed.data?.tasks.length && !timed.isPending && !timed.error && (
            <p>本日尚无具体时间安排</p>
          )}
          {page(timed, timedOffset, setTimedOffset)}
        </section>
        <button onClick={onReminders}>提醒收件箱</button>
        <button onClick={onSettings}>日历与类型设置</button>
        <p className="calendar-caption">
          按记录日期归组，不作跨时区投影。数量按Task去重；不计算法律期间。外部同步尚未接入。
        </p>
      </aside>
      <main className="calendar-agenda">
        <header>
          <button className="calendar-open-dates" onClick={() => setDatesOpen(true)}>
            日期与重要日程
          </button>
          <h1>{date === today ? '今日' : date}工作台</h1>
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
              }}
            />
            显示已完成／已取消
          </label>
        </header>
        {[counts, day, timed, undated].some((r) => r.error) && (
          <div role="alert">
            日历读取失败，未修改原数据。
            <button
              onClick={() => {
                void counts.refetch();
                void day.refetch();
                void timed.refetch();
                void undated.refetch();
              }}
            >
              重读日历
            </button>
          </div>
        )}
        {(day.isPending || timed.isPending || undated.isPending) && (
          <p role="status">正在读取日历…</p>
        )}
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
        <section aria-label="待安排任务">
          <h2>待安排／无日期任务</h2>
          {rows(undated.data?.tasks ?? [])}
          {page(undated, undatedOffset, setUndatedOffset)}
        </section>
      </main>
      <div className="calendar-task-inspector" aria-label="日历所选任务">
        {selected ? (
          <>
            <header>
              <small>同一任务 · {selected.id}</small>
              <button onClick={onClose}>关闭任务详情</button>
            </header>
            {inspector}
          </>
        ) : (
          <p>选择任意任务查看真实属性与AI对话。</p>
        )}
      </div>
    </section>
  );
}
