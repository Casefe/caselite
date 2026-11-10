import { useEffect, useRef, useState } from 'react';
import type { Matter, Task } from '../../../preload/caselite-api';
import { DraftEditor, type RichDraft } from '../../editors/RichEditor';
import { Icon } from '../../shared/ui/Icon';
import TagPicker from '../../shared/ui/TagPicker';
import { taskStatusNames } from '../../ui/task-status';
import { taskPriorityNames } from '../../ui/task-priority';
import TaskDatePicker, { type TaskDates } from './TaskDatePicker';
import ReminderDraftPicker, { type ReminderDraft } from './ReminderDraftPicker';

export type CreateProperties = TaskDates & {
  status: Task['status'];
  priority: number;
  assignee: string | null;
  tags: string[];
  matter_id: string;
};
export default function TaskCreateDialog({
  title,
  onTitle,
  objective,
  onObjective,
  properties,
  onProperties,
  reminder,
  onReminder,
  projects,
  projectState,
  onRetryProjects,
  suggestions,
  assigneeSuggestions,
  onTagDraft,
  onFieldEditing,
  busy,
  uncertain,
  onCancel,
  onCreate,
  onRetry,
}: {
  title: string;
  onTitle(value: string): void;
  objective: RichDraft;
  onObjective(value: RichDraft): void;
  properties: CreateProperties;
  onProperties(value: CreateProperties): void;
  reminder: ReminderDraft | null;
  onReminder(value: ReminderDraft | null): void;
  projects: Matter[];
  projectState: 'loading' | 'ready' | 'failed';
  onRetryProjects(): void;
  suggestions: string[];
  assigneeSuggestions: string[];
  onTagDraft(value: boolean): void;
  onFieldEditing(value: boolean): void;
  busy: boolean;
  uncertain: boolean;
  onCancel(): void;
  onCreate(): void;
  onRetry(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    composing = useRef(false);
  const [expanded, setExpanded] = useState(false),
    [fieldEditing, setFieldEditing] = useState(false),
    [tagDraft, setTagDraft] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const locked = busy || uncertain;
  const edit = (value: boolean) => {
    setFieldEditing(value);
    onFieldEditing(value);
  };
  return (
    <dialog
      ref={dialog}
      className={`task-create-dialog${expanded ? ' is-expanded' : ''}`}
      aria-label="新建任务"
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onCancel();
      }}
    >
      <form
        className="create-form task-create-compact"
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!composing.current && !fieldEditing && !tagDraft) onCreate();
        }}
      >
        <header className="create-form-header">
          <div className="create-form-context">
            <Icon name="check" size={17} />
            <span>本地工作区</span>
            <Icon name="chevron" size={13} />
            <h1>新建任务</h1>
          </div>
          <div>
            <button
              type="button"
              aria-label={expanded ? '缩小新建任务' : '展开新建任务'}
              onClick={() => setExpanded((v) => !v)}
            >
              ⤢
            </button>
            <button type="button" aria-label="取消新建任务" disabled={locked} onClick={onCancel}>
              ×
            </button>
          </div>
        </header>
        <div className="create-form-body">
          <label className="create-title-label">
            <span className="sr-only">任务名称</span>
            <input
              data-testid="task-title"
              required
              maxLength={160}
              value={title}
              placeholder="任务标题"
              disabled={locked}
              onChange={(e) => onTitle(e.target.value)}
            />
          </label>
          <div className="create-objective">
            <DraftEditor
              value={objective}
              label="任务内容"
              testId="task-objective"
              disabled={locked}
              onChange={onObjective}
              placeholder="添加说明…"
            />
            {objective.text.length > 4000 && (
              <p role="alert">超过4000字符，请精简后创建；输入仍保留。</p>
            )}
          </div>
          <fieldset className="task-create-choices" disabled={locked}>
            <legend className="sr-only">任务属性</legend>
            <label className="create-choice">
              <Icon name="check" size={16} />
              <span>状态</span>
              <select
                aria-label="任务状态"
                value={properties.status}
                onChange={(e) =>
                  onProperties({ ...properties, status: e.target.value as Task['status'] })
                }
              >
                {Object.entries(taskStatusNames).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="create-choice">
              <span aria-hidden="true">⚑</span>
              <span>优先级</span>
              <select
                aria-label="任务优先级"
                value={properties.priority}
                onChange={(e) => onProperties({ ...properties, priority: Number(e.target.value) })}
              >
                {Object.entries(taskPriorityNames).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="create-choice">
              <Icon name="person" size={16} />
              <span>负责人</span>
              <select
                aria-label="任务负责人"
                value={properties.assignee ?? ''}
                onChange={(e) => onProperties({ ...properties, assignee: e.target.value || null })}
              >
                <option value="">未分配</option>
                {[...new Set(['本人', ...assigneeSuggestions])].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div className="create-choice">
              <span>日期</span>
              <TaskDatePicker
                value={properties}
                disabled={locked}
                onEditing={edit}
                onChange={(dates) => onProperties({ ...properties, ...dates })}
              />
            </div>
            <div className="create-choice">
              <span>提醒</span>
              <ReminderDraftPicker
                value={reminder}
                disabled={locked}
                onEditing={edit}
                onChange={onReminder}
              />
            </div>
            <label className="create-choice">
              <Icon name="folder" size={16} />
              <span>项目</span>
              <select
                aria-label="所属项目"
                disabled={projectState === 'loading'}
                value={properties.matter_id}
                onChange={(e) => onProperties({ ...properties, matter_id: e.target.value })}
              >
                <option value="">独立任务</option>
                {properties.matter_id && !projects.some((p) => p.id === properties.matter_id) && (
                  <option value={properties.matter_id}>所选项目暂不可用</option>
                )}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <details className="create-choice create-tags">
              <summary>
                ♧ 标签：{properties.tags.length ? properties.tags.join('、') : '添加标签'}
              </summary>
              <div>
                <TagPicker
                  tags={properties.tags}
                  suggestions={suggestions}
                  disabled={locked}
                  onDraft={(value) => {
                    setTagDraft(value);
                    onTagDraft(value);
                  }}
                  onChange={(tags) => onProperties({ ...properties, tags })}
                />
              </div>
            </details>
          </fieldset>
          {projectState !== 'ready' && (
            <p role="status">
              {projectState === 'loading' ? '正在读取项目…' : '项目列表读取失败。'}
              {projectState === 'failed' && (
                <button type="button" onClick={onRetryProjects}>
                  重读项目列表
                </button>
              )}
            </p>
          )}
        </div>
        <footer className="create-form-footer">
          <span className="create-attachment-hint">
            <Icon name="file" size={18} />
            创建后可添加附件
          </span>
          <span className="create-form-spacer" />
          {uncertain && (
            <button type="button" disabled={busy} onClick={onRetry}>
              重试原创建请求
            </button>
          )}
          <button type="button" disabled={locked} onClick={onCancel}>
            取消
          </button>
          <button
            className="primary"
            data-testid="create-task"
            disabled={
              busy || tagDraft || fieldEditing || !title.trim() || objective.text.length > 4000
            }
          >
            {busy ? '创建中…' : uncertain ? '核对创建结果' : '创建任务'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
