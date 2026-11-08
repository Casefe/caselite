import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { CatalogRequest, CatalogResponse } from '@caselite/contracts';

type Plan = NonNullable<Extract<CatalogResponse, { ok: true }>['project_plan']>;
type Mutation = Extract<
  CatalogRequest,
  {
    operation: 'create_milestone' | 'update_milestone' | 'assign_milestone';
  }
>;
type Failure = Extract<CatalogResponse, { ok: false }>;
const fail = (code: Failure['code'], message: string): Failure => ({ ok: false, code, message });

export function projectMilestones(db: Database.Database, workspace: string) {
  const readProject = (id: string) =>
    db
      .prepare('SELECT archived_at FROM matters WHERE id=? AND workspace_id=?')
      .get(id, workspace) as { archived_at: string | null } | undefined;

  return {
    read(projectId: string): Plan | Failure {
      if (!readProject(projectId)) return fail('NOT_FOUND', '项目在当前工作区不可访问。');
      const milestones = db
        .prepare(
          `
        SELECT m.id,m.title,m.target_date,m.version,m.archived_at,
          count(CASE WHEN t.status <> 'canceled' THEN 1 END) AS total,
          count(CASE WHEN t.status = 'done' THEN 1 END) AS done
        FROM project_milestones m
        LEFT JOIN task_milestones a ON a.milestone_id=m.id AND a.matter_id=m.matter_id
        LEFT JOIN task_items t ON t.id=a.task_id AND t.workspace_id=?
        WHERE m.matter_id=? GROUP BY m.id
        ORDER BY m.archived_at IS NOT NULL,m.target_date IS NULL,m.target_date,m.created_at,m.id
      `,
        )
        .all(workspace, projectId) as Plan['milestones'];
      const assignments = db
        .prepare(
          `
        SELECT a.task_id,a.milestone_id FROM task_milestones a
        JOIN task_items t ON t.id=a.task_id AND t.workspace_id=? WHERE a.matter_id=?
      `,
        )
        .all(workspace, projectId) as Plan['assignments'];
      return { milestones, assignments };
    },
    // 调用方将关系、活动及回执一起提交，避免已归组但没有可核对回执。
    write(request: Mutation, now: string): string | Failure {
      const project = readProject(request.project_id);
      if (!project) return fail('NOT_FOUND', '项目在当前工作区不可访问。');
      if (project.archived_at) return fail('CONFLICT', '项目已归档，里程碑只读。');
      if (request.operation === 'create_milestone') {
        const id = randomUUID();
        db.prepare(
          'INSERT INTO project_milestones(id,matter_id,title,target_date,created_at) VALUES(?,?,?,?,?)',
        ).run(id, request.project_id, request.title, request.target_date, now);
        return id;
      }
      const milestone =
        request.milestone_id === null
          ? null
          : (db
              .prepare(
                'SELECT version,archived_at FROM project_milestones WHERE id=? AND matter_id=?',
              )
              .get(request.milestone_id, request.project_id) as
              { version: number; archived_at: string | null } | null | undefined);
      if (request.milestone_id && !milestone) return fail('NOT_FOUND', '里程碑不属于该项目。');
      if (request.operation === 'update_milestone') {
        if (milestone?.version !== request.expected_version)
          return fail('CONFLICT', '里程碑已有更新，请重新读取。');
        db.prepare(
          'UPDATE project_milestones SET title=?,target_date=?,archived_at=?,version=version+1 WHERE id=? AND matter_id=?',
        ).run(
          request.title,
          request.target_date,
          request.archived ? (milestone.archived_at ?? now) : null,
          request.milestone_id,
          request.project_id,
        );
        return request.milestone_id;
      }
      if (milestone?.archived_at) return fail('CONFLICT', '请先恢复里程碑再关联任务。');
      const task = db
        .prepare(
          `
        SELECT t.version FROM task_items t JOIN task_projects p ON p.task_id=t.id
        WHERE t.id=? AND t.workspace_id=? AND p.matter_id=?
      `,
        )
        .get(request.task_id, workspace, request.project_id) as { version: number } | undefined;
      if (!task) return fail('NOT_FOUND', '任务不属于该项目。');
      if (task.version !== request.expected_version)
        return fail('CONFLICT', '任务已有更新，请重新读取。');
      if (request.milestone_id) {
        db.prepare(
          `
          INSERT INTO task_milestones(task_id,matter_id,milestone_id) VALUES(?,?,?)
          ON CONFLICT(task_id) DO UPDATE SET milestone_id=excluded.milestone_id
        `,
        ).run(request.task_id, request.project_id, request.milestone_id);
      } else
        db.prepare('DELETE FROM task_milestones WHERE task_id=? AND matter_id=?').run(
          request.task_id,
          request.project_id,
        );
      db.prepare('UPDATE task_items SET version=version+1 WHERE id=? AND workspace_id=?').run(
        request.task_id,
        workspace,
      );
      db.prepare('INSERT INTO task_activity(id,task_id,operation,created_at) VALUES(?,?,?,?)').run(
        randomUUID(),
        request.task_id,
        'assign_milestone',
        now,
      );
      return request.task_id;
    },
  };
}
