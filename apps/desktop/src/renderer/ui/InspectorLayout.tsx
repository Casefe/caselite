import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// 只调整两个区域的尺寸；保持子树和 dock 身份，伸缩不能重启运行或丢失草稿。
export default function InspectorLayout({
  properties,
  children,
  blocked = false,
  className = '',
  expandedActions,
}: {
  properties: ReactNode;
  children: ReactNode;
  blocked?: boolean;
  className?: string;
  expandedActions?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [customWidth, setCustomWidth] = useState<number | null>(null);
  const [bounds, setBounds] = useState({ width: 0, right: 0, bottom: 0, height: 0 });
  const layout = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const region = useId();
  const maximumWidth = Math.max(bounds.width, bounds.right - 12);
  const minimumWidth = Math.min(bounds.width, maximumWidth);
  const width = Math.min(
    maximumWidth,
    Math.max(minimumWidth, expanded ? (customWidth ?? bounds.width * 1.5) : bounds.width),
  );
  const collapse = () => {
    setExpanded(false);
    setCustomWidth(null);
    drag.current = null;
  };
  useLayoutEffect(() => {
    const element = layout.current;
    if (!element) return;
    // 固定定位越过属性栏的 overflow 裁切；只跟随原栏位置，不移动或重挂载会话 dock。
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setBounds({ width: rect.width, right: rect.right, bottom: rect.bottom, height: rect.height });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, []);
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
      setCustomWidth(null);
      drag.current = null;
      toggle.current?.focus();
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
  }, [blocked, expanded]);
  return (
    <div ref={layout} className={`inspector-split ${className}`} data-ai-expanded={expanded}>
      <div className="inspector-properties-scroll" tabIndex={0} aria-label="属性滚动区域">
        {properties}
      </div>
      <section
        ref={section}
        aria-label="AI 对话"
        className="project-inspector-section inspector-ai-region"
        style={{
          width,
          right: Math.max(0, window.innerWidth - bounds.right),
          bottom: Math.max(0, window.innerHeight - bounds.bottom),
          height: expanded ? bounds.height * 0.85 : Math.min(bounds.height, 164),
        }}
      >
        {expanded && (
          <div
            className="inspector-ai-resize"
            role="separator"
            tabIndex={0}
            aria-label="调整 AI 对话宽度"
            aria-orientation="vertical"
            aria-controls={region}
            aria-valuemin={Math.round(minimumWidth)}
            aria-valuemax={Math.round(maximumWidth)}
            aria-valuenow={Math.round(width)}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { id: event.pointerId, x: event.clientX, width };
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start || start.id !== event.pointerId) return;
              setCustomWidth(
                Math.min(
                  maximumWidth,
                  Math.max(minimumWidth, start.width + start.x - event.clientX),
                ),
              );
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onKeyDown={(event) => {
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
            }}
          />
        )}
        <header className="inspector-ai-heading">
          <h3>AI 对话</h3>
          <button
            ref={toggle}
            type="button"
            aria-controls={region}
            aria-expanded={expanded}
            aria-label={expanded ? '收起 AI 对话' : '展开 AI 对话'}
            title={expanded ? '最小化 AI 对话' : '展开 AI 对话'}
            disabled={blocked && !expanded}
            onClick={() => (expanded ? collapse() : setExpanded(true))}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              {expanded ? <path d="M4 8h8" /> : <path d="M3 7V3h4M3 3l4 4m6 2v4H9m4 0L9 9" />}
            </svg>
          </button>
        </header>
        {expanded && expandedActions}
        <div ref={content} id={region} className="inspector-ai-scroll">
          {children}
        </div>
      </section>
    </div>
  );
}
