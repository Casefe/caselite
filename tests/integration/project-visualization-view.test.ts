import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  openTaskStore,
  openToolchainProbe,
  integrationMigrations,
  createProjectGraphReader,
  createProjectVisualizationViewStore,
} from '../../packages/local-db/src/index';
import { createCatalogApplication } from '../../packages/application/src/catalog-application';
import {
  defaultProjectVisualizationConfig,
  type CatalogResponse,
  type TaskResponse,
  type ProjectVisualizationConfig,
} from '../../packages/contracts/src/index';
const migrations = resolve('packages/local-db/migrations');
const roots: string[] = [];
const closers: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0).reverse()) close();
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const ids = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
function ok<T extends CatalogResponse | TaskResponse>(r: T): Extract<T, { ok: true }> {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.message);
  return r as Extract<T, { ok: true }>;
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-viz-view-'));
  roots.push(root);
  const file = join(root, 'synthetic.sqlite');
  const store = openTaskStore(file, migrations);
  closers.push(() => store.close());
  const app = createCatalogApplication(store.catalog);
  const project = ok(app.execute({ ...ids(), operation: 'create_project', title: '合成项目' }))
    .projects[0];
  const task = ok(
    store.execute({
      ...ids(),
      operation: 'create',
      title: '合成任务',
      objective: '',
      matter_id: project.id,
    }),
  ).tasks[0];
  const scope = {
    protocol_version: 1 as const,
    project_id: project.id,
    view_id: 'current' as const,
  };
  const read = () => ok(app.execute({ ...scope, operation: 'read_project_visualization_view' }));
  const save = (config: ProjectVisualizationConfig = defaultProjectVisualizationConfig) => {
    const r = read();
    return {
      ...scope,
      ...ids(),
      operation: 'save_project_visualization_view' as const,
      format_version: 1,
      expected_view_revision: r.project_visualization_view!.revision,
      expected_source_fingerprint: r.project_graph!.fingerprint,
      config,
    };
  };
  const db = openToolchainProbe(file, migrations).sqlite;
  closers.push(() => db.close());
  return { file, store, app, project, task, scope, read, save, db };
}
it('defaults without writing, saves only display configuration and atomically returns current graph/view', () => {
  const x = setup();
  const first = x.read();
  expect(first.project_visualization_view).toMatchObject({
    revision: 0,
    saved_source_fingerprint: null,
    scope_pruned: false,
    config: defaultProjectVisualizationConfig,
  });
  expect(x.db.prepare('SELECT count(*) AS n FROM project_visualization_views').get()).toEqual({
    n: 0,
  });
  const node = { kind: 'task' as const, id: x.task.id };
  const config = {
    ...defaultProjectVisualizationConfig,
    mode: 'statistics' as const,
    representation: 'grouped' as const,
    positions: [{ node, x: 21, y: 34 }],
    selected: node,
    custom_labels: [{ node, text: '自定义显示' }],
  };
  const before = x.db.prepare('SELECT * FROM task_items').all();
  const saved = ok(x.app.execute(x.save(config)));
  expect(saved.project_visualization_view).toMatchObject({ revision: 1, config });
  expect(saved.project_visualization_view!.current_source_fingerprint).toBe(
    saved.project_graph!.fingerprint,
  );
  expect(saved.visualization_receipt).toMatchObject({ committed_revision: 1 });
  expect(x.db.prepare('SELECT * FROM task_items').all()).toEqual(before);
  const reopened = openTaskStore(x.file, migrations);
  closers.push(() => reopened.close());
  expect(
    ok(
      createCatalogApplication(reopened.catalog).execute({
        ...x.scope,
        operation: 'read_project_visualization_view',
      }),
    ).project_visualization_view,
  ).toEqual(saved.project_visualization_view);
});
it('recovers a discarded acknowledgement with original scope/key and never rolls current state back to an old receipt', () => {
  const x = setup();
  const one = x.save();
  const original = ok(x.app.execute(one));
  const status = {
    ...x.scope,
    operation: 'project_visualization_view_status',
    idempotency_key: one.idempotency_key,
  };
  expect(x.app.execute(status)).toEqual(original);
  expect(x.app.execute({ ...one, request_id: randomUUID() })).toEqual(original);
  expect(x.app.execute({ ...one, config: { ...one.config, labels: 'compact' } })).toMatchObject({
    code: 'CONFLICT',
  });
  const two = x.save({ ...defaultProjectVisualizationConfig, labels: 'compact' });
  ok(x.app.execute(two));
  for (const request of [one, status]) {
    const current = ok(x.app.execute(request));
    expect(current.visualization_receipt!.committed_revision).toBe(1);
    expect(current.project_visualization_view).toMatchObject({
      revision: 2,
      config: { labels: 'compact' },
    });
  }
  expect(
    x.app.execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: one.idempotency_key,
    }),
  ).toMatchObject({ code: 'INVALID_REQUEST' });
  const stored = x.db
    .prepare('SELECT result FROM catalog_receipts WHERE key=?')
    .get(one.idempotency_key) as { result: string };
  expect(stored.result).not.toMatch(/custom_labels|configuration|compact|positions/);
  expect(x.app.execute({ ...status, project_id: randomUUID() })).toMatchObject({
    code: 'NOT_FOUND',
  });
  const other = ok(
    x.app.execute({ ...ids(), operation: 'create_project', title: '另一项目' }),
  ).target_id!;
  expect(x.app.execute({ ...status, project_id: other })).toMatchObject({ code: 'NOT_FOUND' });
  expect(x.app.execute({ ...one, project_id: other })).toMatchObject({ code: 'CONFLICT' });
  const foreign = openTaskStore(x.file, migrations, 'foreign-workspace');
  closers.push(() => foreign.close());
  const app = createCatalogApplication(foreign.catalog);
  for (const r of [one, status, { ...x.scope, operation: 'read_project_visualization_view' }])
    expect(app.execute(r)).toMatchObject({ code: 'NOT_FOUND' });
  const reopened = openTaskStore(x.file, migrations);
  closers.push(() => reopened.close());
  expect(
    ok(createCatalogApplication(reopened.catalog).execute(status)).project_visualization_view!
      .revision,
  ).toBe(2);
});
it('rejects stale sources, double-connection CAS and out-of-scope objects without altering saved configuration', () => {
  const x = setup();
  const a = x.save();
  const b = { ...a, ...ids() };
  const other = openTaskStore(x.file, migrations);
  closers.push(() => other.close());
  const second = createCatalogApplication(other.catalog);
  ok(x.app.execute(a));
  expect(second.execute(b)).toMatchObject({ code: 'CONFLICT' });
  const stale = x.save();
  x.db
    .prepare('UPDATE task_items SET title=?,version=version+1 WHERE id=?')
    .run('任务改名', x.task.id);
  expect(x.app.execute(stale)).toMatchObject({ code: 'CONFLICT' });
  for (const kind of ['project', 'task', 'document'] as const)
    expect(
      x.app.execute(
        x.save({ ...defaultProjectVisualizationConfig, selected: { kind, id: randomUUID() } }),
      ),
    ).toMatchObject({ code: 'INVALID_REQUEST' });
  expect(x.read().project_visualization_view!.revision).toBe(1);
  expect(x.read().project_graph!.nodes.find((n) => n.kind === 'document')).toMatchObject({
    title: '任务改名',
    task_version: 2,
    metadata_version: 1,
    body_revision: 0,
  });
});
it('rolls back configuration on a failure between write and receipt, and keeps original identity for retry', () => {
  const x = setup();
  ok(x.app.execute(x.save()));
  const before = x.read().project_visualization_view;
  const request = x.save({ ...defaultProjectVisualizationConfig, labels: 'compact' });
  x.db.exec(
    "CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON catalog_receipts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
  );
  expect(x.app.execute(request)).toMatchObject({ code: 'UNAVAILABLE' });
  expect(x.read().project_visualization_view).toEqual(before);
  expect(
    x.app.execute({
      ...x.scope,
      operation: 'project_visualization_view_status',
      idempotency_key: request.idempotency_key,
    }),
  ).toMatchObject({ code: 'NOT_FOUND' });
  x.db.exec('DROP TRIGGER synthetic_receipt_failure');
  expect(ok(x.app.execute(request)).project_visualization_view!.revision).toBe(2);
});
it('prunes inaccessible custom labels without deleting history, and enforces archived project read-only on replay', () => {
  const x = setup();
  const node = { kind: 'document' as const, id: x.task.document_id };
  const request = x.save({
    ...defaultProjectVisualizationConfig,
    custom_labels: [{ node, text: '不可回泄的标签' }],
    selected: node,
    positions: [{ node, x: 1, y: 2 }],
    hidden_nodes: [node],
  });
  ok(x.app.execute(request));
  const original = x.db.prepare('SELECT configuration FROM project_visualization_views').get();
  ok(
    x.app.execute({
      ...ids(),
      operation: 'archive_document',
      id: x.task.document_id,
      expected_version: 1,
      archived: true,
    }),
  );
  for (const response of [
    x.read(),
    ok(x.app.execute(request)),
    ok(
      x.app.execute({
        ...x.scope,
        operation: 'project_visualization_view_status',
        idempotency_key: request.idempotency_key,
      }),
    ),
  ]) {
    expect(response.project_visualization_view).toMatchObject({
      scope_pruned: true,
      config: { custom_labels: [], positions: [], hidden_nodes: [], selected: null },
    });
    expect(JSON.stringify(response)).not.toContain('不可回泄的标签');
  }
  expect(x.db.prepare('SELECT configuration FROM project_visualization_views').get()).toEqual(
    original,
  );
  const current = x.save();
  ok(
    x.app.execute({
      ...ids(),
      operation: 'archive_project',
      id: x.project.id,
      expected_version: 1,
      archived: true,
    }),
  );
  expect(x.read().project_visualization_view!.read_only).toBe(true);
  expect(x.app.execute(current)).toMatchObject({ code: 'CONFLICT' });
  expect(x.app.execute(request)).toMatchObject({ code: 'CONFLICT' });
});
it('changes fingerprint independently for Task title/version, document metadata and saved body revision', () => {
  const x = setup();
  let previous = x.read().project_graph!.fingerprint;
  for (const sql of [
    "UPDATE task_items SET title='新标题',version=version+1",
    'UPDATE documents SET metadata_version=metadata_version+1',
    'UPDATE documents SET body_revision=body_revision+1',
  ]) {
    x.db.exec(sql);
    const graph = x.read().project_graph!;
    expect(graph.fingerprint).not.toBe(previous);
    previous = graph.fingerprint;
  }
  expect(x.read().project_graph!.nodes.find((n) => n.kind === 'document')).toMatchObject({
    title: '新标题',
    task_version: 2,
    metadata_version: 2,
    body_revision: 1,
  });
});
it('reads project/tasks/documents consistently while a second connection commits between bounded queries', () => {
  const x = setup();
  x.db.pragma('journal_mode=WAL');
  const other = new Database(x.file);
  closers.push(() => other.close());
  const before = createProjectGraphReader(x.db, 'local').read({
    protocol_version: 1,
    operation: 'read_project_graph',
    project_id: x.project.id,
    depth: 2,
    node_limit: 200,
  });
  // 夹具在真实SELECT返回后插入另一连接提交，不在产品注入同步钩子。
  const prepare = x.db.prepare.bind(x.db);
  let interleaved = false;
  vi.spyOn(x.db, 'prepare').mockImplementation(((sql: string) => {
    const statement = prepare(sql);
    if (sql.startsWith('SELECT id,title,version,status,project_type')) {
      const get = statement.get.bind(statement);
      statement.get = ((...args: unknown[]) => {
        const row = get(...args);
        if (!interleaved) {
          interleaved = true;
          other
            .transaction(() => {
              other.prepare("UPDATE matters SET title='新项目',version=version+1").run();
              other.prepare("UPDATE task_items SET title='新任务',version=version+1").run();
            })
            .immediate();
        }
        return row;
      }) as typeof statement.get;
    }
    return statement;
  }) as typeof x.db.prepare);
  const reader = createProjectGraphReader(x.db, 'local');
  const viewStore = createProjectVisualizationViewStore(x.db, 'local', reader);
  const during = ok(
    viewStore.execute({ ...x.scope, operation: 'read_project_visualization_view' }),
  ).project_graph!;
  expect(during).toEqual(before);
  expect(interleaved).toBe(true);
  expect(x.read().project_graph!.fingerprint).not.toBe(during.fingerprint);
});
it('upgrades the exact previous integrated history without changing old rows, receipts or migration identities', () => {
  const root = mkdtempSync(join(tmpdir(), 'viz-old-db-'));
  roots.push(root);
  const file = join(root, 'old.sqlite');
  const old = new Database(file);
  old.exec(
    'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  for (const migration of integrationMigrations.slice(0, -1)) {
    old.exec(readFileSync(join(migrations, migration.tag + '.sql'), 'utf8'));
    old
      .prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)')
      .run(migration.hash, migration.when);
  }
  old.prepare('INSERT INTO toolchain_probe VALUES(?,?)').run('preserved', '旧数据');
  const history = old
    .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY rowid')
    .all();
  old.close();
  const db = openToolchainProbe(file, migrations).sqlite;
  closers.push(() => db.close());
  expect(db.prepare('SELECT * FROM toolchain_probe').all()).toEqual([
    { id: 'preserved', value: '旧数据' },
  ]);
  expect(
    db
      .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY rowid')
      .all()
      .slice(0, -1),
  ).toEqual(history);
  expect(db.prepare('SELECT * FROM project_visualization_views').all()).toEqual([]);
  expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
});
