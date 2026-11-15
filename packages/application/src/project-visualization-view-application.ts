import {
  projectVisualizationRequestSchema,
  catalogResponseSchema,
  type ProjectVisualizationRequest,
  type CatalogResponse,
} from '@caselite/contracts';
export interface ProjectVisualizationViewPort {
  execute(request: ProjectVisualizationRequest): CatalogResponse;
}
export function createProjectVisualizationViewApplication(port: ProjectVisualizationViewPort) {
  return {
    execute(input: unknown): CatalogResponse {
      const parsed = projectVisualizationRequestSchema.safeParse(input);
      if (!parsed.success)
        return { ok: false, code: 'INVALID_REQUEST', message: '视图字段或保存身份无效。' };
      try {
        const response = catalogResponseSchema.parse(port.execute(parsed.data));
        if (response.ok) {
          const view = response.project_visualization_view;
          const receipt = response.visualization_receipt;
          if (
            !view ||
            !response.project_graph ||
            response.project_graph.project_id !== parsed.data.project_id ||
            response.project_graph.depth !== 2 ||
            response.project_graph.node_limit !== 200 ||
            response.project_graph.fingerprint !== view.current_source_fingerprint ||
            view.project_id !== parsed.data.project_id ||
            view.view_id !== parsed.data.view_id ||
            (parsed.data.operation !== 'read_project_visualization_view' &&
              (!receipt ||
                receipt.project_id !== parsed.data.project_id ||
                receipt.view_id !== parsed.data.view_id ||
                receipt.idempotency_key !== parsed.data.idempotency_key ||
                receipt.committed_revision > view.revision))
          )
            throw new Error('Unexpected visualization scope');
        }
        return response;
      } catch {
        return {
          ok: false,
          code: 'UNAVAILABLE',
          message: '视图操作失败，请保留输入并核对原提交。',
        };
      }
    },
  };
}
