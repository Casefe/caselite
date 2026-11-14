import { useRef, useState } from 'react';
import type { Task, TaskRequest } from '../../../preload/caselite-api';
import { mutation } from '../../shared/data/taskCommand';

type Command = Extract<TaskRequest, { operation: 'change_status' }>;
type Pending = { command: Command; phase: 'unknown' | 'read' };
export type { TaskCompletionActions } from '../../ui/SharedTaskTable';

export function useTaskCompletion({
  disabled,
  onChanged,
}: {
  disabled: boolean;
  onChanged(task: Task, description: number[] | null): void | Promise<boolean>;
}) {
  const pending = useRef<Pending | null>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState<'unknown' | 'read'>('read');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);

  async function read(id: string, minimum: number) {
    const result = await window.caselite.task({
      protocol_version: 1,
      operation: 'read',
      task_id: id,
    });
    if (!result.ok) throw Error(result.message);
    const actual = result.tasks.find((task) => task.id === id && task.version >= minimum);
    if (!actual) throw Error('暂时无法重读任务当前版本，请保留原操作后重试。');
    if ((await onChanged(actual, result.objective_state ?? null)) === false)
      throw Error('任务已保存，列表刷新失败；请重读，勿重新完成任务。');
  }
  async function run(task?: Task) {
    // 同一事件循环内先锁定，阻止双击在 React 更新前创建第二个幂等键。
    if (running.current || (task && (disabled || pending.current || error))) return;
    if (task && (task.status === 'done' || task.status === 'canceled')) return;
    if (!task && !pending.current && !conflictId) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      if (task) {
        setTaskId(task.id);
        pending.current = {
          command: {
            ...mutation(),
            operation: 'change_status',
            task_id: task.id,
            expected_version: task.version,
            status: 'done',
          },
          phase: 'unknown',
        };
      }
      const original = pending.current;
      if (original) {
        const command = original.command;
        if (original.phase === 'unknown') {
          // 仅明确查无回执时重发原请求；异常和未知结果始终保留原键。
          let result = await window.caselite.task(
            task
              ? command
              : {
                  protocol_version: 1,
                  operation: 'status',
                  idempotency_key: command.idempotency_key,
                },
          );
          let checking = !task;
          if (checking && !result.ok && result.code === 'NOT_FOUND') {
            checking = false;
            result = await window.caselite.task(command);
          }
          if (!result.ok) {
            if (!checking && result.code !== 'RESULT_UNKNOWN' && result.code !== 'READ_FAILED') {
              pending.current = null;
              setConflictId(command.task_id);
            }
            throw Error(result.message);
          }
          const saved = result.tasks.find((row) => row.id === command.task_id);
          if (
            result.receipt !== command.idempotency_key ||
            !saved ||
            saved.version !== command.expected_version + 1 ||
            saved.status !== 'done'
          )
            throw Error('完成回执未确认，请核对原提交。');
          original.phase = 'read';
        }
        // 确认回执后只重读和刷新缓存，不再次提交；允许回读到后续合法版本。
        await read(command.task_id, command.expected_version + 1);
      } else if (conflictId) {
        await read(conflictId, 0);
      }
      pending.current = null;
      setTaskId(null);
      setConflictId(null);
    } catch (cause) {
      setRecovery(pending.current?.phase ?? 'read');
      setError(cause instanceof Error ? cause.message : '任务完成结果未确认，请核对原操作。');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return {
    complete: (task: Task) => {
      void run(task);
    },
    busyIds: taskId ? [taskId] : [],
    blocked: busy || Boolean(error),
    feedback: busy ? (
      <p role="status">正在确认任务完成…</p>
    ) : error ? (
      <div role="alert" className="task-completion-feedback">
        {error}
        <button type="button" onClick={() => void run()}>
          {recovery === 'unknown' ? '核对原完成操作' : '重新读取任务和列表'}
        </button>
      </div>
    ) : null,
  };
}
