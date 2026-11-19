// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogRequest, CatalogResponse, Matter, Task } from '../../../preload/caselite-api';
import ProjectPlanning from './ProjectPlanning';

afterEach(cleanup);

const project: Matter = {
  id: '00000000-0000-4000-8000-000000000001',
  title: '知识产权维权项目',
  status: 'planned',
  version: 1,
  archived_at: null,
  body_id: 'body-1',
  body_revision: 0,
  editor_schema: 1,
  updated_at: '2026-11-16T00:00:00Z',
  task_count: 3,
};

const tasks: Task[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    title: '准备证据材料',
    objective: '',
    status: 'done',
    priority: 1,
    due_date: '2026-12-01',
    version: 1,
    matter_id: project.id,
    document_id: 'doc-1',
    body_id: 'body-1',
    body_revision: 0,
    editor_schema: 1,
    updated_at: '2026-11-16T00:00:00Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: '撰写起诉状',
    objective: '',
    status: 'in_progress',
    priority: 2,
    due_date: '2026-12-10',
    version: 1,
    matter_id: project.id,
    document_id: 'doc-2',
    body_id: 'body-2',
    body_revision: 0,
    editor_schema: 1,
    updated_at: '2026-11-16T00:00:00Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    title: '缴纳诉讼费',
    objective: '',
    status: 'todo',
    priority: 0,
    due_date: null,
    version: 1,
    matter_id: project.id,
    document_id: 'doc-3',
    body_id: 'body-3',
    body_revision: 0,
    editor_schema: 1,
    updated_at: '2026-11-16T00:00:00Z',
  },
];

const milestone = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: '诉讼前准备',
  target_date: '2026-12-20',
  version: 1,
  archived_at: null,
  total: 2,
  done: 1,
  todo: 0,
  in_progress: 1,
  canceled: 0,
  status: 'in_progress' as const,
};

describe('DEV-1891: ProjectPlanning task grouping, target dates, status and progress panel', () => {
  beforeEach(() => {
    window.caselite = {
      catalog: vi.fn(async (request: CatalogRequest): Promise<CatalogResponse> => {
        if (request.operation === 'read_project_plan') {
          return {
            ok: true,
            project_plan: {
              milestones: [milestone],
              assignments: [
                { task_id: tasks[0].id, milestone_id: milestone.id },
                { task_id: tasks[1].id, milestone_id: milestone.id },
              ],
            },
          };
        }
        return { ok: true };
      }),
    } as unknown as Window['caselite'];
  });

  it('displays milestone target date, organization status badge, and progress counts', async () => {
    const onOpenTask = vi.fn();
    render(
      <ProjectPlanning
        project={project}
        tasks={tasks}
        disabled={false}
        pending={false}
        onDirty={vi.fn()}
        execute={vi.fn()}
        onOpenTask={onOpenTask}
      />,
    );

    // Wait for plan to load
    await waitFor(() => {
      expect(screen.getAllByText('诉讼前准备').length).toBeGreaterThan(0);
    });

    // Target date and organization status badge
    expect(screen.getByText('目标日 2026-12-20')).toBeTruthy();
    expect(screen.getByText('进行中', { selector: '.project-milestone-status' })).toBeTruthy();

    // Progress percentage and completion text
    expect(screen.getByText('50% · 1 / 2 项完成')).toBeTruthy();

    // Reconcilable breakdown counts
    expect(screen.getByText('待办 0')).toBeTruthy();
    expect(screen.getByText('进行中 1')).toBeTruthy();
    expect(screen.getByText('已完成 1')).toBeTruthy();
    expect(screen.getByText('已取消 0')).toBeTruthy();

    // Assigned tasks rendered under the milestone
    expect(screen.getByRole('button', { name: '打开任务 准备证据材料' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开任务 撰写起诉状' })).toBeTruthy();

    // Unassigned tasks reconciliation text
    expect(screen.getByText('未关联里程碑任务：1 / 3 项')).toBeTruthy();

    // Clicking an assigned task opens original task
    fireEvent.click(screen.getByRole('button', { name: '打开任务 撰写起诉状' }));
    expect(onOpenTask).toHaveBeenCalledWith(tasks[1].id);
  });

  it('renders overdue warning for milestone with passed target date', async () => {
    const overdueMilestone = {
      ...milestone,
      target_date: '2020-01-01',
      status: 'planned' as const,
      total: 1,
      done: 0,
      todo: 1,
      in_progress: 0,
    };

    window.caselite.catalog = vi.fn(async () => ({
      ok: true,
      project_plan: {
        milestones: [overdueMilestone],
        assignments: [],
      },
    })) as unknown as Window['caselite']['catalog'];

    render(
      <ProjectPlanning
        project={project}
        tasks={tasks}
        disabled={false}
        pending={false}
        onDirty={vi.fn()}
        execute={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('（已逾期）')).toBeTruthy();
    });
    expect(screen.getByText('暂无关联任务')).toBeTruthy();
  });
});
