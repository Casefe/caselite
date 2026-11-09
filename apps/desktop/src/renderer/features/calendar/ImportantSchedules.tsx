import { useState } from 'react';
import { taskStatusNames } from '../../ui/task-status';
import type { CalendarType, Task } from '../../../preload/caselite-api';
import {
  attentionDate,
  attentionGroup,
  attentionTime,
  calendarQuery,
  useCalendar,
} from './calendar-query';

export function ImportantScheduleRow({
  task,
  types,
  onOpen,
}: {
  task: Task;
  types: CalendarType[];
  onOpen(id: string): void;
}) {
  const type = types.find((t) => t.id === task.calendar?.type_id),
    date = attentionDate(task),
    time = attentionTime(task);
  return (
    <button
      className="important-schedule-row"
      data-important-task={task.id}
      onClick={() => onOpen(task.id)}
    >
      <span>
        {date ?? '日期待确认'}
        {time && (
          <small>
            {time} ·{' '}
            {task.calendar?.attention_source === 'schedule'
              ? task.calendar.schedule?.timezone
              : '未指定时区'}
          </small>
        )}
      </span>
      <span>
        <b>{task.title}</b>
        <small>
          {attentionGroup(task)} · {type?.name ?? '未知类型'}
          {type && !type.enabled ? ' · 已停用' : ''}
          {task.status === 'done' || task.status === 'canceled'
            ? ' · ' + taskStatusNames[task.status]
            : ''}
        </small>
      </span>
    </button>
  );
}
export default function ImportantSchedules({
  home = false,
  onOpen,
  onCalendar,
}: {
  home?: boolean;
  onOpen(id: string): void;
  onCalendar?(): void;
}) {
  const [expanded, setExpanded] = useState(false),
    [offset, setOffset] = useState(0),
    [closed, setClosed] = useState(false);
  const read = useCalendar(calendarQuery('important', { home, offset, include_closed: closed }));
  // 待确认数量由全范围查询给出，不用前五条推测，更不能靠recent任务补齐。
  const rows = read.data?.tasks ?? [],
    types = read.data?.calendar_types ?? [];
  const visible = expanded ? rows : rows.slice(0, home ? 5 : 4);
  return (
    <section className="important-schedules" aria-label={home ? '首页重要日程' : '跨日期重要日程'}>
      <header>
        <h3>重要日程{read.data && <small> {read.data.page?.total ?? 0}</small>}</h3>
        {onCalendar && <button onClick={onCalendar}>日历</button>}
      </header>
      {read.isPending && <p role="status">正在读取重要日程…</p>}
      {read.error && (
        <p role="alert">
          重要日程读取失败。<button onClick={() => void read.refetch()}>重读</button>
        </p>
      )}
      <div
        className={`${home ? 'important-preview-home' : 'important-preview-calendar'} ${expanded ? 'is-expanded' : ''}`}
      >
        {visible.map((task) => (
          <ImportantScheduleRow key={task.id} task={task} types={types} onOpen={onOpen} />
        ))}
      </div>
      {read.data && !rows.length && <p>暂无重要日程</p>}
      <p className="calendar-caption">
        {read.data
          ? `日期待确认 ${read.data.calendar_pending_count ?? 0} 项`
          : '待确认数量尚未读取'}{' '}
        · 展示不会创建通知
      </p>
      <button disabled={!read.data} onClick={() => setExpanded(!expanded)}>
        {expanded ? '收起' : '查看全部'}
        {read.data ? ` ${read.data.page?.total ?? 0} 项` : ''}
      </button>
      {expanded && (
        <>
          <label>
            <input
              type="checkbox"
              checked={closed}
              onChange={(e) => {
                setClosed(e.target.checked);
                setOffset(0);
              }}
            />
            查看已完成／已取消
          </label>
          <div className="calendar-pagination">
            <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>
              上一页
            </button>
            <span>
              {offset + 1}—{offset + rows.length}
            </span>
            <button disabled={!read.data?.page?.has_more} onClick={() => setOffset(offset + 50)}>
              下一页
            </button>
          </div>
        </>
      )}
    </section>
  );
}
