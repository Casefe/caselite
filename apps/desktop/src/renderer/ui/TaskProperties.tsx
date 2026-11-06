import { useEffect, useRef, useState } from 'react';
import type { Task, TaskRequest } from '../../preload/caselite-api';
import { taskStatusNames } from './task-status';

type ChangeStatus = Extract<TaskRequest, { operation: 'change_status' }>;
export default function TaskProperties({
  task,
  disabled,
  onBlocked,
  onChanged,
}: {
  task: Task;
  disabled: boolean;
  onBlocked(value: boolean): void;
  onChanged(task: Task, objectiveState: number[] | null): void;
}) {
  const [draft, setDraft] = useState<{ status: Task['status']; version: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<ChangeStatus | null>(null);
  const alive = useRef(true);
  const changed = !!draft && draft.status !== (task.status ?? 'todo');
  const blocked = changed || pending || unknown || committed;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onBlocked(blocked);
    return () => onBlocked(false);
  }, [blocked, onBlocked]);

  const readCurrent = async () => {
    const result = await window.caselite.task({
      protocol_version: 1,
      operation: 'read',
      task_id: task.id,
    });
    if (!alive.current) return;
    const current = result.ok ? result.tasks.find((t) => t.id === task.id) : undefined;
    if (!current) throw new Error('任务属性暂时无法重读，请保留当前结果后重试。');
    onChanged(current, result.ok ? (result.objective_state ?? null) : null);
    setDraft(null);
    request.current = null;
    setUnknown(false);
    setCommitted(false);
    setError('');
  };
  const execute = async (mode: 'save' | 'query' | 'retry') => {
    if (pending || disabled || (mode === 'save' && (!draft || !changed || unknown || committed)))
      return;
    const command =
      mode === 'save' && draft
        ? {
            protocol_version: 1 as const,
            operation: 'change_status' as const,
            request_id: crypto.randomUUID(),
            idempotency_key: crypto.randomUUID(),
            task_id: task.id,
            expected_version: draft.version,
            status: draft.status,
          }
        : request.current;
    if (!command) return;
    request.current = command;
    setPending(true);
    setError('');
    let confirmed = false;
    try {
      const result = await window.caselite.task(
        mode === 'query'
          ? {
              protocol_version: 1,
              operation: 'status',
              idempotency_key: command.idempotency_key,
            }
          : command,
      );
      if (!alive.current) return;
      if (!result.ok) {
        if (mode === 'query' || result.code === 'RESULT_UNKNOWN') setUnknown(true);
        else {
          request.current = null;
          setUnknown(false);
        }
        setError(result.message);
        return;
      }
      // 回执是原提交快照；只用它确认提交，再读当前对象，避免历史状态倒灌。
      if (
        result.receipt !== command.idempotency_key ||
        !result.tasks.some(
          (current) =>
            current.id === task.id &&
            current.version === command.expected_version + 1 &&
            current.status === command.status,
        )
      ) {
        setUnknown(true);
        setError('提交回执与当前任务不一致，请核对原提交。');
        return;
      }
      setCommitted(true);
      confirmed = true;
      await readCurrent();
    } catch {
      if (alive.current) {
        setUnknown(!confirmed);
        setError(
          confirmed
            ? '状态已保存，当前属性暂时无法重读，请重试读取。'
            : '结果暂未核实，请核对原提交；不更换提交身份。',
        );
      }
    } finally {
      if (alive.current) setPending(false);
    }
  };
  const reload = async () => {
    if (pending || disabled || unknown) return;
    if (changed && !committed && !window.confirm('放弃尚未保存的任务状态并重新读取？')) return;
    setPending(true);
    try {
      await readCurrent();
    } catch {
      if (alive.current) setError('无法重读任务属性，请重试。');
    } finally {
      if (alive.current) setPending(false);
    }
  };
  return (
    <section className="task-properties-editor" aria-label="任务状态设置">
      <label>
        <span>状态</span>
        <select
          aria-label="任务状态"
          value={draft?.status ?? task.status ?? 'todo'}
          disabled={disabled || pending || unknown || committed}
          onChange={(e) => {
            if (disabled || pending || unknown || committed) return;
            onBlocked(e.target.value !== (task.status ?? 'todo'));
            setDraft({ status: e.target.value as Task['status'], version: task.version });
            setError('');
          }}
        >
          {Object.entries(taskStatusNames).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <p className="caption">当前已保存：{taskStatusNames[task.status ?? 'todo']}</p>
      {changed && !unknown && !committed && <p role="status">状态尚未保存</p>}
      {pending && <p role="status">正在核对任务属性…</p>}
      {error && <p role="alert">{error}</p>}
      {!unknown && !committed && (
        <button disabled={disabled || pending || !changed} onClick={() => void execute('save')}>
          保存任务状态
        </button>
      )}
      {unknown && !committed && (
        <>
          <button disabled={disabled || pending} onClick={() => void execute('query')}>
            核对原状态提交
          </button>
          <button disabled={disabled || pending} onClick={() => void execute('retry')}>
            重试原状态请求
          </button>
        </>
      )}
      {!unknown || committed ? (
        <button disabled={disabled || pending} onClick={() => void reload()}>
          {committed ? '重读已保存任务属性' : '重新读取任务属性'}
        </button>
      ) : null}
      <p className="caption">任务完成只表示工作项状态，定稿和交付另行确认。</p>
    </section>
  );
}
