import ProjectFiles from './ProjectFiles';
import ActivityList from './ActivityList';
import type { CatalogDocument, Matter, Task } from '../../../preload/caselite-api';

export default function ProjectSummary({
  project,
  tasks,
  documents,
  unavailable,
  disabled,
  onOpen,
  onProject,
}: {
  project: Matter;
  tasks: Task[];
  documents: CatalogDocument[];
  unavailable: boolean;
  disabled: boolean;
  onOpen(taskId: string): void;
  onProject?(projectId: string): void;
}) {
  const members = tasks.filter((task) => task.matter_id === project.id);
  const visible = documents.filter((doc) => doc.matter_id === project.id && !doc.archived_at);
  // 归组不修改项目版本；成员身份与版本变化也必须重读原查询。
  const refreshKey = `${project.id}:${project.version}:${project.task_count}:${members.map((task) => `${task.id}:${task.version}`).join(',')}`;
  return (
    <section className="project-summary" aria-label="项目工作摘要">
      <div className="project-summary-heading">
        <h2>工作摘要</h2>
        <span>来自本地记录</span>
      </div>
      {unavailable ? (
        <p role="status">摘要暂时无法更新，项目说明仍可查看。</p>
      ) : (
        <>
          <dl className="project-summary-counts">
            <div>
              <dt>项目任务</dt>
              <dd>{project.task_count}</dd>
            </div>
            <div>
              <dt>已完成任务</dt>
              <dd>
                {members.length === project.task_count
                  ? members.filter((task) => task.status === 'done').length
                  : '正在更新'}
              </dd>
            </div>
            <div>
              <dt>未归档文档</dt>
              <dd>{visible.length}</dd>
            </div>
          </dl>
          <div className="project-summary-records">
            <section>
              <h3>项目任务</h3>
              {members.slice(0, 3).map((task) => (
                <button key={task.id} disabled={disabled} onClick={() => onOpen(task.id)}>
                  {task.title}
                </button>
              ))}
              {!members.length && (
                <p>
                  {project.task_count
                    ? '任务列表正在更新，请稍后重读。'
                    : '还没有任务，可将已有独立任务归入此项目。'}
                </p>
              )}
            </section>
            <section>
              <h3>文档</h3>
              {visible.slice(0, 3).map((doc) => (
                <button key={doc.id} disabled={disabled} onClick={() => onOpen(doc.task_id)}>
                  {doc.title}
                </button>
              ))}
              {!visible.length && <p>还没有未归档文档。</p>}
              {!!visible.length && <p>打开关联任务的成果正文；保存不代表正式交付。</p>}
            </section>
          </div>
          <div className="project-summary-records">
            <section>
              <h3>最近登记的PDF</h3>
              <ProjectFiles key={refreshKey} projectId={project.id} disabled={disabled} compact />
            </section>
            <section>
              <h3>近期活动</h3>
              <ActivityList
                key={refreshKey}
                scope={{ type: 'project', id: project.id }}
                disabled={disabled}
                onTask={onOpen}
                onProject={onProject}
                compact
              />
            </section>
          </div>
          <p className="project-summary-boundary">
            完整记录可从上方文件、活动栏目查看；正式交付摘要尚未接入。
          </p>
        </>
      )}
    </section>
  );
}
