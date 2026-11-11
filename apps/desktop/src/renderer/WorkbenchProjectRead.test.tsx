// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  CatalogRequest,
  CatalogResponse,
  Matter,
  Task,
  TaskRequest,
  TaskResponse,
} from '../preload/caselite-api';
import App from './App';
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
vi.mock('@tiptap/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tiptap/react')>()),
  useEditor: () => null,
}));
vi.mock('./ui/Appearance', () => ({
  AppearanceProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./editors/RichEditor', () => ({
  emptyDraft: () => ({ text: '', state: null }),
  localExtensions: () => [],
  useLocalDoc: () => null,
  EditorSurface: () => <div />,
  DraftEditor: ({ onChange }: { onChange?(value: { text: string; state: number[] }): void }) => (
    <textarea
      aria-label="任务内容"
      onChange={(event) => onChange?.({ text: event.target.value, state: [1] })}
    />
  ),
}));
vi.mock('./ui/Workspace', () => ({
  Icon: () => null,
  WorkspaceShell: ({
    children,
    onNavigate,
    onOpen,
  }: {
    children: React.ReactNode;
    onNavigate(v: string): void;
    onOpen(id: string): void;
  }) => (
    <>
      <button onClick={() => onNavigate('projects')}>项目入口</button>
      <button onClick={() => onNavigate('tasks')}>全局入口</button>
      <button onClick={() => onNavigate('settings')}>设置入口</button>
      <button onClick={() => onOpen('B')}>全局B</button>
      {children}
    </>
  ),
}));
vi.mock('./ui/TaskInspector', () => ({
  default: ({
    onProjectDirty,
    onPropertiesBlocked,
  }: {
    onProjectDirty(v: boolean): void;
    onPropertiesBlocked(v: boolean): void;
  }) => (
    <>
      <input aria-label="未保存草稿" onChange={() => onProjectDirty(true)} />
      <button onClick={() => onPropertiesBlocked(true)}>未知提交</button>
    </>
  ),
}));
vi.mock('./ui/SettingsView', () => {
  return {
    default: ({ onBack }: { onBack(): void }) => <button onClick={onBack}>关闭设置</button>,
  };
});
vi.mock('./ui/AgentHome', () => ({ default: () => <div>首页</div> }));
vi.mock('./ui/RecordList', () => ({
  initialTaskListState: {},
  default: () => <div>全局任务列表</div>,
}));
vi.mock('./EngineeringApp', () => ({ default: () => null }));
const project: Matter = {
  id: 'P',
  title: '来源项目',
  status: 'active',
  version: 1,
  archived_at: null,
  body_id: 'PB',
  body_revision: 1,
  editor_schema: 1,
  updated_at: '2026-11-07',
  task_count: 1,
};
const task = {
  id: 'A',
  title: '原任务',
  objective: '',
  status: 'todo',
  priority: 0,
  due_date: null,
  version: 1,
  editor_schema: 1,
  updated_at: '2026-11-07',
  matter_id: 'P',
  body_revision: 1,
  document_id: 'D',
  body_id: 'B',
} as Task;
const response = {
  ok: true,
  projects: [project],
  documents: [],
  state: null,
  receipt: null,
  target_id: null,
} as const;
afterEach(cleanup);
it('keeps the same mounted project section on failed task read without an extra project query', async () => {
  let reject!: (error: Error) => void;
  const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> =>
    r.operation === 'list_activity'
      ? { ...response, activity: [], activity_has_more: false }
      : { ...response },
  );
  window.caselite = {
    catalog,
    task: vi.fn(async (r: TaskRequest) =>
      r.operation === 'read'
        ? new Promise((_, no) => {
            reject = no;
          })
        : { ok: true, tasks: [task], state: null },
    ),
  } as unknown as Window['caselite'];
  render(<App />);
  await screen.findByText('首页');
  fireEvent.click(screen.getByText('项目入口'));
  fireEvent.click(await screen.findByRole('button', { name: '来源项目', exact: true }));
  await screen.findByLabelText('编辑项目名称');
  fireEvent.click(screen.getByRole('tab', { name: '任务', exact: true }));
  const editor = screen.getByLabelText('编辑项目名称');
  fireEvent.click(document.querySelector('#project-panel-tasks [data-project-task]')!);
  expect(screen.getByLabelText('编辑项目名称')).toBe(editor);
  expect(document.querySelector('.project-catalog')?.hasAttribute('inert')).toBe(true);
  await act(async () => reject(new Error('任务读取失败')));
  await screen.findByText('任务读取失败');
  expect(screen.getByLabelText('编辑项目名称')).toBe(editor);
  expect(screen.getByRole('tabpanel', { name: '任务', exact: true })).toBeTruthy();
  expect(document.querySelector('.project-catalog')?.hasAttribute('inert')).toBe(false);
  expect(catalog.mock.calls.filter(([r]) => r.operation === 'read_project')).toHaveLength(1);
});

it('keeps all create fields on project rejection and resolves a lost acknowledgement using the same key', async () => {
  type Create = Extract<TaskRequest, { operation: 'create' }>;
  const secondProject = { ...project, id: 'Q', title: '可用替代项目' };
  const catalog = vi.fn(async (request: CatalogRequest): Promise<CatalogResponse> =>
    request.operation === 'list_activity'
      ? { ...response, activity: [], activity_has_more: false }
      : { ...response, projects: [project, secondProject] },
  );
  const creates: Create[] = [];
  const statusKeys: string[] = [];
  let saved: Task | undefined;
  const taskApi = vi.fn(async (request: TaskRequest): Promise<TaskResponse> => {
    if (request.operation === 'create') {
      creates.push(request);
      if (request.matter_id === 'P')
        return { ok: false, code: 'NOT_FOUND', message: '所选项目已归档' };
      saved = { ...task, ...request, id: 'saved-task', matter_id: request.matter_id ?? null };
      return { ok: false, code: 'RESULT_UNKNOWN', message: '合成回执丢失' };
    }
    if (request.operation === 'read' && saved && request.task_id === saved.id)
      return { ok: true, tasks: [saved], state: null, receipt: null, objective_state: [1] };
    if (request.operation === 'status') {
      statusKeys.push(request.idempotency_key);
      if (statusKeys.length <= 2 || !saved)
        return { ok: false, code: 'NOT_FOUND', message: '暂未查到回执' };
      return { ok: true, tasks: [saved], state: null, receipt: request.idempotency_key };
    }
    return { ok: true, tasks: [task], state: null, receipt: null };
  });
  window.caselite = { catalog, task: taskApi } as unknown as Window['caselite'];
  render(<App />);
  fireEvent.click(screen.getByText('项目入口'));
  fireEvent.click(await screen.findByRole('button', { name: '来源项目', exact: true }));
  await screen.findByLabelText('编辑项目名称');
  fireEvent.click(screen.getByRole('tab', { name: '任务', exact: true }));
  const sourcePage = document.querySelector('.project-catalog');
  const newTask = screen.getByRole('button', { name: '新建任务' });
  newTask.focus();
  fireEvent.click(newTask);
  expect(document.querySelector('.project-catalog')).toBe(sourcePage);
  expect(document.activeElement).toBe(
    within(screen.getByRole('dialog', { name: '新建任务' })).getByLabelText('任务名称'),
  );
  fireEvent.click(
    within(screen.getByRole('dialog', { name: '新建任务' })).getByRole('button', {
      name: '取消新建任务',
    }),
  );
  expect(document.querySelector('.project-catalog')).toBe(sourcePage);
  expect(screen.getByRole('tabpanel', { name: '任务', exact: true })).toBeTruthy();
  expect(document.activeElement).toBe(newTask);
  fireEvent.click(screen.getByRole('button', { name: '新建任务' }));
  await screen.findByRole('option', { name: '可用替代项目' });
  const values = {
    任务名称: '保留的合成标题',
    任务内容: '保留的说明',
    任务状态: 'in_progress',
    任务优先级: '2',
    任务负责人: '',
    截止日期: '2027-01-15',
  };
  const read = (name: string) =>
    within(screen.getByRole('dialog', { name: '新建任务' })).getByLabelText(
      name,
    ) as HTMLInputElement;
  for (const [name, value] of Object.entries(values).filter(([name]) => name !== '截止日期'))
    fireEvent.change(read(name), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '设置任务日期' }));
  fireEvent.change(read('截止日期'), { target: { value: values.截止日期 } });
  fireEvent.click(screen.getByRole('button', { name: '确定日期' }));
  const assertDraft = (projectId: string) => {
    for (const [name, value] of Object.entries(values)) expect(read(name).value).toBe(value);
    expect(read('所属项目').value).toBe(projectId);
  };
  assertDraft('P');
  fireEvent.change(read('任务名称'), { target: { value: '   ' } });
  fireEvent.keyDown(read('任务名称'), { key: 'Enter', metaKey: true });
  expect(creates).toHaveLength(0);
  fireEvent.change(read('任务名称'), { target: { value: values.任务名称 } });
  fireEvent.change(read('任务内容'), { target: { value: 'x'.repeat(4001) } });
  fireEvent.keyDown(read('任务内容'), { key: 'Enter', ctrlKey: true });
  expect(creates).toHaveLength(0);
  fireEvent.change(read('任务内容'), { target: { value: values.任务内容 } });
  fireEvent.compositionStart(read('任务名称'));
  fireEvent.keyDown(read('任务名称'), { key: 'Enter', metaKey: true, isComposing: true });
  expect(creates).toHaveLength(0);
  fireEvent.compositionEnd(read('任务名称'));
  fireEvent.keyDown(read('任务名称'), { key: 'Enter', metaKey: true });
  await screen.findByText('所选项目已归档');
  expect(
    within(screen.getByRole('dialog', { name: '新建任务' })).getByRole('alert').textContent,
  ).toContain('所选项目已归档');
  assertDraft('P');
  expect(creates).toHaveLength(1);

  fireEvent.change(read('所属项目'), { target: { value: 'Q' } });
  fireEvent.click(screen.getByTestId('create-task'));
  await screen.findByText('创建结果尚未确认，请核对或重试原提交。');
  assertDraft('Q');
  expect(read('任务名称').disabled).toBe(true);
  expect(read('所属项目').matches(':disabled')).toBe(true);
  expect(creates[1]).toMatchObject({
    matter_id: 'Q',
    title: values.任务名称,
    objective: values.任务内容,
    objective_state: [1],
    status: values.任务状态,
    priority: 2,
    assignee: null,
    due_date: values.截止日期,
  });
  expect(creates[0].idempotency_key).not.toBe(creates[1].idempotency_key);
  fireEvent.click(screen.getByRole('button', { name: '核对创建结果' }));
  await within(screen.getByRole('dialog', { name: '新建任务' })).findByText('暂未查到回执');
  expect(creates).toHaveLength(2);
  assertDraft('Q');
  expect(read('任务名称').disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '核对创建结果' }));
  await screen.findByRole('heading', { name: values.任务名称 });
  expect(document.querySelector('.task-detail')?.getAttribute('data-active-task')).toBe(
    'saved-task',
  );
  expect(creates).toHaveLength(2);
  expect(statusKeys).toEqual([
    creates[1].idempotency_key,
    creates[1].idempotency_key,
    creates[1].idempotency_key,
  ]);
});
