import { PropertyRow } from '../shared/ui/PropertyRow';
import { InspectorSection } from '../shared/ui/InspectorSection';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task, TaskRequest } from '../../preload/caselite-api';
import { taskStatusNames } from './task-status';
import { taskPriorityNames } from './task-priority';
import TagPicker from '../shared/ui/TagPicker';

type Command = Extract<TaskRequest, { operation: 'change_status' | 'update_attributes' }>;
type Attributes = {
  priority: number;
  due_date: string | null;
  tags: string[];
  assignee: string | null;
};
type Edit = { status: Task['status'] } | Partial<Attributes>;
type Failure = { kind: 'unknown' | 'read' | 'conflict' | 'write'; message: string };
const attributes = (task: Task): Attributes => ({
  priority: task.priority ?? 0,
  due_date: task.due_date ?? null,
  tags: task.tags ?? [],
  assignee: task.assignee === undefined ? '本人' : task.assignee,
});
const sameAttributes = (left: Attributes, right: Attributes) =>
  left.priority === right.priority &&
  left.due_date === right.due_date &&
  left.assignee === right.assignee &&
  JSON.stringify(left.tags) === JSON.stringify(right.tags);

export default function TaskProperties({
  task,
  disabled,
  suggestions = [],
  assigneeSuggestions = [],
  groupTags = false,
  project,
  onBlocked,
  onChanged,
}: {
  task: Task;
  disabled: boolean;
  suggestions?: string[];
  assigneeSuggestions?: string[];
  groupTags?: boolean;
  project?: ReactNode;
  onBlocked(value: boolean): void;
  onChanged(task: Task, objectiveState: number[] | null): void;
}) {
  const [edits, setEdits] = useState<Edit[]>([]);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [confirmed, setConfirmed] = useState(task);
  const [tagDraft, setTagDraft] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [dateInvalid, setDateInvalid] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState<string | null>(null);
  const assigneeButton = useRef<HTMLButtonElement>(null);
  const focusAssigneeInput = useCallback((input: HTMLInputElement | null) => input?.focus(), []);
  const assigneeComposing = useRef(false);
  const [assigneeInComposition, setAssigneeInComposition] = useState(false);
  const queue = useRef<Edit[]>([]);
  const running = useRef(false);
  const command = useRef<Command | null>(null);
  const base = useRef(task);
  const composing = useRef(false);
  const alive = useRef(true);
  const blocked =
    pending ||
    edits.length > 0 ||
    date !== null ||
    Boolean(assigneeDraft) ||
    assigneeInComposition ||
    tagDraft ||
    failure !== null;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onBlocked(blocked);
  }, [blocked, onBlocked]);
  useEffect(() => () => onBlocked(false), [onBlocked]);

  const readCurrent = async () => {
    const result = await window.caselite.task({
      protocol_version: 1,
      operation: 'read',
      task_id: task.id,
    });
    if (!result.ok) throw new Error(result.message);
    const current = result.tasks.find((item) => item.id === task.id);
    if (!current || current.version < base.current.version) throw new Error('任务版本无法确认。');
    return { current, description: result.objective_state ?? null };
  };
  const drain = async (mode: 'save' | 'recover' | 'read' | 'discard' = 'save') => {
    if (running.current || disabled) return;
    running.current = true;
    setPending(true);
    let phase: Failure['kind'] = 'read';
    try {
      if (mode === 'discard') {
        const { current, description } = await readCurrent();
        if (!alive.current) return;
        queue.current = [];
        command.current = null;
        base.current = current;
        setConfirmed(current);
        setEdits([]);
        setDate(null);
        setAssigneeDraft(null);
        setDateInvalid(false);
        onChanged(current, description);
        setFailure(null);
        return;
      }
      while (alive.current && queue.current.length) {
        const edit = queue.current[0]!;
        const previous = base.current;
        if (!command.current) {
          const next = { ...attributes(previous), ...edit };
          const unchanged =
            'status' in edit
              ? edit.status === previous.status
              : sameAttributes(attributes(previous), next);
          if (unchanged) {
            queue.current = queue.current.slice(1);
            setEdits(queue.current);
            continue;
          }
          command.current = {
            protocol_version: 1,
            request_id: crypto.randomUUID(),
            idempotency_key: crypto.randomUUID(),
            task_id: task.id,
            expected_version: previous.version,
            ...('status' in edit
              ? { operation: 'change_status' as const, status: edit.status }
              : {
                  operation: 'update_attributes' as const,
                  priority: next.priority,
                  due_date: next.due_date,
                  tags: next.tags,
                  ...('assignee' in edit ? { assignee: next.assignee } : {}),
                }),
          };
        }
        const original = command.current;
        if (mode !== 'read') {
          phase = 'unknown';
          // 结果未知时先查同一键，只有明确无回执才重发原请求。
          let result =
            mode === 'recover'
              ? await window.caselite.task({
                  protocol_version: 1,
                  operation: 'status',
                  idempotency_key: original.idempotency_key,
                })
              : await window.caselite.task(original);
          if (mode === 'recover' && !result.ok && result.code === 'NOT_FOUND') {
            mode = 'save';
            if (!alive.current) return;
            result = await window.caselite.task(original);
          }
          if (!alive.current) return;
          if (!result.ok) {
            if (mode !== 'recover' && result.code !== 'RESULT_UNKNOWN') {
              phase = result.code === 'CONFLICT' ? 'conflict' : 'write';
              command.current = null;
            }
            throw new Error(result.message);
          }
          const saved = result.tasks.find((item) => item.id === task.id);
          if (
            result.receipt !== original.idempotency_key ||
            !saved ||
            saved.version !== original.expected_version + 1 ||
            (original.operation === 'change_status'
              ? saved.status !== original.status
              : !sameAttributes(attributes(saved), {
                  priority: original.priority,
                  due_date: original.due_date,
                  tags: original.tags ?? [],
                  assignee:
                    original.assignee === undefined
                      ? attributes(previous).assignee
                      : original.assignee,
                }))
          )
            throw new Error('提交回执与任务不一致，请核对原提交。');
        }
        // 回执是历史快照。后续写入只基于回读确认的版本，遇到其他修改时保留队列。
        phase = 'read';
        const { current, description } = await readCurrent();
        if (!alive.current) return;
        if (current.version < original.expected_version + 1)
          throw new Error('暂时无法确认已保存版本，请重读。');
        command.current = null;
        base.current = current;
        setConfirmed(current);
        queue.current = queue.current.slice(1);
        setEdits(queue.current);
        onChanged(current, description);
        if (queue.current.length && current.version !== original.expected_version + 1) {
          phase = 'conflict';
          throw new Error('任务已有其他修改。待保存的输入已保留，请核对当前版本。');
        }
        mode = 'save';
      }
      if (alive.current) setFailure(null);
    } catch (error) {
      if (alive.current)
        setFailure({
          kind: phase === 'read' && !command.current ? 'conflict' : phase,
          message: error instanceof Error ? error.message : '任务属性暂时无法保存，请重试。',
        });
    } finally {
      running.current = false;
      if (alive.current) setPending(false);
    }
  };
  const enqueue = (edit: Edit) => {
    if (disabled || failure) return;
    if (!queue.current.length && !running.current && task.version > base.current.version)
      base.current = task;
    queue.current = [...queue.current, edit];
    setEdits(queue.current);
    onBlocked(true);
    void drain();
  };
  const latest = confirmed.version > task.version ? confirmed : task;
  const shown = Object.assign({ status: latest.status ?? 'todo', ...attributes(latest) }, ...edits);
  const locked = disabled || Boolean(failure);
  const finishDate = (input: HTMLInputElement) => {
    if (locked || composing.current || date === null) return;
    if (
      !input.validity.valid ||
      !input.value ||
      input.value.length !== 10 ||
      input.value.startsWith('0000-')
    ) {
      setDateInvalid(true);
      return;
    }
    setDate(null);
    setDateInvalid(false);
    enqueue({ due_date: input.value });
  };

  const finishAssignee = (value?: string | null) => {
    if (assigneeComposing.current) return;
    setAssigneeDraft(null);
    assigneeButton.current?.focus();
    if (value !== undefined) enqueue({ assignee: value });
  };
  const assigneeName = assigneeDraft?.trim() ?? '';
  const assigneeInvalid = assigneeName.length > 80 || assigneeName.includes('\0');
  const assigneeValid = assigneeName.length > 0 && !assigneeInvalid;
  const tags = (
    <TagPicker
      onDemand={groupTags}
      onDraft={(value) => {
        setTagDraft(value);
        if (value) onBlocked(true);
      }}
      tags={shown.tags}
      suggestions={suggestions}
      disabled={locked}
      onChange={(tags) => enqueue({ tags })}
    />
  );
  const properties = (
    <section className="task-properties-editor" aria-label="任务属性设置">
      <PropertyRow compact={groupTags} label="状态">
        <select
          aria-label="任务状态"
          value={shown.status}
          disabled={locked}
          onChange={(event) => enqueue({ status: event.target.value as Task['status'] })}
        >
          {Object.entries(taskStatusNames).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
      </PropertyRow>
      <PropertyRow compact={groupTags} label="优先级">
        <select
          aria-label="任务优先级"
          value={shown.priority}
          disabled={locked}
          onChange={(event) => enqueue({ priority: Number(event.target.value) })}
        >
          {Object.entries(taskPriorityNames).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
      </PropertyRow>
      <PropertyRow compact={groupTags} label={groupTags ? '日期' : '普通截止日期'}>
        <input
          aria-label="普通截止日期"
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          value={date ?? shown.due_date ?? ''}
          disabled={locked}
          aria-invalid={dateInvalid}
          onInput={(event) => {
            setDate(event.currentTarget.value);
            setDateInvalid(false);
            onBlocked(true);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onBlur={(event) => finishDate(event.currentTarget)}
          onKeyDown={(event) => {
            if (composing.current || event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') finishDate(event.currentTarget);
            if (event.key === 'Escape') {
              setDate(null);
              setDateInvalid(false);
            }
          }}
        />
      </PropertyRow>
      {(shown.due_date || date !== null) && (
        <button
          type="button"
          disabled={locked}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setDate(null);
            setDateInvalid(false);
            enqueue({ due_date: null });
          }}
        >
          清空截止日期
        </button>
      )}
      {dateInvalid && (
        <p role="alert">
          请输入完整有效的日期（YYYY-MM-DD），或选择清空截止日期。按 Esc 可取消编辑。
        </p>
      )}
      {groupTags ? (
        <>
          <div className="inspector-property-row">
            <span className="inspector-property-label">负责人</span>
            <button
              ref={assigneeButton}
              className="task-assignee-value"
              type="button"
              aria-label={`编辑任务负责人，当前${shown.assignee ?? '未分配'}`}
              aria-expanded={assigneeDraft !== null}
              disabled={locked}
              onClick={() => {
                if (assigneeDraft === null) {
                  assigneeComposing.current = false;
                  setAssigneeDraft('');
                } else finishAssignee();
              }}
            >
              {shown.assignee ?? '未分配'}
            </button>
          </div>
          {assigneeDraft !== null && (
            <div
              className="task-assignee-editor"
              role="group"
              aria-label="编辑任务负责人"
              onKeyDown={(event) => {
                if (
                  assigneeComposing.current ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229
                )
                  return;
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  finishAssignee();
                }
              }}
            >
              <input
                ref={focusAssigneeInput}
                aria-label="本地负责人称呼"
                placeholder={shown.assignee ?? '输入本地称呼'}
                value={assigneeDraft}
                disabled={locked}
                aria-invalid={assigneeInvalid}
                onCompositionStart={() => {
                  assigneeComposing.current = true;
                  setAssigneeInComposition(true);
                  onBlocked(true);
                }}
                onCompositionEnd={() => {
                  assigneeComposing.current = false;
                  setAssigneeInComposition(false);
                }}
                onChange={(event) => {
                  setAssigneeDraft(event.target.value);
                  if (event.target.value) onBlocked(true);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Enter' ||
                    assigneeComposing.current ||
                    event.nativeEvent.isComposing ||
                    event.keyCode === 229
                  )
                    return;
                  event.preventDefault();
                  if (assigneeValid) finishAssignee(assigneeName);
                }}
              />
              <select
                aria-label="选择本地负责人"
                value=""
                disabled={locked}
                onChange={(event) => finishAssignee(event.target.value)}
              >
                <option value="" disabled>
                  选择已有称呼
                </option>
                {[...new Set(['本人', ...assigneeSuggestions])].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {assigneeInvalid && <p role="alert">请输入 1–80 字的有效负责人称呼。</p>}
              <div className="task-assignee-actions">
                <button
                  type="button"
                  disabled={locked || !assigneeValid}
                  onClick={() => finishAssignee(assigneeName)}
                >
                  保存称呼
                </button>
                <button
                  type="button"
                  disabled={locked || shown.assignee === null}
                  onClick={() => finishAssignee(null)}
                >
                  清空负责人
                </button>
                <button type="button" onClick={() => finishAssignee()}>
                  取消
                </button>
              </div>
            </div>
          )}
          {project ?? (
            <div className="inspector-property-row">
              <span className="inspector-property-label">项目</span>
              <span className="inspector-property-text">
                {task.matter_title ?? (task.matter_id ? '已归组' : '未归组')}
              </span>
            </div>
          )}
        </>
      ) : (
        tags
      )}
      {pending && <p role="status">正在保存任务属性…</p>}
      {failure && (
        <div className="task-property-recovery">
          <p role="alert">{failure.message}</p>
          {failure.kind === 'unknown' && (
            <button disabled={disabled || pending} onClick={() => void drain('recover')}>
              核对并重试原提交
            </button>
          )}
          {failure.kind === 'read' && (
            <button disabled={disabled || pending} onClick={() => void drain('read')}>
              重读已保存任务属性
            </button>
          )}
          {failure.kind === 'write' && (
            <button disabled={disabled || pending} onClick={() => void drain()}>
              重试保存
            </button>
          )}
          {(failure.kind === 'write' || failure.kind === 'conflict') && (
            <button
              disabled={disabled || pending}
              onClick={() => {
                if (window.confirm('放弃尚未保存的属性修改并重新读取？')) void drain('discard');
              }}
            >
              放弃修改并重读
            </button>
          )}
        </div>
      )}
    </section>
  );
  if (!groupTags) return properties;
  return (
    <>
      <InspectorSection title="属性">{properties}</InspectorSection>
      <section className="project-inspector-section task-label-section" aria-label="标签">
        <h3>标签</h3>
        {tags}
      </section>
    </>
  );
}
