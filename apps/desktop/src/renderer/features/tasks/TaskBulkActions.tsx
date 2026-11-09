import { useRef, useState } from 'react';
import type { Task, TaskRequest } from '../../../preload/caselite-api';
import { mutation } from '../../shared/data/taskCommand';
import { taskPriorityNames } from '../../ui/task-priority';

type Command = Extract<TaskRequest, { operation: 'change_status' | 'update_attributes' }>;
export default function TaskBulkActions({
  tasks,
  selected,
  disabled,
  onSelection,
  onBlocked,
  onChanged,
}: {
  tasks: Task[];
  selected: string[];
  disabled: boolean;
  onSelection(value: string[]): void;
  onBlocked(value: boolean): void;
  onChanged(task: Task, state: number[] | null): void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [priority, setPriority] = useState('');
  const [canEnd, setCanEnd] = useState(false);
  const original = useRef<Command | null>(null),
    queue = useRef<string[]>([]);
  const action = useRef<{ priority: number } | { status: 'done' }>({ status: 'done' });
  const running = useRef(false);
  async function run(next?: { priority: number } | { status: 'done' }) {
    if (running.current || (disabled && !error)) return;
    if (next) {
      queue.current = selected.slice();
      action.current = next;
    }
    if (!queue.current.length) return;
    running.current = true;
    setBusy(true);
    setCanEnd(false);
    setError('');
    onBlocked(true);
    try {
      while (queue.current.length) {
        const id = queue.current[0]!;
        const recovering = Boolean(original.current);
        if (!original.current) {
          const r = await window.caselite.task({
            protocol_version: 1,
            operation: 'read',
            task_id: id,
          });
          const current = r.ok ? r.tasks.find((t) => t.id === id) : null;
          if (!current) throw Error(r.ok ? '无法读取所选任务。' : r.message);
          if (
            ('status' in action.current && current.status === 'done') ||
            ('priority' in action.current && current.priority === action.current.priority)
          ) {
            queue.current.shift();
            continue;
          }
          original.current = {
            ...mutation(),
            task_id: id,
            expected_version: current.version,
            ...('status' in action.current
              ? { operation: 'change_status', status: 'done' }
              : {
                  operation: 'update_attributes',
                  priority: action.current.priority,
                  due_date: current.due_date,
                }),
          };
        }
        const command = original.current;
        let checking = recovering;
        let r = await window.caselite.task(
          recovering
            ? { protocol_version: 1, operation: 'status', idempotency_key: command.idempotency_key }
            : command,
        );
        if (recovering && !r.ok && r.code === 'NOT_FOUND') {
          checking = false;
          r = await window.caselite.task(command);
        }
        if (!r.ok) {
          if (!checking && r.code !== 'RESULT_UNKNOWN' && r.code !== 'READ_FAILED')
            original.current = null;
          throw Error(r.message);
        }
        const saved = r.tasks.find((t) => t.id === id);
        if (
          r.receipt !== command.idempotency_key ||
          !saved ||
          saved.version !== command.expected_version + 1 ||
          (command.operation === 'change_status'
            ? saved.status !== command.status
            : saved.priority !== command.priority || saved.due_date !== command.due_date)
        )
          throw Error('批量操作回执未确认，请核对原提交。');
        const read = await window.caselite.task({
          protocol_version: 1,
          operation: 'read',
          task_id: id,
        });
        const actual = read.ok
          ? read.tasks.find((t) => t.id === id && t.version >= saved.version)
          : null;
        if (!actual || !read.ok) throw Error('任务已保存，当前版本暂时无法重读。');
        onChanged(actual, read.objective_state ?? null);
        original.current = null;
        queue.current.shift();
      }
      onSelection([]);
      onBlocked(false);
      setPriority('');
    } catch (e) {
      setCanEnd(!original.current);
      onSelection(queue.current.slice());
      setError(e instanceof Error ? e.message : '批量操作未完成，请核对剩余任务。');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="task-bulk-actions">
      <label>
        <input
          type="checkbox"
          aria-label="批量选择当前页任务"
          checked={tasks.length > 0 && tasks.every((t) => selected.includes(t.id))}
          disabled={disabled || busy || Boolean(error)}
          onChange={(e) => onSelection(e.target.checked ? tasks.map((t) => t.id) : [])}
        />
        已选择 {selected.length} 项
      </label>
      <button
        type="button"
        disabled={disabled || busy || !selected.length || Boolean(error)}
        onClick={() => void run({ status: 'done' })}
      >
        ✓ 标记完成
      </button>
      <label>
        ⚑
        <select
          aria-label="批量设置优先级"
          value={priority}
          disabled={disabled || busy || !selected.length || Boolean(error)}
          onChange={(e) => {
            setPriority(e.target.value);
            void run({ priority: Number(e.target.value) });
          }}
        >
          <option value="">设置优先级</option>
          {Object.entries(taskPriorityNames).map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {busy && <span role="status">正在处理所选任务…</span>}
      {error && (
        <div role="alert">
          {error}
          <button type="button" disabled={busy} onClick={() => void run()}>
            核对并继续原操作
          </button>
          {canEnd && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                queue.current = [];
                setError('');
                setPriority('');
                onSelection([]);
                onBlocked(false);
              }}
            >
              结束批量操作
            </button>
          )}
        </div>
      )}
    </div>
  );
}
