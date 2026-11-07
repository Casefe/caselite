import { useCallback, useRef, useState } from 'react';

export default function TagPicker({
  tags,
  suggestions,
  disabled = false,
  onChange,
  onDraft,
  onDemand = false,
  retainDraftOnAdd = false,
  lockDraft = false,
}: {
  tags: string[];
  suggestions: string[];
  disabled?: boolean;
  onChange(tags: string[], added?: boolean): void;
  onDraft?(value: boolean): void;
  onDemand?: boolean;
  retainDraftOnAdd?: boolean;
  lockDraft?: boolean;
}) {
  const [text, setText] = useState('');
  const composing = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const focusEditor = useCallback((input: HTMLInputElement | null) => input?.focus(), []);
  const value = text.trim();
  const available = suggestions.filter((tag) => !tags.includes(tag));
  const canAdd = !disabled && tags.length < 20;
  const edit = (next: string) => {
    setText(next);
    onDraft?.(Boolean(next));
  };
  const close = () => {
    edit('');
    if (onDemand) {
      composing.current = false;
      setExpanded(false);
      toggle.current?.focus();
    }
  };
  const add = (tag: string) => {
    if (composing.current || !canAdd || !tag || tag.length > 40 || tags.includes(tag)) return;
    onChange([...tags, tag], true);
    if (!retainDraftOnAdd) close();
  };

  return (
    <div className="task-tags">
      {!onDemand && <span>标签</span>}
      <div className="task-tag-list">
        {tags.map((tag, index) => (
          <button
            key={index}
            type="button"
            disabled={disabled || (retainDraftOnAdd && Boolean(text))}
            aria-label={`移除标签 ${tag}`}
            onClick={() => onChange(tags.filter((_, position) => position !== index))}
          >
            {tag} ×
          </button>
        ))}
      </div>
      {onDemand && (
        <button
          ref={toggle}
          type="button"
          className="task-tag-toggle"
          aria-expanded={expanded}
          disabled={lockDraft || (!expanded && !canAdd)}
          onClick={() => (expanded ? close() : setExpanded(true))}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 3h8l10 10-8 8L3 11z" />
            <circle cx="7.5" cy="7.5" r="1" />
          </svg>
          {expanded ? '取消标签输入' : '添加标签'}
        </button>
      )}
      {(!onDemand || expanded) && (
        <>
          <div className="task-tag-input">
            <input
              ref={onDemand ? focusEditor : undefined}
              aria-label="新标签"
              placeholder="输入标签"
              maxLength={40}
              value={text}
              disabled={!canAdd}
              onChange={(event) => edit(event.target.value)}
              onCompositionStart={() => {
                composing.current = true;
                if (onDemand) onDraft?.(true);
              }}
              onCompositionEnd={(event) => {
                composing.current = false;
                if (onDemand) onDraft?.(Boolean(event.currentTarget.value));
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current)
                  return;
                if (event.key === 'Escape' && !lockDraft) {
                  event.preventDefault();
                  close();
                }
                if (event.key !== 'Enter') return;
                event.preventDefault();
                add(value);
              }}
            />
            <button
              type="button"
              disabled={!canAdd || !value || tags.includes(value)}
              onClick={() => add(value)}
            >
              添加
            </button>
          </div>
          {!onDemand && text && (
            <button type="button" onClick={close}>
              取消标签输入
            </button>
          )}
          {available.length > 0 && (
            <select
              aria-label="选择已使用的任务标签"
              value=""
              disabled={!canAdd}
              onChange={(event) => add(event.target.value)}
            >
              <option value="">选择已使用标签</option>
              {available.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      {tags.length >= 20 && <small>最多 20 个标签</small>}
    </div>
  );
}
