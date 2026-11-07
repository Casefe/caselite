import { useRef, useState } from 'react';

export default function TaskTags({
  tags,
  suggestions,
  disabled = false,
  onChange,
  onDraft,
}: {
  tags: string[];
  suggestions: string[];
  disabled?: boolean;
  onChange(tags: string[]): void;
  onDraft?(value: boolean): void;
}) {
  const [text, setText] = useState('');
  const composing = useRef(false);
  const value = text.trim();
  const available = suggestions.filter((tag) => !tags.includes(tag));
  const canAdd = !disabled && tags.length < 20;
  const edit = (next: string) => {
    setText(next);
    onDraft?.(Boolean(next));
  };
  const add = (tag: string) => {
    if (composing.current || !canAdd || !tag || tag.length > 40 || tags.includes(tag)) return;
    onChange([...tags, tag]);
    edit('');
  };

  return (
    <div className="task-tags">
      <span>标签</span>
      <div className="task-tag-list">
        {tags.map((tag, index) => (
          <button
            key={index}
            type="button"
            disabled={disabled}
            aria-label={`移除标签 ${tag}`}
            onClick={() => onChange(tags.filter((_, position) => position !== index))}
          >
            {tag} ×
          </button>
        ))}
      </div>
      <div className="task-tag-input">
        <input
          aria-label="新标签"
          placeholder="输入标签"
          maxLength={40}
          value={text}
          disabled={!canAdd}
          onChange={(event) => edit(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || composing.current) return;
            if (event.key === 'Escape') edit('');
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
      {text && (
        <button type="button" onClick={() => edit('')}>
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
      {tags.length >= 20 && <small>最多 20 个标签</small>}
    </div>
  );
}
