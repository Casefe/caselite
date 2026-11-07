// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceShell } from './Workspace';
import ProjectPreview from '../projects/ProjectPreview';
afterEach(cleanup);
describe('workspace navigation and clearly bounded project prototype', () => {
  it('routes primary objects and keeps the sidebar collapse accessible', () => {
    const navigate = vi.fn(),
      collapse = vi.fn();
    const { rerender } = render(
      <WorkspaceShell
        view="home"
        collapsed={false}
        onCollapse={collapse}
        onNavigate={navigate}
        tasks={[]}
        onOpen={vi.fn()}
      >
        <p>内容区域</p>
      </WorkspaceShell>,
    );
    expect(
      Array.from(screen.getByRole('navigation').querySelectorAll('button'), (b) => b.ariaLabel),
    ).toEqual(['首页', '提醒', '任务', '知识库', '项目', '财务', '工具', '白板', '文档']);
    expect(screen.getByRole('group', { name: '工作区' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '收藏' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '项目', exact: true }));
    expect(navigate).toHaveBeenCalledWith('projects');
    fireEvent.click(screen.getByRole('button', { name: '收起导航' }));
    expect(collapse).toHaveBeenCalledOnce();
    expect(screen.getByText('谭律师')).toBeTruthy();
    expect(
      screen
        .getByRole('banner', { name: '工作台顶部栏' })
        .contains(screen.getByRole('button', { name: '收起导航' })),
    ).toBe(true);
    rerender(
      <WorkspaceShell
        view="home"
        collapsed
        onCollapse={collapse}
        onNavigate={navigate}
        tasks={[]}
        onOpen={vi.fn()}
      >
        <p>内容区域</p>
      </WorkspaceShell>,
    );
    expect(screen.getByRole('button', { name: '展开导航' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: '展开导航' }));
    expect(collapse).toHaveBeenCalledTimes(2);
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
