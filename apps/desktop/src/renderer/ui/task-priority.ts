import type { Task } from '../../preload/caselite-api';

export const taskPriorityNames: Record<Task['priority'], string> = {
  0: '未设置',
  1: '紧急',
  2: '高',
  3: '普通',
  4: '低',
};
