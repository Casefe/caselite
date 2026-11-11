import type { Task } from '../../../preload/caselite-api';
import { Icon } from '../../shared/ui/Icon';
import { StatusGlyph } from '../../ui/TaskListGlyph';
import { taskPriorityNames } from '../../ui/task-priority';
import { taskStatusNames } from '../../ui/task-status';

export default function CalendarTaskRow({
  task,
  date,
  timed = false,
  selected,
  blocked,
  onOpen,
}: {
  task: Task;
  date: string;
  timed?: boolean;
  selected: boolean;
  blocked: boolean;
  onOpen(id: string): void;
}) {
  const calendar = task.calendar;
  const schedule = calendar?.schedule;
  return (
    <button
      className={`calendar-task-row calendar-forecast-task ${timed ? 'is-timed' : ''}`}
      data-calendar-task={task.id}
      aria-pressed={selected}
      disabled={blocked}
      onClick={() => onOpen(task.id)}
    >
      <StatusGlyph status={task.status} />
      <span className="calendar-task-content">
        <b>{task.title}</b>
        <span className="calendar-task-metadata">
          <span className="calendar-task-project">
            <Icon name="folder" size={13} />
            {task.matter_title ?? (task.matter_id ? '已归组项目' : '独立任务')}
          </span>
          {task.tags?.map((tag) => (
            <span className="calendar-task-tag" key={tag}>
              {tag}
            </span>
          ))}
          <span>{taskStatusNames[task.status]}</span>
          <span>优先级 {taskPriorityNames[task.priority]}</span>
          {calendar?.planned_date && <span>计划 {calendar.planned_date}</span>}
          {task.start_date && <span>开始 {task.start_date}</span>}
          {task.due_date && <span>截止 {task.due_date}</span>}
          {task.assignee && <span>负责人 {task.assignee}</span>}
          {schedule && (
            <span className="calendar-task-schedule">
              <Icon name="clock" size={13} />
              {schedule.date !== date && `${schedule.date} `}
              {schedule.start}–{schedule.end} {schedule.timezone}
            </span>
          )}
          {calendar?.important && <span>☆ 重要</span>}
          {calendar?.important &&
            calendar.attention_source === 'custom' &&
            calendar.attention_time && (
              <span>
                重要关注 {calendar.attention_date} {calendar.attention_time}{' '}
                {calendar.attention_timezone ?? '未指定时区'}
              </span>
            )}
        </span>
      </span>
    </button>
  );
}
