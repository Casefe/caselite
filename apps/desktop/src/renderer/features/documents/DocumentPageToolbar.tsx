import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../shared/ui/Icon';

export default function DocumentPageToolbar({
  documentId,
  title,
  path,
  favorite,
  disabled,
  backDisabled,
  split,
  orientation,
  wide,
  onBack,
  onToggleSplit,
  onToggleOrientation,
  onToggleWide,
}: {
  documentId?: string;
  title: string;
  path: string;
  favorite?: ReactNode;
  disabled: boolean;
  backDisabled: boolean;
  split: boolean;
  orientation: 'horizontal' | 'vertical';
  wide: boolean;
  onBack(): void;
  onToggleSplit(): void;
  onToggleOrientation(): void;
  onToggleWide(): void;
}) {
  const scope = documentId ?? 'empty';
  const [menuState, setMenuState] = useState({ scope, open: false });
  // 身份变化时丢弃旧菜单状态，返回同一文档也不能复活菜单并抢走输入焦点。
  if (menuState.scope !== scope) setMenuState({ scope, open: false });
  const open = menuState.scope === scope && menuState.open;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const sharingNote = useId();
  const menuId = useId();
  const close = (focus = false) => {
    setMenuState((current) => ({ ...current, open: false }));
    if (focus) trigger.current?.focus();
  };

  useLayoutEffect(() => {
    const panel = menu.current;
    const button = trigger.current;
    if (!open || !panel || !button) return;
    // 菜单进入顶层DOM，避免被中央滚动区裁切；显示选项不移动正文或右侧子树。
    panel.style.maxHeight = `${Math.max(0, window.innerHeight - 16)}px`;
    const anchor = button.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - bounds.height - 8))}px`;
    panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setMenuState((current) => ({ ...current, open: false }));
    };
    const dismiss = () => setMenuState((current) => ({ ...current, open: false }));
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [open]);

  function act(action: () => void) {
    action();
    close(true);
  }

  return (
    <header className="document-page-toolbar" aria-label="文档页面顶栏">
      <div className="document-page-location">
        <button
          type="button"
          className="document-directory-back"
          aria-label="返回文件夹"
          disabled={backDisabled}
          onClick={onBack}
        >
          <Icon name="back" size={16} />
        </button>
        <span className="document-page-short-title" title={path}>
          {title}
        </span>
        {documentId && (
          <span className="document-page-visibility" title="此设备工作区，尚未启用共享">
            <span aria-hidden="true">🔒</span> 私人
          </span>
        )}
      </div>
      <div className="document-page-actions">
        <span title="共享功能尚未接入">
          <button type="button" disabled aria-describedby={sharingNote}>
            共享
          </button>
        </span>
        <span id={sharingNote} className="document-page-sr-only">
          共享功能尚未接入，不改变当前文档的访问范围。
        </span>
        {favorite ?? (
          <button type="button" disabled aria-label="收藏文档">
            <Icon name="star" size={16} />
          </button>
        )}
        <button
          ref={trigger}
          type="button"
          className="document-page-more"
          aria-label="更多文档操作"
          aria-haspopup="menu"
          aria-controls={open ? menuId : undefined}
          aria-expanded={open}
          onClick={() => setMenuState({ scope, open: !open })}
          onKeyDown={(event) => {
            if (!event.nativeEvent.isComposing && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
              event.preventDefault();
              setMenuState({ scope, open: true });
            }
          }}
        >
          …
        </button>
      </div>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label="文档页面操作"
            className="document-page-menu"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
              } else if (event.key === 'Tab') close();
              else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const buttons = Array.from(
                  menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
                );
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }
            }}
          >
            <span className="document-page-menu-label">页面显示</span>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={wide}
              disabled={!documentId}
              onClick={() => act(onToggleWide)}
            >
              全宽阅读<span aria-hidden="true">{wide ? '✓' : ''}</span>
            </button>
            <hr />
            <span className="document-page-menu-label">对照阅读</span>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={split}
              disabled={disabled}
              onClick={() => act(onToggleSplit)}
            >
              {split ? '收起双栏' : '双栏预览'}
              <span aria-hidden="true">{split ? '✓' : ''}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={disabled || !split}
              onClick={() => act(onToggleOrientation)}
            >
              {orientation === 'horizontal' ? '上下分栏' : '左右分栏'}
            </button>
          </div>,
          document.body,
        )}
    </header>
  );
}
