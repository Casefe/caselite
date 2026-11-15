import { expect, it } from 'vitest';
import {
  projectVisualizationRecords,
  visualizationRecordData,
} from './project-visualization-records';
import {
  defaultProjectVisualizationConfig,
  normalizeVisualizationConfig,
  pruneVisualizationConfig,
  type ProjectGraph,
} from './project-visualization-view-model';
const p = '11111111-1111-4111-8111-111111111111',
  t = '22222222-2222-4222-8222-222222222222',
  d = '33333333-3333-4333-8333-333333333333';
const graph: ProjectGraph = {
  project_id: p,
  depth: 2,
  node_limit: 200,
  read_only: false,
  truncated: true,
  fingerprint: 'a'.repeat(64),
  nodes: [
    {
      kind: 'project',
      id: p,
      title: '真实已保存项目',
      status: 'active',
      version: 8,
      project_type: 'litigation',
      professional_type: 'civil_litigation',
      professional_fields: [
        { section: 'civil_litigation', field: 'case_number', value: '合成案号' },
        { section: 'civil_litigation', field: 'stage', value: '一审' },
      ],
    },
    { kind: 'task', id: t, title: '真实任务标题很长很长很长很长很长很长', version: 7 },
    {
      kind: 'document',
      id: d,
      title: '真实任务标题很长很长很长很长很长很长',
      task_id: t,
      task_version: 7,
      metadata_version: 3,
      body_revision: 11,
    },
  ],
  edges: [
    { kind: 'project_task', from: { kind: 'project', id: p }, to: { kind: 'task', id: t } },
    { kind: 'task_document', from: { kind: 'task', id: t }, to: { kind: 'document', id: d } },
  ],
};
it('maps exact field owners and revisions without inventing parties, fixed sources, legal relationships or statistics', () => {
  const project = visualizationRecordData(graph.nodes[0], defaultProjectVisualizationConfig);
  expect(project.properties).toContainEqual(['案号', '合成案号']);
  expect(project.properties).toContainEqual(['阶段', '一审']);
  expect(project.properties.some(([key]) => key === '当事人')).toBe(false);
  const document = visualizationRecordData(graph.nodes[2], {
    ...defaultProjectVisualizationConfig,
    labels: 'compact',
    custom_labels: [{ node: { kind: 'document', id: d }, text: '手工显示' }],
  });
  expect(document.label).toBe('文档 · 手工显示');
  expect(document.sourceTitle).toBe(graph.nodes[2].title);
  expect(document.fieldSources).toEqual([
    ['标题', 'Task.title · Task 修订 7'],
    ['文档元数据', 'Document.metadata_version · 3'],
    ['已保存正文', 'Document.body_revision · 11'],
  ]);
  expect(JSON.stringify(document)).not.toMatch(/SourceVersion|SourceVersion|当事人|胜率|100万元/);
  const filtered = projectVisualizationRecords(graph, {
    ...defaultProjectVisualizationConfig,
    visible_kinds: ['document'],
  });
  expect(filtered.nodes.map((n) => n.id)).toEqual([`document:${d}`]);
  expect(filtered.edges).toEqual([]);
  const network = projectVisualizationRecords(graph, defaultProjectVisualizationConfig),
    grouped = projectVisualizationRecords(graph, {
      ...defaultProjectVisualizationConfig,
      representation: 'grouped',
    });
  expect(network.nodes[1].position).not.toEqual(grouped.nodes[1].position);
});
it('prunes inaccessible display references while retaining available labels/positions and local finite limits', () => {
  const config = {
    ...defaultProjectVisualizationConfig,
    positions: [{ node: { kind: 'task' as const, id: t }, x: 12, y: 34 }],
    custom_labels: [{ node: { kind: 'document' as const, id: d }, text: '旧标签' }],
    selected: { kind: 'document' as const, id: d },
  };
  const pruned = pruneVisualizationConfig(config, {
    ...graph,
    nodes: graph.nodes.slice(0, 2),
    edges: graph.edges.slice(0, 1),
  });
  expect(pruned.positions).toEqual(config.positions);
  expect(pruned.custom_labels).toEqual([]);
  expect(pruned.selected).toBeNull();
  expect(config.custom_labels).toHaveLength(1);
  expect(
    normalizeVisualizationConfig({ ...config, viewport: { x: Infinity, y: 0, zoom: 1 } }),
  ).toBeNull();
  expect(
    normalizeVisualizationConfig({
      ...config,
      custom_labels: [{ node: { kind: 'task', id: t }, text: 'a'.repeat(161) }],
    }),
  ).toBeNull();
});
