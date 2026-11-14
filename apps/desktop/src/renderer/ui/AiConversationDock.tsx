import type { ReactNode } from 'react';
import BrandLogo from './BrandLogo';
import type { useAiConversationDock } from './useAiConversationDock';

export default function AiConversationDock({
  model,
  children,
  expandedActions,
}: {
  model: ReturnType<typeof useAiConversationDock>;
  children: ReactNode;
  expandedActions?: ReactNode;
}) {
  const {
    expanded,
    maximized,
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
  } = model;
  return (
    <>
      {floating && (
        <button
          ref={launcher}
          className="workspace-ai-launcher"
          type="button"
          aria-label="打开 AI 对话"
          aria-expanded={expanded}
          aria-controls={region}
          disabled={blocked && !expanded}
          onClick={toggleFromLauncher}
        >
          <BrandLogo />
        </button>
      )}
      <section
        ref={section}
        aria-label="AI 对话"
        hidden={floating && !expanded}
        inert={floating && !expanded}
        className="project-inspector-section inspector-ai-region"
        style={sectionStyle}
      >
        {expanded && !maximized && (
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
            {...resizeHandlers}
          />
        )}
        <header className="inspector-ai-heading">
          <h3>{expanded ? '新的 AI 对话' : 'AI 对话'}</h3>
          <div className="inspector-ai-controls">
            <button
              ref={toggle}
              type="button"
              aria-controls={region}
              aria-expanded={expanded}
              aria-label={expanded ? '收起 AI 对话' : '展开 AI 对话'}
              title={expanded ? '最小化 AI 对话' : '展开 AI 对话'}
              disabled={blocked && !expanded}
              onClick={toggleFromHeading}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                {expanded ? <path d="M4 8h8" /> : <path d="M3 7V3h4M3 3l4 4m6 2v4H9m4 0L9 9" />}
              </svg>
            </button>
            <button
              type="button"
              className="inspector-ai-maximize"
              aria-controls={region}
              aria-label={maximized ? '还原 AI 对话' : '最大化 AI 对话'}
              title={maximized ? '还原 AI 对话' : '最大化为 AI Agent'}
              aria-pressed={maximized}
              disabled={blocked && !expanded}
              onClick={toggleMaximized}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                {maximized ? (
                  <path d="M6 3h7v7M3 6h7v7H3z" />
                ) : (
                  <path d="M3 6V3h3m4 0h3v3m0 4v3h-3m-4 0H3v-3" />
                )}
              </svg>
            </button>
          </div>
        </header>
        {expanded && expandedActions}
        <div
          ref={content}
          id={region}
          className="inspector-ai-scroll"
          hidden={compact && !expanded}
        >
          {children}
        </div>
      </section>
    </>
  );
}
