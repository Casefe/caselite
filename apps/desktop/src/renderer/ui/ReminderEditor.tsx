import { Icon } from '../shared/ui/Icon';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Reminder, ReminderResponse } from '../../preload/caselite-api';
export const reminderCoverage =
  '提醒支持2000—2099年。仅本机：应用运行时检查，重启或唤醒后补查。退出、关机或休眠期间不保证准时；系统通知可能被拒绝或隐藏，请同时查看应用内提醒。普通截止日不会自动生成提醒，不计算法定期限。';
export const attemptLabel = (r: Reminder) =>
  r.status === 'canceled'
    ? '已取消 · 旧计划失效'
    : r.attempt === 'shown'
      ? '系统报告显示 · 不代表已读'
      : r.attempt === 'failed'
        ? '系统通知失败 · 请在此查看'
        : r.attempt === 'unsupported'
          ? '系统不支持通知 · 请在此查看'
          : r.attempt === 'unknown'
            ? '通知结果未知 · 不自动重发'
            : r.instant <= new Date().toISOString()
              ? '已到期 · 等待本机检查'
              : '等待到期';
import { confirmsReminder, type ReminderCommand as Command } from './reminder-state';
const check = (r: ReminderResponse) => {
  if (!r.ok) throw new Error(r.message);
  return r;
};
function ReminderEditorState({
  taskId,
  disabled = false,
  onBlocked,
  onChanged,
  compact = false,
}: {
  taskId: string;
  compact?: boolean;
  disabled?: boolean;
  onBlocked?(value: boolean): void;
  onChanged?(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState<Reminder | null>(null),
    [loaded, setLoaded] = useState(false),
    [editing, setEditing] = useState(false);
  const [date, setDate] = useState(''),
    [time, setTime] = useState('09:00'),
    [timezone, setZone] = useState('');
  const [choices, setChoices] = useState<string[]>([]),
    [instant, setInstant] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [readError, setReadError] = useState(''),
    [unknown, setUnknown] = useState(false),
    [committed, setCommitted] = useState(false);
  useEffect(() => {
    if (!compact) return;
    if (editing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [compact, editing]);
  const dateInput = useRef<HTMLInputElement>(null),
    timeInput = useRef<HTMLInputElement>(null);
  const pending = useRef<Command | null>(null),
    alive = useRef(true),
    readSequence = useRef(0);
  const load = useCallback(async () => {
    const seq = ++readSequence.current;
    try {
      const result = await window.caselite.reminder({
        protocol_version: 1,
        operation: 'list',
        task_id: taskId,
      });
      if (!alive.current || seq !== readSequence.current) return false;
      const r = check(result);
      if (r.reminders.some((r) => r.task_id !== taskId)) throw new Error('提醒范围不匹配');
      setCurrent(r.reminders[0] ?? null);
      setLoaded(true);
      setReadError('');
      return true;
    } catch (e) {
      if (!alive.current || seq !== readSequence.current) return false;
      throw e;
    }
  }, [taskId]);
  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => {
      if (alive.current)
        void load().catch(() => {
          if (alive.current) setReadError('提醒读取失败，请重试。');
        });
    });
    return () => {
      alive.current = false;
    };
  }, [load]);
  useEffect(() => {
    if (editing || busy || unknown || committed) return;
    const timer = setInterval(
      () =>
        void load().catch(() => {
          if (alive.current) setReadError('提醒刷新失败，请重新读取。');
        }),
      5000,
    );
    return () => clearInterval(timer);
  }, [load, editing, busy, unknown, committed]);
  const block = (value: boolean) => {
    readSequence.current++;
    setEditing(value);
    onBlocked?.(value);
  };
  const change = () => {
    setChoices([]);
    setInstant('');
    setConfirmed(false);
    setError('');
  };
  async function resolve() {
    setBusy(true);
    setError('');
    try {
      const r = check(
        await window.caselite.reminder({
          protocol_version: 1,
          operation: 'resolve',
          date,
          time,
          timezone,
        }),
      );
      if (!alive.current) return;
      setChoices(r.choices);
      setInstant(r.choices.length === 1 ? r.choices[0] : '');
      setConfirmed(false);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '时刻验证失败');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function finish() {
    const loaded = await load();
    if (!alive.current) return;
    if (!loaded) throw new Error('Current reminder read superseded');
    pending.current = null;
    setUnknown(false);
    setCommitted(false);
    block(false);
    setChoices([]);
    onChanged?.();
  }
  async function reload() {
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      await finish();
    } catch {
      if (alive.current) setError('提醒已保存，当前计划暂时无法重读，请重试读取。');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function send(operation: 'schedule' | 'cancel', mode: 'save' | 'query' | 'retry' = 'save') {
    if (busy || disabled || committed) return;
    if (
      mode === 'save' &&
      operation === 'schedule' &&
      (!dateInput.current?.validity.valid ||
        !timeInput.current?.validity.valid ||
        !confirmed ||
        !instant)
    ) {
      setError('请完整输入有效日期和时刻并重新验证确认。');
      return;
    }
    setBusy(true);
    setError('');
    const cmd: Command =
      mode === 'save'
        ? {
            protocol_version: 1,
            request_id: crypto.randomUUID(),
            idempotency_key: crypto.randomUUID(),
            task_id: taskId,
            reminder_id: current?.id ?? crypto.randomUUID(),
            expected_version: current?.version ?? 0,
            ...(operation === 'schedule'
              ? { operation, date, time, timezone, instant, confirmed: true as const }
              : { operation }),
          }
        : pending.current!;
    if (!cmd) {
      setBusy(false);
      return;
    }
    pending.current = cmd;
    let accepted = false;
    try {
      const r = await window.caselite.reminder(
        mode === 'query'
          ? { protocol_version: 1, operation: 'receipt', idempotency_key: cmd.idempotency_key }
          : cmd,
      );
      if (!alive.current) return;
      if (!r.ok) {
        if (mode !== 'save' || r.code === 'RESULT_UNKNOWN') setUnknown(true);
        else {
          pending.current = null;
          setUnknown(false);
        }
        setError(r.message);
        return;
      }
      if (!confirmsReminder(r, cmd)) {
        setUnknown(true);
        setError('提醒回执与原提交不一致，请核对原提交。');
        return;
      }
      accepted = true;
      setCommitted(true);
      setUnknown(false);
      await finish();
    } catch {
      if (alive.current) {
        setUnknown(!accepted);
        setError(
          accepted
            ? '提醒已保存，当前计划暂时无法重读，请重试读取。'
            : '结果尚未确认，请核对原提交，不更换提交身份。',
        );
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const content = (
    <section className="reminder-editor" aria-label="本机提醒设置">
      <h3>本机提醒</h3>
      {current && (
        <p data-testid="saved-reminder">
          {current.date} {current.time} · {current.timezone}
          <br />
          {attemptLabel(current)} · 版本 {current.version}
        </p>
      )}
      {!current && loaded && <p className="caption">尚未设置提醒</p>}
      <p className="caption">{reminderCoverage}</p>
      {(error || readError) && <p role="alert">{error || readError}</p>}
      {!loaded && (
        <button
          disabled={busy || disabled}
          onClick={() => void load().catch(() => setReadError('提醒读取仍失败'))}
        >
          重新读取提醒
        </button>
      )}
      {editing ? (
        <>
          <fieldset disabled={busy || unknown || committed || disabled}>
            <label>
              提醒日期
              <input
                ref={dateInput}
                aria-label="提醒日期"
                type="date"
                min="2000-01-01"
                max="2099-12-31"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  change();
                }}
              />
            </label>
            <label>
              提醒时刻
              <input
                ref={timeInput}
                aria-label="提醒时刻"
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  change();
                }}
              />
            </label>
            <label>
              明确时区
              <input
                aria-label="提醒时区"
                placeholder="Asia/Shanghai"
                value={timezone}
                onChange={(e) => {
                  setZone(e.target.value);
                  change();
                }}
              />
            </label>
            <button
              onClick={() => {
                if (dateInput.current?.validity.valid && timeInput.current?.validity.valid)
                  void resolve();
                else setError('请输入完整有效日期和时刻。');
              }}
            >
              验证日期与时区
            </button>
            {choices.length > 0 && (
              <>
                {choices.length > 1 && <p>该时刻因夏令时重复，请明确选择时间点。</p>}
                <select
                  aria-label="提醒时间点"
                  value={instant}
                  onChange={(e) => {
                    setInstant(e.target.value);
                    setConfirmed(false);
                  }}
                >
                  <option value="">选择时间点</option>
                  {choices.map((c) => (
                    <option key={c} value={c}>
                      {c}（UTC）
                    </option>
                  ))}
                </select>
                <label className="reminder-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  我确认 {date} {time} · {timezone}，对应 {instant || '待选择'}（UTC）
                </label>
              </>
            )}
          </fieldset>
          {compact && current?.status === 'scheduled' && !unknown && !committed && (
            <button type="button" disabled={busy || disabled} onClick={() => void send('cancel')}>
              清除提醒
            </button>
          )}
          {!unknown && !committed && (
            <button
              className="primary"
              disabled={busy || disabled || (!unknown && (!confirmed || !instant))}
              onClick={() => void send('schedule')}
            >
              {busy ? '保存中…' : '确认保存提醒'}
            </button>
          )}
          {unknown && (
            <>
              <button disabled={busy || disabled} onClick={() => void send('schedule', 'query')}>
                核对原提交
              </button>
              <button disabled={busy || disabled} onClick={() => void send('schedule', 'retry')}>
                重试原提交
              </button>
            </>
          )}
          {committed && (
            <button disabled={busy || disabled} onClick={() => void reload()}>
              重试读取已保存提醒
            </button>
          )}
          <button
            disabled={busy || unknown || committed}
            onClick={() => {
              block(false);
              setError('');
            }}
          >
            取消编辑
          </button>
        </>
      ) : (
        <div className="reminder-actions">
          <button
            disabled={!loaded || busy || disabled}
            onClick={() => {
              setDate(current?.date ?? '');
              setTime(current?.time ?? '09:00');
              setZone(current?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
              change();
              block(true);
            }}
          >
            {current ? '改期 / 重新设定' : '设置提醒'}
          </button>
          {current?.status === 'scheduled' && (
            <button
              disabled={busy || disabled}
              onClick={() => {
                block(true);
                void send('cancel');
              }}
            >
              取消提醒
            </button>
          )}
        </div>
      )}
    </section>
  );
  if (!compact) return content;
  return (
    <>
      <div className="inspector-property-row task-reminder-field">
        <span className="inspector-property-label">提醒</span>
        <button
          type="button"
          className="task-date-trigger"
          aria-label="设置任务提醒"
          disabled={!loaded || busy || disabled}
          onClick={() => {
            setDate(current?.date ?? '');
            setTime(current?.time ?? '09:00');
            setZone(current?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
            change();
            block(true);
          }}
        >
          <Icon name="bell" size={16} />
          <span>
            {current?.status === 'scheduled'
              ? `${current.date} ${current.time}`
              : readError
                ? '读取失败，请重试'
                : '设置日期和时间'}
          </span>
          <span aria-hidden="true">⌄</span>
        </button>
        {readError && (
          <button
            type="button"
            onClick={() => void load().catch(() => setReadError('提醒读取仍失败'))}
          >
            重新读取提醒
          </button>
        )}
      </div>
      <dialog
        ref={dialog}
        className="task-property-dialog task-reminder-dialog"
        aria-label="任务提醒"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy && !unknown && !committed) {
            block(false);
            setError('');
          }
        }}
      >
        <header>
          <h2>提醒</h2>
        </header>
        {content}
      </dialog>
    </>
  );
}

// Task切换必须创建新的异步生命周期，旧任务的迟到响应不能写入新任务表单。
export default function ReminderEditor(props: Parameters<typeof ReminderEditorState>[0]) {
  return <ReminderEditorState key={props.taskId} {...props} />;
}
