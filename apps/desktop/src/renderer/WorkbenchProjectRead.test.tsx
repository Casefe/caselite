// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  CatalogRequest,
  CatalogResponse,
  Matter,
  Task,
  TaskRequest,
} from '../preload/caselite-api';
import App from './App';
vi.mock('@tiptap/react', () => ({ useEditor: () => null }));
vi.mock('./ui/Appearance', () => ({
  AppearanceProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./editors/RichEditor', () => ({
  emptyDraft: () => ({ text: '', state: null }),
  localExtensions: () => [],
  EditorSurface: () => <div />,
  DraftEditor: () => <div />,
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
vi.mock('./ui/SettingsView', async () => {
  const React = await import('react');
  return {
    ModelSettingsNavigation: React.createContext(() => {}),
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
