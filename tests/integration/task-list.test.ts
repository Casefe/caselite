import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
import { createTaskApplication } from '../../packages/application/src/task-application';
import { createCatalogApplication } from '../../packages/application/src/catalog-application';
import type { TaskListQuery, TaskResponse } from '../../packages/contracts/src';
const migrations = resolve('packages/local-db/migrations'),
  roots: string[] = [];
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
const ok = (r: TaskResponse) => {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.message);
  return r;
};
const query: TaskListQuery = {
  scope: { type: 'workspace' },
  text: '',
  status: null,
  priority: null,
  dates: 'all',
  from: null,
  to: null,
  body: 'all',
  sort: 'title',
  offset: 0,
};
it('queries the current workspace and explicit project with Chinese combined filters, stable pages and no business writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'caselite-task-list-'));
  roots.push(dir);
  const file = join(dir, 'db.sqlite'),
    store = openTaskStore(file, migrations),
    app = createTaskApplication(store),
    catalog = createCatalogApplication(store.catalog);
  const project = catalog.execute({
    ...identity(),
    operation: 'create_project',
    title: '合成项目',
  });
  if (!project.ok) throw new Error(project.message);
  const ids: string[] = [];
  for (let i = 0; i < 45; i++) {
    let t = ok(
      app.execute({
        ...identity(),
        operation: 'create',
        title: '共同中文任务',
        objective: '检索说明关键词',
      }),
    ).tasks[0];
    ids.push(t.id);
    if (i < 2) {
      t = ok(
        app.execute({
          ...identity(),
          operation: 'update_attributes',
          task_id: t.id,
          expected_version: t.version,
          priority: 1,
          due_date: '2024-02-29',
        }),
      ).tasks[0];
      t = ok(
        app.execute({
          ...identity(),
          operation: 'change_status',
          task_id: t.id,
          expected_version: t.version,
          status: 'in_progress',
        }),
      ).tasks[0];
      expect(
        catalog.execute({
          ...identity(),
          operation: 'assign_task',
          task_id: t.id,
          expected_version: t.version,
          matter_id: project.target_id,
        }).ok,
      ).toBe(true);
    }
  }
  const other = openTaskStore(file, migrations, 'other'),
    otherApp = createTaskApplication(other),
    foreign = createCatalogApplication(other.catalog).execute({
      ...identity(),
      operation: 'create_project',
      title: '不可见项目',
    });
  ok(otherApp.execute({ ...identity(), operation: 'create', title: '不可见任务', objective: '' }));
  if (!foreign.ok) throw new Error(foreign.message);
  const db = openToolchainProbe(file, migrations).sqlite;
  const before = JSON.stringify({
    tasks: db.prepare('SELECT * FROM task_items ORDER BY id').all(),
    receipts: db.prepare('SELECT * FROM task_receipts ORDER BY key').all(),
    activity: db.prepare('SELECT * FROM task_activity ORDER BY id').all(),
  });
  const list = (patch: Partial<TaskListQuery> = {}) =>
    ok(app.execute({ protocol_version: 1, operation: 'list', query: { ...query, ...patch } }));
  const first = list(),
    second = list({ offset: 20 }),
    last = list({ offset: 40 });
  expect(first.tasks).toHaveLength(20);
  expect(last.tasks).toHaveLength(5);
  expect(first.page).toEqual({ offset: 0, total: 45, has_more: true });
  expect(last.page?.has_more).toBe(false);
  expect([...first.tasks, ...second.tasks, ...last.tasks].map((t) => t.id)).toEqual(ids.sort());
  expect(list({ offset: 60 }).tasks).toEqual([]);
  const combination = {
    scope: { type: 'project' as const, id: project.target_id! },
    text: '说明关键词',
    status: 'in_progress' as const,
    priority: 1,
    from: '2024-02-29',
    to: '2024-02-29',
    dates: 'dated' as const,
  };
  expect(list(combination).tasks).toHaveLength(2);
  expect(list({ ...combination, status: 'done' }).tasks).toEqual([]);
  expect(list({ dates: 'undated' }).page?.total).toBe(43);
  expect(list({ text: "%' OR 1=1 --" }).tasks).toEqual([]);
  expect(
    list({ sort: 'priority' })
      .tasks.slice(0, 2)
      .every((t) => t.priority === 1),
  ).toBe(true);
  expect(
    list({ sort: 'due_date' })
      .tasks.slice(0, 2)
      .every((t) => t.due_date === '2024-02-29'),
  ).toBe(true);
  for (const id of [randomUUID(), foreign.target_id!])
    expect(
      app.execute({
        protocol_version: 1,
        operation: 'list',
        query: { ...query, scope: { type: 'project', id } },
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(ok(app.execute({ protocol_version: 1, operation: 'list' })).tasks).toHaveLength(45);
  expect(
    JSON.stringify({
      tasks: db.prepare('SELECT * FROM task_items ORDER BY id').all(),
      receipts: db.prepare('SELECT * FROM task_receipts ORDER BY key').all(),
      activity: db.prepare('SELECT * FROM task_activity ORDER BY id').all(),
    }),
  ).toBe(before);
  db.close();
  other.close();
  store.close();
  const reopened = openTaskStore(file, migrations);
  expect(
    ok(
      reopened.execute({
        protocol_version: 1,
        operation: 'list',
        query: { ...query, ...combination },
      }),
    ).tasks,
  ).toHaveLength(2);
  reopened.close();
});
