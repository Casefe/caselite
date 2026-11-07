import { useCallback, useState } from 'react';
import type { Task } from '../../preload/caselite-api';
import SidebarAgent from './SidebarAgent';
import TaskProjectAction from '../projects/TaskProjectAction';
import TaskProperties from './TaskProperties';
import { taskStatusNames } from './task-status';
import { taskPriorityNames } from './task-priority';
export default function TaskInspector({
  task,
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
  onProjectChanged?(task: Task, objectiveState: number[] | null): void;
  onProjectDirty?(dirty: boolean): void;
  projectDisabled?: boolean;
  suggestions?: string[];
  propertiesDisabled?: boolean;
  reminderEditing?: boolean;
  onPropertiesBlocked?(value: boolean): void;
  onTaskChanged?(task: Task, objectiveState: number[] | null): void;
}) {
  const [editing, setEditing] = useState(false);
  const reportBlocked = useCallback(
    (value: boolean) => {
      setEditing(value);
      onPropertiesBlocked?.(value);
    },
    [onPropertiesBlocked],
  );
  if (!task) return <aside className="task-inspector" aria-label="任务属性" />;
  return (
    <aside className="task-inspector" aria-label="属性与 AI 侧边栏">
      <div className="inspector-content task-inspector-content" aria-label="任务属性">
        {onPropertiesBlocked && onTaskChanged ? (
          <TaskProperties
            task={task}
            disabled={propertiesDisabled}
            suggestions={suggestions}
            groupTags
            project={
              onProjectChanged && onProjectDirty ? (
                <TaskProjectAction
                  task={task}
                  disabled={projectDisabled}
                  onChanged={onProjectChanged}
                  onDirty={onProjectDirty}
                />
              ) : undefined
            }
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
              <dt>日期</dt>
              <dd>{task.due_date ?? '未设置'}</dd>
              <dt>负责人</dt>
              <dd>本人</dd>
              <dt>项目</dt>
              <dd>{task.matter_title ?? (task.matter_id ? '已归组' : '未归组')}</dd>
            </dl>
          </details>
        )}
        <section aria-label="AI 对话" className="project-inspector-section">
          <h3>AI 对话</h3>
          <SidebarAgent taskId={task.id} blocked={reminderEditing || editing} />
        </section>
      </div>
    </aside>
  );
}
