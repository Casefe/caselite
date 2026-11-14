import type { StatisticsRow } from './StatisticsCard';
import type { StatisticsModule } from './statistics-preferences';

type Field = Pick<StatisticsRow, 'id' | 'label' | 'tone'>;
type Config = {
  module: StatisticsModule;
  title: string;
  totalLabel: string;
  fields: readonly Field[];
};

export const taskStatistics = {
  module: 'tasks',
  title: '任务统计',
  totalLabel: '总任务',
  fields: [
    { id: 'todo', label: '未开始', tone: 'blue' },
    { id: 'in_progress', label: '进行中', tone: 'amber' },
    { id: 'done', label: '已完成', tone: 'green' },
  ],
} as const satisfies Config;

export const projectStatistics = {
  module: 'projects',
  title: '项目统计',
  totalLabel: '项目总数',
  fields: [
    { id: 'active', label: '进行中', tone: 'blue' },
    { id: 'planned', label: '待启动', tone: 'amber' },
    { id: 'done', label: '已结项', tone: 'green' },
  ],
} as const satisfies Config;

export const financeStatistics = {
  module: 'finance',
  title: '财务统计',
  totalLabel: '总收入',
  fields: [
    { id: 'invoiced', label: '已开票', tone: 'blue' },
    { id: 'received', label: '已收款', tone: 'green' },
    { id: 'outstanding', label: '待收款', tone: 'amber' },
  ],
} as const satisfies Config;

type DisplayValue = Pick<StatisticsRow, 'value' | 'progress'>;

export function buildStatisticsRows<Id extends string>(
  fields: readonly (Field & { id: Id })[],
  values: Record<Id, DisplayValue>,
): StatisticsRow[] {
  const ids = new Set<string>();
  for (const field of fields) {
    if (!field.id || ids.has(field.id)) {
      throw new Error(`Invalid or duplicate statistic id: ${field.id}`);
    }
    ids.add(field.id);
    if (!Object.hasOwn(values, field.id) || values[field.id] == null) {
      throw new Error(`Missing statistic value: ${field.id}`);
    }
  }
  for (const id of Object.keys(values)) {
    if (!ids.has(id)) throw new Error(`Unknown statistic value: ${id}`);
  }
  return fields.map((field) => ({ ...field, ...values[field.id] }));
}
