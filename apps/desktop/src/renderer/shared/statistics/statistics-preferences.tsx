import type { ReactNode } from 'react';
import type { LocalPreferenceValues } from '../../../preload/caselite-api';
import { useLocalPreferences, defaultStatisticsCards } from '../../shared/data/LocalPreferences';
import type { InspectorCard } from '../../ui/InspectorCards';

export type StatisticsPreferences = NonNullable<LocalPreferenceValues['statistics_cards']>;
export type StatisticsModule = keyof StatisticsPreferences;
export const statisticsModules: readonly { id: StatisticsModule; label: string }[] = [
  { id: 'tasks', label: '任务' },
  { id: 'projects', label: '项目' },
  { id: 'finance', label: '财务' },
  { id: 'contacts', label: '联系人' },
];
export function statisticsPreferences(
  values: LocalPreferenceValues['statistics_cards'],
): StatisticsPreferences {
  return {
    tasks: values?.tasks ?? defaultStatisticsCards.tasks,
    projects: values?.projects ?? defaultStatisticsCards.projects,
    finance: values?.finance ?? defaultStatisticsCards.finance,
    // 本期联系人能力未启用；恢复配置也不能绕过消费者限制。
    contacts: { enabled: false, position: values?.contacts.position ?? 'top' },
  };
}
export function useStatisticsCards(
  module: StatisticsModule,
  content: ReactNode,
  visible = true,
): readonly InspectorCard[] {
  const { preferences, ready } = useLocalPreferences();
  const settings = statisticsPreferences(preferences.statistics_cards)[module];
  return ready && visible && module !== 'contacts' && settings.enabled
    ? [{ id: `${module}-statistics`, position: settings.position, content }]
    : [];
}
