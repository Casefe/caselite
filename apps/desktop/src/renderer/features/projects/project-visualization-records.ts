import type {
  ProjectGraph,
  ProjectGraphNode,
  ProjectVisualizationConfig,
} from './project-visualization-view-model';
import type { VisualizationGraph, VisualizationNodeData } from './project-visualization-model';
import { visualizationRefKey } from './project-visualization-view-model';
export const recordKindNames = { project: '项目', task: '任务', document: '文档' };
const fieldNames: Record<string, string> = {
  case_number: '案号',
  court: '法院',
  cause: '案由',
  stage: '阶段',
  authority: '办案机关',
  suspected_offense: '涉嫌罪名',
  institution: '仲裁机构',
  dispute: '争议',
  service_type: '服务类型',
  topic: '主题',
  scope: '服务范围',
  deliverables: '交付范围',
  contract_type: '合同类型',
  subject: '合同标的',
  review_focus: '审查重点',
};
export function visualizationRecordData(
  node: ProjectGraphNode,
  config: ProjectVisualizationConfig,
): VisualizationNodeData {
  const custom = config.custom_labels.find(
    (label) => visualizationRefKey(label.node) === visualizationRefKey(node),
  )?.text;
  const title =
    config.labels === 'compact' && node.title.length > 18
      ? node.title.slice(0, 18) + '…'
      : node.title;
  const revisions: [string, string][] =
    node.kind === 'document'
      ? [
          ['标题', 'Task.title · Task 修订 ' + node.task_version],
          ['文档元数据', 'Document.metadata_version · ' + node.metadata_version],
          ['已保存正文', 'Document.body_revision · ' + node.body_revision],
        ]
      : [['标题', `${node.kind === 'project' ? 'Project' : 'Task'}.title · 修订 ${node.version}`]];
  return {
    kind: 'record',
    label: `${recordKindNames[node.kind]} · ${custom ?? title}`,
    sourceTitle: node.title,
    customLabel: custom,
    subtitle: custom ? '自定义显示标签' : undefined,
    description: '连线仅表示项目—任务—文档的记录归属，不表示法律关系、证据或因果。',
    fieldSources: revisions,
    properties: [
      ['对象类型', recordKindNames[node.kind]],
      ['原名称', node.title],
      ['关系含义', '项目记录归属'],
      ...(node.kind === 'project'
        ? [
            ['项目类型', node.professional_type ?? node.project_type] as [string, string],
            ...node.professional_fields.map(
              (field) => [fieldNames[field.field] ?? field.field, field.value] as [string, string],
            ),
          ]
        : []),
    ],
  };
}
export function projectVisualizationRecords(
  graph: ProjectGraph,
  config: ProjectVisualizationConfig,
): VisualizationGraph {
  const hidden = new Set(config.hidden_nodes.map(visualizationRefKey));
  const visible = graph.nodes.filter(
    (node) => config.visible_kinds.includes(node.kind) && !hidden.has(visualizationRefKey(node)),
  );
  const counters = { project: 0, task: 0, document: 0 };
  const grouped = config.representation === 'grouped' || config.grouping === 'kind';
  const nodes = visible.map((node, index) => {
    const id = visualizationRefKey(node);
    const slot = counters[node.kind]++;
    const position = config.positions.find((p) => visualizationRefKey(p.node) === id);
    return {
      id,
      type: 'visual-card' as const,
      position: position
        ? { x: position.x, y: position.y }
        : grouped
          ? { x: slot * 290, y: ['project', 'task', 'document'].indexOf(node.kind) * 170 }
          : {
              x: node.kind === 'project' ? 0 : node.kind === 'task' ? 330 : 660,
              y: node.kind === 'project' ? 0 : slot * 150,
            },
      data: {
        ...visualizationRecordData(node, config),
        properties: [
          ...visualizationRecordData(node, config).properties,
          ['所属项目', graph.nodes.find((n) => n.kind === 'project')?.title ?? ''] as [
            string,
            string,
          ],
        ],
      },
      selected: config.selected ? visualizationRefKey(config.selected) === id : false,
      dragHandle: '.drag-handle',
      zIndex: index === 0 ? 1 : 0,
    };
  });
  const allowed = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: graph.edges
      .map((edge) => {
        const source = visualizationRefKey(edge.from);
        const target = visualizationRefKey(edge.to);
        return {
          id: `${source}:${target}`,
          source,
          target,
          type: 'smoothstep',
          label: edge.kind === 'project_task' ? '归组' : '可编辑文档',
        };
      })
      .filter((edge) => allowed.has(edge.source) && allowed.has(edge.target)),
  };
}
export function recordDestination(node: ProjectGraphNode) {
  return node.kind === 'task'
    ? { taskId: node.id }
    : node.kind === 'document'
      ? { taskId: node.task_id, documentId: node.id }
      : undefined;
}
