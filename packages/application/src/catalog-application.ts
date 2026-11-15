import {
  createProjectVisualizationViewApplication,
  type ProjectVisualizationViewPort,
} from './project-visualization-view-application';
import {
  catalogRequestSchema,
  type CatalogRequest,
  type CatalogResponse,
} from '@caselite/contracts';
import { createProjectGraphApplication, type ProjectGraphPort } from './project-graph-application';
export interface CatalogPort {
  projectGraph?: ProjectGraphPort;
  projectVisualizationView?: ProjectVisualizationViewPort;
  execute(request: CatalogRequest): CatalogResponse;
}
export function createCatalogApplication(port: CatalogPort) {
  const graph = port.projectGraph ? createProjectGraphApplication(port.projectGraph) : undefined;
  const view = port.projectVisualizationView
    ? createProjectVisualizationViewApplication(port.projectVisualizationView)
    : undefined;
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
        if (request.data.operation === 'read_project_graph') {
          const result = graph?.read(request.data);
          if (!result)
            return { ok: false, code: 'UNAVAILABLE', message: '当前版本暂不支持关系查询。' };
          if (!result.ok) return result;
          return {
            ok: true,
            projects: [],
            documents: [],
            state: null,
            target_id: request.data.project_id,
            receipt: null,
            project_graph: result.graph,
          };
        }
        if (
          request.data.operation === 'read_project_visualization_view' ||
          request.data.operation === 'save_project_visualization_view' ||
          request.data.operation === 'project_visualization_view_status'
        )
          return (
            view?.execute(request.data) ?? {
              ok: false,
              code: 'UNAVAILABLE',
              message: '当前版本暂不支持视图保存。',
            }
          );
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
