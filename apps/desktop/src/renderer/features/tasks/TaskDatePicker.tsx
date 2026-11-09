import { useRef, useState } from 'react';
import { Icon } from '../../shared/ui/Icon';

export type TaskDates = { start_date: string | null; due_date: string | null };
export const dateLabel = (value: TaskDates) => {
  const short = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
  return value.start_date && value.due_date
    ? `${short(value.start_date)} — ${short(value.due_date)}`
    : value.start_date
      ? `${short(value.start_date)}开始`
      : value.due_date
        ? `${short(value.due_date)}截止`
        : '设置开始与截止日期';
};

export default function TaskDatePicker({
  value,
  disabled = false,
  onChange,
  onEditing,
}: {
  value: TaskDates;
  disabled?: boolean;
  onChange(value: TaskDates): void;
  onEditing?(value: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const start = useRef<HTMLInputElement>(null),
    end = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<TaskDates>({
      start_date: value.start_date,
      due_date: value.due_date,
    }),
    [error, setError] = useState('');
  const close = () => {
    dialog.current?.close();
    onEditing?.(false);
    trigger.current?.focus();
  };
  const confirm = () => {
    if (disabled) return;
    if (
      !start.current?.validity.valid ||
      !end.current?.validity.valid ||
      [draft.start_date, draft.due_date].some(
        (date) => date && (date.length !== 10 || date.startsWith('0000-')),
      ) ||
      (draft.start_date && draft.due_date && draft.start_date > draft.due_date)
    ) {
      setError('请输入有效日期，开始日期不能晚于截止日期。');
      return;
    }
    onChange(draft);
    close();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="task-date-trigger"
        aria-label="设置任务日期"
        disabled={disabled}
        title={`${value.start_date ?? '未设开始日期'} — ${value.due_date ?? '未设截止日期'}`}
        onClick={() => {
          // 仅取日期字段，不能把调用方的 status 等属性带回属性操作队列。
          setDraft({ start_date: value.start_date, due_date: value.due_date });
          setError('');
          dialog.current?.showModal();
          onEditing?.(true);
        }}
      >
        <Icon name="calendar" size={16} />
        <span>{dateLabel(value)}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      <dialog
        ref={dialog}
        className="task-property-dialog"
        aria-label="任务日期"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            confirm();
          }
        }}
      >
        <header>
          <h2>日期</h2>
          <button type="button" aria-label="关闭日期选择" onClick={close}>
            ×
          </button>
        </header>
        <div className="task-date-fields">
          <label>
            开始日期
            <input
              ref={start}
              aria-label="开始日期"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={draft.start_date ?? ''}
              disabled={disabled}
              onChange={(e) => setDraft({ ...draft, start_date: e.target.value || null })}
            />
          </label>
          <label>
            截止日期
            <input
              ref={end}
              aria-label="截止日期"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={draft.due_date ?? ''}
              disabled={disabled}
              onChange={(e) => setDraft({ ...draft, due_date: e.target.value || null })}
            />
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange({ start_date: null, due_date: null });
              close();
            }}
          >
            清除日期
          </button>
          <span />
          <button type="button" onClick={close}>
            取消
          </button>
          <button type="button" className="primary" disabled={disabled} onClick={confirm}>
            确定日期
          </button>
        </footer>
      </dialog>
    </>
  );
}
