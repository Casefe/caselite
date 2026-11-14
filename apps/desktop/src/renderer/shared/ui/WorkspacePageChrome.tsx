import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Icon } from './Icon';

export type WorkspaceChromeAction = {
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  unavailableReason?: string;
  expanded?: boolean;
  controls?: string;
};

export function closeWorkspaceDisplayOnEscape(event: ReactKeyboardEvent<HTMLDetailsElement>) {
  if (
    event.key !== 'Escape' ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229 ||
    !event.currentTarget.open
  )
    return;
  event.preventDefault();
  event.currentTarget.open = false;
  event.currentTarget.querySelector('summary')?.focus();
}

export default function WorkspacePageChrome({
  title,
  createLabel,
  create,
  navigation,
  search,
  filter,
  display,
  displayAction,
  inspector,
}: {
  title: string;
  createLabel: string;
  create: WorkspaceChromeAction;
  navigation?: ReactNode;
  search?: WorkspaceChromeAction;
  filter?: WorkspaceChromeAction;
  display?: ReactNode;
  displayAction?: WorkspaceChromeAction;
  inspector?: WorkspaceChromeAction;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [lastTool, setLastTool] = useState('');
  const reasonId = useId();
  // 展开区可位于各领域原容器；Escape 关闭后把焦点交还实际触发按钮。
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229
      )
        return;
      const target = event.target as Node | null;
      const actions = [
        { key: 'filter', action: filter },
        { key: 'search', action: search },
        { key: 'display', action: displayAction },
      ];
      const matches = ({ key, action }: { key: string; action?: WorkspaceChromeAction }) => {
        if (!action?.expanded || action.disabled || !action.controls) return false;
        const panel = document.getElementById(action.controls);
        const trigger = root.current?.querySelector<HTMLButtonElement>(
          `[data-chrome-tool="${key}"]`,
        );
        return target && (panel?.contains(target) || trigger?.contains(target));
      };
      const active =
        actions.find((item) => item.key === lastTool && matches(item)) ?? actions.find(matches);
      if (!active?.action?.onClick) return;
      event.preventDefault();
      active.action.onClick();
      root.current?.querySelector<HTMLButtonElement>(`[data-chrome-tool="${active.key}"]`)?.focus();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [filter, search, displayAction, lastTool]);
  const tool = (key: string, label: string, icon: string, action?: WorkspaceChromeAction) => {
    const reason =
      action?.unavailableReason || (!action?.onClick ? `${title}暂不支持${label}` : '');
    return (
      <>
        <button
          type="button"
          data-chrome-tool={key}
          aria-label={action?.label ?? `${title}${label}`}
          aria-describedby={reason ? `${reasonId}-${key}` : undefined}
          title={reason || label}
          aria-expanded={action?.expanded}
          aria-controls={action?.controls}
          aria-disabled={!action?.onClick || action.disabled || undefined}
          disabled={action?.disabled}
          onClick={
            action?.onClick
              ? () => {
                  setLastTool(key);
                  action.onClick?.();
                }
              : undefined
          }
        >
          <Icon name={icon} size={16} />
          {key !== 'search' && key !== 'inspector' && <span>{label}</span>}
        </button>
        {reason && (
          <span id={`${reasonId}-${key}`} className="sr-only">
            {reason}
          </span>
        )}
      </>
    );
  };
  const createReason =
    create.unavailableReason || (!create.onClick ? `${title}创建入口尚未接入` : '');
  return (
    <div className="workspace-page-chrome" ref={root}>
      <header className="workspace-page-titlebar">
        <h1>{title}</h1>
        <button
          type="button"
          className="workspace-page-create"
          aria-disabled={!create.onClick || create.disabled || undefined}
          disabled={create.disabled}
          title={createReason || undefined}
          aria-describedby={createReason ? reasonId : undefined}
          onClick={create.onClick}
        >
          <Icon name="plus" size={16} /> {createLabel}
        </button>
        {createReason && (
          <span id={reasonId} className="sr-only">
            {createReason}
          </span>
        )}
      </header>
      <div className="workspace-page-filterbar">
        <div className="workspace-page-navigation">{navigation}</div>
        <div className="workspace-page-tools" aria-label={`${title}工具`}>
          {tool('search', '搜索', 'search', search)}
          {tool('filter', '筛选', 'filter', filter)}
          {display ?? tool('display', '显示设置', 'settings', displayAction)}
          {tool('inspector', '侧栏', 'panel', inspector)}
        </div>
      </div>
    </div>
  );
}
