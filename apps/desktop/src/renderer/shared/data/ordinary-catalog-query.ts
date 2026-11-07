import { queryOptions, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

const ordinaryCatalog = queryOptions({
  queryKey: ['catalog', 'ordinary'] as const,
  queryFn: async () => {
    const result = await window.caselite
      .catalog({ protocol_version: 1, operation: 'list' })
      .catch(() => {
        throw new Error('无法读取本地目录，请重试。');
      });
    if (!result.ok) throw new Error(result.message);
    return result;
  },
});

export function invalidateOrdinaryCatalog(client: QueryClient, restartEmpty = true) {
  const filter = { queryKey: ordinaryCatalog.queryKey, exact: true } as const;
  // 旧 IPC 可能仍在宿主执行，但它的结果不应覆盖已提交后的目录。
  void client.cancelQueries(filter);
  // 已有快照的页面保留编辑状态，首次读取没有快照时必须补发，避免停在空白加载态。
  const needsInitialRead =
    restartEmpty && client.getQueryData(ordinaryCatalog.queryKey) === undefined;
  return client.invalidateQueries({ ...filter, refetchType: needsInitialRead ? 'active' : 'none' });
}

export function useOrdinaryCatalog() {
  const client = useQueryClient();
  const read = useQuery(ordinaryCatalog);
  return {
    data: read.data ?? null,
    error: read.error?.message ?? '',
    isFetching: read.isFetching,
    async load() {
      await invalidateOrdinaryCatalog(client, false);
      return client.fetchQuery(ordinaryCatalog);
    },
  };
}
