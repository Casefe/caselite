import StatisticsCard, { statisticsProgress } from '../../shared/statistics/StatisticsCard';
import type { Task } from '../../../preload/caselite-api';

export default function TaskListSummary({
  tasks,
  disabled,
  onOpen,
  variant = 'all',
}: {
  tasks: Task[];
  disabled: boolean;
  onOpen(id: string): void;
  variant?: 'all' | 'stats' | 'deadlines';
}) {
  const total = BigInt(tasks.length);
  const statistics = (
    <StatisticsCard
      module="tasks"
      title="任务统计"
      totalLabel="总任务"
      total={String(tasks.length)}
      rows={[
        {
          label: '未开始',
          count: tasks.filter((task) => !task.status || task.status === 'todo').length,
          tone: 'blue' as const,
        },
        {
          label: '进行中',
          count: tasks.filter((task) => task.status === 'in_progress').length,
          tone: 'amber' as const,
        },
        {
          label: '已完成',
          count: tasks.filter((task) => task.status === 'done').length,
          tone: 'green' as const,
        },
      ].map(({ label, count, tone }) => ({
        label,
        value: String(count),
        tone,
        progress: statisticsProgress(BigInt(count), total),
      }))}
    />
  );
  if (variant === 'stats') return statistics;
  const today = new Date();
  const dateKey = (date: Date) =>
    [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((value) => String(value).padStart(2, '0'))
      .join('-');
  const upcomingEnd = new Date(today);
  upcomingEnd.setDate(today.getDate() + 7);
  const start = dateKey(today);
  const end = dateKey(upcomingEnd);
  const open = tasks.filter((task) => task.status !== 'done' && task.status !== 'canceled');
  const due = open
    .filter((task) => task.due_date)
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!) || a.id.localeCompare(b.id));
  const groups = [
    { title: '已逾期', items: due.filter((task) => task.due_date! < start), style: 'overdue' },
    { title: '今日到期', items: due.filter((task) => task.due_date === start), style: 'today' },
    {
      title: '即将到期',
      items: due.filter((task) => task.due_date! > start && task.due_date! <= end),
      style: 'soon',
    },
  ];
  return (
    <div className="task-list-summary">
      {variant !== 'deadlines' && statistics}
      {groups.map(({ title, items, style }) => (
        <section key={style} data-deadline-group={style}>
          <h2>
            {title} <span>{items.length}</span>
          </h2>
          {!items.length && <p>暂无任务</p>}
          <ul>
            {items.slice(0, 5).map((task) => (
              <li key={task.id}>
                <button type="button" disabled={disabled} onClick={() => onOpen(task.id)}>
                  <strong>{task.title}</strong>
                  <time dateTime={task.due_date ?? undefined}>{task.due_date}</time>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
