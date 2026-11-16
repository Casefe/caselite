import { useEffect, useState } from 'react';
import type { CatalogRequest, CatalogResponse, Matter, Task } from '../../../preload/caselite-api';
import { catalogMutation } from '../../shared/data/catalogMutation';
import { StatusGlyph } from '../../ui/TaskListGlyph';

type Success = Extract<CatalogResponse, { ok: true }>;
type Plan = NonNullable<Success['project_plan']>;
type Milestone = Plan['milestones'][number];
const progress = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

const milestoneStatus = (m: Milestone) => {
  if (m.archived_at) return 'archived';
  if (m.status) return m.status;
  if (m.total > 0 && m.done === m.total) return 'completed';
  if (m.done > 0 || (m.in_progress ?? 0) > 0) return 'in_progress';
  return 'planned';
};

const milestoneStatusLabel = (m: Milestone) => {
  const s = milestoneStatus(m);
  switch (s) {
    case 'archived':
      return '已归档';
    case 'completed':
      return '已完成';
    case 'in_progress':
      return '进行中';
    case 'planned':
    default:
      return '规划中';
  }
};

const isOverdue = (m: Milestone) => {
  if (m.archived_at || m.done === m.total || !m.target_date) return false;
  const today = new Date().toISOString().slice(0, 10);
  return m.target_date < today;
};

export default function ProjectPlanning({
  project,
  tasks,
  disabled,
  pending,
  onDirty,
  execute,
  onOpenTask,
}: {
  project: Matter;
  tasks: Task[];
  disabled: boolean;
  pending: boolean;
  onDirty(value: boolean): void;
  execute(request: CatalogRequest, committed: () => void): Promise<CatalogResponse | null>;
  onOpenTask?(taskId: string): void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState<{ title: string; date: string; milestone?: Milestone } | null>(
    null,
  );
  const [target, setTarget] = useState('');
  const [assignment, setAssignment] = useState<string | null>(null);
  const revisions = tasks.map((task) => `${task.id}:${task.version}`).join(',');
  const projectId = project.id;
  useEffect(() => {
    let current = true;
    const load = async () => {
      setReading(true);
      setError('');
      try {
        const result = await window.caselite.catalog({
          operation: 'read_project_plan',
          protocol_version: 1,
          project_id: projectId,
        });
        if (!current) return;
        if (!result.ok || !result.project_plan)
          throw new Error(result.ok ? '未收到项目里程碑。' : result.message);
        setPlan(result.project_plan);
      } catch (failure) {
        if (current) setError(failure instanceof Error ? failure.message : '无法读取项目里程碑。');
      } finally {
        if (current) setReading(false);
      }
    };
    queueMicrotask(() => {
      if (current) void load();
    });
    return () => {
      current = false;
    };
  }, [projectId, refresh, revisions]);

  const unavailable =
    disabled || pending || reading || Boolean(error) || Boolean(project.archived_at);
  const selectTask = tasks.find((task) => task.id === target);
  const savedAssignment =
    plan?.assignments.find((item) => item.task_id === target)?.milestone_id ?? '';
  const nextAssignment = assignment ?? savedAssignment;
  const assignmentDirty = nextAssignment !== savedAssignment;
  const edit = (milestone?: Milestone) => {
    setDraft({ milestone, title: milestone?.title ?? '', date: milestone?.target_date ?? '' });
    onDirty(true);
  };
  const closeDraft = () => {
    setDraft(null);
    onDirty(false);
  };
  const onCommitted = () => {
    closeDraft();
    setAssignment(null);
    setRefresh((value) => value + 1);
  };
  const updateMilestone = (
    milestone: Milestone,
    title: string,
    date: string | null,
    archived: boolean,
  ) =>
    execute(
      catalogMutation({
        operation: 'update_milestone' as const,
        project_id: projectId,
        milestone_id: milestone.id,
        expected_version: milestone.version,
        title,
        target_date: date,
        archived,
      }),
      onCommitted,
    );
  const active = tasks.filter((task) => task.status !== 'canceled');
  const done = active.filter((task) => task.status === 'done').length;
  const inProgress = active.filter((task) => task.status === 'in_progress').length;
  const canceled = tasks.length - active.length;
  const progressReady = tasks.length === project.task_count;
  const percent = progress(done, active.length);
  return (
    <div className="project-planning">
      <details open className="inspector-disclosure">
        <summary>进度</summary>
        {progressReady ? (
          <>
            {active.length ? (
              <>
                <p>
                  {percent}% · {done} / {active.length} 项完成
                </p>
                <progress aria-label="项目任务完成度" value={done} max={active.length} />
              </>
            ) : (
              <p>暂无计入进度的任务。</p>
            )}
            <dl className="project-progress-counts">
              <div>
                <dt>待办</dt>
                <dd>{active.length - done - inProgress}</dd>
              </div>
              <div>
                <dt>进行中</dt>
                <dd>{inProgress}</dd>
              </div>
              <div>
                <dt>已完成</dt>
                <dd>{done}</dd>
              </div>
              <div>
                <dt>已取消</dt>
                <dd>{canceled}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p role="status">等待任务列表更新。</p>
        )}
      </details>
      <details open className="inspector-disclosure">
        <summary>里程碑</summary>
        {reading && <p role="status">正在读取里程碑…</p>}
        {error && (
          <p role="alert">
            {error}{' '}
            <button type="button" disabled={reading} onClick={() => setRefresh((n) => n + 1)}>
              重读里程碑
            </button>
          </p>
        )}
        {!project.archived_at && !draft && (
          <button type="button" disabled={unavailable || assignmentDirty} onClick={() => edit()}>
            新建里程碑
          </button>
        )}
        {draft && (
          <form
            className="project-milestone-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (unavailable || !draft.title.trim()) return;
              if (draft.milestone) {
                void updateMilestone(
                  draft.milestone,
                  draft.title,
                  draft.date || null,
                  Boolean(draft.milestone.archived_at),
                );
              } else {
                void execute(
                  catalogMutation({
                    operation: 'create_milestone' as const,
                    project_id: projectId,
                    title: draft.title,
                    target_date: draft.date || null,
                  }),
                  onCommitted,
                );
              }
            }}
          >
            <label>
              名称
              <input
                aria-label="里程碑名称"
                required
                maxLength={160}
                value={draft.title}
                disabled={unavailable}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label>
              目标日
              <input
                aria-label="里程碑目标日"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={draft.date}
                disabled={unavailable}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
              />
            </label>
            <div>
              <button type="submit" disabled={unavailable || !draft.title.trim()}>
                保存里程碑
              </button>
              <button type="button" disabled={pending} onClick={closeDraft}>
                取消
              </button>
            </div>
          </form>
        )}
        {plan && !plan.milestones.length && <p>暂无里程碑。</p>}
        {plan?.milestones.map((milestone) => {
          const milestoneTasks = tasks.filter((task) =>
            plan.assignments.some((a) => a.task_id === task.id && a.milestone_id === milestone.id),
          );
          return (
            <div className="project-milestone-row" key={milestone.id}>
              <div className="project-milestone-header">
                <strong>{milestone.title}</strong>
                <span
                  className={`project-milestone-status project-milestone-status-${milestoneStatus(milestone)}`}
                >
                  {milestoneStatusLabel(milestone)}
                </span>
              </div>
              <div className="project-milestone-meta">
                <small>
                  {milestone.target_date ? `目标日 ${milestone.target_date}` : '未设目标日'}
                  {isOverdue(milestone) && (
                    <span className="project-milestone-overdue">（已逾期）</span>
                  )}
                </small>
              </div>
              <p className="project-milestone-progress-text">
                {progress(milestone.done, milestone.total)}% · {milestone.done} / {milestone.total}{' '}
                项完成
              </p>
              <progress
                className="project-milestone-progress-bar"
                aria-label={`里程碑 ${milestone.title} 完成度`}
                value={milestone.done}
                max={milestone.total || 1}
              />
              <div
                className="project-milestone-counts"
                aria-label={`里程碑 ${milestone.title} 进度构成`}
              >
                <span>待办 {milestone.todo ?? milestone.total - milestone.done}</span>
                <span>进行中 {milestone.in_progress ?? 0}</span>
                <span>已完成 {milestone.done}</span>
                <span>已取消 {milestone.canceled ?? 0}</span>
              </div>
              <div
                className="project-milestone-tasks"
                aria-label={`里程碑 ${milestone.title} 关联任务`}
              >
                {milestoneTasks.map((task) => (
                  <div className="project-milestone-task-item" key={task.id}>
                    <StatusGlyph status={task.status} />
                    <button
                      type="button"
                      className="project-milestone-task-link"
                      onClick={() => onOpenTask?.(task.id)}
                      aria-label={`打开任务 ${task.title}`}
                    >
                      {task.title}
                    </button>
                    {task.due_date && <small>截止 {task.due_date}</small>}
                  </div>
                ))}
                {!milestoneTasks.length && (
                  <p className="project-milestone-task-empty">暂无关联任务</p>
                )}
              </div>
              {!project.archived_at && !draft && (
                <div className="project-milestone-actions">
                  <button
                    type="button"
                    disabled={unavailable || assignmentDirty}
                    onClick={() => edit(milestone)}
                    aria-label={`编辑里程碑 ${milestone.title}`}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    disabled={unavailable || assignmentDirty}
                    onClick={() =>
                      void updateMilestone(
                        milestone,
                        milestone.title,
                        milestone.target_date,
                        !milestone.archived_at,
                      )
                    }
                  >
                    {milestone.archived_at ? '恢复' : '归档'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {plan && Boolean(tasks.length) && (
          <p className="project-milestone-reconciliation">
            未关联里程碑任务：
            {tasks.filter((t) => !plan.assignments.some((a) => a.task_id === t.id)).length} /{' '}
            {tasks.length} 项
          </p>
        )}
        {!project.archived_at &&
          !draft &&
          Boolean(plan?.milestones.length) &&
          Boolean(tasks.length) && (
            <form
              className="project-milestone-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!selectTask || unavailable || nextAssignment === savedAssignment) return;
                void execute(
                  catalogMutation({
                    operation: 'assign_milestone' as const,
                    project_id: projectId,
                    task_id: selectTask.id,
                    expected_version: selectTask.version,
                    milestone_id: nextAssignment || null,
                  }),
                  onCommitted,
                );
              }}
            >
              <label>
                任务
                <select
                  aria-label="关联里程碑的任务"
                  value={target}
                  disabled={unavailable || assignmentDirty}
                  onChange={(event) => {
                    setTarget(event.target.value);
                    setAssignment(null);
                  }}
                >
                  <option value="">选择项目任务</option>
                  {tasks.map((task) => (
                    <option value={task.id} key={task.id}>
                      {task.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                里程碑
                <select
                  aria-label="关联目标里程碑"
                  value={nextAssignment}
                  disabled={unavailable || !selectTask}
                  onChange={(event) => {
                    const next = event.target.value;
                    setAssignment(next === savedAssignment ? null : next);
                    onDirty(next !== savedAssignment);
                  }}
                >
                  <option value="">无里程碑</option>
                  {plan?.milestones
                    .filter((item) => !item.archived_at || item.id === savedAssignment)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                        {item.archived_at ? '（已归档）' : ''}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={unavailable || !selectTask || nextAssignment === savedAssignment}
              >
                保存里程碑关联
              </button>
              {assignmentDirty && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setAssignment(null);
                    onDirty(false);
                  }}
                >
                  取消里程碑关联修改
                </button>
              )}
            </form>
          )}
      </details>
    </div>
  );
}
