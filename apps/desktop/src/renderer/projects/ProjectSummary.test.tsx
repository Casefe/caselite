// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogDocument, Matter, Task } from '../../preload/caselite-api';
import ProjectSummary from './ProjectSummary';
afterEach(cleanup);
describe('project summary reads original objects', () => {
  const project = { id: 'A', task_count: 1 } as Matter;
  const tasks = [
    { id: 'task-A', title: '原任务A', matter_id: 'A' },
    { id: 'task-B', title: '其他项目任务', matter_id: 'B' },
  ] as Task[];
  const documents = [
    { id: 'doc-A', task_id: 'task-A', title: '原成果A', matter_id: 'A', archived_at: null },
    {
      id: 'doc-old',
      task_id: 'task-A',
      title: '已归档成果',
      matter_id: 'A',
      archived_at: '2026-11-06',
    },
    { id: 'doc-B', task_id: 'task-B', title: '其他成果', matter_id: 'B', archived_at: null },
  ] as CatalogDocument[];
  it('scopes records and sends the original Task ID for document and task links', () => {
    const open = vi.fn();
    render(
      <ProjectSummary
        project={project}
        tasks={tasks}
        documents={documents}
        unavailable={false}
        disabled={false}
        onOpen={open}
      />,
    );
    fireEvent.click(screen.getByText('原任务A'));
    fireEvent.click(screen.getByText('原成果A'));
    expect(open.mock.calls).toEqual([['task-A'], ['task-A']]);
    expect(screen.queryByText('其他项目任务')).toBeNull();
    expect(screen.queryByText('已归档成果')).toBeNull();
    expect(screen.queryByText('其他成果')).toBeNull();
  });
  it('shows unavailable data as unavailable and does not invent zero results', () => {
    render(
      <ProjectSummary
        project={project}
        tasks={[]}
        documents={[]}
        unavailable
        disabled={false}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('摘要暂时无法更新');
    expect(screen.queryByText('还没有未归档文档。')).toBeNull();
  });
});
