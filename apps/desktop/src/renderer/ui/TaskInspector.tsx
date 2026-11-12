import ReminderEditor from './ReminderEditor';
import TaskCalendarEditor from '../features/calendar/TaskCalendarEditor';
import { useCallback, useState, useRef, type ReactNode } from 'react';
import type { Task } from '../../preload/caselite-api';
import SidebarAgent from './SidebarAgent';
import InspectorLayout from './InspectorLayout';
import InspectorCards, { type InspectorCard } from './InspectorCards';
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
  reminder,
  showCalendar = false,
  editorAssistantDock,
  cards,
  compactAi = false,
}: {
  content?: ReactNode;
  cards?: readonly InspectorCard[];
  compactAi?: boolean;
  reminder?: ReactNode;
  showCalendar?: boolean;
  editorAssistantDock?(element: HTMLDivElement | null): void;
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
  const [localReminderEditing, setLocalReminderEditing] = useState(false);
  const flags = useRef({ properties: false, calendar: false, reminder: false });
  const reportBlocked = useCallback(
    (value: boolean) => {
      flags.current.properties = value;
      setEditing(value);
      onPropertiesBlocked?.(value || flags.current.calendar || flags.current.reminder);
    },
    [onPropertiesBlocked],
  );
  const reportCalendar = useCallback(
    (value: boolean) => {
      flags.current.calendar = value;
      setCalendarEditing(value);
      onPropertiesBlocked?.(value || flags.current.properties || flags.current.reminder);
    },
    [onPropertiesBlocked],
  );
  const reportReminder = useCallback(
    (value: boolean) => {
      flags.current.reminder = value;
      setLocalReminderEditing(value);
      onPropertiesBlocked?.(value || flags.current.properties || flags.current.calendar);
    },
    [onPropertiesBlocked],
  );
  if (!task && compactAi) return <p className="empty-task-preview">选择任务后查看属性。</p>;
  if (!task)
    return (
      <aside className="task-inspector" aria-label="任务属性">
        {cards !== undefined && <InspectorCards properties={null} cards={cards} />}
      </aside>
    );
  return (
    <aside className="task-inspector" aria-label="属性与 AI 侧边栏">
      <InspectorLayout
        compact={compactAi}
        cards={cards}
        blocked={reminderEditing || editing || calendarEditing || localReminderEditing}
        properties={
          <div className="inspector-content task-inspector-content" aria-label="任务属性">
            {content}
            {onPropertiesBlocked && onTaskChanged ? (
              <TaskProperties
                task={task}
                disabled={propertiesDisabled || calendarEditing || localReminderEditing}
                suggestions={suggestions}
                assigneeSuggestions={assigneeSuggestions}
                groupTags
                reminder={
                  reminder ?? (
                    <ReminderEditor
                      compact
                      taskId={task.id}
                      disabled={propertiesDisabled || editing || calendarEditing}
                      onBlocked={reportReminder}
                    />
                  )
                }
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
            {showCalendar && onPropertiesBlocked && onTaskChanged && (
              <TaskCalendarEditor
                key={task.id}
                task={task}
                disabled={propertiesDisabled || editing}
                onBlocked={reportCalendar}
                onChanged={onTaskChanged}
              />
            )}
          </div>
        }
      >
        {editorAssistantDock ? (
          <div ref={editorAssistantDock} aria-label="正文 AI 侧栏" />
        ) : (
          <SidebarAgent
            key={task.id}
            taskId={task.id}
            taskVersion={task.version}
            blocked={reminderEditing || editing || calendarEditing || localReminderEditing}
          />
        )}
      </InspectorLayout>
    </aside>
  );
}
