import { createPortal } from 'react-dom';
import AiConversationDock from './AiConversationDock';
import { useAiConversationDock } from './useAiConversationDock';
import { useResponsiveWorkspace } from './ResponsiveWorkspace';
import InspectorCards, { type InspectorCard } from './InspectorCards';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// 只调整两个区域的尺寸；保持子树和 dock 身份，伸缩不能重启运行或丢失草稿。
export default function InspectorLayout({
  properties,
  children,
  blocked = false,
  className = '',
  expandedActions,
  cards,
  compact = false,
}: {
  properties: ReactNode;
  cards?: readonly InspectorCard[];
  compact?: boolean;
  children: ReactNode;
  blocked?: boolean;
  className?: string;
  expandedActions?: ReactNode;
}) {
  const { inlineProperties, slots, presentationEpoch } = useResponsiveWorkspace();
  const layout = useRef<HTMLDivElement>(null);
  const [propertiesSlot, setPropertiesSlot] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const scopeSelector = '.task-layout, .task-query-list, .project-catalog, .document-workspace';
    const scope = layout.current?.closest(scopeSelector);
    // 挂点只属于同一个业务布局的主辅助栏；隐藏或并存的其它 Inspector 不得抢走表单。
    const target =
      scope && scope.querySelector('.inspector-split') === layout.current
        ? ([...slots.values()].find((slot) => slot.closest(scopeSelector) === scope) ?? null)
        : null;
    setPropertiesSlot(target);
  }, [slots]);
  const layoutEpoch = propertiesSlot ? presentationEpoch : 0;
  const floating = inlineProperties && propertiesSlot !== null;
  const [propertiesHost] = useState(() => document.createElement('div'));
  const propertiesHome = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const destination = floating ? propertiesSlot : propertiesHome.current;
    if (!destination) return;
    const focused = propertiesHost.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;
    // 支持状态保留移动的 Chromium 不先拆 DOM；旧环境保留同一 React 子树并恢复可见焦点。
    if (
      propertiesHost.isConnected &&
      destination.isConnected &&
      typeof destination.moveBefore === 'function'
    )
      destination.moveBefore(propertiesHost, null);
    else destination.appendChild(propertiesHost);
    if (focused?.isConnected && document.activeElement !== focused)
      focused.focus({ preventScroll: true });
  }, [floating, propertiesSlot, propertiesHost]);
  useLayoutEffect(() => () => propertiesHost.remove(), [propertiesHost]);
  const dock = useAiConversationDock({ layout, layoutEpoch, floating, blocked, compact });
  return (
    <div
      ref={layout}
      className={`inspector-split ${className}`}
      data-responsive-inspector={floating ? 'inline' : 'sidebar'}
      data-ai-expanded={dock.expanded}
      data-ai-maximized={dock.maximized}
      style={{ '--inspector-ai-height': `${dock.height}px` } as CSSProperties}
    >
      <div className="inspector-properties-home" ref={propertiesHome} />
      {createPortal(
        <div className="inspector-properties-scroll" tabIndex={0} aria-label="属性滚动区域">
          {cards === undefined ? (
            properties
          ) : (
            <InspectorCards properties={properties} cards={cards} />
          )}
        </div>,
        propertiesHost,
      )}
      <AiConversationDock model={dock} expandedActions={expandedActions}>
        {children}
      </AiConversationDock>
    </div>
  );
}
