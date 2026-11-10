import type { Matter } from '../../../preload/caselite-api';
import StatisticsCard, { statisticsProgress } from '../../shared/statistics/StatisticsCard';

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
    <StatisticsCard
      module="projects"
      title="项目统计"
      totalLabel="项目总数"
      total={unavailable ? '—' : String(current.length)}
      rows={metrics.slice(1).map((metric, index) => ({
        label: metric.label,
        value: unavailable ? '—' : String(metric.count),
        progress: unavailable
          ? null
          : statisticsProgress(BigInt(metric.count), BigInt(current.length)),
        tone: (['blue', 'amber', 'green'] as const)[index],
      }))}
      note={unavailable ? '数据尚未确认' : undefined}
    />
  );
}
