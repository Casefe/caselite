import { z } from 'zod';
import { ordinaryDateSchema, type TaskStatus } from './task';
import { milestoneOrganizationStatusSchema, type MilestoneOrganizationStatus } from './catalog';

export const taskGroupProgressSummarySchema = z.strictObject({
  milestone_id: z.string().uuid(),
  title: z.string(),
  target_date: ordinaryDateSchema.nullable(),
  status: milestoneOrganizationStatusSchema,
  is_overdue: z.boolean(),
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  todo: z.number().int().nonnegative(),
  in_progress: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
  task_ids: z.array(z.string().uuid()),
});
export type TaskGroupProgressSummary = z.infer<typeof taskGroupProgressSummarySchema>;

export const projectTaskGroupReconciliationSchema = z.strictObject({
  reconciled: z.boolean(),
  project_id: z.string().uuid(),
  project_task_count: z.number().int().nonnegative(),
  assigned_task_count: z.number().int().nonnegative(),
  unassigned_task_count: z.number().int().nonnegative(),
  unassigned_task_ids: z.array(z.string().uuid()),
  groups: z.array(taskGroupProgressSummarySchema),
  discrepancies: z.array(z.string()),
});
export type ProjectTaskGroupReconciliation = z.infer<typeof projectTaskGroupReconciliationSchema>;

export function computeTaskGroupProgress(
  milestone: {
    id: string;
    title: string;
    target_date: string | null;
    archived_at: string | null;
  },
  assignedTasks: Array<{ id: string; status: TaskStatus }>,
  currentDate?: string,
): TaskGroupProgressSummary {
  let todo = 0;
  let in_progress = 0;
  let done = 0;
  let canceled = 0;
  const task_ids: string[] = [];

  for (const t of assignedTasks) {
    task_ids.push(t.id);
    switch (t.status) {
      case 'done':
        done++;
        break;
      case 'in_progress':
        in_progress++;
        break;
      case 'canceled':
        canceled++;
        break;
      case 'todo':
      default:
        todo++;
        break;
    }
  }

  const total = todo + in_progress + done;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  let status: MilestoneOrganizationStatus;
  if (milestone.archived_at) {
    status = 'archived';
  } else if (total > 0 && done === total) {
    status = 'completed';
  } else if (in_progress > 0 || (done > 0 && done < total)) {
    status = 'in_progress';
  } else {
    status = 'planned';
  }

  const today = currentDate ?? new Date().toISOString().slice(0, 10);
  const is_overdue = Boolean(
    milestone.target_date &&
    milestone.target_date < today &&
    status !== 'completed' &&
    status !== 'archived',
  );

  return {
    milestone_id: milestone.id,
    title: milestone.title,
    target_date: milestone.target_date,
    status,
    is_overdue,
    total,
    done,
    todo,
    in_progress,
    canceled,
    percent,
    task_ids,
  };
}

export function reconcileProjectTaskGroups(
  projectId: string,
  projectTasks: Array<{ id: string; status: TaskStatus; matter_id: string | null }>,
  plan: {
    milestones: Array<{
      id: string;
      title: string;
      target_date: string | null;
      archived_at: string | null;
    }>;
    assignments: Array<{ task_id: string; milestone_id: string }>;
  },
  currentDate?: string,
): ProjectTaskGroupReconciliation {
  const discrepancies: string[] = [];
  const assignedTaskIds = new Set<string>();
  const milestoneMap = new Map(plan.milestones.map((m) => [m.id, m]));

  const milestoneTasksMap = new Map<string, Array<{ id: string; status: TaskStatus }>>();
  for (const m of plan.milestones) {
    milestoneTasksMap.set(m.id, []);
  }

  for (const a of plan.assignments) {
    const task = projectTasks.find((t) => t.id === a.task_id);
    if (!task) {
      discrepancies.push(`Assigned task ${a.task_id} not found in project ${projectId}`);
      continue;
    }
    if (task.matter_id !== projectId) {
      discrepancies.push(
        `Assigned task ${a.task_id} belongs to different matter ${task.matter_id}`,
      );
      continue;
    }
    const m = milestoneMap.get(a.milestone_id);
    if (!m) {
      discrepancies.push(`Task ${a.task_id} assigned to unknown milestone ${a.milestone_id}`);
      continue;
    }
    assignedTaskIds.add(a.task_id);
    milestoneTasksMap.get(a.milestone_id)?.push(task);
  }

  const groups: TaskGroupProgressSummary[] = [];
  for (const m of plan.milestones) {
    const assigned = milestoneTasksMap.get(m.id) ?? [];
    groups.push(computeTaskGroupProgress(m, assigned, currentDate));
  }

  const unassigned_task_ids: string[] = [];
  for (const t of projectTasks) {
    if (!assignedTaskIds.has(t.id)) {
      unassigned_task_ids.push(t.id);
    }
  }

  const assigned_task_count = assignedTaskIds.size;
  const unassigned_task_count = unassigned_task_ids.length;
  const project_task_count = projectTasks.length;

  if (assigned_task_count + unassigned_task_count !== project_task_count) {
    discrepancies.push(
      `Task count mismatch: assigned (${assigned_task_count}) + unassigned (${unassigned_task_count}) !== total (${project_task_count})`,
    );
  }

  return {
    reconciled: discrepancies.length === 0,
    project_id: projectId,
    project_task_count,
    assigned_task_count,
    unassigned_task_count,
    unassigned_task_ids,
    groups,
    discrepancies,
  };
}
