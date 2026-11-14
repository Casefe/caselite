import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { TaskListQuery } from '../../preload/caselite-api';

export const taskPages = ['task-list', 'pages'] as const;

export function invalidateTaskPages(client: QueryClient) {
  // IPC 本身不可中止。先取消缓存里的旧读取，避免它在提交之后写回过期结果。
  void client.cancelQueries({ queryKey: taskPages });
  void client.invalidateQueries({ queryKey: taskPages });
}

export function useTaskPage(query: TaskListQuery, enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    // 禁用只会阻止新的自动读取。编辑开始时也要丢弃已在途的响应，保护属性草稿。
    if (!enabled) void client.cancelQueries({ queryKey: [...taskPages, query], exact: true });
  }, [client, enabled, query]);
  return useQuery({
    queryKey: [...taskPages, query],
    enabled,
    queryFn: async () => {
      const result = await window.caselite.task({
        operation: 'list',
        protocol_version: 1,
        query,
      });
      if (!result.ok) throw new Error(result.message);
      if (!result.page) throw new Error('任务列表响应缺少分页信息，请使用当前版本。');
      return { rows: result.tasks, page: result.page };
    },
  });
}
