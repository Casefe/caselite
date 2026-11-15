import { useFourColumnWorkspace, type WorkspaceCreateKind } from './FourColumnWorkspace';
import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { Icon } from '../shared/ui/Icon';
import { activeTab, currentPage } from '../shared/navigation/workspace-tabs';
import type { useWorkspaceTabs } from '../shared/navigation/useWorkspaceTabs';

export default function WorkspaceTopbar<T>({
  navigation,
  collapsed,
  onCollapse,
  inspectorOpen,
  inspectorAvailable,
  onToggleInspector,
  homeLeftSlot,
  homeRightSlot,
  home = false,
  onCreate,
  canCreate,
}: {
  navigation: ReturnType<typeof useWorkspaceTabs<T>>;
  collapsed: boolean;
  onCollapse(): void;
  inspectorOpen: boolean;
  inspectorAvailable: boolean;
  onToggleInspector(): void;
  home?: boolean;
  onCreate?(kind: WorkspaceCreateKind): void;
  canCreate?(): boolean;
  homeLeftSlot?: Ref<HTMLDivElement>;
  homeRightSlot?: Ref<HTMLDivElement>;
}) {
  const shell = useFourColumnWorkspace();
  const createButton = useRef<HTMLButtonElement>(null);
  const { session } = navigation;
  const tab = activeTab(session);
  const [menu, setMenu] = useState<'history' | 'tabs' | 'create' | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const tabsButton = useRef<HTMLButtonElement>(null);
  const tabButtons = useRef(new Map<number, HTMLButtonElement>());
  const dragged = useRef<number | null>(null);
  const id = useId();
  useEffect(() => {
    tabButtons.current
      .get(session.active)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [session.active, session.tabs.length]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setMenu(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented || (!event.metaKey && !event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      let action: (() => unknown) | undefined;
      if (key === 't' && !event.altKey)
        action = event.shiftKey ? navigation.reopen : navigation.add;
      else if (key === 'w' && !event.shiftKey && !event.altKey)
        action = () => navigation.close(session.active);
      else if (/^[1-9]$/.test(key) && !event.altKey && !event.shiftKey) {
        const target = key === '9' ? session.tabs.at(-1) : session.tabs[Number(key) - 1];
        if (target) action = () => navigation.select(target.id);
      } else if (!event.altKey && (key === '[' || key === ']'))
        action = () => navigation.move(key === '[' ? -1 : 1);
      if (action) {
        event.preventDefault();
        setMenu(null);
        void action();
      }
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [navigation, session]);
  function select(id: number) {
    setMenu(null);
    void navigation.select(id);
  }
  return (
    <div
      className="workspace-titlebar"
      ref={root}
      data-transitioning={navigation.transitioning}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menu) {
          (menu === 'history'
            ? historyButton
            : menu === 'create'
              ? createButton
              : tabsButton
          ).current?.focus();
          setMenu(null);
        }
      }}
    >
      <div className="workspace-window-controls-space" aria-hidden="true" />
      <div
        className="workspace-titlebar-scroll"
        onFocusCapture={(event) => {
          if (
            event.target instanceof HTMLElement &&
            event.currentTarget.scrollWidth > event.currentTarget.clientWidth
          )
            event.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        }}
      >
        <div className="workspace-titlebar-controls">
          <button
            type="button"
            className="workspace-titlebar-button"
            ref={historyButton}
            aria-label="最近访问"
            title="最近访问"
            aria-expanded={menu === 'history'}
            aria-controls={`${id}-history`}
            onClick={() => setMenu(menu === 'history' ? null : 'history')}
          >
            <Icon name="clock" size={16} />
          </button>
          <button
            type="button"
            className="workspace-titlebar-button workspace-history-back"
            aria-label="后退"
            title="后退（⌘[ / Ctrl+[）"
            disabled={navigation.transitioning || tab.index === 0}
            onClick={() => {
              setMenu(null);
              void navigation.move(-1);
            }}
          >
            <Icon name="chevron" size={15} />
          </button>
          <button
            type="button"
            className="workspace-titlebar-button"
            aria-label="前进"
            title="前进（⌘] / Ctrl+]）"
            disabled={navigation.transitioning || tab.index === tab.entries.length - 1}
            onClick={() => {
              setMenu(null);
              void navigation.move(1);
            }}
          >
            <Icon name="chevron" size={15} />
          </button>
        </div>
        <button
          type="button"
          className="workspace-navigation-toggle"
          aria-label={
            shell
              ? shell.directoryOpen
                ? '收起目录栏'
                : '展开目录栏'
              : collapsed
                ? '展开导航'
                : '收起导航'
          }
          aria-expanded={shell ? shell.directoryOpen : !collapsed}
          aria-controls="workspace-directory"
          title={
            shell
              ? shell.directoryOpen
                ? '收起目录栏'
                : '展开目录栏'
              : collapsed
                ? '展开导航'
                : '收起导航'
          }
          onClick={shell?.toggleDirectory ?? onCollapse}
        >
          <Icon name="panel" size={16} />
        </button>
        {home && <div className="home-topbar-left-slot" ref={homeLeftSlot} />}
        <div
          className="workspace-page-tabs"
          role="tablist"
          aria-label="打开的页面"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            if (
              !(event.target instanceof HTMLElement) ||
              event.target.getAttribute('role') !== 'tab'
            )
              return;
            event.preventDefault();
            const index = session.tabs.findIndex((item) => item.id === session.active);
            const target =
              event.key === 'Home'
                ? session.tabs[0]
                : event.key === 'End'
                  ? session.tabs.at(-1)!
                  : session.tabs[
                      (index + (event.key === 'ArrowLeft' ? -1 : 1) + session.tabs.length) %
                        session.tabs.length
                    ];
            void navigation.select(target.id)?.then((ok) => {
              if (ok) tabButtons.current.get(target.id)?.focus();
            });
          }}
        >
          {session.tabs.map((item, index) => {
            const page = currentPage(item),
              selected = item.id === session.active;
            return (
              <div
                className="workspace-page-tab"
                key={item.id}
                data-active={selected}
                draggable={!navigation.transitioning}
                onDragStart={(event) => {
                  dragged.current = item.id;
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(item.id));
                }}
                onDragOver={(event) => {
                  if (dragged.current !== null) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDragEnd={() => {
                  dragged.current = null;
                }}
                onDrop={(event) => {
                  if (dragged.current !== null) {
                    event.preventDefault();
                    navigation.reorder(dragged.current, item.id);
                    dragged.current = null;
                  }
                }}
              >
                <button
                  type="button"
                  role="tab"
                  className="workspace-page-tab-target"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  aria-controls="workspace-page-content"
                  aria-label={page.title}
                  title={page.title}
                  ref={(element) => {
                    if (element) tabButtons.current.set(item.id, element);
                    else tabButtons.current.delete(item.id);
                  }}
                  onClick={() => select(item.id)}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      void navigation.close(item.id);
                    }
                  }}
                >
                  <span className="workspace-page-tab-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="workspace-page-tab-title">{page.title}</span>
                </button>
                <button
                  type="button"
                  className="workspace-page-tab-close"
                  aria-label={`关闭页面：${page.title}`}
                  title={`关闭页面：${page.title}`}
                  onClick={() => {
                    setMenu(null);
                    void navigation.close(item.id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="workspace-titlebar-button workspace-all-tabs"
          ref={tabsButton}
          aria-label="所有打开的页面"
          title="所有打开的页面"
          aria-expanded={menu === 'tabs'}
          aria-controls={`${id}-tabs`}
          onClick={() => setMenu(menu === 'tabs' ? null : 'tabs')}
        >
          <Icon name="chevron" size={14} />
        </button>
        <button
          type="button"
          className="workspace-titlebar-button workspace-add-page"
          aria-label="增加页面"
          title="增加页面（⌘T / Ctrl+T）"
          onClick={() => {
            setMenu(null);
            void navigation.add();
          }}
        >
          <Icon name="plus" size={16} />
        </button>
        <button
          ref={createButton}
          type="button"
          className="workspace-titlebar-button workspace-global-create"
          aria-label="新增"
          aria-haspopup="menu"
          aria-expanded={menu === 'create'}
          onClick={() => setMenu(menu === 'create' ? null : 'create')}
        >
          <Icon name="plus" size={16} />
          <span>新增</span>
        </button>
        <button
          type="button"
          className="workspace-titlebar-button workspace-global-export"
          aria-label="导出"
          disabled={!shell?.actions.export || shell.actions.export.disabled}
          title={
            shell?.actions.export?.reason ??
            (shell?.actions.export ? '导出当前已保存内容' : '当前页面没有可导出的已保存内容')
          }
          onClick={() => shell?.actions.export?.run()}
        >
          <Icon name="download" size={16} />
          <span>导出</span>
        </button>
        <span className="workspace-titlebar-divider" aria-hidden="true" />
        {home && !shell ? (
          <div className="home-topbar-right-slot" ref={homeRightSlot} hidden={Boolean(shell)} />
        ) : (
          <button
            type="button"
            className="workspace-titlebar-button workspace-inspector-toggle"
            disabled={!inspectorAvailable}
            aria-label={inspectorOpen ? '收起右侧属性栏' : '展开右侧属性栏'}
            title={inspectorOpen ? '收起右侧属性栏' : '展开右侧属性栏'}
            aria-expanded={inspectorAvailable && inspectorOpen}
            onClick={() => {
              setMenu(null);
              onToggleInspector();
            }}
          >
            <Icon name={inspectorOpen ? 'panel-right-close' : 'panel-right-open'} size={16} />
          </button>
        )}
      </div>
      {menu === 'create' && (
        <div
          className="workspace-navigation-menu workspace-create-menu"
          role="menu"
          aria-label="新增对象"
          onKeyDown={(event) => {
            if (
              !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) ||
              event.nativeEvent.isComposing
            )
              return;
            event.preventDefault();
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
            ];
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
          }}
        >
          {(
            [
              { kind: 'task', label: '任务', icon: 'check' },
              { kind: 'project', label: '项目', icon: 'folder' },
              { kind: 'document', label: '文档', icon: 'file' },
              { kind: 'contact', label: '联系人', icon: 'person' },
              { kind: 'finance', label: '收支', icon: 'wallet' },
            ] as const
          ).map((item) => (
            <button
              key={item.kind}
              type="button"
              role="menuitem"
              disabled={
                !onCreate ||
                (shell?.actions.create?.kind === item.kind && shell.actions.create.disabled)
              }
              title={
                shell?.actions.create?.kind === item.kind ? shell.actions.create.reason : undefined
              }
              onClick={() => {
                setMenu(null);
                if (canCreate && !canCreate()) return;
                if (shell?.actions.create?.kind === item.kind) {
                  if (!shell.actions.create.disabled) shell.actions.create.run();
                } else onCreate?.(item.kind);
              }}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
      {menu === 'history' && (
        <div
          className="workspace-navigation-menu workspace-recent-pages"
          id={`${id}-history`}
          aria-label="最近访问页面"
        >
          <div className="workspace-navigation-menu-heading">最近访问</div>
          {session.recent.map((page) => (
            <button
              type="button"
              key={page.key}
              title={page.title}
              onClick={() => {
                setMenu(null);
                void navigation.visit(page);
              }}
            >
              <Icon name={page.icon} size={15} />
              <span>{page.title}</span>
            </button>
          ))}
        </div>
      )}
      {menu === 'tabs' && (
        <div
          className="workspace-navigation-menu workspace-open-pages"
          id={`${id}-tabs`}
          aria-label="所有页面列表"
        >
          <div className="workspace-navigation-menu-heading">打开的页面</div>
          {session.tabs.map((item) => {
            const page = currentPage(item);
            return (
              <button
                type="button"
                key={item.id}
                title={page.title}
                aria-current={item.id === session.active ? 'page' : undefined}
                onClick={() => select(item.id)}
              >
                <Icon name={page.icon} size={15} />
                <span>{page.title}</span>
              </button>
            );
          })}
          {!!session.closed.length && (
            <button
              type="button"
              onClick={() => {
                setMenu(null);
                void navigation.reopen();
              }}
            >
              <Icon name="clock" size={15} />
              <span>重新打开关闭的页面</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
