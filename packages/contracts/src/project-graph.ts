import { z } from 'zod';

const id = z.string().uuid();
const version = z.number().int().positive().safe();
const nodeBase = { id, title: z.string(), version };
export const projectGraphNodeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...nodeBase,
    kind: z.literal('project'),
    status: z.enum(['planned', 'active', 'done']),
    project_type: z.enum(['general', 'litigation', 'contract_review']),
    professional_type: z
      .enum(['civil_litigation', 'criminal_litigation', 'commercial_arbitration', 'non_litigation'])
      .nullable(),
    professional_fields: z
      .array(
        z.strictObject({
          section: z.enum([
            'civil_litigation',
            'criminal_litigation',
            'commercial_arbitration',
            'non_litigation',
            'contract_review',
          ]),
          field: z.enum([
            'case_number',
            'court',
            'cause',
            'stage',
            'authority',
            'suspected_offense',
            'institution',
            'dispute',
            'service_type',
            'topic',
            'scope',
            'deliverables',
            'contract_type',
            'subject',
            'review_focus',
          ]),
          value: z.string().max(240),
        }),
      )
      .max(20),
  }),
  z.strictObject({ ...nodeBase, kind: z.literal('task') }),
  z.strictObject({
    id,
    title: z.string(),
    kind: z.literal('document'),
    task_version: version,
    metadata_version: version,
    task_id: id,
    body_revision: z.number().int().nonnegative().safe(),
  }),
]);
const reference = <Kind extends 'project' | 'task' | 'document'>(kind: Kind) =>
  z.strictObject({ kind: z.literal(kind), id });
export const projectGraphEdgeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('project_task'),
    from: reference('project'),
    to: reference('task'),
  }),
  z.strictObject({
    kind: z.literal('task_document'),
    from: reference('task'),
    to: reference('document'),
  }),
]);
export const projectGraphRequestSchema = z.strictObject({
  protocol_version: z.literal(1),
  operation: z.literal('read_project_graph'),
  project_id: id,
  depth: z.union([z.literal(1), z.literal(2)]),
  node_limit: z.number().int().min(1).max(200),
});
export const projectGraphSchema = z
  .strictObject({
    project_id: id,
    depth: z.union([z.literal(1), z.literal(2)]),
    node_limit: z.number().int().min(1).max(200),
    nodes: z.array(projectGraphNodeSchema).min(1).max(200),
    edges: z.array(projectGraphEdgeSchema).max(199),
    truncated: z.boolean(),
    read_only: z.boolean(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .superRefine((graph, context) => {
    const nodes = new Map(graph.nodes.map((node) => [`${node.kind}:${node.id}`, node]));
    const projects = graph.nodes.filter((node) => node.kind === 'project');
    const seen = new Set<string>();
    const incoming = new Set<string>();
    let valid =
      nodes.size === graph.nodes.length &&
      graph.nodes.length <= graph.node_limit &&
      projects.length === 1 &&
      projects[0].id === graph.project_id &&
      graph.edges.length === graph.nodes.length - 1;
    for (const edge of graph.edges) {
      const source = `${edge.from.kind}:${edge.from.id}`;
      const target = `${edge.to.kind}:${edge.to.id}`;
      const key = `${source}/${target}`;
      const node = nodes.get(target);
      if (
        !nodes.has(source) ||
        !node ||
        seen.has(key) ||
        incoming.has(target) ||
        (edge.kind === 'project_task' && edge.from.id !== graph.project_id) ||
        (node.kind === 'document' && node.task_id !== edge.from.id) ||
        (graph.depth === 1 && edge.kind === 'task_document')
      )
        valid = false;
      seen.add(key);
      incoming.add(target);
    }
    if (!valid)
      context.addIssue({ code: 'custom', message: 'Project graph must contain one bound tree' });
  });
export type ProjectGraphRequest = z.infer<typeof projectGraphRequestSchema>;
export type ProjectGraph = z.infer<typeof projectGraphSchema>;
export type ProjectGraphNode = z.infer<typeof projectGraphNodeSchema>;
export type ProjectGraphEdge = z.infer<typeof projectGraphEdgeSchema>;
