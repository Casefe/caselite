import { useCallback, useState } from 'react';
import type { Task } from '../../preload/caselite-api';
import { Icon } from './Workspace';
import SidebarAgent from './SidebarAgent';
import TaskProjectAction from '../projects/TaskProjectAction';
import TaskProperties from './TaskProperties';
import { taskStatusNames } from './task-status';
import { taskPriorityNames } from './task-priority';
export default function TaskInspector({
  task,
  documents = false,
  onOpen,
  onProjectChanged,
  onProjectDirty,
  projectDisabled = false,
  suggestions = [],
  propertiesDisabled = false,
  reminderEditing = false,
  onPropertiesBlocked,
  onTaskChanged,
}: {
  task: Task | null;
  documents?: boolean;
  onOpen?(id: string): void;
  onProjectChanged?(task: Task, objectiveState: number[] | null): void;
  onProjectDirty?(dirty: boolean): void;
  projectDisabled?: boolean;
  suggestions?: string[];
  propertiesDisabled?: boolean;
  reminderEditing?: boolean;
  onPropertiesBlocked?(value: boolean): void;
  onTaskChanged?(task: Task, objectiveState: number[] | null): void;
}) {
  const [tab, setTab] = useState<'properties' | 'ai'>('properties');
  const [editing, setEditing] = useState(false);
  const reportBlocked = useCallback(
    (value: boolean) => {
      setEditing(value);
      onPropertiesBlocked?.(value);
    },
    [onPropertiesBlocked],
  );
  const open =
    task && onOpen && documents ? (
      <button
        className="inspector-open"
        data-testid="inspector-open"
        onClick={() => onOpen(task.id)}
      >
        <Icon name="file" size={14} />
        打开文档
        <Icon name="chevron" size={13} />
      </button>
    ) : null;
  if (!task && !documents) return <aside className="task-inspector" aria-label="任务属性" />;
  if (task && !documents)
    return (
      <aside className="task-inspector" aria-label="属性与 AI 侧边栏">
        <div className="inspector-content task-inspector-content" aria-label="任务属性">
          {onPropertiesBlocked && onTaskChanged ? (
            <TaskProperties
              task={task}
              disabled={propertiesDisabled}
              suggestions={suggestions}
              groupTags
              onBlocked={reportBlocked}
              onChanged={onTaskChanged}
            />
          ) : (
            <details className="inspector-disclosure" open>
              <summary>属性</summary>
              <dl>
                <dt>状态</dt>
                <dd>{taskStatusNames[task.status ?? 'todo']}</dd>
                <dt>优先级</dt>
                <dd>{taskPriorityNames[task.priority ?? 0]}</dd>
                <dt>普通截止日期</dt>
                <dd>{task.due_date ?? '未设置'}</dd>
              </dl>
            </details>
          )}
          {onProjectChanged && onProjectDirty && (
            <section aria-label="项目" className="project-inspector-section task-project-section">
              <h3>项目</h3>
              <TaskProjectAction
                task={task}
                disabled={projectDisabled}
                onChanged={onProjectChanged}
                onDirty={onProjectDirty}
              />
            </section>
          )}
          <section aria-label="AI 对话" className="project-inspector-section">
            <h3>AI 对话</h3>
            <SidebarAgent taskId={task.id} blocked={reminderEditing || editing} />
          </section>
        </div>
      </aside>
    );
  return (
    <aside className="task-inspector" aria-label="属性与 AI 侧边栏">
      <div className="inspector-tabs" role="tablist" aria-label="侧边栏栏目">
        <button
          role="tab"
          aria-selected={tab === 'properties'}
          onClick={() => setTab('properties')}
        >
          <Icon name="panel" size={15} /> 属性
        </button>
        <button role="tab" aria-selected={tab === 'ai'} onClick={() => setTab('ai')}>
          <Icon name="spark" size={15} /> AI 助手
        </button>
      </div>
      {!task ? (
        <div className="inspector-content inspector-empty">
          <Icon name={documents ? 'file' : 'check'} size={24} />
          <h2>选择{documents ? '文档' : '任务'}</h2>
          <p>列表有结果后，在这里查看属性与使用 AI 助手。</p>
        </div>
      ) : tab === 'properties' ? (
        <div
          className="inspector-content"
          role="tabpanel"
          aria-label={documents ? '文档属性' : '任务属性'}
        >
          <div className="inspector-heading">
            <Icon name={documents ? 'file' : 'check'} />
            <span>{documents ? '成果文档' : '当前任务'}</span>
          </div>
          <h2>
            {task.title}
            {documents ? ' · 初稿' : ''}
          </h2>
          {open}
          <p className="inspector-objective">{task.objective || '尚未填写工作目标。'}</p>
          <h3>属性</h3>
          <dl>
            <dt>关联任务</dt>
            <dd>{task.title}</dd>
            <dt>文档 ID</dt>
            <dd className="record-id">{task.document_id}</dd>
            <dt>所属项目</dt>
            <dd>{task.matter_title ?? (task.matter_id ? '已归组' : '未归组')}</dd>
            <dt>工作范围</dt>
            <dd>个人本地</dd>
            <dt>成果</dt>
            <dd>内部沟通初稿</dd>
            <dt>正文修订</dt>
            <dd>{task.body_revision}</dd>
            <dt>最近更新</dt>
            <dd>{new Date(task.updated_at).toLocaleDateString('zh-CN')}</dd>
          </dl>
          <hr />
          <div className="property-note">
            <Icon name="file" size={16} />
            <p>
              保存不代表定稿。
              <br />
              引用与结论仍需人工核对。
            </p>
          </div>
        </div>
      ) : (
        <div className="ai-inspector" role="tabpanel" aria-label="AI 助手">
          <div className="ai-heading">
            <span className="ai-symbol">
              <Icon name="spark" size={23} />
            </span>
            <h2>{documents ? '围绕关联任务工作' : '围绕当前任务工作'}</h2>
            <p>
              {documents
                ? '与关联任务共用会话，正文不会自动发送。'
                : '梳理材料、比较矛盾、协助起草。'}
            </p>
          </div>
          <div className="ai-context">
            <Icon name="check" size={15} />
            <span>{task.title}</span>
          </div>
          <SidebarAgent taskId={task.id} />
        </div>
      )}
    </aside>
  );
}
