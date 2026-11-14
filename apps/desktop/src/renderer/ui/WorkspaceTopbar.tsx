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
}: {
  navigation: ReturnType<typeof useWorkspaceTabs<T>>;
  collapsed: boolean;
  onCollapse(): void;
  inspectorOpen: boolean;
  inspectorAvailable: boolean;
  onToggleInspector(): void;
  home?: boolean;
  homeLeftSlot?: Ref<HTMLDivElement>;
  homeRightSlot?: Ref<HTMLDivElement>;
}) {
  const { session } = navigation;
  const tab = activeTab(session);
  const [menu, setMenu] = useState<'history' | 'tabs' | null>(null);
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
          (menu === 'history' ? historyButton : tabsButton).current?.focus();
          setMenu(null);
        }
      }}
    >
      <div className="workspace-window-controls-space" aria-hidden="true" />
      <div className="workspace-titlebar-controls">
        {home ? (
          <div className="home-topbar-left-slot" ref={homeLeftSlot} />
        ) : (
          <button
            type="button"
            className="workspace-navigation-toggle"
            aria-label={collapsed ? '展开导航' : '收起导航'}
            aria-expanded={!collapsed}
            aria-controls="primary-navigation"
            title={collapsed ? '展开导航' : '收起导航'}
            onClick={onCollapse}
          >
            <Icon name="panel" size={16} />
          </button>
        )}
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
      <div
        className="workspace-page-tabs"
        role="tablist"
        aria-label="打开的页面"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab')
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
      <span className="workspace-titlebar-divider" aria-hidden="true" />
      {home ? (
        <div className="home-topbar-right-slot" ref={homeRightSlot} />
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
