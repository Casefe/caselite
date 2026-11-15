import type { SkinDefinition } from './types';

export const pineSkin = {
  id: 'pine',
  name: '松绿审阅',
  description: '松绿强调、紧凑对齐；文档、资料与任务优先。',
  navigationOrder: [
    'documents',
    'tasks',
    'knowledge',
    'home',
    'projects',
    'calendar',
    'contacts',
    'finance',
    'favorites',
  ],
} as const satisfies SkinDefinition;
