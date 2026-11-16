import { useCallback, useEffect, useRef, useState } from 'react';
import type { IntakeRequest, WorkRequest } from '../../../preload/caselite-api';

const statusLabel = {
  pending: '待分拣',
  accepted: '已采纳',
  rejected: '已拒绝',
  snoozed: '已暂缓',
  duplicate: '重复',
} as const;

function commandId() {
  return {
    protocol_version: 1 as const,
    request_id: crypto.randomUUID(),
    idempotency_key: crypto.randomUUID(),
  };
}

export default function IntakeView({ onOpen }: { onOpen(taskId: string): void }) {
  const [rows, setRows] = useState<WorkRequest[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [retryable, setRetryable] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const pending = useRef<IntakeRequest | null>(null);
  const busyRef = useRef(false);
  const load = useCallback(async () => {
    const result = await window.caselite.intake({
      protocol_version: 1,
      operation: 'list',
      now: new Date().toISOString(),
    });
    if (!alive.current) return;
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRows(result.requests);
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const read = () =>
      void load().catch(() => {
        if (!alive.current) return;
        setError('收件读取失败，已保存内容保持不变。');
      });
    read();
  }, [load]);
  async function send(next: IntakeRequest) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setRetryable(false);
    pending.current = next;
    try {
      const result = await window.caselite.intake(next);
      if (!alive.current) return;
      if (!result.ok) {
        setError(result.message);
        setRetryable(result.code === 'RESULT_UNKNOWN');
        if (result.code !== 'RESULT_UNKNOWN') pending.current = null;
        return;
      }
      pending.current = null;
      if (next.operation === 'submit') {
        setTitle('');
        setText('');
      }
      await load();
    } catch {
      if (alive.current) {
        setError('无法确认收件结果，请保留原提交身份并核对。');
        setRetryable(true);
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="intake-inbox" aria-label="工作请求收件区">
      <header>
        <h1>收件</h1>
        <p>
          放进收件区不会创建任务，也不会改变案件或委托状态。接受、拒绝、暂缓或标成重复都要另外确认。
        </p>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send({ ...commandId(), operation: 'submit', title, text });
        }}
      >
        <label>
          请求标题
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          请求说明
          <textarea value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <button type="submit" disabled={busy}>
          放入收件区
        </button>
      </form>
      {error ? (
        <p role="alert">
          {error}
          {retryable ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => pending.current && void send(pending.current)}
            >
              核对原提交
            </button>
          ) : null}
        </p>
      ) : null}
      <div>
        {rows.map((row) => {
          const openable = row.status === 'pending' || row.status === 'snoozed';
          return (
            <article key={row.id} aria-label={row.title}>
              <h2>{row.title}</h2>
              <p>
                {statusLabel[row.status]}
                {row.snooze_due ? '，已到期，仍须人工处理' : ''}
              </p>
              <p>{row.text}</p>
              {row.target_task_id ? (
                <button type="button" onClick={() => onOpen(row.target_task_id!)}>
                  打开任务
                </button>
              ) : null}
              {openable ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void send({
                        ...commandId(),
                        operation: 'accept_create',
                        work_request_id: row.id,
                      })
                    }
                  >
                    接受并创建任务
                  </button>
                  <label>
                    已有任务
                    <input aria-label={`关联任务 ${row.title}`} data-link={row.id} />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(event) => {
                      const input = event.currentTarget.parentElement?.querySelector(
                        'input[data-link]',
                      ) as HTMLInputElement | null;
                      void send({
                        ...commandId(),
                        operation: 'accept_link',
                        work_request_id: row.id,
                        task_id: input?.value ?? '',
                      });
                    }}
                  >
                    关联已有任务
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void send({ ...commandId(), operation: 'reject', work_request_id: row.id })
                    }
                  >
                    拒绝
                  </button>
                  <label>
                    暂缓到
                    <input
                      type="datetime-local"
                      aria-label={`暂缓到 ${row.title}`}
                      data-snooze={row.id}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(event) => {
                      const input = event.currentTarget.parentElement?.querySelector(
                        'input[data-snooze]',
                      ) as HTMLInputElement | null;
                      const until = input?.value ? new Date(input.value).toISOString() : '';
                      void send({
                        ...commandId(),
                        operation: 'snooze',
                        work_request_id: row.id,
                        until,
                      });
                    }}
                  >
                    暂缓
                  </button>
                  <label>
                    重复目标
                    <input aria-label={`重复目标 ${row.title}`} data-duplicate={row.id} />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(event) => {
                      const input = event.currentTarget.parentElement?.querySelector(
                        'input[data-duplicate]',
                      ) as HTMLInputElement | null;
                      void send({
                        ...commandId(),
                        operation: 'duplicate',
                        work_request_id: row.id,
                        target: { type: 'task', id: input?.value ?? '' },
                      });
                    }}
                  >
                    标记重复
                  </button>
                </>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
