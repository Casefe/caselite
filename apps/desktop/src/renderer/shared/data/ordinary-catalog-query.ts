import { queryOptions, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

function catalogQuery(projectProperties: boolean) {
  return queryOptions({
    queryKey: ['catalog', projectProperties ? 'project-properties' : 'ordinary'] as const,
    queryFn: async () => {
      const result = await window.caselite
        .catalog({
          protocol_version: 1,
          operation: 'list',
          ...(projectProperties && { project_properties: true as const }),
        })
        .catch(() => {
          throw new Error('无法读取本地目录，请重试。');
        });
      if (!result.ok) throw new Error(result.message);
      return result;
    },
  });
}
const ordinaryCatalog = catalogQuery(false);
const projectCatalog = catalogQuery(true);

export function invalidateOrdinaryCatalog(
  client: QueryClient,
  restartEmpty = true,
  refreshActive = false,
) {
  const filter = { queryKey: ordinaryCatalog.queryKey, exact: true } as const;
  // 旧 IPC 可能仍在宿主执行，但它的结果不应覆盖已提交后的目录。
  void client.cancelQueries(filter);
  // 已有快照的页面保留编辑状态，首次读取没有快照时必须补发，避免停在空白加载态。
  const needsInitialRead =
    restartEmpty && client.getQueryData(ordinaryCatalog.queryKey) === undefined;
  return client.invalidateQueries({
    ...filter,
    refetchType: needsInitialRead || refreshActive ? 'active' : 'none',
  });
}

export function invalidateProjectCatalog(
  client: QueryClient,
  refetchType: 'none' | 'active' = 'none',
) {
  const filter = { queryKey: projectCatalog.queryKey, exact: true } as const;
  void client.cancelQueries(filter);
  const needsInitialRead = client.getQueryData(projectCatalog.queryKey) === undefined;
  return client.invalidateQueries({
    ...filter,
    refetchType: needsInitialRead ? 'active' : refetchType,
  });
}

export function useProjectCatalog() {
  const client = useQueryClient();
  const read = useQuery(projectCatalog);
  return {
    data: read.data ?? null,
    error: read.error?.message ?? '',
    isFetching: read.isFetching,
    async load() {
      await client.cancelQueries({ queryKey: projectCatalog.queryKey, exact: true });
      await client.invalidateQueries({
        queryKey: projectCatalog.queryKey,
        exact: true,
        refetchType: 'none',
      });
      return client.fetchQuery(projectCatalog);
    },
  };
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
