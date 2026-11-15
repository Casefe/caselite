// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  CatalogDocument,
  CatalogRequest,
  CatalogResponse,
  Matter,
  Task,
  TaskRequest,
} from '../preload/caselite-api';
import App from './App';
import { initialLocalPreferences, LocalPreferencesProvider } from './shared/data/LocalPreferences';

// 保留 App、项目栏目、页签、导航桥和文档工作区；仅替换正文/AI等昂贵叶子。
vi.mock('./ui/Appearance', () => ({
  AppearanceProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./ui/AgentHome', () => ({ default: () => <p>合成首页</p> }));
vi.mock('./EngineeringApp', () => ({ default: () => null }));
vi.mock('./editors/RichEditor', () => ({
  emptyDraft: () => ({ text: '', state: null }),
  localExtensions: () => [],
  useLocalDoc: () => null,
  EditorSurface: () => null,
  DraftEditor: ({
    value,
    onChange,
    label,
    disabled,
  }: {
    value: { text: string };
    onChange?(value: { text: string; state: number[] }): void;
    label: string;
    disabled?: boolean;
  }) => (
    <textarea
      aria-label={label}
      value={value.text}
      disabled={disabled}
      onChange={(event) => onChange?.({ text: event.target.value, state: [1] })}
    />
  ),
}));
vi.mock('./features/documents/BodyEditor', () => ({
  default: function SyntheticBody({
    task,
    disabled,
    onDirty,
  }: {
    task: Task;
    disabled: boolean;
    onDirty(value: boolean): void;
  }) {
    const [draft, setDraft] = useState('');
    return (
      <textarea
        aria-label={`合成正文 ${task.document_id}`}
        value={draft}
        disabled={disabled}
        onChange={(event) => {
          setDraft(event.target.value);
          onDirty(Boolean(event.target.value));
        }}
      />
    );
  },
}));
vi.mock('./ui/SidebarAgent', () => ({
  default: function SyntheticConversation({
    document,
    project,
  }: {
    document?: { id: string };
    project?: { id: string };
  }) {
    const [draft, setDraft] = useState('');
    return (
      <textarea
        aria-label={`合成 AI 草稿 ${document?.id ?? project?.id ?? 'empty'}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  },
}));

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const button = (name: string) =>
  screen.getByRole<HTMLButtonElement>('button', { name, exact: true });
const topbar = () => within(screen.getByLabelText('工作台顶部栏'));
const projectTabs = () => within(screen.getByRole('tablist', { name: '项目栏目' }));
const pageTabs = () => within(screen.getByRole('tablist', { name: '打开的页面' }));
const workbench = () => document.querySelector('.workbench')!;
async function inspector(open: boolean) {
  await waitFor(() => expect(workbench().getAttribute('data-inspector-open')).toBe(String(open)));
  expect(
    topbar()
      .getByRole('button', { name: open ? '收起右侧属性栏' : '展开右侧属性栏' })
      .getAttribute('aria-expanded'),
  ).toBe(String(open));
}
function toggleInspector() {
  fireEvent.click(topbar().getByRole('button', { name: /右侧属性栏$/ }));
}
function navigate(name: '项目' | '首页' | '收藏') {
  fireEvent.click(
    within(screen.getByRole('complementary', { name: '一级导航' })).getByRole('button', {
      name,
      exact: true,
    }),
  );
}
async function section(name: '概述' | '文档') {
  const tab = projectTabs().getByRole<HTMLButtonElement>('tab', { name, exact: true });
  await waitFor(() => expect(tab.disabled).toBe(false));
  fireEvent.click(tab);
  await waitFor(() => expect(tab.getAttribute('aria-selected')).toBe('true'));
}
async function openProject(title: string) {
  fireEvent.click(
    await within(
      document.querySelector<HTMLElement>('.project-catalog > .collection-main')!,
    ).findByRole('button', { name: title, exact: true }),
  );
  await screen.findByRole('tablist', { name: '项目栏目' });
  await waitFor(() => expect(button('返回项目列表').disabled).toBe(false));
  expect(button('返回项目列表').closest('.project-catalog-heading')).not.toBeNull();
  expect(screen.getByLabelText('一级导航').contains(button('返回项目列表'))).toBe(false);
  await waitFor(() =>
    expect(pageTabs().getByRole('tab', { name: title }).getAttribute('aria-selected')).toBe('true'),
  );
}
async function projectList() {
  const back = button('返回项目列表');
  await waitFor(() => expect(back.disabled).toBe(false));
  fireEvent.click(back);
  await screen.findByRole('table', { name: '项目列表' });
}
async function readDocument(doc: CatalogDocument) {
  await waitFor(() =>
    expect(document.querySelector('.project-document-panel .document-workspace')).not.toBeNull(),
  );
  const directories = document.querySelectorAll<HTMLElement>('.workspace-page-directory');
  expect(directories).toHaveLength(1);
  const directory = document.querySelector<HTMLElement>('.workspace-page-directory')!;
  if (directory.closest('[hidden], [inert]')) fireEvent.click(button('展开目录栏'));
  expect(directory.closest('[hidden], [inert]')).toBeNull();
  const row = () => directory.querySelector<HTMLButtonElement>(`[data-document-id="${doc.id}"]`);
  if (!row()) {
    const summary = directory.querySelector<HTMLElement>(
      `[data-folder-id="project:${doc.matter_id}"] > summary`,
    )!;
    await waitFor(() => expect(summary.getAttribute('aria-disabled')).toBe('false'));
    fireEvent.click(summary);
  }
  await waitFor(() => expect(row()?.disabled).toBe(false));
  fireEvent.click(row()!);
  return await screen.findByLabelText<HTMLTextAreaElement>(`合成正文 ${doc.id}`);
}
function fixture(
  favoriteDocument = false,
  options: { knowledge?: boolean; finance?: boolean } = {},
) {
  // 每次使用新项目身份，避免模块内合法的窗口级阅读缓存串到另一条测试。
  const projects: Matter[] = ['合成项目P', '合成项目Q'].map((title) => ({
    id: crypto.randomUUID(),
    title,
    status: 'planned',
    version: 1,
    archived_at: null,
    body_id: crypto.randomUUID(),
    body_revision: 0,
    editor_schema: 1,
    updated_at: '2026-11-14',
    task_count: 1,
  }));
  const documents: CatalogDocument[] = projects.map((project, index) => ({
    id: crypto.randomUUID(),
    body_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    matter_id: project.id,
    title: `合成文档${index ? 'Q' : 'P'}`,
    body_revision: 1,
    version: 1,
    archived_at: null,
    collection: '',
    tags: [],
    favorite: false,
    in_library: false,
    updated_at: '2026-11-14',
  }));
  const tasks = documents.map((doc) => ({
    id: doc.task_id,
    title: doc.title,
    objective: '',
    document_id: doc.id,
    body_id: doc.body_id,
    body_revision: doc.body_revision,
    matter_id: doc.matter_id,
    document_metadata_version: doc.version,
    document_archived_at: null,
    status: 'todo',
    priority: 0,
    assignee: '本人',
    tags: [],
    version: 1,
    due_date: null,
    start_date: null,
    updated_at: doc.updated_at,
  })) as Task[];
  if (favoriteDocument) documents[0].favorite = true;
  if (options.knowledge) documents[0].in_library = true;
  let unknown = false;
  const response = (target: string | null = null): Extract<CatalogResponse, { ok: true }> => ({
    ok: true,
    projects,
    documents,
    state: null,
    receipt: null,
    target_id: target,
  });
  const catalog = vi.fn(async (request: CatalogRequest): Promise<CatalogResponse> => {
    if (request.operation === 'organize_document') {
      if (unknown) return { ok: false, code: 'RESULT_UNKNOWN', message: '合成未知回执' };
      throw Error('未授权的合成写请求');
    }
    if (request.operation === 'list_activity')
      return { ...response(), activity: [], activity_has_more: false };
    if (request.operation === 'read_project_plan')
      return { ...response(), project_plan: { milestones: [], assignments: [] } };
    if (request.operation === 'list_discussion')
      return { ...response(), discussion: { entries: [], next: null } };
    if (request.operation === 'read_project') return response(request.id);
    if (request.operation === 'list') return response();
    throw Error(`未覆盖的合成目录请求 ${request.operation}`);
  });
  const task = vi.fn(async (request: TaskRequest) => {
    if (request.operation === 'read')
      return { ok: true, tasks: tasks.filter((item) => item.id === request.task_id), state: null };
    if (request.operation === 'list') return { ok: true, tasks, state: null };
    if (request.operation === 'calendar_query')
      return {
        ok: true,
        tasks: [],
        calendar_types: [],
        page: { total: 0, has_more: false },
        state: null,
      };
    if (request.operation === 'list_snapshots')
      return {
        ok: true,
        tasks: [],
        snapshots: [],
        page: { offset: 0, has_more: false },
        state: null,
      };
    throw Error(`未覆盖的合成任务请求 ${request.operation}`);
  });
  const preferences = vi.fn(async () => ({
    ok: true,
    preferences: options.finance
      ? {
          ...initialLocalPreferences,
          favorite_navigation: {
            folders: [],
            references: projects.map((p) => ({ kind: 'finance', id: p.id, folder_id: null })),
            document_folders: [],
          },
        }
      : initialLocalPreferences,
    receipt: null,
  }));
  const material = vi.fn(async () => ({ ok: true, materials: [] }));
  const folder = vi.fn(async () => ({ ok: true, state: 'not_configured', pending: [], saved: [] }));
  const finance = vi.fn(async (request: { operation: string; project_id?: string }) =>
    request.operation === 'm_read'
      ? {
          ok: true,
          kind: 'management',
          receipt: null,
          evidence: null,
          effect: null,
          preview: null,
          preview_digest: null,
          state: {
            version: 0,
            default_rule_id: null,
            projects: [],
            rules: [],
            bindings: [],
            allocations: [],
            candidates: [],
            sources: [],
            invoices: [],
            expenses: [],
            reimbursements: [],
            payouts: [],
          },
        }
      : {
          ok: true,
          kind: 'ledger',
          project_id: request.project_id,
          today: '2026-11-15',
          time_zone: 'Asia/Shanghai',
          receipt: null,
          evidence: null,
          ledger: null,
        },
  );
  vi.stubGlobal('caselite', { catalog, task, preferences, material, folder, finance });
  render(
    <LocalPreferencesProvider>
      <App />
    </LocalPreferencesProvider>,
  );
  return {
    projects,
    documents,
    finance,
    catalog,
    task,
    preferences,
    material,
    folder,
    makeUnknown: () => {
      unknown = true;
    },
    requests: () => ({
      catalog: catalog.mock.calls.map(([request]) => request),
      task: task.mock.calls.map(([request]) => request),
      preferences: preferences.mock.calls.length,
      material: material.mock.calls.length,
      folder: folder.mock.calls.length,
    }),
  };
}

it('真实项目概述默认展开，文档首次收起，显式开关按项目及栏目保留', async () => {
  const f = fixture();
  await screen.findByText('合成首页');
  navigate('项目');
  await openProject(f.projects[0].title);
  await inspector(true);
  toggleInspector();
  await inspector(false);
  await section('文档');
  await inspector(false);
  await readDocument(f.documents[0]);
  toggleInspector();
  await inspector(true);
  await section('概述');
  await inspector(false);
  await section('文档');
  await inspector(true);
  await projectList();
  await openProject(f.projects[1].title);
  await inspector(true);
  await section('文档');
  await inspector(false);
  await readDocument(f.documents[1]);
  await projectList();
  await openProject(f.projects[0].title);
  await inspector(false);
  await section('文档');
  await inspector(true);
  await projectList();
  await openProject(f.projects[1].title);
  await inspector(true);
  await section('文档');
  await inspector(false);
});

it('收藏文档返回已访问页面时恢复原文档显示宽度', async () => {
  const f = fixture(true);
  await screen.findByText('合成首页');
  navigate('收藏');
  const directory = within(screen.getByRole('complementary', { name: '收藏目录' }));
  fireEvent.click(await directory.findByRole('button', { name: f.documents[0].title }));
  await screen.findByLabelText(`合成正文 ${f.documents[0].id}`);
  fireEvent.click(screen.getByLabelText('文档显示设置'));
  fireEvent.click(button('宽屏显示'));
  await waitFor(() =>
    expect(document.querySelector('.document-workspace')?.getAttribute('data-reading-width')).toBe(
      'full',
    ),
  );
  navigate('首页');
  await screen.findByText('合成首页');
  fireEvent.click(topbar().getByRole('button', { name: '后退', exact: true }));
  await screen.findByLabelText(`合成正文 ${f.documents[0].id}`);
  expect(document.querySelector('.document-workspace')?.getAttribute('data-reading-width')).toBe(
    'full',
  );
});

it('离开收藏再返回时保留未提交文件夹名称与搜索', async () => {
  fixture(true);
  await screen.findByText('合成首页');
  navigate('收藏');
  const directory = within(screen.getByRole('complementary', { name: '收藏目录' }));
  const create = await directory.findByRole<HTMLButtonElement>('button', {
    name: '新建收藏文件夹',
  });
  await waitFor(() => expect(create.disabled).toBe(false));
  fireEvent.click(create);
  fireEvent.change(directory.getByLabelText('收藏文件夹名称'), { target: { value: '待整理资料' } });
  fireEvent.change(directory.getByLabelText('搜索收藏'), { target: { value: '合成' } });
  navigate('首页');
  await screen.findByText('合成首页');
  navigate('收藏');
  const restored = within(screen.getByRole('complementary', { name: '收藏目录' }));
  expect(restored.getByLabelText<HTMLInputElement>('收藏文件夹名称').value).toBe('待整理资料');
  expect(restored.getByLabelText<HTMLInputElement>('搜索收藏').value).toBe('合成');
});

it.each([false, true])(
  '真实顶部历史和页签恢复文档右栏 %s，优先于项目的初始化默认值',
  async (open) => {
    const f = fixture();
    await screen.findByText('合成首页');
    navigate('项目');
    await openProject(f.projects[0].title);
    await section('文档');
    await readDocument(f.documents[0]);
    await inspector(false);
    if (open) toggleInspector();
    await inspector(open);
    await section('概述');
    await inspector(true);
    fireEvent.click(topbar().getByRole('button', { name: '后退', exact: true }));
    await waitFor(() =>
      expect(
        projectTabs().getByRole('tab', { name: '文档', exact: true }).getAttribute('aria-selected'),
      ).toBe('true'),
    );
    await screen.findByLabelText(`合成正文 ${f.documents[0].id}`);
    await inspector(open);
    await waitFor(() => expect(button('返回项目列表').disabled).toBe(false));
    fireEvent.click(topbar().getByRole('button', { name: '增加页面' }));
    await screen.findByRole('heading', { name: '打开一个页面' });
    navigate('首页');
    await screen.findByText('合成首页');
    fireEvent.click(pageTabs().getByRole('tab', { name: f.projects[0].title, exact: true }));
    await screen.findByLabelText(`合成正文 ${f.documents[0].id}`);
    await inspector(open);
    expect(
      projectTabs().getByRole('tab', { name: '文档', exact: true }).getAttribute('aria-selected'),
    ).toBe('true');
  },
);

it('真实右栏开合保留同一正文和AI草稿、不新增IPC；正文dirty由原canLeave阻止离开', async () => {
  const f = fixture();
  await screen.findByText('合成首页');
  navigate('项目');
  await openProject(f.projects[0].title);
  await section('文档');
  const body = await readDocument(f.documents[0]);
  const ai = screen.getByLabelText<HTMLTextAreaElement>(`合成 AI 草稿 ${f.documents[0].id}`);
  fireEvent.change(ai, { target: { value: '保留AI追问' } });
  fireEvent.change(body, { target: { value: '保留未保存正文' } });
  await waitFor(() => expect(button('返回项目列表').disabled).toBe(true));
  const requests = f.requests();
  toggleInspector();
  await inspector(true);
  toggleInspector();
  await inspector(false);
  expect(screen.getByLabelText(`合成正文 ${f.documents[0].id}`)).toBe(body);
  expect(screen.getByLabelText(`合成 AI 草稿 ${f.documents[0].id}`)).toBe(ai);
  expect(body.value).toBe('保留未保存正文');
  expect(ai.value).toBe('保留AI追问');
  expect(f.requests()).toEqual(requests);
  navigate('首页');
  expect(screen.queryByText('合成首页')).toBeNull();
  expect(screen.getByText('请先保存当前内容或核对提交结果，再离开当前页面。')).toBeTruthy();
  fireEvent.click(topbar().getByRole('button', { name: '增加页面' }));
  expect(screen.queryByRole('heading', { name: '打开一个页面' })).toBeNull();
  expect(screen.getByLabelText(`合成正文 ${f.documents[0].id}`)).toBe(body);
  expect(f.requests()).toEqual(requests);
});

it('真实文档未知回执沿原canLeave锁导航，侧栏切换不重提写入且原键核对入口保留', async () => {
  const f = fixture();
  await screen.findByText('合成首页');
  navigate('项目');
  await openProject(f.projects[0].title);
  await section('文档');
  const body = await readDocument(f.documents[0]);
  toggleInspector();
  await inspector(true);
  f.makeUnknown();
  fireEvent.click(button('添加标签'));
  const input = screen.getByLabelText<HTMLInputElement>('新标签');
  fireEvent.change(input, { target: { value: '合成未知标签' } });
  fireEvent.click(button('添加'));
  const retry = await screen.findByRole('button', { name: '核对原提交', exact: true });
  const workspace = body.closest('.document-workspace')!;
  expect(workspace.getAttribute('data-directory-view')).toBe('list');
  const requests = f.requests();
  toggleInspector();
  await inspector(false);
  toggleInspector();
  await inspector(true);
  navigate('首页');
  expect(screen.queryByText('合成首页')).toBeNull();
  expect(screen.getByText('请先保存当前内容或核对提交结果，再离开当前页面。')).toBeTruthy();
  fireEvent.click(topbar().getByRole('button', { name: '后退', exact: true }));
  expect(
    projectTabs().getByRole('tab', { name: '文档', exact: true }).getAttribute('aria-selected'),
  ).toBe('true');
  expect(screen.getByLabelText(`合成正文 ${f.documents[0].id}`)).toBe(body);
  expect(screen.getByLabelText('新标签')).toBe(input);
  expect(input.value).toBe('合成未知标签');
  expect(screen.getByRole('button', { name: '核对原提交', exact: true })).toBe(retry);
  expect(f.requests()).toEqual(requests);
  const writes = f.catalog.mock.calls
    .map(([request]) => request)
    .filter((request) => request.operation === 'organize_document');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ id: f.documents[0].id, tags: ['合成未知标签'] });
  expect(writes[0] && 'idempotency_key' in writes[0]).toBe(true);
});

it('收藏知识文档打开原知识视图并由页签恢复同一 Document 身份', async () => {
  const f = fixture(true, { knowledge: true });
  await screen.findByText('合成首页');
  navigate('收藏');
  fireEvent.click(
    await within(screen.getByRole('complementary', { name: '收藏目录' })).findByRole('button', {
      name: f.documents[0].title,
    }),
  );
  const body = await screen.findByLabelText(`合成正文 ${f.documents[0].id}`);
  expect(body.closest('.document-workspace')?.getAttribute('data-collection')).toBe('knowledge');
  navigate('首页');
  await screen.findByText('合成首页');
  fireEvent.click(topbar().getByRole('button', { name: '后退', exact: true }));
  expect(
    (await screen.findByLabelText(`合成正文 ${f.documents[0].id}`))
      .closest('.document-workspace')
      ?.getAttribute('data-collection'),
  ).toBe('knowledge');
  expect(f.catalog.mock.calls.some(([r]) => r.operation === 'organize_document')).toBe(false);
});

it('连续点击财务项目收藏打开原账本，未保存输入沿原守卫阻止切换', async () => {
  const f = fixture(false, { finance: true });
  await screen.findByText('合成首页');
  navigate('收藏');
  const directory = within(screen.getByRole('complementary', { name: '收藏目录' }));
  fireEvent.click(await directory.findByRole('button', { name: f.projects[0].title }));
  await screen.findByRole('heading', { name: f.projects[0].title, level: 1 });
  await screen.findByRole('group', { name: '登记有效收费合同' });
  expect(screen.getByRole('button', { name: '取消收藏财务项目' })).toBeTruthy();
  fireEvent.click(directory.getByRole('button', { name: f.projects[1].title }));
  await screen.findByRole('heading', { name: f.projects[1].title, level: 1 });
  const number = await screen.findByLabelText('合同编号');
  fireEvent.change(number, { target: { value: '保留财务输入' } });
  await screen.findByText('有未提交的财务输入。保存或放弃输入后可以切换项目。');
  fireEvent.click(directory.getByRole('button', { name: f.projects[0].title }));
  expect(screen.getByRole('heading', { name: f.projects[1].title, level: 1 })).toBeTruthy();
  expect((number as HTMLInputElement).value).toBe('保留财务输入');
  expect(
    f.finance.mock.calls.filter(([r]) => !['read', 'm_read'].includes(r.operation)),
  ).toHaveLength(0);
});

it('知识库真实入口打开 Skills 预览，取消不写现有文档或任务', async () => {
  const f = fixture(false, { knowledge: true });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  await screen.findByText('合成首页');
  expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull();
  fireEvent.click(
    within(screen.getByRole('complementary', { name: '一级导航' })).getByRole('button', {
      name: '知识库',
    }),
  );
  await within(document.querySelector<HTMLElement>('.workspace-directory-heading')!).findByRole(
    'heading',
    { name: '知识库' },
  );
  const entry = screen.getByText('Skills', { selector: 'button' });
  fireEvent.click(entry.closest('details')!.querySelector('summary')!);
  fireEvent.click(entry);
  await screen.findByRole('dialog', { name: 'Skills 导入预览' });
  expect(screen.getByText(/文件夹和 ZIP 尚未支持/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消并关闭' }));
  expect(screen.queryByRole('dialog', { name: 'Skills 导入预览' })).toBeNull();
  expect(
    f.catalog.mock.calls.filter(([request]) => request.operation === 'organize_document'),
  ).toHaveLength(0);
  expect(
    f.task.mock.calls.every(([request]) =>
      ['read', 'list', 'calendar_query', 'list_snapshots'].includes(request.operation),
    ),
  ).toBe(true);
});
