import { describe, expect, it } from 'vitest';
import { catalogRequestSchema, catalogResponseSchema } from '../../packages/contracts/src/catalog';
import { projectGraphSchema, type ProjectGraph } from '../../packages/contracts/src/project-graph';
import { createProjectGraphApplication } from '../../packages/application/src/project-graph-application';
import { createCatalogApplication } from '../../packages/application/src/catalog-application';

const project = '10000000-0000-4000-8000-000000000001';
const task = '10000000-0000-4000-8000-000000000002';
const document = '10000000-0000-4000-8000-000000000003';
const other = '10000000-0000-4000-8000-000000000004';
const request = {
  protocol_version: 1,
  operation: 'read_project_graph',
  project_id: project,
  depth: 2,
  node_limit: 100,
} as const;
function graph(): ProjectGraph {
  return {
    project_id: project,
    depth: 2,
    node_limit: 100,
    fingerprint: 'a'.repeat(64),
    truncated: false,
    read_only: false,
    nodes: [
      {
        kind: 'project',
        id: project,
        title: '项目',
        version: 1,
        status: 'planned',
        project_type: 'general',
        professional_type: null,
        professional_fields: [],
      },
      { kind: 'task', id: task, title: '同名', version: 2 },
      {
        kind: 'document',
        id: document,
        title: '同名',
        metadata_version: 3,
        task_version: 2,
        body_revision: 4,
        task_id: task,
      },
    ],
    edges: [
      {
        kind: 'project_task',
        from: { kind: 'project', id: project },
        to: { kind: 'task', id: task },
      },
      {
        kind: 'task_document',
        from: { kind: 'task', id: task },
        to: { kind: 'document', id: document },
      },
    ],
  };
}
describe('DEV-1910-A bounded project graph contract and Application', () => {
  it('uses existing catalog transport without exposing layout or another data owner', () => {
    expect(catalogRequestSchema.parse(request)).toEqual(request);
    const app = createCatalogApplication({
      execute: () => {
        throw new Error('Graph must use the reader');
      },
      projectGraph: { read: () => graph() },
    });
    const result = app.execute(request);
    expect(result).toMatchObject({
      ok: true,
      projects: [],
      documents: [],
      state: null,
      project_graph: graph(),
    });
    expect(catalogResponseSchema.parse(result)).toEqual(result);
  });
  it.each([
    { depth: 0 },
    { depth: 3 },
    { node_limit: 0 },
    { node_limit: 201 },
    { workspace: 'other' },
    { sql: 'SELECT *' },
    { path: '/private/data' },
    { verified: true },
    { operation: 'write_project_graph' },
  ])('rejects unbounded or privileged input: %j', (change) => {
    let calls = 0;
    const app = createProjectGraphApplication({
      read: () => {
        calls++;
        return graph();
      },
    });
    expect(app.read({ ...request, ...change })).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(calls).toBe(0);
  });
  it('keeps same-named objects distinct and fixed metadata/body revisions', () => {
    expect(projectGraphSchema.parse(graph()).nodes.slice(1)).toMatchObject([
      { id: task, version: 2 },
      { id: document, metadata_version: 3, task_version: 2, body_revision: 4 },
    ]);
  });
  it.each([
    'duplicate',
    'orphan',
    'wrong-parent',
    'second-project',
    'too-many',
    'layout',
    'wrong-direction',
  ])('rejects malformed graph: %s', (kind) => {
    const value = graph();
    if (kind === 'duplicate') value.nodes.push(value.nodes[1]);
    if (kind === 'orphan') value.edges.pop();
    if (kind === 'wrong-parent') Object.assign(value.nodes[2], { task_id: other });
    if (kind === 'second-project')
      value.nodes.push({
        kind: 'project',
        id: other,
        title: '其他',
        version: 1,
        status: 'planned',
        project_type: 'general',
        professional_type: null,
        professional_fields: [],
      });
    if (kind === 'too-many') value.node_limit = 1;
    if (kind === 'layout') Object.assign(value.nodes[1], { position: { x: 1, y: 2 } });
    if (kind === 'wrong-direction')
      Object.assign(value.edges[0], { from: { kind: 'task', id: task } });
    expect(projectGraphSchema.safeParse(value).success).toBe(false);
  });
  it.each([{ project_id: other }, { depth: 1 }, { node_limit: 99 }])(
    'rejects reader result from a different query: %j',
    (change) => {
      const app = createProjectGraphApplication({ read: () => ({ ...graph(), ...change }) });
      expect(app.read(request)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    },
  );
  it('reports unavailable readers, missing scope and storage failures without falling back to all data', () => {
    expect(
      createCatalogApplication({
        execute: () => {
          throw new Error();
        },
      }).execute(request),
    ).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(createProjectGraphApplication({ read: () => null }).read(request)).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(
      createProjectGraphApplication({
        read: () => {
          throw new Error('/private/database');
        },
      }).read(request),
    ).toEqual({ ok: false, code: 'UNAVAILABLE', message: '关系暂时无法读取，请重试。' });
  });
});
