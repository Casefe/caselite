import type { CatalogResponse, CatalogRequest } from '../../../preload/caselite-api';
type CatalogSuccess = Extract<CatalogResponse, { ok: true }>;
export type ProjectGraph = NonNullable<CatalogSuccess['project_graph']>;
export type ProjectGraphNode = ProjectGraph['nodes'][number];
export type ProjectVisualizationView = NonNullable<CatalogSuccess['project_visualization_view']>;
export type ProjectVisualizationConfig = ProjectVisualizationView['config'];
export type ProjectVisualizationRequest = Extract<
  CatalogRequest,
  {
    operation:
      | 'read_project_visualization_view'
      | 'save_project_visualization_view'
      | 'project_visualization_view_status';
  }
>;
export const defaultProjectVisualizationConfig: ProjectVisualizationConfig = {
  mode: 'relations',
  representation: 'network',
  grouping: 'none',
  labels: 'full',
  visible_kinds: ['project', 'task', 'document'],
  hidden_nodes: [],
  positions: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  selected: null,
  custom_labels: [],
};
// 这里只约束本地显示编辑的输入长度与有限几何；权限/存在性和严格DTO仍由Preload/Application负责。
export function normalizeVisualizationConfig(
  config: ProjectVisualizationConfig,
): ProjectVisualizationConfig | null {
  const finite = (n: number) => Number.isFinite(n) && Math.abs(n) <= 1_000_000;
  if (
    config.positions.length > 200 ||
    config.hidden_nodes.length > 200 ||
    config.custom_labels.length > 200 ||
    !config.visible_kinds.length ||
    config.visible_kinds.length > 3 ||
    config.positions.some((p) => !finite(p.x) || !finite(p.y)) ||
    !finite(config.viewport.x) ||
    !finite(config.viewport.y) ||
    !Number.isFinite(config.viewport.zoom) ||
    config.viewport.zoom < 0.1 ||
    config.viewport.zoom > 4 ||
    config.custom_labels.some(
      (l) => !l.text.trim() || l.text.trim().length > 160 || l.text.includes('\0'),
    )
  )
    return null;
  return {
    ...config,
    custom_labels: config.custom_labels.map((label) => ({ ...label, text: label.text.trim() })),
  };
}
import type { VisualizationMode } from './project-visualization-model';
export type VisualizationSession = {
  projectId: string;
  config: ProjectVisualizationConfig;
  mode: VisualizationMode;
  sample: boolean;
};
export const visualizationRefKey = (node: { kind: string; id: string }) =>
  `${node.kind}:${node.id}`;
export function pruneVisualizationConfig(config: ProjectVisualizationConfig, graph: ProjectGraph) {
  const allowed = new Set(graph.nodes.map(visualizationRefKey));
  const has = (node: { kind: string; id: string }) => allowed.has(visualizationRefKey(node));
  return {
    ...config,
    positions: config.positions.filter((p) => has(p.node)),
    hidden_nodes: config.hidden_nodes.filter(has),
    custom_labels: config.custom_labels.filter((p) => has(p.node)),
    selected: config.selected && has(config.selected) ? config.selected : null,
  };
}
export function visualizationDraftKey(config: ProjectVisualizationConfig) {
  // 浏览选择、视口与图型切换不阻塞回源；显式保存时仍带入这些显示状态。
  const { selected, viewport, mode, ...expression } = config;
  void selected;
  void viewport;
  void mode;
  return JSON.stringify(expression);
}
export const visualizationLayoutFields = (config: ProjectVisualizationConfig) => ({
  representation: config.representation,
  grouping: config.grouping,
  positions: config.positions,
});
