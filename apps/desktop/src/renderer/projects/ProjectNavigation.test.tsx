// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CatalogRequest, Matter, Task } from '../../preload/caselite-api';
import { useState } from 'react';
import ProjectCatalog, { type ProjectViewState } from './ProjectCatalog';
vi.mock('../editors/RichEditor', () => ({
  emptyDraft: () => ({ text: '', state: null }),
  DraftEditor: () => <div />,
}));
afterEach(cleanup);
const project: Matter = {
  id: crypto.randomUUID(),
  title: '来源项目',
  status: 'active',
  version: 3,
  archived_at: null,
  body_id: crypto.randomUUID(),
  body_revision: 2,
  editor_schema: 1,
  updated_at: '2026-11-07',
  task_count: 1,
};
const task = { id: crypto.randomUUID(), title: '原任务', matter_id: project.id } as Task;
const ok = (projects = [project]) => ({
  ok: true,
  projects,
  documents: [],
  state: null,
  receipt: null,
  target_id: null,
});
function setup(read = ok(), list = ok()) {
  const catalog = vi.fn(async (r: CatalogRequest) =>
    r.operation === 'read_project'
      ? read
      : r.operation === 'list_activity'
        ? { ...ok(), activity: [], activity_has_more: false }
        : list,
  );
  window.caselite = { catalog } as unknown as Window['caselite'];
  return catalog;
}
it('returns to the exact section and current project, preserving list preferences and task focus', async () => {
  setup();
  const onOpen = vi.fn();
  const props = { tasks: [task], onOpen, onDirty: vi.fn(), onChanged: vi.fn() };
  const first = render(<ProjectCatalog {...props} />);
  await screen.findByRole('button', { name: '来源项目', exact: true });
  fireEvent.change(screen.getByLabelText('搜索项目'), { target: { value: '来源' } });
  fireEvent.change(screen.getByLabelText('项目排序'), { target: { value: 'title' } });
  fireEvent.change(screen.getByLabelText('筛选项目状态'), { target: { value: 'active' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '更新时间' }));
  fireEvent.click(screen.getByRole('button', { name: '来源项目', exact: true }));
  await screen.findByLabelText('编辑项目名称');
  fireEvent.click(screen.getByRole('tab', { name: '任务', exact: true }));
  const scroll = document.querySelector('.collection-scroll')!;
  scroll.scrollTop = 80;
  fireEvent.click(
    within(screen.getByRole('tabpanel', { name: '任务', exact: true })).getByText('原任务'),
  );
  const source = onOpen.mock.calls[0][1] as ProjectViewState;
  expect(source).toMatchObject({
    projectId: project.id,
    section: 'tasks',
    query: '来源',
    order: 'title',
    statusFilter: 'active',
    columns: { updated: false },
    scrollTop: 80,
  });
  first.unmount();
  const current = { ...project, title: '保存后新名称', version: 4, body_revision: 3 };
  const catalog = setup(ok([current]));
  render(<ProjectCatalog {...props} initialView={source} />);
  await waitFor(() =>
    expect((screen.getByLabelText('编辑项目名称') as HTMLInputElement).value).toBe('保存后新名称'),
  );
  expect(document.querySelector('.project-detail-heading strong')?.textContent).toBe(
    '保存后新名称',
  );
  await waitFor(() =>
    expect(document.activeElement?.getAttribute('data-project-task')).toBe(task.id),
  );
  expect(document.querySelector('.collection-scroll')?.scrollTop).toBe(80);
  expect(
    catalog.mock.calls.some(([r]) => r.operation === 'read_project' && r.id === project.id),
  ).toBe(true);
  fireEvent.click(screen.getByText('返回项目列表'));
  expect((screen.getByLabelText('搜索项目') as HTMLInputElement).value).toBe('来源');
  expect((screen.getByLabelText('项目排序') as HTMLSelectElement).value).toBe('title');
  expect((screen.getByRole('checkbox', { name: '更新时间' }) as HTMLInputElement).checked).toBe(
    false,
  );
});
const source: ProjectViewState = {
  selected: project.id,
  projectId: project.id,
  section: 'tasks',
  query: '',
  order: 'updated',
  statusFilter: 'all',
  columns: { status: true, tasks: true, updated: true },
  scrollTop: 0,
  workspaceScrollTop: 0,
  returnTaskId: task.id,
};
it('does not substitute another project when the source is unavailable', async () => {
  setup(ok([]));
  render(
    <ProjectCatalog
      tasks={[]}
      initialView={source}
      onOpen={vi.fn()}
      onDirty={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
  await screen.findByText(/来源项目暂不可用/);
  expect(screen.queryByText('打开项目')).toBeNull();
  expect(screen.queryByLabelText('编辑项目名称')).toBeNull();
  fireEvent.click(screen.getByText('返回项目列表'));
  await screen.findByRole('table', { name: '项目列表' });
});
it('falls back to the original section when the task moved and shows an archived source read-only', async () => {
  const archived = ok([{ ...project, archived_at: '2026-11-07' }]);
  setup(archived, archived);
  render(
    <ProjectCatalog
      tasks={[]}
      initialView={source}
      onOpen={vi.fn()}
      onDirty={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
  await screen.findByLabelText('编辑项目名称');
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '任务', exact: true })),
  );
  expect((screen.getByLabelText('编辑项目名称') as HTMLInputElement).disabled).toBe(true);
});
it('refreshes same-version task counts and compact PDF projection after assigning and removing a task', async () => {
  let assigned = false;
  const member = { ...task, matter_id: null, version: 1, status: 'done' } as Task;
  const material = vi.fn(async () => ({
    ok: true,
    materials: assigned
      ? [{ id: 'S', name: '归入原件.pdf', bytes: 1, page_count: 1, status: 'ready', pages: [] }]
      : [],
  }));
  window.caselite = {
    material,
    catalog: vi.fn(async (r: CatalogRequest) => {
      if (r.operation === 'assign_task') assigned = r.matter_id === project.id;
      return {
        ...ok([{ ...project, task_count: assigned ? 1 : 0 }]),
        activity: [],
        activity_has_more: false,
      };
    }),
  } as unknown as Window['caselite'];
  function Container() {
    const [tasks, setTasks] = useState([member]);
    return (
      <ProjectCatalog
        tasks={tasks}
        onOpen={vi.fn()}
        onDirty={vi.fn()}
        onChanged={() =>
          setTasks([
            { ...member, matter_id: assigned ? project.id : null, version: assigned ? 2 : 3 },
          ])
        }
      />
    );
  }
  render(<Container />);
  fireEvent.click(await screen.findByRole('button', { name: '来源项目', exact: true }));
  await screen.findByLabelText('编辑项目名称');
  await screen.findByText('项目还没有已登记材料，请在任务中添加 PDF。');
  fireEvent.click(screen.getByRole('tab', { name: '任务', exact: true }));
  fireEvent.change(screen.getByLabelText('归入已有任务'), { target: { value: task.id } });
  fireEvent.click(screen.getByText('归入项目'));
  await waitFor(() =>
    expect((screen.getByRole('tab', { name: '概述' }) as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole('tab', { name: '概述' }));
  await screen.findByText('归入原件.pdf');
  expect(screen.getByText('项目任务', { selector: 'dt' }).nextElementSibling?.textContent).toBe(
    '1',
  );
  expect(screen.getByText('已完成任务').nextElementSibling?.textContent).toBe('1');
  fireEvent.click(screen.getByRole('tab', { name: '任务', exact: true }));
  fireEvent.click(screen.getByText('移出项目'));
  await waitFor(() =>
    expect((screen.getByRole('tab', { name: '概述' }) as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole('tab', { name: '概述' }));
  await screen.findByText('项目还没有已登记材料，请在任务中添加 PDF。');
  expect(screen.queryByText('归入原件.pdf')).toBeNull();
  expect(screen.getByText('项目任务', { selector: 'dt' }).nextElementSibling?.textContent).toBe(
    '0',
  );
  expect(screen.getByText('已完成任务').nextElementSibling?.textContent).toBe('0');
});
it.each([false, true])(
  'returns from the list sidebar to the original list with safe focus (moved=%s)',
  async (moved) => {
    setup();
    const onOpen = vi.fn();
    const props = { tasks: [task], onOpen, onDirty: vi.fn(), onChanged: vi.fn() };
    const first = render(<ProjectCatalog {...props} />);
    await screen.findByRole('button', { name: '来源项目', exact: true });
    fireEvent.change(screen.getByLabelText('搜索项目'), { target: { value: '来源' } });
    fireEvent.change(screen.getByLabelText('项目排序'), { target: { value: 'title' } });
    // 原列表侧栏入口已移到项目任务栏目，往返后仍应保留列表筛选与焦点。
    fireEvent.click(screen.getByRole('button', { name: '来源项目', exact: true }));
    await screen.findByLabelText('编辑项目名称');
    fireEvent.click(screen.getByRole('tab', { name: '任务', exact: true }));
    const scroll = document.querySelector('.collection-scroll')!;
    scroll.scrollTop = 65;
    fireEvent.click(document.querySelector('#project-panel-tasks [data-project-task]')!);
    const listSource = onOpen.mock.calls[0][1] as ProjectViewState;
    expect(listSource).toMatchObject({
      projectId: project.id,
      section: 'tasks',
      selected: project.id,
      query: '来源',
      order: 'title',
      scrollTop: 65,
    });
    first.unmount();
    const catalog = setup();
    render(<ProjectCatalog {...props} tasks={moved ? [] : [task]} initialView={listSource} />);
    await screen.findByLabelText('编辑项目名称');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector(
          moved ? '#project-tab-tasks' : '#project-panel-tasks [data-project-task]',
        ),
      ),
    );
    expect(document.querySelector('.collection-scroll')?.scrollTop).toBe(65);
    fireEvent.click(screen.getByText('返回项目列表'));
    expect((screen.getByLabelText('搜索项目') as HTMLInputElement).value).toBe('来源');
    expect(catalog.mock.calls.some(([r]) => r.operation === 'read_project')).toBe(true);
  },
);
