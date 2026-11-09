import TaskCalendarEditor from '../features/calendar/TaskCalendarEditor';
import { useCallback, useState, useRef, type ReactNode } from 'react';
import type { Task } from '../../preload/caselite-api';
import SidebarAgent from './SidebarAgent';
import TaskProjectAction from '../features/projects/TaskProjectAction';
import TaskProperties from './TaskProperties';
import { taskStatusNames } from './task-status';
import { taskPriorityNames } from './task-priority';
export default function TaskInspector({
  task,
  onProjectChanged,
  onProjectDirty,
  projectDisabled = false,
  suggestions = [],
  assigneeSuggestions = [],
  propertiesDisabled = false,
  reminderEditing = false,
  onPropertiesBlocked,
  onTaskChanged,
  content,
}: {
  content?: ReactNode;
  task: Task | null;
  onProjectChanged?(task: Task, objectiveState: number[] | null): void;
  onProjectDirty?(dirty: boolean): void;
  projectDisabled?: boolean;
  suggestions?: string[];
  assigneeSuggestions?: string[];
  propertiesDisabled?: boolean;
  reminderEditing?: boolean;
  onPropertiesBlocked?(value: boolean): void;
  onTaskChanged?(task: Task, objectiveState: number[] | null): void;
}) {
  const [editing, setEditing] = useState(false);
  const [calendarEditing, setCalendarEditing] = useState(false);
  const flags = useRef({ properties: false, calendar: false });
  const reportBlocked = useCallback(
    (value: boolean) => {
      flags.current.properties = value;
      setEditing(value);
      onPropertiesBlocked?.(value || flags.current.calendar);
    },
    [onPropertiesBlocked],
  );
  const reportCalendar = useCallback(
    (value: boolean) => {
      flags.current.calendar = value;
      setCalendarEditing(value);
      onPropertiesBlocked?.(value || flags.current.properties);
    },
    [onPropertiesBlocked],
  );
  if (!task) return <aside className="task-inspector" aria-label="任务属性" />;
  return (
    <aside className="task-inspector" aria-label="属性与 AI 侧边栏">
      <div className="inspector-content task-inspector-content" aria-label="任务属性">
        {content}
        {onPropertiesBlocked && onTaskChanged ? (
          <TaskProperties
            task={task}
            disabled={propertiesDisabled || calendarEditing}
            suggestions={suggestions}
            assigneeSuggestions={assigneeSuggestions}
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
            <dl className="inspector-property-list">
              <div className="inspector-property-row">
                <dt className="inspector-property-label">状态</dt>
                <dd>{taskStatusNames[task.status ?? 'todo']}</dd>
              </div>
              <div className="inspector-property-row">
                <dt className="inspector-property-label">优先级</dt>
                <dd>{taskPriorityNames[task.priority ?? 0]}</dd>
              </div>
              <div className="inspector-property-row">
                <dt className="inspector-property-label">日期</dt>
                <dd>{task.due_date ?? '未设置'}</dd>
              </div>
              <div className="inspector-property-row">
                <dt className="inspector-property-label">负责人</dt>
                <dd>{task.assignee === undefined ? '本人' : (task.assignee ?? '未分配')}</dd>
              </div>
              <div className="inspector-property-row">
                <dt className="inspector-property-label">项目</dt>
                <dd>{task.matter_title ?? (task.matter_id ? '已归组' : '未归组')}</dd>
              </div>
            </dl>
          </details>
        )}
        {onPropertiesBlocked && onTaskChanged && (
          <TaskCalendarEditor
            key={task.id + ':' + task.version}
            task={task}
            disabled={propertiesDisabled || editing}
            onBlocked={reportCalendar}
            onChanged={onTaskChanged}
          />
        )}
        <section aria-label="AI 对话" className="project-inspector-section">
          <h3>AI 对话</h3>
          <SidebarAgent
            key={task.id}
            taskId={task.id}
            blocked={reminderEditing || editing || calendarEditing}
          />
        </section>
      </div>
    </aside>
  );
}
