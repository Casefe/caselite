// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceShell } from './Workspace';
import { ResponsiveWorkspaceProvider, useResponsiveWorkspace } from './ResponsiveWorkspace';
import ProjectPreview from '../features/projects/ProjectPreview';
afterEach(cleanup);
describe('workspace navigation and clearly bounded project prototype', () => {
  it('routes primary objects and keeps the sidebar collapse accessible', () => {
    const navigate = vi.fn(),
      collapse = vi.fn();
    const { rerender } = render(
      <WorkspaceShell
        view="tasks"
        collapsed={false}
        onCollapse={collapse}
        onNavigate={navigate}
        tasks={[]}
        importantDatesCount={73}
        onOpen={vi.fn()}
      >
        <p>内容区域</p>
      </WorkspaceShell>,
    );
    const checkNavigation = () => {
      const sidebar = within(screen.getByRole('navigation'));
      const labels = (group: string) =>
        within(sidebar.getByRole('group', { name: group }))
          .getAllByRole('button')
          .map((button) => button.getAttribute('aria-label'));
      expect(labels('常用')).toEqual(['首页', '日历', '任务', '项目', '文档']);
      expect(labels('更多')).toEqual(['收件', '财务', '联系人', '知识库', '收藏']);
      for (const name of ['白板', '报告', '工具', '客户'])
        expect(sidebar.queryByRole('button', { name, exact: true })).toBeNull();
    };
    checkNavigation();
    expect(
      screen.getByRole('button', { name: '任务', exact: true }).querySelector('small'),
    ).toBeNull();
    expect(
      within(screen.getByRole('button', { name: '日历', exact: true })).getByLabelText(
        '重要日期 73 项',
      ).textContent,
    ).toBe('73');
    expect(screen.queryByRole('region', { name: '收藏' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '项目', exact: true }));
    expect(navigate).toHaveBeenCalledWith('projects');
    fireEvent.click(screen.getByRole('button', { name: '收起目录栏' }));
    expect(collapse).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '谭律师 · 设置' })).toBeTruthy();
    expect(screen.queryByText('Pro')).toBeNull();
    expect(document.querySelector('img.profile-avatar')?.getAttribute('src')).toMatch(
      /^data:image\/svg\+xml,/,
    );
    expect(
      screen
        .getByRole('banner', { name: '工作台顶部栏' })
        .contains(screen.getByRole('button', { name: '展开目录栏' })),
    ).toBe(true);
    rerender(
      <WorkspaceShell
        view="tasks"
        collapsed
        onCollapse={collapse}
        onNavigate={navigate}
        tasks={[]}
        importantDatesCount={73}
        onOpen={vi.fn()}
      >
        <p>内容区域</p>
      </WorkspaceShell>,
    );
    expect(screen.getByRole('button', { name: '展开目录栏' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    checkNavigation();
    expect(screen.getByRole('button', { name: '日历', exact: true }).title).toBe(
      '日历 · 73 个重要日期',
    );
    fireEvent.click(screen.getByRole('button', { name: '联系人', exact: true }));
    expect(navigate).toHaveBeenCalledWith('contacts');
    fireEvent.click(screen.getByRole('button', { name: '展开目录栏' }));
    expect(collapse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '谭律师 · 设置', exact: true }));
    expect(navigate).toHaveBeenCalledWith('settings');
    expect(document.querySelector('.global-bar')).toBeNull();
    expect(screen.queryByText('个人法律工作台')).toBeNull();
    expect(screen.getByText('内容区域')).toBeTruthy();
  });
  it('filters and drills into sample project tabs without a storage API', () => {
    render(<ProjectPreview onAgent={vi.fn()} />);
    expect(screen.getByText('示例项目 · 不保存')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '筛选示例项目状态' }), {
      target: { value: '待开始' },
    });
    expect(screen.queryByText('海川服务合同争议')).toBeNull();
    expect(screen.getAllByText('明远劳动争议')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '项目看板视图' }));
    fireEvent.click(screen.getByRole('button', { name: /明远劳动争议/ }));
    fireEvent.click(screen.getByRole('tab', { name: /任务/ }));
    fireEvent.click(screen.getByText('整理已收到的材料'));
    expect(screen.getByText(/不会创建或修改你的本地任务/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭示例任务详情' }));
    fireEvent.click(screen.getByRole('button', { name: '返回项目列表' }));
    expect(screen.getByRole('button', { name: '项目列表视图' })).toBeTruthy();
  });
});

it('keeps the home rail labeled and interactive when responsive navigation is normally hidden', () => {
  vi.stubGlobal('innerWidth', 400);
  const screenWidth = Object.getOwnPropertyDescriptor(window.screen, 'width');
  Object.defineProperty(window.screen, 'width', { configurable: true, value: 1920 });
  try {
    const navigate = vi.fn();
    function NarrowHome() {
      const responsive = useResponsiveWorkspace();
      return (
        <WorkspaceShell
          view="home"
          collapsed={!responsive.drawerOpen}
          onCollapse={responsive.toggleDrawer}
          onNavigate={navigate}
          tasks={[]}
          onOpen={vi.fn()}
        >
          <p>首页内容</p>
        </WorkspaceShell>
      );
    }
    render(
      <ResponsiveWorkspaceProvider>
        <NarrowHome />
      </ResponsiveWorkspaceProvider>,
    );
    const rail = screen.getByLabelText('一级导航');
    expect(rail.hasAttribute('inert')).toBe(false);
    const directory = document.querySelector<HTMLElement>('.workspace-directory')!;
    expect(directory.hidden).toBe(true);
    expect(directory.hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '展开目录栏' }));
    expect(directory.hidden).toBe(false);
    expect(directory.hasAttribute('inert')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '收起目录栏' }));
    expect(directory.hidden).toBe(true);
    expect(directory.hasAttribute('inert')).toBe(true);
    expect(rail.hasAttribute('inert')).toBe(false);
    expect(rail.closest('main')?.dataset.navigationOverlay).toBe('false');
    for (const label of ['首页', '项目', '财务']) {
      fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    }
    expect(navigate.mock.calls.map(([view]) => view)).toEqual(['home', 'projects', 'finance']);
  } finally {
    cleanup();
    if (screenWidth) Object.defineProperty(window.screen, 'width', screenWidth);
    else Reflect.deleteProperty(window.screen, 'width');
    vi.unstubAllGlobals();
  }
});

it('uses the same collapsed navigation for every primary page, including narrow windows', () => {
  vi.stubGlobal('innerWidth', 400);
  const screenWidth = Object.getOwnPropertyDescriptor(window.screen, 'width');
  Object.defineProperty(window.screen, 'width', { configurable: true, value: 1920 });
  try {
    const navigate = vi.fn(),
      collapse = vi.fn();
    const { rerender } = render(
      <ResponsiveWorkspaceProvider>
        <WorkspaceShell
          view="home"
          collapsed
          onCollapse={collapse}
          onNavigate={navigate}
          tasks={[]}
          onOpen={vi.fn()}
        >
          <p>首页内容</p>
        </WorkspaceShell>
      </ResponsiveWorkspaceProvider>,
    );
    const rail = screen.getByLabelText('一级导航');
    expect(rail.hasAttribute('inert')).toBe(false);
    expect(rail.closest('main')?.dataset.navigationHidden).toBe('false');
    expect(rail.closest('main')?.hasAttribute('data-home-rail')).toBe(false);
    const navLabels = Array.from(rail.querySelectorAll('.primary-navigation button')).map((item) =>
      item.getAttribute('aria-label'),
    );
    for (const view of ['calendar', 'tasks', 'projects', 'finance', 'contacts'] as const) {
      rerender(
        <ResponsiveWorkspaceProvider>
          <WorkspaceShell
            view={view}
            collapsed
            onCollapse={collapse}
            onNavigate={navigate}
            tasks={[]}
            onOpen={vi.fn()}
          >
            <p>内容区域</p>
          </WorkspaceShell>
        </ResponsiveWorkspaceProvider>,
      );
      expect(rail.hasAttribute('inert')).toBe(false);
      expect(rail.closest('main')?.dataset.navigationHidden).toBe('false');
      expect(
        Array.from(rail.querySelectorAll('.primary-navigation button')).map((item) =>
          item.getAttribute('aria-label'),
        ),
      ).toEqual(navLabels);
    }
    const directory = document.querySelector<HTMLElement>('.workspace-directory')!;
    expect(directory.hidden).toBe(true);
    expect(directory.hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '展开目录栏' }));
    expect(directory.hidden).toBe(false);
    expect(directory.hasAttribute('inert')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '收起目录栏' }));
    expect(directory.hidden).toBe(true);
    expect(directory.hasAttribute('inert')).toBe(true);
    expect(screen.queryByRole('region', { name: '收藏' })).toBeNull();
    expect(collapse).not.toHaveBeenCalled();
  } finally {
    cleanup();
    if (screenWidth) Object.defineProperty(window.screen, 'width', screenWidth);
    else Reflect.deleteProperty(window.screen, 'width');
    vi.unstubAllGlobals();
  }
});

it('keeps the home collapsed rail dedicated to preview and other pages dedicated to properties and AI', () => {
  const toggle = vi.fn();
  const props = {
    collapsed: false,
    onCollapse: vi.fn(),
    onNavigate: vi.fn(),
    tasks: [],
    onOpen: vi.fn(),
    inspectorOpen: false,
    onToggleInspector: toggle,
  };
  const view = render(
    <WorkspaceShell {...props} view="home">
      <p>首页内容</p>
    </WorkspaceShell>,
  );
  const rail = within(screen.getByLabelText('辅助列'));
  const preview = rail.getByRole('button', { name: '展开预览' });
  expect(preview.title).toBe('从对话中打开附件或回答以预览');
  expect(rail.queryByRole('button', { name: '展开属性与 AI 对话' })).toBeNull();
  fireEvent.click(preview);
  expect(toggle).toHaveBeenCalledOnce();
  view.rerender(
    <WorkspaceShell {...props} view="tasks">
      <p>任务内容</p>
    </WorkspaceShell>,
  );
  expect(rail.getByRole('button', { name: '展开属性与 AI 对话' })).toBeTruthy();
});
