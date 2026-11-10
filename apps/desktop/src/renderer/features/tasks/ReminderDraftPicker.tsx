import { useRef, useState } from 'react';
import type { TaskRequest } from '../../../preload/caselite-api';
import { Icon } from '../../shared/ui/Icon';

export type ReminderDraft = NonNullable<
  Extract<TaskRequest, { operation: 'create' }>['initial_reminder']
>;
export default function ReminderDraftPicker({
  value,
  disabled,
  onChange,
  onEditing,
}: {
  value: ReminderDraft | null;
  disabled: boolean;
  onChange(value: ReminderDraft | null): void;
  onEditing(value: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const dateInput = useRef<HTMLInputElement>(null),
    timeInput = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(''),
    [time, setTime] = useState('09:00'),
    [zone, setZone] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [choices, setChoices] = useState<string[]>([]),
    [instant, setInstant] = useState('');
  const reset = () => {
    setChoices([]);
    setInstant('');
    setError('');
  };
  const close = () => {
    if (busy) return;
    dialog.current?.close();
    onEditing(false);
    trigger.current?.focus();
  };
  async function confirm() {
    if (busy || disabled) return;
    if (
      !date ||
      !time ||
      !dateInput.current?.validity.valid ||
      !timeInput.current?.validity.valid
    ) {
      setError('请完整输入提醒日期和时间。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await window.caselite.reminder({
        protocol_version: 1,
        operation: 'resolve',
        date,
        time,
        timezone: zone,
      });
      if (!r.ok) throw Error(r.message);
      const chosen = r.choices.length === 1 ? r.choices[0] : instant;
      if (!chosen || !r.choices.includes(chosen)) {
        setChoices(r.choices);
        setError('该本地时刻重复，请明确选择时间点。');
        return;
      }
      onChange({ date, time, timezone: zone, instant: chosen, confirmed: true });
      dialog.current?.close();
      onEditing(false);
      trigger.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : '提醒时间验证失败。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="task-date-trigger"
        disabled={disabled}
        aria-label="设置新任务提醒"
        onClick={() => {
          setDate(value?.date ?? '');
          setTime(value?.time ?? '09:00');
          setZone(value?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
          reset();
          dialog.current?.showModal();
          onEditing(true);
        }}
      >
        <Icon name="bell" size={16} />
        <span>{value ? `${value.date} ${value.time}` : '设置提醒'}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      <dialog
        ref={dialog}
        className="task-property-dialog"
        aria-label="新任务提醒"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            void confirm();
          }
        }}
      >
        <header>
          <h2>提醒</h2>
          <button type="button" disabled={busy} aria-label="关闭提醒选择" onClick={close}>
            ×
          </button>
        </header>
        <fieldset disabled={disabled || busy}>
          <label>
            提醒日期
            <input
              ref={dateInput}
              aria-label="新任务提醒日期"
              type="date"
              min="2000-01-01"
              max="2099-12-31"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                reset();
              }}
            />
          </label>
          <label>
            提醒时间
            <input
              ref={timeInput}
              aria-label="新任务提醒时间"
              type="time"
              value={time}
              onChange={(e) => {
                setTime(e.target.value);
                reset();
              }}
            />
          </label>
          <label>
            时区
            <input
              aria-label="新任务提醒时区"
              value={zone}
              onChange={(e) => {
                setZone(e.target.value);
                reset();
              }}
            />
          </label>
          {choices.length > 1 && (
            <select
              aria-label="新任务提醒时间点"
              value={instant}
              onChange={(e) => setInstant(e.target.value)}
            >
              <option value="">选择时间点</option>
              {choices.map((v) => (
                <option key={v} value={v}>
                  {v}（UTC）
                </option>
              ))}
            </select>
          )}
        </fieldset>
        <p className="caption">
          创建任务时保存此提醒。仅应用运行时检查，退出或休眠期间不保证准时。
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => {
              onChange(null);
              close();
            }}
          >
            清除提醒
          </button>
          <span />
          <button type="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={disabled || busy}
            onClick={() => void confirm()}
          >
            {busy ? '验证中…' : '确定提醒'}
          </button>
        </footer>
      </dialog>
    </>
  );
}
