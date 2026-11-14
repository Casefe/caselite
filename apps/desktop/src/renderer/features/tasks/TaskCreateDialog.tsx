import { useEffect, useRef, useState } from 'react';
import type { TaskCalendar } from '../../../preload/caselite-api';
import CreationScheduleFields from './CreationScheduleFields';
import { CreationAttachments, CreationUploadButton } from './CreationAttachments';
import type { TaskCreationAttachmentController } from './useTaskCreationAttachments';
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
  mode = 'task',
  calendar,
  onCalendar,
  attachments,
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
  error = '',
  onCancel,
  onCreate,
  onRetry,
}: {
  mode?: 'task' | 'schedule';
  calendar?: TaskCalendar;
  onCalendar?(value: TaskCalendar): void;
  attachments?: TaskCreationAttachmentController;
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
  error?: string;
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
    const previous = document.activeElement;
    element?.showModal();
    element?.querySelector<HTMLInputElement>('[data-testid="task-title"]')?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const [more, setMore] = useState(false);
  const recovery = Boolean(attachments?.draft?.task_id);
  const locked =
    busy || uncertain || Boolean(attachments?.busy) || attachments?.ready === false || recovery;
  const validCalendar =
    !calendar ||
    (window.caselite.validateTaskCalendar?.(calendar) ??
      (!calendar.schedule && !calendar.important));
  const name = mode === 'schedule' ? '新建日程' : '新建任务';
  const edit = (value: boolean) => {
    setFieldEditing(value);
    onFieldEditing(value);
  };
  return (
    <dialog
      ref={dialog}
      className={`task-create-dialog${expanded ? ' is-expanded' : ''}${mode === 'schedule' ? ' is-schedule' : ''}${more ? ' show-more' : ''}`}
      aria-label={name}
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
        onKeyDownCapture={(event) => {
          if (
            composing.current ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          ) {
            return;
          }
          if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
          if (event.repeat) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          if (
            !busy &&
            !composing.current &&
            !event.nativeEvent.isComposing &&
            !fieldEditing &&
            !tagDraft
          )
            event.currentTarget.requestSubmit();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !busy &&
            !composing.current &&
            !fieldEditing &&
            !tagDraft &&
            (recovery || (title.trim() && validCalendar)) &&
            objective.text.length <= 4000
          )
            onCreate();
        }}
      >
        <header className="create-form-header">
          <div className="create-form-context">
            <Icon name={mode === 'schedule' ? 'calendar' : 'check'} size={17} />
            <span>本地工作区</span>
            <Icon name="chevron" size={13} />
            <h1>{name}</h1>
          </div>
          <div>
            <button
              type="button"
              aria-label={`${expanded ? '缩小' : '展开'}${name}`}
              onClick={() => setExpanded((v) => !v)}
            >
              ⤢
            </button>
            <button type="button" aria-label={`取消${name}`} disabled={locked} onClick={onCancel}>
              ×
            </button>
          </div>
        </header>
        <div className="create-form-body">
          <label className="create-title-label">
            <span className="sr-only">{mode === 'schedule' ? '日程名称' : '任务名称'}</span>
            <input
              data-testid="task-title"
              required={!recovery}
              maxLength={160}
              value={title}
              placeholder={mode === 'schedule' ? '日程标题' : '任务标题'}
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
          {mode === 'schedule' && calendar?.schedule && onCalendar && (
            <CreationScheduleFields value={calendar} onChange={onCalendar} disabled={locked} />
          )}
          {mode === 'task' && calendar && onCalendar && (
            <label className="creation-planned-date">
              计划日
              <input
                type="date"
                aria-label="任务计划日"
                value={calendar.planned_date ?? ''}
                disabled={locked}
                onChange={(e) => onCalendar({ ...calendar, planned_date: e.target.value || null })}
              />
              {calendar.planned_date && (
                <button
                  type="button"
                  disabled={locked}
                  aria-label="清除任务计划日"
                  onClick={() => onCalendar({ ...calendar, planned_date: null })}
                >
                  ×
                </button>
              )}
            </label>
          )}
          <fieldset className="task-create-choices" disabled={locked}>
            <legend className="sr-only">任务属性</legend>
            <label className="create-choice create-property-extra">
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
            <label className="create-choice create-property-extra">
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
            <div className="create-choice create-property-extra">
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
          {mode === 'schedule' && (
            <button type="button" className="creation-more" onClick={() => setMore((v) => !v)}>
              {more ? '▾' : '▸'} 更多属性
            </button>
          )}
          {attachments && (
            <CreationAttachments controller={attachments} disabled={busy || uncertain} />
          )}
          {calendar && !validCalendar && (
            <p role="status">请补全同日开始、结束时间和有效时区；重要日程还需选择类型。</p>
          )}
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
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">正在创建任务…</p>}
        </div>
        <footer className="create-form-footer">
          {attachments ? (
            <>
              <CreationUploadButton controller={attachments} disabled={busy || uncertain} />
              <span className="creation-local-hint">仅保存到本机</span>
            </>
          ) : (
            <span className="create-attachment-hint">创建后可添加附件</span>
          )}
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
            aria-keyshortcuts="Meta+Enter Control+Enter"
            title={`${mode === 'schedule' ? '创建日程' : '创建任务'}（⌘ / Ctrl + Enter）`}
            data-testid="create-task"
            disabled={
              busy ||
              attachments?.busy ||
              attachments?.ready === false ||
              tagDraft ||
              fieldEditing ||
              (!recovery && (!title.trim() || !validCalendar)) ||
              objective.text.length > 4000
            }
          >
            {busy
              ? '正在保存…'
              : recovery
                ? '继续保存附件'
                : uncertain
                  ? '核对创建结果'
                  : mode === 'schedule'
                    ? '创建日程'
                    : '创建任务'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
