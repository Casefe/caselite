import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type HTMLAttributes,
} from 'react';

export function useAiConversationDock({
  layout,
  layoutEpoch,
  floating,
  blocked,
  compact,
}: {
  layout: RefObject<HTMLDivElement | null>;
  layoutEpoch: number;
  floating: boolean;
  blocked: boolean;
  compact: boolean;
}) {
  const [expansion, setExpansion] = useState<{
    epoch: number;
    floating: boolean;
    maximized: boolean;
    width: number | null;
  } | null>(null);
  const expanded = expansion?.epoch === layoutEpoch && expansion.floating === floating;
  const maximized = expanded && expansion.maximized;
  const customWidth = expanded ? expansion.width : null;
  const setExpanded = useCallback(
    (value: boolean) =>
      setExpansion((old) =>
        value
          ? old?.epoch === layoutEpoch && old.floating === floating
            ? old
            : { epoch: layoutEpoch, floating, maximized: false, width: null }
          : null,
      ),
    [layoutEpoch, floating],
  );
  const setMaximized = useCallback(
    (value: boolean | ((old: boolean) => boolean)) =>
      setExpansion((old) => {
        if (!old || old.epoch !== layoutEpoch || old.floating !== floating) return old;
        return { ...old, maximized: typeof value === 'function' ? value(old.maximized) : value };
      }),
    [layoutEpoch, floating],
  );
  const setCustomWidth = useCallback(
    (width: number | null) =>
      setExpansion((old) =>
        old?.epoch === layoutEpoch && old.floating === floating ? { ...old, width } : old,
      ),
    [layoutEpoch, floating],
  );
  const launcher = useRef<HTMLButtonElement>(null);
  const [bounds, setBounds] = useState({
    width: 0,
    right: 0,
    bottom: 0,
    height: 0,
    workspaceLeft: 0,
    workspaceTop: 0,
    workspaceWidth: 0,
    workspaceHeight: 0,
  });
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const region = useId();
  const right = Math.min(
    window.innerWidth,
    Math.max(0, floating ? window.innerWidth - 16 : bounds.right),
  );
  const maximumWidth = Math.max(0, right - 12);
  const minimumWidth = Math.min(Math.max(280, floating ? 340 : bounds.width), maximumWidth);
  // 展开和调宽的下界实时跟随属性栏；窄窗仍受视口安全上限约束，不能挤出控件。
  const width = expanded
    ? Math.min(maximumWidth, Math.max(minimumWidth, customWidth ?? window.innerWidth / 4))
    : Math.min(bounds.width, right);
  const bottom = Math.min(
    window.innerHeight,
    Math.max(0, floating ? window.innerHeight - 74 : bounds.bottom),
  );
  const availableHeight = Math.max(
    0,
    Math.min(floating ? Math.max(0, bottom - bounds.workspaceTop) : bounds.height, bottom),
  );
  const maximumHeight = Math.max(0, availableHeight - Math.min(48, availableHeight * 0.15));
  const height = expanded
    ? Math.min(maximumHeight, Math.max(Math.min(164, maximumHeight), availableHeight * 0.85))
    : Math.min(availableHeight, compact ? 44 : 164);
  const collapse = () => {
    setExpanded(false);
    setMaximized(false);
    setCustomWidth(null);
    drag.current = null;
  };
  useLayoutEffect(() => {
    const element = layout.current;
    if (!element) return;
    // 固定定位越过属性栏的 overflow 裁切；只跟随原栏位置，不移动或重挂载会话 dock。
    const workspace = element.closest('.workspace-main');
    const measure = () => {
      const area = workspace?.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      setBounds({
        width: rect.width,
        right: rect.right,
        bottom: rect.bottom,
        height: rect.height,
        workspaceLeft: Math.max(0, area?.left ?? 0),
        workspaceTop: Math.max(0, area?.top ?? 0),
        workspaceWidth: Math.max(
          0,
          Math.min(area?.right ?? window.innerWidth, window.innerWidth) -
            Math.max(0, area?.left ?? 0),
        ),
        workspaceHeight: Math.max(
          0,
          Math.min(area?.bottom ?? window.innerHeight, window.innerHeight) -
            Math.max(0, area?.top ?? 0),
        ),
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (workspace) observer?.observe(workspace);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [layout]);
  useLayoutEffect(() => {
    const scroll = content.current;
    if (!expanded || !scroll) return;
    // 仅在展开时回到最新位置；后续阅读历史不被强制拉回，也不改变焦点或会话身份。
    scroll.scrollTop = scroll.scrollHeight;
    for (const viewport of scroll.querySelectorAll<HTMLElement>(
      '.assistant-thread, .assistant-viewport, .editor-agent-viewport, .document-review-content',
    ))
      viewport.scrollTop = viewport.scrollHeight;
  }, [expanded]);
  useEffect(() => {
    const scroll = content.current;
    const panel = section.current;
    if (!scroll || !panel) return;
    // 审阅 dock 是 portal；原生 DOM 事件覆盖其实际位置，不依赖 portal 外的 React 祖先。
    const focus = (event: Event) => {
      if (
        !blocked &&
        event.target instanceof Element &&
        event.target.matches('input, textarea, [contenteditable="true"]')
      )
        setExpanded(true);
    };
    const click = (event: Event) => {
      if (
        !blocked &&
        event.target instanceof Element &&
        !event.target.closest('.inspector-ai-heading button, .inspector-ai-resize') &&
        !event.target.closest('dialog[open], [role="dialog"], [role="alertdialog"]')
      )
        setExpanded(true);
    };
    const submit = () => {
      if (!blocked) setExpanded(true);
    };
    const escape = (event: KeyboardEvent) => {
      // 等子控件的 React 处理完成；原件弹窗和菜单的 Escape 始终由各自 Owner 消费。
      if (
        event.key !== 'Escape' ||
        !expanded ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        !(event.target instanceof Element) ||
        !section.current?.contains(event.target) ||
        event.target.closest('dialog[open], [role="dialog"], [role="alertdialog"]')
      )
        return;
      event.preventDefault();
      setExpanded(false);
      setMaximized(false);
      setCustomWidth(null);
      drag.current = null;
      if (floating) window.requestAnimationFrame(() => launcher.current?.focus());
      else toggle.current?.focus();
    };
    scroll.addEventListener('focusin', focus, true);
    panel.addEventListener('click', click, true);
    scroll.addEventListener('submit', submit, true);
    document.addEventListener('keydown', escape);
    return () => {
      scroll.removeEventListener('focusin', focus, true);
      panel.removeEventListener('click', click, true);
      scroll.removeEventListener('submit', submit, true);
      document.removeEventListener('keydown', escape);
    };
  }, [blocked, expanded, floating, setExpanded, setMaximized, setCustomWidth]);
  const toggleFromLauncher = () => (expanded ? collapse() : setExpanded(true));
  const toggleFromHeading = () => {
    if (expanded) {
      collapse();
      if (floating) window.requestAnimationFrame(() => launcher.current?.focus());
    } else setExpanded(true);
  };
  const toggleMaximized = () => {
    setExpanded(true);
    setMaximized((value) => !value);
    drag.current = null;
  };
  const sectionStyle = {
    width: maximized ? bounds.workspaceWidth : width,
    right: maximized ? undefined : Math.max(0, window.innerWidth - right),
    left: maximized ? bounds.workspaceLeft : undefined,
    top: maximized ? bounds.workspaceTop : undefined,
    bottom: maximized ? undefined : Math.max(0, window.innerHeight - bottom),
    height: maximized ? bounds.workspaceHeight : height,
  };
  const resizeHandlers: HTMLAttributes<HTMLDivElement> = {
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, width };
    },
    onPointerMove: (event) => {
      const start = drag.current;
      if (!start || start.id !== event.pointerId) return;
      setCustomWidth(
        Math.min(maximumWidth, Math.max(minimumWidth, start.width + start.x - event.clientX)),
      );
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onLostPointerCapture: () => {
      drag.current = null;
    },
    onKeyDown: (event) => {
      const next =
        event.key === 'ArrowLeft'
          ? width + 24
          : event.key === 'ArrowRight'
            ? width - 24
            : event.key === 'Home'
              ? minimumWidth
              : event.key === 'End'
                ? maximumWidth
                : null;
      if (next === null) return;
      event.preventDefault();
      setCustomWidth(Math.min(maximumWidth, Math.max(minimumWidth, next)));
    },
  };
  return {
    expanded,
    maximized,
    height,
    floating,
    blocked,
    compact,
    launcher,
    section,
    toggle,
    content,
    region,
    width,
    minimumWidth,
    maximumWidth,
    sectionStyle,
    toggleFromLauncher,
    toggleFromHeading,
    toggleMaximized,
    resizeHandlers,
  };
}
