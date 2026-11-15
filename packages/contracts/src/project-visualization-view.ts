import { z } from 'zod';
const id = z.string().uuid();
const revision = z.number().int().nonnegative().safe();
export const visualizationNodeRefSchema = z.strictObject({
  kind: z.enum(['project', 'task', 'document']),
  id,
});
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
export const projectVisualizationConfigSchema = z
  .strictObject({
    mode: z.enum(['relations', 'statistics']),
    representation: z.enum(['network', 'grouped', 'list']),
    grouping: z.enum(['kind', 'none']),
    labels: z.enum(['full', 'compact']),
    visible_kinds: z
      .array(z.enum(['project', 'task', 'document']))
      .min(1)
      .max(3),
    hidden_nodes: z.array(visualizationNodeRefSchema).max(200),
    positions: z
      .array(z.strictObject({ node: visualizationNodeRefSchema, x: coordinate, y: coordinate }))
      .max(200),
    viewport: z.strictObject({
      x: coordinate,
      y: coordinate,
      zoom: z.number().finite().min(0.1).max(4),
    }),
    selected: visualizationNodeRefSchema.nullable(),
    custom_labels: z
      .array(
        z.strictObject({
          node: visualizationNodeRefSchema,
          text: z
            .string()
            .trim()
            .min(1)
            .max(160)
            .refine((v) => !v.includes('\0')),
        }),
      )
      .max(200),
  })
  .superRefine((value, ctx) => {
    const key = (n: z.infer<typeof visualizationNodeRefSchema>) => `${n.kind}:${n.id}`;
    for (const entries of [
      value.visible_kinds,
      value.hidden_nodes.map(key),
      value.positions.map((v) => key(v.node)),
      value.custom_labels.map((v) => key(v.node)),
    ])
      if (new Set(entries).size !== entries.length)
        ctx.addIssue({ code: 'custom', message: '视图字段不允许重复对象。' });
  });
export type ProjectVisualizationConfig = z.infer<typeof projectVisualizationConfigSchema>;
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
const scope = { protocol_version: z.literal(1), project_id: id, view_id: z.literal('current') };
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const projectVisualizationReadRequestSchema = z.strictObject({
  ...scope,
  operation: z.literal('read_project_visualization_view'),
});
export const projectVisualizationSaveRequestSchema = z.strictObject({
  ...scope,
  operation: z.literal('save_project_visualization_view'),
  request_id: id,
  idempotency_key: id,
  format_version: z.literal(1),
  expected_view_revision: revision,
  expected_source_fingerprint: fingerprint,
  config: projectVisualizationConfigSchema,
});
export const projectVisualizationStatusRequestSchema = z.strictObject({
  ...scope,
  operation: z.literal('project_visualization_view_status'),
  idempotency_key: id,
});
export const projectVisualizationRequestSchema = z.discriminatedUnion('operation', [
  projectVisualizationReadRequestSchema,
  projectVisualizationSaveRequestSchema,
  projectVisualizationStatusRequestSchema,
]);
export const projectVisualizationViewSchema = z.strictObject({
  project_id: id,
  view_id: z.literal('current'),
  format_version: z.literal(1),
  revision,
  config: projectVisualizationConfigSchema,
  saved_source_fingerprint: fingerprint.nullable(),
  current_source_fingerprint: fingerprint,
  read_only: z.boolean(),
  scope_pruned: z.boolean(),
});
// 回执只说明原命令已提交；当前配置单独回读，旧回执不携带旧标签或旧配置。
export const projectVisualizationReceiptSchema = z.strictObject({
  operation: z.literal('save_project_visualization_view'),
  project_id: id,
  view_id: z.literal('current'),
  idempotency_key: id,
  committed_revision: revision.refine((v) => v > 0),
});
export type ProjectVisualizationRequest = z.infer<typeof projectVisualizationRequestSchema>;
export type ProjectVisualizationView = z.infer<typeof projectVisualizationViewSchema>;
export type ProjectVisualizationReceipt = z.infer<typeof projectVisualizationReceiptSchema>;
