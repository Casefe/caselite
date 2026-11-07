import { QueryClient, useQuery } from '@tanstack/react-query';
import type { TaskListQuery } from '../../preload/caselite-api';

const taskPages = ['task-list', 'pages'] as const;

export function createTaskListQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'always',
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function invalidateTaskPages(client: QueryClient) {
  // IPC 本身不可中止。先取消缓存里的旧读取，避免它在提交之后写回过期结果。
  void client.cancelQueries({ queryKey: taskPages });
  void client.invalidateQueries({ queryKey: taskPages });
}

export function useTaskPage(query: TaskListQuery, enabled: boolean) {
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
