// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogDocument, Matter, Task } from '../../preload/caselite-api';
import ProjectSummary from './ProjectSummary';
afterEach(cleanup);
beforeEach(() => {
  window.caselite = {
    material: vi.fn(async () => ({ ok: true, materials: [] })),
    catalog: vi.fn(async () => ({ ok: true, activity: [], activity_has_more: false })),
  } as unknown as Window['caselite'];
});
describe('project summary reads original objects', () => {
  const project = { id: 'A', task_count: 1 } as Matter;
  const tasks = [
    { id: 'task-A', title: '原任务A', matter_id: 'A', status: 'done' },
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
    expect(screen.getByText('已完成任务').nextElementSibling?.textContent).toBe('1');
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
    expect(window.caselite.material).not.toHaveBeenCalled();
    expect(window.caselite.catalog).not.toHaveBeenCalled();
  });
});

it('does not infer a completed count from an incomplete task projection', () => {
  render(
    <ProjectSummary
      project={{ id: 'A', task_count: 2 } as Matter}
      tasks={[]}
      documents={[]}
      unavailable={false}
      disabled={false}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText('已完成任务').nextElementSibling?.textContent).toBe('正在更新');
});

it('refreshes compact queries after project save and task membership changes', async () => {
  let saved = false;
  let assigned = false;
  const material = vi.fn(async () => ({
    ok: true,
    materials: assigned
      ? [
          {
            id: 'source',
            name: '归入任务.pdf',
            bytes: 1,
            page_count: 1,
            status: 'ready',
            pages: [],
          },
        ]
      : [],
  }));
  const catalog = vi.fn(async () => ({
    ok: true,
    activity: saved
      ? [
          {
            id: 'save',
            origin: 'catalog',
            operation: 'update_project',
            target_id: 'A',
            target_type: 'project',
            committed_at: '2026-11-07T00:00:00Z',
            actor: null,
            recorded_version: null,
          },
        ]
      : [],
    activity_has_more: false,
  }));
  window.caselite = { material, catalog } as unknown as Window['caselite'];
  const props = {
    project: { id: 'A', version: 1, task_count: 0 } as Matter,
    tasks: [] as Task[],
    documents: [],
    unavailable: false,
    disabled: false,
    onOpen: vi.fn(),
  };
  const view = render(<ProjectSummary {...props} />);
  await screen.findByText('还没有可显示的成功活动。');
  saved = true;
  view.rerender(<ProjectSummary {...props} project={{ ...props.project, version: 2 }} />);
  await screen.findByText('保存项目概述');
  assigned = true;
  const member = { id: 't', matter_id: 'A', title: '任务', version: 1 } as Task;
  view.rerender(
    <ProjectSummary
      {...props}
      project={{ ...props.project, version: 2, task_count: 1 }}
      tasks={[member]}
    />,
  );
  await screen.findByText('归入任务.pdf');
  assigned = false;
  view.rerender(<ProjectSummary {...props} project={{ ...props.project, version: 2 }} />);
  await screen.findByText('项目还没有已登记材料，请在任务中添加 PDF。');
  expect(screen.queryByText('归入任务.pdf')).toBeNull();
  expect(material).toHaveBeenCalledTimes(4);
  expect(catalog).toHaveBeenCalledTimes(4);
});
