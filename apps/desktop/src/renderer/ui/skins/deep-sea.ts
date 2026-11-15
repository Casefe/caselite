import type { SkinDefinition } from './types';

export const deepSeaSkin = {
  id: 'deep-sea',
  name: '深海效率',
  description: '深海蓝强调与紧凑工具感；项目、任务和日历优先。',
  navigationOrder: [
    'projects',
    'tasks',
    'calendar',
    'documents',
    'home',
    'contacts',
    'finance',
    'knowledge',
    'favorites',
  ],
} as const satisfies SkinDefinition;
