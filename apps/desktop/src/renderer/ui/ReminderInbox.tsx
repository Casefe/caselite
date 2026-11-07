import { useCallback, useEffect, useRef, useState } from 'react';
import type { Reminder, ReminderRequest } from '../../preload/caselite-api';
import ReminderEditor, { attemptLabel, reminderCoverage } from './ReminderEditor';
import { confirmsReminder } from './reminder-state';
import { Icon } from './Workspace';
export default function ReminderInbox({
  onOpen,
  onBlocked,
}: {
  onOpen(id: string): void;
  onBlocked(value: boolean): void;
}) {
  const [rows, setRows] = useState<Reminder[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [filter, setFilter] = useState('unread');
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [blocked, setBlocked] = useState(false),
    [busy, setBusy] = useState(false),
    [recovering, setRecovering] = useState(false),
    [committed, setCommitted] = useState(false);
  const alive = useRef(true),
    sequence = useRef(0);
  const pending = useRef<Extract<ReminderRequest, { operation: 'mark_read' }> | null>(null);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    let r;
    try {
      r = await window.caselite.reminder({ protocol_version: 1, operation: 'list' });
    } catch (e) {
      if (!alive.current || seq !== sequence.current) return;
      throw e;
    }
    if (!alive.current || seq !== sequence.current) return;
    if (!r.ok) throw new Error(r.message);
    setRows(r.reminders);
    setLoading(false);
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (blocked || busy || recovering || committed) return;
    const read = () =>
      void refresh().catch(() => {
        if (!alive.current) return;
        setError('提醒读取失败，现有数据保留。');
        setLoading(false);
      });
    read();
    const timer = setInterval(read, 5000);
    return () => clearInterval(timer);
  }, [refresh, blocked, busy, recovering, committed]);
  const block = (v: boolean) => {
    setBlocked(v);
    onBlocked(v || !!pending.current);
  };
  const visible = rows.filter((r) =>
    filter === 'plans'
      ? r.status === 'scheduled'
      : r.status === 'scheduled' &&
        r.instant <= new Date().toISOString() &&
        (filter === 'read' ? !!r.read_at : !r.read_at),
  );
  const current = (blocked || busy || recovering || committed ? rows : visible).find(
    (r) => r.id === selected,
  );
  async function mark(mode: 'save' | 'query' | 'retry' = 'save') {
    if (!current || busy) return;
    setBusy(true);
    onBlocked(true);
    setError('');
    const cmd = pending.current ?? {
      protocol_version: 1 as const,
      operation: 'mark_read' as const,
      request_id: crypto.randomUUID(),
      idempotency_key: crypto.randomUUID(),
      reminder_id: current.id,
      task_id: current.task_id,
      expected_version: current.version,
      read: !current.read_at,
    };
    pending.current = cmd;
    sequence.current++;
    setRecovering(true);
    let accepted = false;
    try {
      if (committed) {
        await refresh();
        if (!alive.current) return;
        setCommitted(false);
        setRecovering(false);
        pending.current = null;
        return;
      }
      const r = await window.caselite.reminder(
        mode === 'query'
          ? { protocol_version: 1, operation: 'receipt', idempotency_key: cmd.idempotency_key }
          : cmd,
      );
      if (!alive.current) return;
      if (!r.ok) {
        if (mode === 'save' && r.code !== 'RESULT_UNKNOWN') {
          pending.current = null;
          setRecovering(false);
        }
        throw new Error(r.message);
      }
      if (!confirmsReminder(r, cmd)) throw new Error('已读回执与原提交不一致，请核对原提交。');
      accepted = true;
      setCommitted(true);
      await refresh();
      if (!alive.current) return;
      pending.current = null;
      setRecovering(false);
      setCommitted(false);
    } catch (e) {
      if (alive.current)
        setError(
          accepted
            ? '已读状态已保存，当前列表暂时无法重读。'
            : e instanceof Error
              ? e.message
              : '操作失败',
        );
    } finally {
      if (alive.current) {
        setBusy(false);
        onBlocked(blocked || !!pending.current);
      }
    }
  }
  return (
    <section className="reminder-inbox" aria-label="提醒收件箱">
      <header>
        <div>
          <Icon name="bell" />
          <h1>提醒</h1>
        </div>
        <span>本地工作区 · 本人</span>
      </header>
      <div className="reminder-coverage">{reminderCoverage}</div>
      <nav className="reminder-tabs" aria-label="提醒筛选">
        {[
          ['unread', '未读'],
          ['read', '已读'],
          ['plans', '当前计划'],
        ].map(([key, label]) => (
          <button
            key={key}
            disabled={blocked || busy || recovering || committed}
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key);
              setSelected(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert">
          {error}
          <button
            disabled={busy}
            onClick={() =>
              void refresh()
                .then(() => setError(''))
                .catch(() => setError('提醒读取仍失败。'))
            }
          >
            重试读取
          </button>
        </p>
      )}
      <div className="reminder-columns">
        <div className="reminder-list">
          {loading ? (
            <p role="status">正在读取提醒…</p>
          ) : visible.length === 0 ? (
            <div className="reminder-empty">
              <Icon name="bell" size={28} />
              <h2>
                {filter === 'plans'
                  ? '没有当前计划'
                  : '没有' + (filter === 'read' ? '已读' : '未读') + '提醒'}
              </h2>
              <p>在任务的属性栏中，确认日期、时刻与时区后设置提醒。</p>
            </div>
          ) : (
            visible.map((r) => (
              <button
                key={r.id}
                className="reminder-row"
                aria-current={selected === r.id ? 'true' : undefined}
                disabled={blocked || busy || recovering || committed}
                onClick={() => setSelected(r.id)}
              >
                <span className={r.read_at ? 'read-dot' : 'unread-dot'} />
                <div>
                  <strong>{r.task_title}</strong>
                  <time>
                    {r.date} {r.time} · {r.timezone}
                  </time>
                  <small>{attemptLabel(r)}</small>
                </div>
                <Icon name="chevron" size={14} />
              </button>
            ))
          )}
        </div>
        <aside className="reminder-detail">
          {current ? (
            <>
              <span className="sidebar-caption">
                任务提醒 · {current.read_at ? '已读' : '未读'}
              </span>
              <h2>{current.task_title}</h2>
              <button
                disabled={blocked || busy || recovering || committed}
                onClick={() => onOpen(current.task_id)}
              >
                返回原任务 <Icon name="chevron" size={13} />
              </button>
              <button
                disabled={
                  blocked ||
                  busy ||
                  (!recovering &&
                    !committed &&
                    (current.status !== 'scheduled' || current.instant > new Date().toISOString()))
                }
                onClick={() => void mark(recovering ? 'query' : 'save')}
              >
                {recovering
                  ? committed
                    ? '重试读取已保存状态'
                    : '核对原已读操作'
                  : current.read_at
                    ? '标为未读'
                    : '标为已读'}
              </button>
              {recovering && !committed && (
                <button disabled={busy} onClick={() => void mark('retry')}>
                  重试原已读操作
                </button>
              )}
              <ReminderEditor
                key={current.id}
                taskId={current.task_id}
                disabled={busy || recovering || committed}
                onBlocked={block}
                onChanged={() => void refresh().catch(() => setError('计划已保存，列表刷新失败。'))}
              />
            </>
          ) : (
            <div className="reminder-empty">
              <Icon name="bell" size={32} />
              <h2>选择一条提醒</h2>
              <p>查看已确认计划，手动标记已读或返回任务。选择提醒不会自动标为已读。</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
