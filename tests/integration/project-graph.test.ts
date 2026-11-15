import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src/index';
import { createCatalogApplication } from '../../packages/application/src/catalog-application';
import type { CatalogResponse, TaskResponse } from '../../packages/contracts/src/index';

const roots: string[] = [];
const migrations = resolve('packages/local-db/migrations');
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const command = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
function ok<T extends CatalogResponse | TaskResponse>(result: T): Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result as Extract<T, { ok: true }>;
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-project-graph-'));
  roots.push(root);
  const file = join(root, 'test.sqlite');
  const store = openTaskStore(file, migrations);
  const app = createCatalogApplication(store.catalog);
  const project = ok(app.execute({ ...command(), operation: 'create_project', title: '合成项目' }))
    .projects[0];
  const addTask = (title: string, matter = project.id) => {
    const task = ok(
      store.execute({
        ...command(),
        operation: 'create',
        title,
        objective: '不得出现在图查询中的正文',
      }),
    ).tasks[0];
    ok(
      app.execute({
        ...command(),
        operation: 'assign_task',
        task_id: task.id,
        expected_version: task.version,
        matter_id: matter,
      }),
    );
    return task;
  };
  const read = (depth: 1 | 2 = 2, node_limit = 200) => {
    const result = ok(
      app.execute({
        protocol_version: 1,
        operation: 'read_project_graph',
        project_id: project.id,
        depth,
        node_limit,
      }),
    );
    expect(result.projects).toEqual([]);
    expect(result.documents).toEqual([]);
    expect(result.state).toBeNull();
    if (!result.project_graph) throw new Error('Missing project graph');
    return result.project_graph;
  };
  return { root, file, store, app, project, addTask, read };
}
describe('DEV-1910-A real SQLite project graph', () => {
  it('reads existing identities and versions in one snapshot and survives reopening without graph writes', () => {
    const x = setup();
    const task = x.addTask('同名记录');
    const graph = x.read();
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes.find((n) => n.kind === 'document')).toMatchObject({
      id: task.document_id,
      task_id: task.id,
      body_revision: 0,
    });
    expect(graph.nodes.find((n) => n.kind === 'task')).toMatchObject({
      id: task.id,
      version: task.version + 1,
    });
    expect(JSON.stringify(graph)).not.toMatch(/objective|不得出现在|body_id|private_storage|path/);
    x.store.close();
    const reopened = openTaskStore(x.file, migrations);
    const result = ok(
      createCatalogApplication(reopened.catalog).execute({
        protocol_version: 1,
        operation: 'read_project_graph',
        project_id: x.project.id,
        depth: 2,
        node_limit: 200,
      }),
    );
    expect(result.project_graph).toEqual(graph);
    reopened.close();
  });
  it('isolates other projects and workspaces without hiding legitimate same-name identities', () => {
    const x = setup();
    const second = ok(
      x.app.execute({ ...command(), operation: 'create_project', title: '其他项目' }),
    ).projects.find((p) => p.id !== x.project.id)!;
    const own = x.addTask('同名');
    const other = x.addTask('同名', second.id);
    const graph = x.read();
    expect(graph.nodes.some((n) => n.id === own.id)).toBe(true);
    expect(graph.nodes.some((n) => n.id === other.id || n.id === other.document_id)).toBe(false);
    const hidden = openTaskStore(x.file, migrations, 'other-workspace');
    expect(
      createCatalogApplication(hidden.catalog).execute({
        protocol_version: 1,
        operation: 'read_project_graph',
        project_id: x.project.id,
        depth: 2,
        node_limit: 200,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    hidden.close();
    x.store.close();
  });
  it('limits depth and nodes, marks truncation, and never returns orphan edges', () => {
    const x = setup();
    for (let i = 0; i < 4; i++) x.addTask('有界记录');
    const first = x.read(1);
    expect(first.nodes).toHaveLength(5);
    expect(first.nodes.every((n) => n.kind !== 'document')).toBe(true);
    expect(first.truncated).toBe(false);
    for (const limit of [1, 3, 5, 7, 9]) {
      const graph = x.read(2, limit);
      expect(graph.nodes).toHaveLength(limit);
      expect(graph.edges).toHaveLength(limit - 1);
      expect(graph.truncated).toBe(limit < 9);
      const refs = new Set(graph.nodes.map((n) => `${n.kind}:${n.id}`));
      expect(
        graph.edges.every(
          (e) => refs.has(`${e.from.kind}:${e.from.id}`) && refs.has(`${e.to.kind}:${e.to.id}`),
        ),
      ).toBe(true);
    }
    x.store.close();
  });
  it('returns an honest empty project and updates the fingerprint when membership changes', () => {
    const x = setup();
    const empty = x.read();
    expect(empty.nodes).toHaveLength(1);
    expect(empty.edges).toEqual([]);
    expect(empty.truncated).toBe(false);
    const task = x.addTask('待移出的任务');
    const before = x.read();
    expect(before.fingerprint).not.toBe(empty.fingerprint);
    ok(
      x.app.execute({
        ...command(),
        operation: 'assign_task',
        task_id: task.id,
        expected_version: task.version + 1,
        matter_id: null,
      }),
    );
    expect(x.read()).toEqual(empty);
    x.store.close();
  });
  it('preserves archived-document visibility and returns the same owner after restoration', () => {
    const x = setup();
    const task = x.addTask('归档文档');
    const before = x.read();
    const document = before.nodes.find((node) => node.kind === 'document')!;
    ok(
      x.app.execute({
        ...command(),
        operation: 'archive_document',
        id: task.document_id,
        expected_version: document.metadata_version,
        archived: true,
      }),
    );
    const archived = x.read();
    expect(archived.nodes.map((node) => node.kind)).toEqual(['project', 'task']);
    expect(archived.truncated).toBe(false);
    ok(
      x.app.execute({
        ...command(),
        operation: 'archive_document',
        id: task.document_id,
        expected_version: document.metadata_version + 1,
        archived: false,
      }),
    );
    expect(x.read().nodes.find((node) => node.kind === 'document')).toMatchObject({
      id: document.id,
      task_id: task.id,
      metadata_version: document.metadata_version + 2,
    });
    x.store.close();
  });
  it('distinguishes an exactly complete 200-node result from a 201-node result', () => {
    const x = setup();
    for (let index = 0; index < 100; index++) x.addTask('上限边界');
    const over = x.read();
    expect(over.nodes).toHaveLength(200);
    expect(over.truncated).toBe(true);
    const document = over.nodes.find((node) => node.kind === 'document')!;
    ok(
      x.app.execute({
        ...command(),
        operation: 'archive_document',
        id: document.id,
        expected_version: document.metadata_version,
        archived: true,
      }),
    );
    const exact = x.read();
    expect(exact.nodes).toHaveLength(200);
    expect(exact.truncated).toBe(false);
    x.store.close();
  });
  it('does not leak a foreign task even if an invalid cross-workspace membership exists', () => {
    const x = setup();
    x.addTask('合法任务');
    const foreign = openTaskStore(x.file, migrations, 'other-workspace');
    const task = ok(
      foreign.execute({ ...command(), operation: 'create', title: '跨工作区任务', objective: '' }),
    ).tasks[0];
    const probe = openToolchainProbe(x.file, migrations);
    probe.sqlite
      .prepare('INSERT INTO task_projects(task_id,matter_id) VALUES(?,?)')
      .run(task.id, x.project.id);
    expect(x.read().nodes.some((node) => node.id === task.id || node.id === task.document_id)).toBe(
      false,
    );
    probe.sqlite.close();
    foreign.close();
    x.store.close();
  });
  it('does not mutate schema, receipts, activity or existing records when querying', () => {
    const x = setup();
    x.addTask('只读记录');
    const probe = openToolchainProbe(x.file, migrations);
    const tables = (
      probe.sqlite
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
    ).map((row) => row.name);
    const snapshot = () =>
      JSON.stringify([
        probe.sqlite.prepare('SELECT * FROM sqlite_schema ORDER BY type,name').all(),
        tables.map((table) => [
          table,
          probe.sqlite.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all(),
        ]),
      ]);
    const before = snapshot();
    for (let i = 0; i < 3; i++) x.read();
    expect(snapshot()).toBe(before);
    probe.sqlite.close();
    x.store.close();
  });
});
