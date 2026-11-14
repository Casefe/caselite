import type { QueryClient } from '@tanstack/react-query';
import { taskPages } from './task-list-query';
import { calendarQueries } from '../shared/data/calendar-query';

export async function refreshTaskConsumers(client: QueryClient) {
  const filters = [taskPages, calendarQueries].map((queryKey) => ({ queryKey }));
  await Promise.all(filters.map((filter) => client.cancelQueries(filter)));
  await Promise.all(
    filters.map((filter) => client.invalidateQueries({ ...filter, refetchType: 'none' })),
  );
  const consumers = filters
    .flatMap((filter) => client.getQueryCache().findAll(filter))
    .filter((query) => query.getObserversCount() > 0);
  // 完成确认期间任务页会暂停自动读取；显式读取现有查询，不等解锁后才刷新。
  // 所有真实消费者读回成功才能释放原操作，失败继续保留只读恢复入口。
  await Promise.all(
    consumers.map((query) =>
      client.fetchQuery({
        ...query.options,
        queryKey: query.queryKey,
        staleTime: 0,
        retry: false,
      }),
    ),
  );
}
