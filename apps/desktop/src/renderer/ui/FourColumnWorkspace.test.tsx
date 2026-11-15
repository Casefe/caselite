// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceShell } from './Workspace';
import {
  FourColumnWorkspace,
  WorkspaceDirectory,
  useWorkspacePageActions,
  useFourColumnWorkspace,
} from './FourColumnWorkspace';
import WorkspaceTopbar from './WorkspaceTopbar';
import { useWorkspaceTabs } from '../shared/navigation/useWorkspaceTabs';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('collapses only the directory, preserves its draft and clamps resize to one third of the live viewport', () => {
  vi.stubGlobal('innerWidth', 1200);
  render(
    <WorkspaceShell
      view="tasks"
      collapsed
      onCollapse={vi.fn()}
      onNavigate={vi.fn()}
      tasks={[]}
      onOpen={vi.fn()}
    >
      <WorkspaceDirectory>
        <input aria-label="目录草稿" defaultValue="保留输入" />
      </WorkspaceDirectory>
      <p>工作区正文</p>
    </WorkspaceShell>,
  );
  const input = screen.getByRole('textbox', { name: '目录草稿' });
  fireEvent.change(input, { target: { value: '未提交' } });
  fireEvent.keyDown(screen.getByRole('separator', { name: '调整目录栏宽度' }), { key: 'End' });
  fireEvent.keyUp(screen.getByRole('separator', { name: '调整目录栏宽度' }), { key: 'End' });
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('400');
  fireEvent.click(screen.getByRole('button', { name: '收起目录栏' }));
  expect(input.isConnected).toBe(true);
  expect(screen.getByText('工作区正文')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '展开目录栏' }));
  expect(screen.getByRole('textbox', { name: '目录草稿' })).toBe(input);
  expect((input as HTMLInputElement).value).toBe('未提交');
  vi.stubGlobal('innerWidth', 600);
  fireEvent(window, new Event('resize'));
  expect(screen.getByRole('separator', { hidden: true }).getAttribute('aria-valuemax')).toBe('200');
  expect(screen.getByRole('separator', { hidden: true }).getAttribute('aria-valuenow')).toBe('200');
});

it('acknowledges a create request globally so remounting a page cannot reopen an old form', () => {
  const create = vi.fn();
  function Page() {
    useWorkspacePageActions({ create: { kind: 'contact', run: create } });
    return <p>联系人页面</p>;
  }
  function Harness() {
    const [request, setRequest] = useState<{ kind: 'contact'; id: number } | undefined>({
      kind: 'contact',
      id: 1,
    });
    const [show, setShow] = useState(true);
    return (
      <WorkspaceShell
        view="contacts"
        collapsed
        onCollapse={vi.fn()}
        onNavigate={vi.fn()}
        tasks={[]}
        onOpen={vi.fn()}
        createRequest={request}
        onCreateRequestConsumed={(id) => setRequest((old) => (old?.id === id ? undefined : old))}
      >
        <button onClick={() => setShow((value) => !value)}>切换挂载</button>
        <button onClick={() => setRequest({ kind: 'contact', id: 2 })}>再次新增</button>
        {show && <Page />}
      </WorkspaceShell>
    );
  }
  render(<Harness />);
  expect(create).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('切换挂载'));
  fireEvent.click(screen.getByText('切换挂载'));
  expect(create).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('再次新增'));
  expect(create).toHaveBeenCalledTimes(2);
});

it('keeps unavailable creation disabled and honors the central leave guard for same-page actions', () => {
  const create = vi.fn(),
    fallback = vi.fn(),
    canLeave = vi.fn(() => false);
  function Harness({ blocked }: { blocked: boolean }) {
    const page = { key: 'contacts', title: '联系人', icon: 'person', state: null };
    const navigation = useWorkspaceTabs({
      pageKey: page.key,
      title: page.title,
      getPage: () => page,
      newPage: () => page,
      restore: async () => true,
      canLeave,
      ready: true,
    });
    return (
      <FourColumnWorkspace.Provider
        value={{
          directory: null,
          directoryOpen: true,
          toggleDirectory: vi.fn(),
          registerActions: vi.fn(),
          actions: {
            create: { kind: 'contact', run: create, disabled: blocked, reason: '请先核对保存结果' },
          },
        }}
      >
        <WorkspaceTopbar
          navigation={navigation}
          collapsed
          onCollapse={vi.fn()}
          inspectorOpen
          inspectorAvailable
          onToggleInspector={vi.fn()}
          onCreate={fallback}
          canCreate={canLeave}
        />
      </FourColumnWorkspace.Provider>
    );
  }
  const view = render(<Harness blocked />);
  fireEvent.click(screen.getByRole('button', { name: '新增' }));
  expect((screen.getByRole('menuitem', { name: '联系人' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('menuitem', { name: '联系人' }));
  expect(create).not.toHaveBeenCalled();
  view.rerender(<Harness blocked={false} />);
  fireEvent.click(screen.getByRole('menuitem', { name: '联系人' }));
  expect(canLeave).toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
});

it('selects export from the active document and relinquishes a hidden secondary owner without remounting either pane', () => {
  const exported = vi.fn();
  function Editor({ id, active }: { id: string; active: boolean }) {
    useWorkspacePageActions({ export: active ? { run: () => exported(id) } : undefined });
    return <input aria-label={`正文${id}`} defaultValue={`草稿${id}`} />;
  }
  function Export() {
    const shell = useFourColumnWorkspace();
    return <button onClick={() => shell?.actions.export?.run()}>导出活动文档</button>;
  }
  function Harness() {
    const [active, setActive] = useState('A');
    const [split, setSplit] = useState(true);
    return (
      <WorkspaceShell
        view="documents"
        collapsed
        onCollapse={vi.fn()}
        onNavigate={vi.fn()}
        tasks={[]}
        onOpen={vi.fn()}
      >
        <button onClick={() => setActive('A')}>激活A</button>
        <button onClick={() => setActive('B')}>激活B</button>
        <button
          onClick={() => {
            setSplit(false);
            setActive('A');
          }}
        >
          收起副栏
        </button>
        <Editor id="A" active={active === 'A'} />
        <div hidden={!split}>
          <Editor id="B" active={split && active === 'B'} />
        </div>
        <Export />
      </WorkspaceShell>
    );
  }
  render(<Harness />);
  const draft = screen.getByLabelText('正文B');
  fireEvent.click(screen.getByText('导出活动文档'));
  fireEvent.click(screen.getByText('激活B'));
  fireEvent.click(screen.getByText('导出活动文档'));
  fireEvent.click(screen.getByText('激活A'));
  fireEvent.click(screen.getByText('导出活动文档'));
  fireEvent.click(screen.getByText('激活B'));
  fireEvent.click(screen.getByText('收起副栏'));
  fireEvent.click(screen.getByText('导出活动文档'));
  expect(exported.mock.calls.map(([id]) => id)).toEqual(['A', 'B', 'A', 'A']);
  expect(draft.isConnected).toBe(true);
  expect((draft as HTMLInputElement).value).toBe('草稿B');
});

it('does not present a calendar checkbox as directory search and focuses only an explicit search consumer', async () => {
  function Harness({ searchable }: { searchable: boolean }) {
    return (
      <WorkspaceShell
        view="calendar"
        collapsed
        onCollapse={vi.fn()}
        onNavigate={vi.fn()}
        tasks={[]}
        onOpen={vi.fn()}
      >
        <WorkspaceDirectory>
          <input type="checkbox" aria-label="显示已完成" />
          {searchable && <input type="search" aria-label="真实目录搜索" />}
        </WorkspaceDirectory>
      </WorkspaceShell>
    );
  }
  const view = render(<Harness searchable={false} />);
  const search = screen.getByRole<HTMLButtonElement>('button', { name: '搜索日历目录' });
  expect(search.disabled).toBe(true);
  expect(search.title).toBe('此目录暂未接入搜索');
  view.rerender(<Harness searchable />);
  await waitFor(() => expect(search.disabled).toBe(false));
  fireEvent.click(search);
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '真实目录搜索' }));
});

it('shows the narrow auxiliary rail only when collapsed and keeps the independent logo and child draft mounted', () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <WorkspaceShell
        view="documents"
        collapsed
        onCollapse={vi.fn()}
        onNavigate={vi.fn()}
        tasks={[]}
        onOpen={vi.fn()}
        inspectorOpen={open}
        onToggleInspector={() => setOpen((value) => !value)}
      >
        <button onClick={() => setOpen((value) => !value)}>辅助切换</button>
        <input aria-label="工作区草稿" defaultValue="保留正文" />
      </WorkspaceShell>
    );
  }
  const { container } = render(<Harness />);
  const rail = container.querySelector('.workspace-auxiliary-rail') as HTMLElement;
  const shell = container.querySelector('.workbench') as HTMLElement;
  const logo = container.querySelector('.workspace-corner-logo');
  const draft = screen.getByRole('textbox', { name: '工作区草稿' });
  expect(rail.hidden).toBe(true);
  expect(rail.hasAttribute('inert')).toBe(true);
  expect(shell.style.getPropertyValue('--shell-rail-width')).toBe('0px');
  expect(rail.contains(logo)).toBe(false);
  fireEvent.click(screen.getByText('辅助切换'));
  expect(rail.hidden).toBe(false);
  expect(rail.hasAttribute('inert')).toBe(false);
  expect(shell.style.getPropertyValue('--shell-rail-width')).toBe(
    'var(--shell-collapsed-rail-width)',
  );
  expect(screen.getByRole('textbox', { name: '工作区草稿' })).toBe(draft);
  expect(container.querySelector('.workspace-corner-logo')).toBe(logo);
});

it('temporarily overlays the same directory in narrow windows, restores focus and desktop width without losing draft', () => {
  vi.stubGlobal('innerWidth', 1200);
  const { container } = render(
    <WorkspaceShell
      view="documents"
      collapsed
      onCollapse={vi.fn()}
      onNavigate={vi.fn()}
      tasks={[]}
      onOpen={vi.fn()}
    >
      <WorkspaceDirectory>
        <input aria-label="窄窗目录草稿" defaultValue="保留" />
      </WorkspaceDirectory>
    </WorkspaceShell>,
  );
  const input = screen.getByRole('textbox', { name: '窄窗目录草稿' });
  const shell = container.querySelector('.workbench') as HTMLElement;
  const aside = container.querySelector('.workspace-directory') as HTMLElement;
  const grip = screen.getByRole('separator', { name: '调整目录栏宽度' });
  fireEvent.keyDown(grip, { key: 'End' });
  fireEvent.keyUp(grip, { key: 'End' });
  fireEvent.change(input, { target: { value: '同一未提交草稿' } });
  input.focus();
  vi.stubGlobal('innerWidth', 600);
  fireEvent(window, new Event('resize'));
  expect(aside.hidden).toBe(true);
  expect(aside.hasAttribute('inert')).toBe(true);
  expect(shell.style.getPropertyValue('--shell-directory-width')).toBe('0px');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '展开目录栏' }));
  fireEvent.click(screen.getByRole('button', { name: '展开目录栏' }));
  expect(aside.dataset.directoryMode).toBe('overlay');
  expect(aside.hidden).toBe(false);
  expect(screen.getByRole('textbox', { name: '窄窗目录草稿' })).toBe(input);
  input.focus();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(aside.hidden).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '展开目录栏' }));
  vi.stubGlobal('innerWidth', 1200);
  fireEvent(window, new Event('resize'));
  expect(aside.hidden).toBe(false);
  expect(aside.dataset.directoryMode).toBe('column');
  expect(shell.style.getPropertyValue('--shell-directory-width')).toBe('400px');
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '窄窗目录草稿' }).value).toBe(
    '同一未提交草稿',
  );
});

it.each([false, true])(
  'keeps keyboard focus visible in the topbar only when it overflows: %s',
  (overflow) => {
    const create = vi.fn();
    function Harness() {
      const page = { key: 'home', title: '首页', icon: 'home', state: null };
      const navigation = useWorkspaceTabs({
        pageKey: page.key,
        title: page.title,
        getPage: () => page,
        newPage: () => page,
        restore: async () => true,
        canLeave: () => true,
        ready: true,
      });
      return (
        <WorkspaceTopbar
          navigation={navigation}
          collapsed
          onCollapse={vi.fn()}
          inspectorOpen
          inspectorAvailable
          onToggleInspector={vi.fn()}
          onCreate={create}
        />
      );
    }
    render(<Harness />);
    const scroller = document.querySelector<HTMLElement>('.workspace-titlebar-scroll')!;
    Object.defineProperties(scroller, {
      clientWidth: { value: 270 },
      scrollWidth: { value: overflow ? 500 : 270 },
    });
    const button = screen.getByRole('button', { name: '所有打开的页面' });
    const scroll = vi.fn();
    button.scrollIntoView = scroll;
    button.focus();
    expect(document.activeElement).toBe(button);
    if (overflow)
      expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', inline: 'nearest' });
    else expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '新增', exact: true }));
    const item = screen.getByRole('menuitem', { name: '文档', exact: true });
    const menuScroll = vi.fn();
    item.scrollIntoView = menuScroll;
    item.focus();
    expect(document.activeElement).toBe(item);
    expect(menuScroll).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  },
);
