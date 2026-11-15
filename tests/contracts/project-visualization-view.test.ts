import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  catalogRequestSchema,
  defaultProjectVisualizationConfig,
  projectVisualizationConfigSchema,
} from '../../packages/contracts/src/index';
import { createCatalogApplication } from '../../packages/application/src/catalog-application';
import { createProjectVisualizationViewApplication } from '../../packages/application/src/project-visualization-view-application';
const project_id = randomUUID();
const request = {
  protocol_version: 1,
  operation: 'save_project_visualization_view',
  project_id,
  view_id: 'current',
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
  format_version: 1,
  expected_view_revision: 0,
  expected_source_fingerprint: 'a'.repeat(64),
  config: defaultProjectVisualizationConfig,
};
it('accepts only bounded display fields and real typed identifiers; rejects privileged or business data', () => {
  expect(catalogRequestSchema.safeParse(request).success).toBe(true);
  const ref = { kind: 'task', id: randomUUID() };
  for (const config of [
    { ...request.config, positions: [{ node: ref, x: Infinity, y: 0 }] },
    { ...request.config, viewport: { x: 0, y: 0, zoom: 0 } },
    { ...request.config, positions: Array(201).fill({ node: ref, x: 0, y: 0 }) },
    { ...request.config, custom_labels: [{ node: ref, text: 'x'.repeat(161) }] },
    { ...request.config, custom_labels: [{ node: ref, text: 'bad\0label' }] },
    {
      ...request.config,
      custom_labels: [
        { node: ref, text: 'a' },
        { node: ref, text: 'b' },
      ],
    },
    { ...request.config, selected: { kind: 'fact', id: randomUUID() } },
    { ...request.config, hidden_nodes: [{ kind: 'task', id: 'sample-task' }] },
    { ...request.config, visible_kinds: ['task', 'task'] },
    { ...request.config, mode: 'timeline' },
    { ...request.config, body: '业务正文' },
    { ...request.config, source_path: '/private/file' },
    { ...request.config, legal_relation: 'supports' },
  ])
    expect(projectVisualizationConfigSchema.safeParse(config).success).toBe(false);
  let calls = 0;
  const app = createCatalogApplication({
    execute: () => {
      calls++;
      throw new Error('unexpected');
    },
  });
  for (const change of [
    { workspace_id: 'other' },
    { actor: 'admin' },
    { view_id: 'sample' },
    { expected_view_revision: -1 },
    { expected_source_fingerprint: 'name' },
    { format_version: 2 },
  ])
    expect(app.execute({ ...request, ...change })).toMatchObject({ code: 'INVALID_REQUEST' });
  expect(calls).toBe(0);
});
it('does not accept missing or mismatched current graph/view scopes from a port', () => {
  const app = createProjectVisualizationViewApplication({
    execute: () => ({
      ok: true,
      projects: [],
      documents: [],
      state: null,
      target_id: null,
      receipt: null,
    }),
  });
  expect(app.execute(request)).toMatchObject({ code: 'UNAVAILABLE' });
  expect(
    createCatalogApplication({
      execute: () => {
        throw new Error('no');
      },
    }).execute(request),
  ).toMatchObject({ code: 'UNAVAILABLE' });
});
