import { describe, expect, it } from 'vitest';
import {
  milestoneSchema,
  computeTaskGroupProgress,
  reconcileProjectTaskGroups,
  type TaskStatus,
} from '@caselite/contracts';

describe('task-group-progress contracts and reconciliation', () => {
  it('validates milestone schema with optional progress breakdown fields', () => {
    const valid = milestoneSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      title: '第一阶段目标',
      target_date: '2026-12-31',
      version: 1,
      archived_at: null,
      total: 3,
      done: 1,
      todo: 1,
      in_progress: 1,
      canceled: 1,
      status: 'in_progress',
    });
    expect(valid.success).toBe(true);

    const legacy = milestoneSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      title: '历史里程碑',
      target_date: null,
      version: 1,
      archived_at: null,
      total: 0,
      done: 0,
    });
    expect(legacy.success).toBe(true);
  });

  it('computes reconcilable progress and organization status correctly', () => {
    const milestone = {
      id: '11111111-1111-4111-8111-111111111111',
      title: '诉讼文书阶段',
      target_date: '2026-12-01',
      archived_at: null,
    };

    const tasks: Array<{ id: string; status: TaskStatus }> = [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'done' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'in_progress' },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'todo' },
      { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', status: 'canceled' },
    ];

    const result = computeTaskGroupProgress(milestone, tasks, '2026-11-16');

    expect(result.total).toBe(3);
    expect(result.done).toBe(1);
    expect(result.in_progress).toBe(1);
    expect(result.todo).toBe(1);
    expect(result.canceled).toBe(1);
    expect(result.percent).toBe(33);
    expect(result.status).toBe('in_progress');
    expect(result.is_overdue).toBe(false);
    expect(result.total).toBe(result.todo + result.in_progress + result.done);
  });

  it('detects completed, planned, archived and overdue states', () => {
    const completedM = {
      id: '11111111-1111-4111-8111-111111111111',
      title: '已完成分组',
      target_date: '2026-10-01',
      archived_at: null,
    };
    const completedTasks: Array<{ id: string; status: TaskStatus }> = [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'done' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'done' },
    ];
    const completedRes = computeTaskGroupProgress(completedM, completedTasks, '2026-11-16');
    expect(completedRes.status).toBe('completed');
    expect(completedRes.percent).toBe(100);
    expect(completedRes.is_overdue).toBe(false);

    const overdueM = {
      id: '22222222-2222-4222-8222-222222222222',
      title: '逾期分组',
      target_date: '2026-11-01',
      archived_at: null,
    };
    const overdueTasks: Array<{ id: string; status: TaskStatus }> = [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'todo' },
    ];
    const overdueRes = computeTaskGroupProgress(overdueM, overdueTasks, '2026-11-16');
    expect(overdueRes.status).toBe('planned');
    expect(overdueRes.is_overdue).toBe(true);

    const archivedM = {
      id: '33333333-3333-4333-8333-333333333333',
      title: '归档分组',
      target_date: '2026-11-01',
      archived_at: '2026-11-10T10:00:00Z',
    };
    const archivedRes = computeTaskGroupProgress(archivedM, overdueTasks, '2026-11-16');
    expect(archivedRes.status).toBe('archived');
    expect(archivedRes.is_overdue).toBe(false);
  });

  it('reconciles project tasks against milestone groups and catches cross-matter discrepancies', () => {
    const projectId = '99999999-9999-4999-8999-999999999999';
    const otherProjectId = '88888888-8888-4888-8888-888888888888';

    const projectTasks = [
      {
        id: 'task-1111-1111-4111-8111-111111111111',
        status: 'done' as TaskStatus,
        matter_id: projectId,
      },
      {
        id: 'task-2222-2222-4222-8222-222222222222',
        status: 'in_progress' as TaskStatus,
        matter_id: projectId,
      },
      {
        id: 'task-3333-3333-4333-8333-333333333333',
        status: 'todo' as TaskStatus,
        matter_id: projectId,
      },
    ];

    const plan = {
      milestones: [
        {
          id: 'mile-1111-1111-4111-8111-111111111111',
          title: '分组1',
          target_date: '2026-12-15',
          archived_at: null,
        },
      ],
      assignments: [
        {
          task_id: 'task-1111-1111-4111-8111-111111111111',
          milestone_id: 'mile-1111-1111-4111-8111-111111111111',
        },
        {
          task_id: 'task-2222-2222-4222-8222-222222222222',
          milestone_id: 'mile-1111-1111-4111-8111-111111111111',
        },
      ],
    };

    const good = reconcileProjectTaskGroups(projectId, projectTasks, plan, '2026-11-16');
    expect(good.reconciled).toBe(true);
    expect(good.assigned_task_count).toBe(2);
    expect(good.unassigned_task_count).toBe(1);
    expect(good.project_task_count).toBe(3);
    expect(good.discrepancies).toEqual([]);

    const badTasks = [
      ...projectTasks.slice(0, 2),
      {
        id: 'task-foreign-0000-4000-8000-000000000000',
        status: 'todo' as TaskStatus,
        matter_id: otherProjectId,
      },
    ];
    const badPlan = {
      ...plan,
      assignments: [
        ...plan.assignments,
        {
          task_id: 'task-foreign-0000-4000-8000-000000000000',
          milestone_id: 'mile-1111-1111-4111-8111-111111111111',
        },
      ],
    };

    const bad = reconcileProjectTaskGroups(projectId, badTasks, badPlan, '2026-11-16');
    expect(bad.reconciled).toBe(false);
    expect(bad.discrepancies.length).toBeGreaterThan(0);
  });
});
