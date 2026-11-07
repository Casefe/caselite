import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src/index';
import { createCatalogApplication } from '../../packages/application/src/catalog-application';
import type {
  CatalogResponse,
  TaskResponse,
  ActivityScope,
} from '../../packages/contracts/src/index';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { force: true, recursive: true })));
function ok<T extends CatalogResponse | TaskResponse>(r: T): Extract<T, { ok: true }> {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.message);
  return r as Extract<T, { ok: true }>;
}
const ids = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
it('queries only committed scoped events, survives restart, rejects forged history, and guards archived targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-activity-'));
  roots.push(root);
  const file = join(root, 'db.sqlite'),
    migrations = resolve('packages/local-db/migrations');
  const store = openTaskStore(file, migrations),
    app = createCatalogApplication(store.catalog);
  const task = ok(
    store.execute({ ...ids(), operation: 'create', title: '合成独立任务', objective: '' }),
  ).tasks[0];
  const taskScope: ActivityScope = { type: 'task', id: task.id };
  const query = (scope: ActivityScope, offset = 0) =>
    ok(app.execute({ protocol_version: 1, operation: 'list_activity', scope, offset }));
  expect(query(taskScope).activity).toHaveLength(1);
  const request = {
    ...ids(),
    operation: 'promote_task' as const,
    task_id: task.id,
    expected_version: task.version,
    title: '合成项目',
  };
  const project = ok(app.execute(request)).target_id!;
  const scope: ActivityScope = { type: 'project', id: project };
  const before = query(scope).activity!;
  expect(before.map((e) => e.operation).sort()).toEqual(['create', 'promote_task']);
  ok(app.execute(request));
  expect(query(scope).activity).toEqual(before);
  expect(
    app.execute({
      protocol_version: 1,
      operation: 'list_activity',
      scope,
      offset: 0,
      actor: 'forged',
      committed_at: 'fake',
    }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  const other = openTaskStore(file, migrations, 'other-workspace');
  expect(
    createCatalogApplication(other.catalog).execute({
      protocol_version: 1,
      operation: 'list_activity',
      scope,
      offset: 0,
    }).ok,
  ).toBe(false);
  other.close();
  const event = before.find((e) => e.target_type === 'task')!;
  const target = {
    protocol_version: 1,
    operation: 'activity_target',
    scope,
    event_id: event.id,
    origin: event.origin,
  };
  expect(ok(app.execute(target)).activity_target?.id).toBe(task.id);
  expect(app.execute({ ...target, event_id: randomUUID() }).ok).toBe(false);
  const connection = openToolchainProbe(file, migrations);
  connection.sqlite.exec(
    "CREATE TRIGGER fail_event BEFORE INSERT ON catalog_activity BEGIN SELECT RAISE(ABORT,'synthetic event failure'); END",
  );
  const change = {
    ...ids(),
    operation: 'update_project',
    id: project,
    expected_version: 1,
    expected_body_revision: 0,
    title: '修改项目',
    status: 'active',
  };
  expect(app.execute(change).ok).toBe(false);
  expect(query(scope).activity).toEqual(before);
  connection.sqlite.exec('DROP TRIGGER fail_event');
  ok(app.execute(change));
  for (let i = 0; i < 23; i++) {
    ok(
      app.execute({
        ...ids(),
        operation: 'archive_project',
        id: project,
        expected_version: i + 2,
        archived: !!(i % 2),
      }),
    );
  }
  const first = query(scope),
    second = query(scope, 20);
  expect(first.activity).toHaveLength(20);
  expect(first.activity_has_more).toBe(true);
  expect(second.activity!.length).toBeGreaterThan(0);
  expect(new Set([...first.activity!, ...second.activity!].map((e) => e.origin + e.id)).size).toBe(
    26,
  );
  const projectEvent = first.activity!.find((e) => e.target_type === 'project')!;
  ok(
    app.execute({
      ...ids(),
      operation: 'archive_project',
      id: project,
      expected_version: 25,
      archived: true,
    }),
  );
  expect(
    app.execute({ ...target, event_id: projectEvent.id, origin: projectEvent.origin }).ok,
  ).toBe(false);
  expect(query(scope).activity!.every((e) => e.actor === null && e.recorded_version === null)).toBe(
    true,
  );
  const expected = query(scope).activity;
  connection.sqlite.close();
  store.close();
  const reopened = openTaskStore(file, migrations);
  expect(
    ok(
      createCatalogApplication(reopened.catalog).execute({
        protocol_version: 1,
        operation: 'list_activity',
        scope,
        offset: 0,
      }),
    ).activity,
  ).toEqual(expected);
  reopened.close();
});

it('revalidates event origin and current membership before opening a scoped target', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-activity-scope-'));
  roots.push(root);
  const store = openTaskStore(join(root, 'db.sqlite'), resolve('packages/local-db/migrations'));
  try {
    const app = createCatalogApplication(store.catalog);
    const task = ok(
      store.execute({ ...ids(), operation: 'create', title: '合成归组任务', objective: '' }),
    ).tasks[0];
    const taskScope: ActivityScope = { type: 'task', id: task.id };
    const query = (scope: ActivityScope) =>
      ok(app.execute({ protocol_version: 1, operation: 'list_activity', scope, offset: 0 }));
    const event = query(taskScope).activity![0];
    const target = {
      protocol_version: 1,
      operation: 'activity_target',
      scope: taskScope,
      event_id: event.id,
      origin: event.origin,
    };
    expect(app.execute({ ...target, origin: 'catalog' }).ok).toBe(false);
    const anotherTask = ok(
      store.execute({ ...ids(), operation: 'create', title: '另一个合成任务', objective: '' }),
    ).tasks[0];
    expect(app.execute({ ...target, scope: { type: 'task', id: anotherTask.id } }).ok).toBe(false);
    const project = ok(
      app.execute({ ...ids(), operation: 'create_project', title: '合成活动项目' }),
    ).projects[0];
    const projectScope: ActivityScope = { type: 'project', id: project.id };
    const scopedTarget = { ...target, scope: projectScope };
    expect(app.execute(scopedTarget).ok).toBe(false);
    ok(
      app.execute({
        ...ids(),
        operation: 'assign_task',
        task_id: task.id,
        expected_version: task.version,
        matter_id: project.id,
      }),
    );
    expect(query(projectScope).activity!.some((e) => e.id === event.id)).toBe(true);
    expect(ok(app.execute(scopedTarget)).activity_target?.task_id).toBe(task.id);
    ok(
      app.execute({
        ...ids(),
        operation: 'assign_task',
        task_id: task.id,
        expected_version: task.version + 1,
        matter_id: null,
      }),
    );
    expect(query(projectScope).activity!.some((e) => e.id === event.id)).toBe(false);
    expect(app.execute(scopedTarget).ok).toBe(false);
    expect(ok(app.execute(target)).activity_target?.task_id).toBe(task.id);
  } finally {
    store.close();
  }
});
