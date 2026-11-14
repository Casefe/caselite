import type { Matter } from '../../../preload/caselite-api';
import StatisticsCard, { statisticsProgress } from '../../shared/statistics/StatisticsCard';
import { projectStatistics, buildStatisticsRows } from '../../shared/statistics/statistics-config';

export default function ProjectMetrics({
  projects,
  unavailable,
}: {
  projects: Matter[];
  unavailable: boolean;
}) {
  const current = projects.filter((project) => !project.archived_at);
  const display = (count: number) => ({
    value: unavailable ? '—' : String(count),
    progress: unavailable ? null : statisticsProgress(BigInt(count), BigInt(current.length)),
  });
  return (
    <StatisticsCard
      module={projectStatistics.module}
      title={projectStatistics.title}
      totalLabel={projectStatistics.totalLabel}
      total={unavailable ? '—' : String(current.length)}
      rows={buildStatisticsRows(projectStatistics.fields, {
        active: display(current.filter((p) => p.status === 'active').length),
        planned: display(current.filter((p) => p.status === 'planned').length),
        done: display(current.filter((p) => p.status === 'done').length),
      })}
      note={unavailable ? '数据尚未确认' : undefined}
    />
  );
}
