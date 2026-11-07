import type { Task } from '../../preload/caselite-api';

export const taskStatusNames: Record<Task['status'], string> = {
  todo: '待办',
  in_progress: '进行中',
  done: '已完成',
  canceled: '已取消',
};
