import { useEffect, useRef, useState } from 'react';
import type { Task, TaskRequest } from '../../preload/caselite-api';
import { taskStatusNames } from './task-status';
import { taskPriorityNames } from './task-priority';

type PropertyCommand = Extract<TaskRequest, { operation: 'change_status' | 'update_attributes' }>;
type Draft = { version: number } & (
  | { kind: 'status'; status: Task['status'] }
  | { kind: 'attributes'; priority: number; due_date: string | null }
);
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState('');
  const [dateInvalid, setDateInvalid] = useState(false);
  const request = useRef<PropertyCommand | null>(null);
  const dateInput = useRef<HTMLInputElement | null>(null);
  const alive = useRef(true);
  const changed =
    !!draft &&
    (draft.kind === 'status'
      ? draft.status !== (task.status ?? 'todo')
      : draft.priority !== (task.priority ?? 0) || draft.due_date !== (task.due_date ?? null));
  const attributes = draft?.kind === 'attributes';
  const actionName = attributes ? '属性' : '状态';
  const blocked = changed || dateInvalid || pending || unknown || committed;
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
    setDateInvalid(false);
    request.current = null;
    setUnknown(false);
    setCommitted(false);
    setError('');
  };
  const execute = async (mode: 'save' | 'query' | 'retry') => {
    if (
      mode === 'save' &&
      draft?.kind === 'attributes' &&
      dateInput.current &&
      !dateInput.current.validity.valid
    ) {
      setDateInvalid(true);
      onBlocked(true);
      return;
    }
    if (
      pending ||
      disabled ||
      (mode === 'save' && (!draft || !changed || dateInvalid || unknown || committed))
    )
      return;
    const command: PropertyCommand | null =
      mode === 'save' && draft
        ? {
            protocol_version: 1 as const,
            request_id: crypto.randomUUID(),
            idempotency_key: crypto.randomUUID(),
            task_id: task.id,
            expected_version: draft.version,
            ...(draft.kind === 'status'
              ? { operation: 'change_status' as const, status: draft.status }
              : {
                  operation: 'update_attributes' as const,
                  priority: draft.priority,
                  due_date: draft.due_date,
                }),
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
            (command.operation === 'change_status'
              ? current.status === command.status
              : current.priority === command.priority && current.due_date === command.due_date),
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
            ? '属性已保存，当前属性暂时无法重读，请重试读取。'
            : '结果暂未核实，请核对原提交；不更换提交身份。',
        );
      }
    } finally {
      if (alive.current) setPending(false);
    }
  };
  const reload = async () => {
    if (pending || disabled || unknown) return;
    if (
      (changed || dateInvalid) &&
      !committed &&
      !window.confirm('放弃尚未保存的任务属性并重新读取？')
    )
      return;
    setPending(true);
    try {
      await readCurrent();
    } catch {
      if (alive.current) setError('无法重读任务属性，请重试。');
    } finally {
      if (alive.current) setPending(false);
    }
  };
  const editAttributes = (
    patch: Partial<{ priority: number; due_date: string | null }>,
    invalid = dateInvalid,
  ) => {
    if (disabled || pending || unknown || committed || (draft?.kind === 'status' && changed))
      return;
    const next = {
      kind: 'attributes' as const,
      version: attributes ? draft.version : task.version,
      priority: task.priority ?? 0,
      due_date: task.due_date ?? null,
      ...(attributes ? draft : {}),
      ...patch,
    };
    setDateInvalid(invalid);
    onBlocked(
      invalid ||
        next.priority !== (task.priority ?? 0) ||
        next.due_date !== (task.due_date ?? null),
    );
    setDraft(next);
    setError('');
  };
  return (
    <section className="task-properties-editor" aria-label="任务属性设置">
      <label>
        <span>状态</span>
        <select
          aria-label="任务状态"
          value={draft?.kind === 'status' ? draft.status : (task.status ?? 'todo')}
          disabled={
            disabled || pending || unknown || committed || (attributes && (changed || dateInvalid))
          }
          onChange={(e) => {
            if (
              disabled ||
              pending ||
              unknown ||
              committed ||
              (attributes && (changed || dateInvalid))
            )
              return;
            onBlocked(e.target.value !== (task.status ?? 'todo'));
            setDraft({
              kind: 'status',
              status: e.target.value as Task['status'],
              version: task.version,
            });
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
      <label>
        <span>优先级</span>
        <select
          aria-label="任务优先级"
          value={attributes ? draft.priority : (task.priority ?? 0)}
          disabled={
            disabled || pending || unknown || committed || (draft?.kind === 'status' && changed)
          }
          onChange={(e) => editAttributes({ priority: Number(e.target.value) })}
        >
          {Object.entries(taskPriorityNames).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>普通截止日期</span>
        <input
          ref={dateInput}
          type="date"
          aria-label="普通截止日期"
          min="0001-01-01"
          max="9999-12-31"
          value={(attributes ? draft.due_date : task.due_date) ?? ''}
          disabled={
            disabled || pending || unknown || committed || (draft?.kind === 'status' && changed)
          }
          onChange={(e) =>
            editAttributes(
              e.currentTarget.validity.valid ? { due_date: e.target.value || null } : {},
              !e.currentTarget.validity.valid,
            )
          }
          onInput={(e) => {
            if (dateInvalid && e.currentTarget.validity.valid)
              editAttributes({ due_date: e.currentTarget.value || null }, false);
          }}
          aria-invalid={dateInvalid}
          aria-describedby={dateInvalid ? 'ordinary-date-error' : undefined}
        />
      </label>
      {dateInvalid && (
        <p role="alert" id="ordinary-date-error">
          请输入完整有效的普通日期（0001—9999年），或明确清空日期。
        </p>
      )}
      <p className="caption" data-testid="saved-task-attributes">
        已保存：{taskPriorityNames[task.priority ?? 0]} · {task.due_date ?? '无截止日期'}
      </p>
      <p className="caption">普通截止日期不含具体时刻；提醒需另行设置。</p>

      {changed && !unknown && !committed && <p role="status">{actionName}尚未保存</p>}
      {pending && <p role="status">正在核对任务属性…</p>}
      {error && <p role="alert">{error}</p>}
      {!unknown && !committed && (
        <button
          disabled={disabled || pending || dateInvalid || !changed}
          onClick={() => void execute('save')}
        >
          保存任务{actionName}
        </button>
      )}
      {unknown && !committed && (
        <>
          <button disabled={disabled || pending} onClick={() => void execute('query')}>
            核对原{actionName}提交
          </button>
          <button disabled={disabled || pending} onClick={() => void execute('retry')}>
            重试原{actionName}请求
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
