import type { Matter } from '../../../preload/caselite-api';
import { Icon } from '../../shared/ui/Icon';

export default function ProjectMetrics({
  projects,
  unavailable,
}: {
  projects: Matter[];
  unavailable: boolean;
}) {
  const current = projects.filter((project) => !project.archived_at);
  const metrics = [
    { label: '项目总数', count: current.length, icon: 'folder', hint: '全部未归档项目' },
    {
      label: '进行中',
      count: current.filter((p) => p.status === 'active').length,
      icon: 'calendar',
      hint: '持续跟进',
    },
    {
      label: '待启动',
      count: current.filter((p) => p.status === 'planned').length,
      icon: 'clock',
      hint: '准备开展',
    },
    {
      label: '已结项',
      count: current.filter((p) => p.status === 'done').length,
      icon: 'check',
      hint: '已完成项目',
    },
  ];
  return (
    <section className="project-dashboard-metrics" aria-label="项目统计">
      {metrics.map((metric, index) => (
        <div key={metric.label} className={`project-metric project-metric--${index}`}>
          <span className="project-metric-icon">
            <Icon name={metric.icon} size={22} />
          </span>
          <dl>
            <dt>{metric.label}</dt>
            <dd>{unavailable ? '—' : metric.count}</dd>
            <dd className="project-metric-hint">{unavailable ? '数据尚未确认' : metric.hint}</dd>
          </dl>
        </div>
      ))}
    </section>
  );
}
