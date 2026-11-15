import type { SkinDefinition } from './types';

export const paperSkin = {
  id: 'paper',
  name: '纸白专注',
  description: '纸面与墨色层次、清晰文字；首页与文档优先。',
  navigationOrder: [
    'home',
    'documents',
    'knowledge',
    'projects',
    'tasks',
    'calendar',
    'contacts',
    'finance',
    'favorites',
  ],
} as const satisfies SkinDefinition;
