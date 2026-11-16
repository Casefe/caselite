import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openTaskStore } from '../../packages/local-db/src/index';
import { createCatalogApplication } from '../../packages/application/src/catalog-application';
import type { CatalogResponse, TaskResponse } from '../../packages/contracts/src/index';

const migrations = resolve('packages/local-db/migrations');
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { force: true, recursive: true })));

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
  const root = mkdtempSync(join(tmpdir(), 'caselite-group-progress-'));
  roots.push(root);
  const file = join(root, 'data.sqlite');
  const store = openTaskStore(file, migrations);
  return { root, file, store, app: createCatalogApplication(store.catalog) };
}

describe('DEV-1891: Task grouping target dates, organization status and reconcilable progress', () => {
  it('computes reconcilable status breakdown counts and organization status for milestone groups', () => {
    const { store, app } = setup();

    const project = ok(
      app.execute({
        ...ids(),
        operation: 'create_project',
        title: '知识产权维权项目',
      }),
    ).target_id!;

    const milestoneId = ok(
      app.execute({
        ...ids(),
        operation: 'create_milestone',
        project_id: project,
        title: '立案与证据保全',
        target_date: '2026-12-15',
      }),
    ).target_id!;

    const plan = (projectId: string) =>
      ok(
        app.execute({
          protocol_version: 1,
          operation: 'read_project_plan',
          project_id: projectId,
        }),
      ).project_plan!;

    const initialPlan = plan(project);
    expect(initialPlan.milestones[0]).toMatchObject({
      id: milestoneId,
      title: '立案与证据保全',
      target_date: '2026-12-15',
      total: 0,
      done: 0,
      todo: 0,
      in_progress: 0,
      canceled: 0,
      status: 'planned',
    });

    const createTask = (title: string) =>
      ok(
        store.execute({
          ...ids(),
          operation: 'create',
          title,
          objective: '',
          matter_id: project,
        }),
      ).tasks[0];

    const task1 = createTask('准备起诉状');
    const task2 = createTask('证据公证');
    const task3 = createTask('缴纳诉讼费');
    const task4 = createTask('多余申请（待取消）');

    const assignMilestone = (taskId: string, version: number) => {
      ok(
        app.execute({
          ...ids(),
          operation: 'assign_milestone',
          project_id: project,
          task_id: taskId,
          expected_version: version,
          milestone_id: milestoneId,
        }),
      );
    };

    assignMilestone(task1.id, task1.version);
    assignMilestone(task2.id, task2.version);
    assignMilestone(task3.id, task3.version);
    assignMilestone(task4.id, task4.version);

    // Initial state: 4 tasks assigned, all in 'todo'
    let current = plan(project).milestones[0];
    expect(current).toMatchObject({
      total: 4,
      done: 0,
      todo: 4,
      in_progress: 0,
      canceled: 0,
      status: 'planned',
    });

    // Advance task1 to in_progress
    const t1Progress = ok(
      store.execute({
        ...ids(),
        operation: 'change_status',
        task_id: task1.id,
        expected_version: task1.version + 1,
        status: 'in_progress',
      }),
    ).tasks[0];

    current = plan(project).milestones[0];
    expect(current).toMatchObject({
      total: 4,
      done: 0,
      todo: 3,
      in_progress: 1,
      canceled: 0,
      status: 'in_progress',
    });

    // Complete task1
    ok(
      store.execute({
        ...ids(),
        operation: 'change_status',
        task_id: task1.id,
        expected_version: t1Progress.version,
        status: 'done',
      }),
    );

    // Advance task2 to in_progress
    const t2Progress = ok(
      store.execute({
        ...ids(),
        operation: 'change_status',
        task_id: task2.id,
        expected_version: task2.version + 1,
        status: 'in_progress',
      }),
    ).tasks[0];

    // Cancel task4
    ok(
      store.execute({
        ...ids(),
        operation: 'change_status',
        task_id: task4.id,
        expected_version: task4.version + 1,
        status: 'canceled',
      }),
    );

    current = plan(project).milestones[0];
    // Invariant check: total active is 3 (task1 done, task2 in_progress, task3 todo)
    expect(current.total).toBe(3);
    expect(current.done).toBe(1);
    expect(current.in_progress).toBe(1);
    expect(current.todo).toBe(1);
    expect(current.canceled).toBe(1);
    expect(current.total).toBe(current.todo! + current.in_progress! + current.done);
    expect(current.status).toBe('in_progress');

    // Complete task2 and task3
    ok(
      store.execute({
        ...ids(),
        operation: 'change_status',
        task_id: task2.id,
        expected_version: t2Progress.version,
        status: 'done',
      }),
    );
    ok(
      store.execute({
        ...ids(),
        operation: 'change_status',
        task_id: task3.id,
        expected_version: task3.version + 1,
        status: 'done',
      }),
    );

    current = plan(project).milestones[0];
    expect(current).toMatchObject({
      total: 3,
      done: 3,
      todo: 0,
      in_progress: 0,
      canceled: 1,
      status: 'completed',
    });

    // Archive milestone: transitions to archived status
    ok(
      app.execute({
        ...ids(),
        operation: 'update_milestone',
        project_id: project,
        milestone_id: milestoneId,
        expected_version: current.version,
        title: '立案与证据保全',
        target_date: '2026-12-15',
        archived: true,
      }),
    );

    current = plan(project).milestones[0];
    expect(current.archived_at).not.toBeNull();
    expect(current.status).toBe('archived');
  });

  it('enforces cross-scope rejection and maintains task identity on milestone changes', () => {
    const { file, store, app } = setup();

    const projectA = ok(
      app.execute({ ...ids(), operation: 'create_project', title: '项目甲' }),
    ).target_id!;
    const projectB = ok(
      app.execute({ ...ids(), operation: 'create_project', title: '项目乙' }),
    ).target_id!;

    const milestoneA = ok(
      app.execute({
        ...ids(),
        operation: 'create_milestone',
        project_id: projectA,
        title: '甲里程碑',
        target_date: '2026-12-01',
      }),
    ).target_id!;

    const taskB = ok(
      store.execute({
        ...ids(),
        operation: 'create',
        title: '乙项目任务',
        objective: '乙项目内容',
        matter_id: projectB,
      }),
    ).tasks[0];

    // Cannot assign task belonging to Project B to milestone in Project A
    const crossAssign = app.execute({
      ...ids(),
      operation: 'assign_milestone',
      project_id: projectA,
      task_id: taskB.id,
      expected_version: taskB.version,
      milestone_id: milestoneA,
    });
    expect(crossAssign).toMatchObject({ code: 'NOT_FOUND' });

    // Assigning task within Project B
    const taskA = ok(
      store.execute({
        ...ids(),
        operation: 'create',
        title: '甲项目任务',
        objective: '甲项目内容',
        matter_id: projectA,
      }),
    ).tasks[0];

    const assignReceipt = ok(
      app.execute({
        ...ids(),
        operation: 'assign_milestone',
        project_id: projectA,
        task_id: taskA.id,
        expected_version: taskA.version,
        milestone_id: milestoneA,
      }),
    );
    expect(assignReceipt.ok).toBe(true);

    // Unassign task from milestone: does not delete task or project
    ok(
      app.execute({
        ...ids(),
        operation: 'assign_milestone',
        project_id: projectA,
        task_id: taskA.id,
        expected_version: taskA.version + 1,
        milestone_id: null,
      }),
    );

    const checkTask = store.catalog.execute({
      protocol_version: 1,
      operation: 'read_project_plan',
      project_id: projectA,
    });
    expect(ok(checkTask).project_plan?.assignments).toEqual([]);

    // Task still exists and retains its matter_id
    const taskList = store.execute({
      protocol_version: 1,
      operation: 'list',
      query: {
        scope: { type: 'project', id: projectA },
        text: '',
        status: null,
        priority: null,
        dates: 'all',
        from: null,
        to: null,
        body: 'all',
        sort: 'updated',
        offset: 0,
      },
    });
    expect(ok(taskList).tasks).toHaveLength(1);
    expect(ok(taskList).tasks[0].id).toBe(taskA.id);

    // Reopen verification
    store.close();
    const reopened = openTaskStore(file, migrations);
    const reopenedApp = createCatalogApplication(reopened.catalog);
    const planAfterReopen = ok(
      reopenedApp.execute({
        protocol_version: 1,
        operation: 'read_project_plan',
        project_id: projectA,
      }),
    ).project_plan!;
    expect(planAfterReopen.milestones[0]).toMatchObject({
      id: milestoneA,
      title: '甲里程碑',
      total: 0,
      done: 0,
      todo: 0,
      in_progress: 0,
      canceled: 0,
      status: 'planned',
    });
    reopened.close();
  });
});
