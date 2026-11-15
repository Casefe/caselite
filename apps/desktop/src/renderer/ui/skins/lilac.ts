import type { SkinDefinition } from './types';

export const lilacSkin = {
  id: 'lilac',
  name: '丁香协作',
  description: '柔和丁香色、宽松留白；客户与跟进事项优先。',
  navigationOrder: [
    'contacts',
    'projects',
    'tasks',
    'calendar',
    'home',
    'documents',
    'finance',
    'knowledge',
    'favorites',
  ],
} as const satisfies SkinDefinition;
