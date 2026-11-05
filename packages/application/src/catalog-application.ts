import {
  catalogRequestSchema,
  type CatalogRequest,
  type CatalogResponse,
} from '@caselite/contracts';
export interface CatalogPort {
  execute(request: CatalogRequest): CatalogResponse;
}
export function createCatalogApplication(port: CatalogPort) {
  return {
    execute(input: unknown): CatalogResponse {
      const request = catalogRequestSchema.safeParse(input);
      if (!request.success)
        return {
          ok: false,
          code: 'INVALID_REQUEST',
          message: '名称、版本或分类格式无效，输入已保留。',
        };
      try {
        return port.execute(request.data);
      } catch {
        return {
          ok: false,
          code: 'UNAVAILABLE',
          message: '本地数据操作失败，请保留输入并核对同一提交。',
        };
      }
    },
  };
}
