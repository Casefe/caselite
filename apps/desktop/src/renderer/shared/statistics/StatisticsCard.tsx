import type { StatisticsModule } from './statistics-preferences';

export type StatisticsRow = {
  id: string;
  label: string;
  value: string;
  progress: number | null;
  tone: 'blue' | 'amber' | 'green';
};

// 比例只控制条长；没有基数时不推断比例，限幅不能改变消费者给出的真实值。
export function statisticsProgress(value: bigint, total: bigint): number | null {
  if (total <= 0n) return null;
  return Number(value <= 0n ? 0n : value >= total ? 10000n : (value * 10000n) / total) / 100;
}

export default function StatisticsCard({
  module,
  title,
  totalLabel,
  total,
  rows,
  note,
}: {
  module: StatisticsModule;
  title: string;
  totalLabel: string;
  total: string;
  rows: readonly StatisticsRow[];
  note?: string;
}) {
  return (
    <section className="statistics-card" aria-label={title} data-statistics-module={module}>
      <h2>{title}</h2>
      <div className="statistics-card-total">
        <strong data-statistic-total>{total}</strong>
        <span>{totalLabel}</span>
      </div>
      <dl className="statistics-card-rows">
        {rows.map((row) => (
          <div key={row.id} data-statistic-row={row.label} data-statistic-id={row.id}>
            <dt>{row.label}</dt>
            <dd>
              <span className="statistics-card-track" aria-hidden="true">
                {row.progress !== null && (
                  <span
                    className={`statistics-card-bar statistics-card-bar--${row.tone}`}
                    style={{ width: `${Math.min(100, Math.max(0, row.progress))}%` }}
                  />
                )}
              </span>
              <span className="statistics-card-value">{row.value}</span>
            </dd>
          </div>
        ))}
      </dl>
      {note && <p className="statistics-card-note">{note}</p>}
    </section>
  );
}
