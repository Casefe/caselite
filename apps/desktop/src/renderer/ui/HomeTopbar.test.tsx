// @vitest-environment jsdom
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import WorkspaceTopbar from './WorkspaceTopbar';
import { useWorkspaceTabs } from '../shared/navigation/useWorkspaceTabs';

afterEach(cleanup);

it('replaces only home navigation and inspector controls with slots while keeping tab protections', async () => {
  const canLeave = vi.fn(() => false),
    restore = vi.fn(async () => true);
  const collapse = vi.fn(),
    inspector = vi.fn();
  function Harness({ home }: { home: boolean }) {
    const [left, setLeft] = useState<HTMLDivElement | null>(null);
    const [right, setRight] = useState<HTMLDivElement | null>(null);
    const page = { key: 'home', title: '首页', icon: 'home', state: null };
    const navigation = useWorkspaceTabs({
      pageKey: page.key,
      title: page.title,
      getPage: () => page,
      newPage: () => ({ ...page, key: 'new-tab', title: '新标签页' }),
      restore,
      canLeave,
      ready: true,
    });
    return (
      <>
        <WorkspaceTopbar
          navigation={navigation}
          home={home}
          homeLeftSlot={setLeft}
          homeRightSlot={setRight}
          collapsed={false}
          onCollapse={collapse}
          inspectorOpen
          inspectorAvailable
          onToggleInspector={inspector}
        />
        {home && left && createPortal(<button>Agent 目录</button>, left)}
        {home && right && createPortal(<button>首页运行控件</button>, right)}
      </>
    );
  }
  const view = render(<Harness home />);
  const directory = await screen.findByRole('button', { name: 'Agent 目录' });
  expect(directory.closest('.workspace-titlebar')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: '首页运行控件' }).closest('.workspace-titlebar'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: /收起导航|展开导航|收起右侧属性栏/ })).toBeNull();
  expect(screen.getByRole('tab', { name: '首页' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '增加页面' }));
  expect(canLeave).toHaveBeenCalledOnce();
  expect(restore).not.toHaveBeenCalled();
  expect(screen.getAllByRole('tab')).toHaveLength(1);
  view.rerender(<Harness home={false} />);
  expect(screen.queryByRole('button', { name: 'Agent 目录' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '收起导航' }));
  fireEvent.click(screen.getByRole('button', { name: '收起右侧属性栏' }));
  expect(collapse).toHaveBeenCalledOnce();
  expect(inspector).toHaveBeenCalledOnce();
});
