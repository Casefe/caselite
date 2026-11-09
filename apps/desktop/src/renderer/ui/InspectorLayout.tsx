import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

// 只调整两个区域的尺寸；保持子树和 dock 身份，伸缩不能重启运行或丢失草稿。
export default function InspectorLayout({
  properties,
  children,
  blocked = false,
  className = '',
}: {
  properties: ReactNode;
  children: ReactNode;
  blocked?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const region = useId();
  useEffect(() => {
    const scroll = content.current;
    if (!scroll) return;
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
        event.target.closest(
          'input, textarea, [contenteditable="true"], button[type="submit"], [data-sidebar-expand]',
        )
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
      toggle.current?.focus();
    };
    scroll.addEventListener('focusin', focus, true);
    scroll.addEventListener('click', click, true);
    scroll.addEventListener('submit', submit, true);
    document.addEventListener('keydown', escape);
    return () => {
      scroll.removeEventListener('focusin', focus, true);
      scroll.removeEventListener('click', click, true);
      scroll.removeEventListener('submit', submit, true);
      document.removeEventListener('keydown', escape);
    };
  }, [blocked, expanded]);
  return (
    <div className={`inspector-split ${className}`} data-ai-expanded={expanded}>
      <div className="inspector-properties-scroll" tabIndex={0} aria-label="属性滚动区域">
        {properties}
      </div>
      <section
        ref={section}
        aria-label="AI 对话"
        className="project-inspector-section inspector-ai-region"
      >
        <header className="inspector-ai-heading">
          <h3>AI 对话</h3>
          <button
            ref={toggle}
            type="button"
            aria-controls={region}
            aria-expanded={expanded}
            disabled={blocked && !expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '收起 AI 对话' : '展开 AI 对话'}
          </button>
        </header>
        <div ref={content} id={region} className="inspector-ai-scroll">
          {children}
        </div>
      </section>
    </div>
  );
}
