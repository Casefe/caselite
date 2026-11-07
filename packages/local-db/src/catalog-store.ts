import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import {
  catalogResponseSchema,
  agentProjectFieldsSchema,
  projectAttributesSchema,
  legacyProjectType,
  type ProjectProfessionalType,
  type ProjectProfessionalFields,
  type CatalogRequest,
  type CatalogResponse,
  type Matter,
  type CatalogDocument,
  type ActivityScope,
  type ActivityEvent,
  type DiscussionScope,
} from '@caselite/contracts';
import { bodyPlainText, validateBody } from './body-schema';

type Success = Extract<CatalogResponse, { ok: true }>;
const fail = (
  code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_REQUEST',
  message: string,
): CatalogResponse => ({ ok: false, code, message });
// 与TaskStore共用连接；仅元数据/绑定在这里维护，正文写入继续复用统一Yjs校验与修订表。
export function createCatalogStore(db: Database.Database, workspace: string) {
  const projects = (properties: string | true | null = null) =>
    (
      db
        .prepare(
          `SELECT m.id,m.title,m.status,m.version,m.archived_at,m.body_id,m.body_revision,m.editor_schema,m.updated_at,m.project_type,m.assignee,m.priority,m.start_date,m.target_date,m.tags,m.professional_type,CASE WHEN ? OR m.id=? THEN m.professional_fields END AS professional_fields,(SELECT count(*) FROM task_projects p JOIN task_items t ON t.id=p.task_id WHERE p.matter_id=m.id AND t.workspace_id=m.workspace_id) AS task_count FROM matters m WHERE m.workspace_id=? ORDER BY m.updated_at DESC,m.id`,
        )
        .all(
          Number(properties === true),
          typeof properties === 'string' ? properties : null,
          workspace,
        ) as (Omit<Matter, 'attributes'> & {
        project_type: string;
        assignee: string | null;
        priority: number;
        start_date: string | null;
        target_date: string | null;
        tags: string;
        professional_type: ProjectProfessionalType | null;
        professional_fields: string | null;
      })[]
    ).map(
      ({
        project_type,
        assignee,
        priority,
        start_date,
        target_date,
        tags,
        professional_type,
        professional_fields,
        ...project
      }) => ({
        ...project,
        attributes: projectAttributesSchema.parse({
          project_type: professional_type ? legacyProjectType(professional_type) : project_type,
          ...(professional_type && professional_fields !== null ? { professional_type } : {}),
          ...(professional_fields && professional_fields !== '{}'
            ? { professional_fields: JSON.parse(professional_fields) }
            : {}),
          assignee,
          priority,
          start_date,
          target_date,
          tags: JSON.parse(tags),
        }),
      }),
    );
  const insertProject = (
    target: string,
    request: Extract<CatalogRequest, { operation: 'create_project' | 'promote_task' }>,
    now: string,
  ) => {
    const a = request.attributes ?? {
      project_type: 'general',
      assignee: null,
      priority: 0,
      start_date: null,
      target_date: null,
      tags: [],
    };
    db.prepare(
      'INSERT INTO matters(id,workspace_id,title,status,version,body_id,updated_at,project_type,assignee,priority,start_date,target_date,tags,professional_type,professional_fields) VALUES(?,?,?,?,1,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      target,
      workspace,
      request.title,
      request.status ?? 'planned',
      randomUUID(),
      now,
      a.project_type,
      a.assignee,
      a.priority,
      a.start_date,
      a.target_date,
      JSON.stringify([...new Set(a.tags)]),
      request.attributes?.professional_type ?? null,
      JSON.stringify(request.attributes?.professional_fields ?? {}),
    );
  };
  const documents = (): CatalogDocument[] =>
    (
      db
        .prepare(
          `SELECT d.id,t.id AS task_id,t.title,p.matter_id,d.body_id,d.body_revision,d.metadata_version AS version,d.archived_at,d.collection,d.tags,d.favorite,d.in_library,t.updated_at FROM documents d JOIN task_items t ON t.id=d.task_id LEFT JOIN task_projects p ON p.task_id=t.id WHERE t.workspace_id=? ORDER BY t.updated_at DESC,d.id`,
        )
        .all(workspace) as (Omit<CatalogDocument, 'tags' | 'favorite' | 'in_library'> & {
        tags: string;
        favorite: number;
        in_library: number;
      })[]
    ).map((d) => ({
      ...d,
      tags: JSON.parse(d.tags),
      favorite: !!d.favorite,
      in_library: !!d.in_library,
    }));
  const result = (
    target: string | null = null,
    receipt: string | null = null,
    state: number[] | null = null,
    properties: string | true | null = null,
  ): Success => ({
    ok: true,
    projects: projects(properties),
    documents: documents(),
    state,
    target_id: target,
    receipt,
  });
  const narrowResult = (
    target_id: string | null = null,
    receipt: string | null = null,
  ): Success => ({
    ok: true,
    projects: [],
    documents: [],
    state: null,
    target_id,
    receipt,
  });
  const discussionTarget = (scope: DiscussionScope): { archived_at: string | null } | undefined => {
    if (scope.kind === 'task_comment') {
      // 归属始终按 Task 判定；当前项目的归档只约束发布，不参与定位历史。
      return db
        .prepare(
          `SELECT m.archived_at FROM task_items t
         LEFT JOIN task_projects p ON p.task_id=t.id
         LEFT JOIN matters m ON m.id=p.matter_id AND m.workspace_id=t.workspace_id
         WHERE t.id=? AND t.workspace_id=?`,
        )
        .get(scope.task_id, workspace) as { archived_at: string | null } | undefined;
    }
    return db
      .prepare(
        `SELECT m.archived_at FROM matters m WHERE m.id=? AND m.workspace_id=?
       AND (? IS NULL OR EXISTS (
         SELECT 1 FROM project_discussion d WHERE d.matter_id=m.id AND d.id=? AND d.kind='update'
       ))`,
      )
      .get(
        scope.project_id,
        workspace,
        scope.kind === 'update_comment' ? scope.update_id : null,
        scope.kind === 'update_comment' ? scope.update_id : null,
      ) as { archived_at: string | null } | undefined;
  };
  const getProject = (id: string, properties = false) =>
    projects(properties ? id : null).find((p) => p.id === id);
  const scopeExists = (scope: ActivityScope) =>
    scope.type === 'project'
      ? !!getProject(scope.id)
      : !!db
          .prepare('SELECT id FROM task_items WHERE id=? AND workspace_id=?')
          .get(scope.id, workspace);
  const activityRows = (
    scope: ActivityScope,
    offset = 0,
    event?: { id: string; origin: string },
  ): ActivityEvent[] => {
    // 两种既有成功事件按明确来源聚合；不把诊断日志、材料登记或推测动作补写为历史。
    const rows = db
      .prepare(
        `SELECT * FROM (
      SELECT a.id,'task' AS origin,a.task_id AS target_id,'task' AS target_type,a.operation,a.created_at AS committed_at
      FROM task_activity a JOIN task_items t ON t.id=a.task_id LEFT JOIN task_projects p ON p.task_id=t.id
      WHERE t.workspace_id=@workspace AND ((@kind='task' AND t.id=@scope) OR (@kind='project' AND p.matter_id=@scope AND a.operation NOT IN ('assign_project','promote_task')))
      UNION ALL
      SELECT a.id,'catalog' AS origin,a.target_id,
        CASE WHEN a.operation IN ('create_project','promote_task','update_project','archive_project') THEN 'project'
             WHEN a.operation='assign_task' THEN 'task' ELSE 'document' END AS target_type,
        a.operation,a.created_at AS committed_at
      FROM catalog_activity a
      LEFT JOIN task_items t ON t.id=a.target_id AND t.workspace_id=a.workspace_id
      LEFT JOIN documents d ON d.id=a.target_id
      LEFT JOIN task_items dt ON dt.id=d.task_id AND dt.workspace_id=a.workspace_id
      LEFT JOIN task_projects p ON p.task_id=COALESCE(t.id,dt.id)
      WHERE a.workspace_id=@workspace
        AND ((@kind='project' AND (a.target_id=@scope OR p.matter_id=@scope))
          OR (@kind='task' AND dt.id=@scope))
    ) WHERE (@event IS NULL OR (id=@event AND origin=@origin))
    ORDER BY committed_at DESC,origin,id DESC LIMIT 21 OFFSET @offset`,
      )
      .all({
        workspace,
        kind: scope.type,
        scope: scope.id,
        event: event?.id ?? null,
        origin: event?.origin ?? null,
        offset,
      }) as Omit<ActivityEvent, 'actor' | 'recorded_version'>[];
    return rows.map((row) => ({ ...row, actor: null, recorded_version: null }));
  };
  return {
    agentProject: {
      exists(id: string) {
        return Boolean(
          db.prepare('SELECT 1 FROM matters WHERE workspace_id=? AND id=?').get(workspace, id),
        );
      },
      preview(id: string) {
        // 仅查模型允许使用的列；项目正文与专业数据不参与预览或发送。
        const row = db
          .prepare(
            `SELECT title,status,coalesce(professional_type,project_type) AS project_type,priority,target_date,version,archived_at
           FROM matters WHERE workspace_id=? AND id=?`,
          )
          .get(workspace, id) as
          ({ version: number; archived_at: string | null } & Record<string, unknown>) | undefined;
        if (!row) return undefined;
        const { version, archived_at, ...values } = row;
        const fields = agentProjectFieldsSchema.parse(values);
        const fingerprint = createHash('sha256')
          .update(JSON.stringify([workspace, id, version, archived_at, fields]))
          .digest('hex');
        return { fields, fingerprint, archived: archived_at !== null };
      },
    },
    execute(request: CatalogRequest): CatalogResponse {
      if (request.operation === 'list_discussion') {
        const { scope } = request;
        const target = discussionTarget(scope);
        if (!target) return fail('NOT_FOUND', '讨论目标在当前工作区不可访问。');
        const taskScope = scope.kind === 'task_comment';
        const before = request.before ?? Number.MAX_SAFE_INTEGER;
        const rows = db
          .prepare(
            `SELECT d.sequence AS cursor,d.id,d.committed_at,b.state
           FROM ${taskScope ? 'task_comment' : 'project_discussion'} d
           JOIN body_revisions b ON b.body_id=d.body_id AND b.revision=d.body_revision
           WHERE ${taskScope ? 'd.task_id=?' : 'd.matter_id=? AND d.kind=? AND d.update_id IS ?'}
             AND d.sequence < ?
           ORDER BY d.sequence DESC LIMIT 11`,
          )
          .all(
            ...(taskScope
              ? [scope.task_id, before]
              : [
                  scope.project_id,
                  scope.kind,
                  scope.kind === 'update_comment' ? scope.update_id : null,
                  before,
                ]),
          ) as { cursor: number; id: string; committed_at: string; state: Buffer }[];
        return {
          ...narrowResult(),
          discussion: {
            entries: rows.slice(0, 10).map(({ id, committed_at, state }) => {
              validateBody(state);
              return { id, committed_at, state: Array.from(state) };
            }),
            next: rows.length > 10 ? rows[9].cursor : null,
            ...(taskScope ? { read_only: !!target.archived_at } : {}),
          },
        };
      }
      if (request.operation === 'list_activity' || request.operation === 'activity_target') {
        if (!scopeExists(request.scope)) return fail('NOT_FOUND', '活动范围不可访问。');
        if (request.operation === 'list_activity') {
          const rows = activityRows(request.scope, request.offset);
          return { ...result(), activity: rows.slice(0, 20), activity_has_more: rows.length > 20 };
        }
        const event = activityRows(request.scope, 0, {
          id: request.event_id,
          origin: request.origin,
        })[0];
        if (!event) return fail('NOT_FOUND', '活动已不在当前范围，请重新读取。');
        const project = event.target_type === 'project' ? getProject(event.target_id) : undefined;
        const doc =
          event.target_type === 'document'
            ? documents().find((d) => d.id === event.target_id)
            : undefined;
        const task = db
          .prepare(
            `SELECT t.id,t.version,d.archived_at FROM task_items t JOIN documents d ON d.task_id=t.id WHERE t.id=? AND t.workspace_id=?`,
          )
          .get(event.target_type === 'task' ? event.target_id : (doc?.task_id ?? ''), workspace) as
          { id: string; version: number; archived_at: string | null } | undefined;
        if (
          (event.target_type === 'project' && (!project || project.archived_at)) ||
          (event.target_type === 'document' && (!doc || doc.archived_at)) ||
          (event.target_type !== 'project' && (!task || task.archived_at))
        )
          return fail('NOT_FOUND', '目标已归档或不可访问，历史记录保留。');
        return {
          ...result(),
          activity_target: {
            type: event.target_type,
            id: event.target_id,
            task_id: task?.id ?? null,
            current_version: project?.version ?? doc?.version ?? task!.version,
          },
        };
      }
      if (request.operation === 'list')
        return result(null, null, null, request.project_properties ?? null);
      if (request.operation === 'status') {
        const row = db
          .prepare('SELECT result FROM catalog_receipts WHERE workspace_id=? AND key=?')
          .get(workspace, request.idempotency_key) as { result: string } | undefined;
        return row
          ? catalogResponseSchema.parse(JSON.parse(row.result))
          : fail('NOT_FOUND', '尚未查到原提交，请保留输入并重试同一提交。');
      }
      if (request.operation === 'read_project') {
        const p = getProject(request.id);
        if (!p) return fail('NOT_FOUND', '项目不存在或不属于此工作区。');
        const row = db
          .prepare('SELECT state FROM body_revisions WHERE body_id=? AND revision=?')
          .get(p.body_id, p.body_revision) as { state: Buffer } | undefined;
        if (p.body_revision && !row) throw new Error('Missing project body');
        if (row) validateBody(row.state);
        return result(p.id, null, row ? Array.from(row.state) : null, p.id);
      }
      return db.transaction((): CatalogResponse => {
        const { request_id: diagnostic, ...content } = request;
        void diagnostic;
        const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
        const prior = db
          .prepare('SELECT digest,result FROM catalog_receipts WHERE workspace_id=? AND key=?')
          .get(workspace, request.idempotency_key) as
          { digest: string; result: string } | undefined;
        if (prior)
          return prior.digest === digest
            ? catalogResponseSchema.parse(JSON.parse(prior.result))
            : fail('CONFLICT', '同一提交身份已用于其他内容。');
        const saveReceipt = (response: Success) => {
          db.prepare(
            'INSERT INTO catalog_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)',
          ).run(workspace, request.idempotency_key, digest, JSON.stringify(response));
          return response;
        };
        if (request.operation === 'publish_discussion') {
          const { scope } = request;
          const target = discussionTarget(scope);
          if (!target) return fail('NOT_FOUND', '讨论目标在当前工作区不可访问。');
          if (target.archived_at) return fail('CONFLICT', '项目已归档，讨论只读。');
          const state = Buffer.from(request.state);
          let text: string;
          try {
            text = bodyPlainText(state).trim();
          } catch {
            return fail('INVALID_REQUEST', '讨论正文格式不支持，草稿已保留。');
          }
          if (!text || text.length > 8000)
            return fail('INVALID_REQUEST', '请输入 1 至 8000 字的讨论正文。');
          const id = randomUUID();
          const bodyId = randomUUID();
          // 任一步骤失败均回滚，避免回执或讨论条目指向未提交的正文。
          db.prepare('INSERT INTO body_revisions(body_id,revision,state) VALUES(?,1,?)').run(
            bodyId,
            state,
          );
          const now = new Date().toISOString();
          if (scope.kind === 'task_comment')
            db.prepare(
              'INSERT INTO task_comment(id,task_id,body_id,committed_at) VALUES(?,?,?,?)',
            ).run(id, scope.task_id, bodyId, now);
          else
            db.prepare(
              `INSERT INTO project_discussion(id,matter_id,kind,update_id,body_id,committed_at)
               VALUES(?,?,?,?,?,?)`,
            ).run(
              id,
              scope.project_id,
              scope.kind,
              scope.kind === 'update_comment' ? scope.update_id : null,
              bodyId,
              now,
            );
          return saveReceipt(narrowResult(id, request.idempotency_key));
        }
        let target: string;
        const now = new Date().toISOString();
        if (request.operation === 'create_project') {
          target = randomUUID();
          insertProject(target, request, now);
        } else if (request.operation === 'promote_task') {
          const task = db
            .prepare('SELECT version FROM task_items WHERE id=? AND workspace_id=?')
            .get(request.task_id, workspace) as { version: number } | undefined;
          if (!task) return fail('NOT_FOUND', '任务不在当前工作区。');
          if (task.version !== request.expected_version)
            return fail('CONFLICT', '任务已有更新，请重新打开后创建项目。');
          if (
            db.prepare('SELECT matter_id FROM task_projects WHERE task_id=?').get(request.task_id)
          )
            return fail('CONFLICT', '任务已经归入项目，请在原项目中继续。');
          // 创建、原任务关联和回执共用事务；中断时不留下空项目或复制任务。
          target = randomUUID();
          insertProject(target, request, now);
          db.prepare('INSERT INTO task_projects(task_id,matter_id) VALUES(?,?)').run(
            request.task_id,
            target,
          );
          db.prepare('UPDATE task_items SET version=version+1,updated_at=? WHERE id=?').run(
            now,
            request.task_id,
          );
          db.prepare(
            'INSERT INTO task_activity(id,task_id,operation,created_at) VALUES(?,?,?,?)',
          ).run(randomUUID(), request.task_id, 'promote_task', now);
        } else if (request.operation === 'assign_task') {
          target = request.task_id;
          const task = db
            .prepare('SELECT version FROM task_items WHERE id=? AND workspace_id=?')
            .get(target, workspace) as { version: number } | undefined;
          if (!task) return fail('NOT_FOUND', '任务不在当前工作区。');
          if (task.version !== request.expected_version)
            return fail('CONFLICT', '任务已有更新，请重读后归组。');
          if (request.matter_id) {
            const p = getProject(request.matter_id);
            if (!p || p.archived_at) return fail('NOT_FOUND', '目标项目不可用或已归档。');
            db.prepare(
              'INSERT INTO task_projects(task_id,matter_id) VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET matter_id=excluded.matter_id',
            ).run(target, request.matter_id);
          } else db.prepare('DELETE FROM task_projects WHERE task_id=?').run(target);
          db.prepare('UPDATE task_items SET version=version+1,updated_at=? WHERE id=?').run(
            now,
            target,
          );
          db.prepare(
            'INSERT INTO task_activity(id,task_id,operation,created_at) VALUES(?,?,?,?)',
          ).run(randomUUID(), target, 'assign_project', now);
        } else if (
          request.operation === 'archive_document' ||
          request.operation === 'organize_document'
        ) {
          target = request.id;
          const d = documents().find((x) => x.id === target);
          if (!d) return fail('NOT_FOUND', '文档不在当前工作区。');
          if (d.version !== request.expected_version)
            return fail('CONFLICT', '文档属性已有更新，请重新读取。');
          if (request.operation === 'archive_document')
            db.prepare(
              'UPDATE documents SET archived_at=?,metadata_version=metadata_version+1 WHERE id=?',
            ).run(request.archived ? (d.archived_at ?? now) : null, target);
          else {
            if (d.archived_at) return fail('CONFLICT', '请先恢复文档再修改分类。');
            db.prepare(
              'UPDATE documents SET collection=?,tags=?,favorite=?,in_library=?,metadata_version=metadata_version+1 WHERE id=?',
            ).run(
              request.collection,
              JSON.stringify([...new Set(request.tags)]),
              Number(request.favorite),
              Number(request.in_library),
              target,
            );
          }
        } else {
          target = request.id;
          const p = getProject(target, request.operation === 'update_project');
          if (!p) return fail('NOT_FOUND', '项目不在当前工作区。');
          if (p.version !== request.expected_version)
            return fail('CONFLICT', '项目已有更新，请重新读取。');
          if (request.operation === 'archive_project')
            db.prepare(
              'UPDATE matters SET archived_at=?,version=version+1,updated_at=? WHERE id=?',
            ).run(request.archived ? (p.archived_at ?? now) : null, now, target);
          else {
            if (p.archived_at) return fail('CONFLICT', '请先恢复项目再编辑。');
            if (p.body_revision !== request.expected_body_revision)
              return fail('CONFLICT', '说明已有新修订，输入已保留。');
            const currentType = p.attributes?.professional_type;
            if (
              currentType &&
              request.attributes &&
              request.attributes.professional_type === undefined &&
              request.attributes.project_type !== legacyProjectType(currentType)
            )
              return fail('CONFLICT', '项目已细分，请重新打开项目后更改类型。');
            if (request.state) {
              try {
                validateBody(Uint8Array.from(request.state));
              } catch {
                return fail('INVALID_REQUEST', '说明正文格式不支持，输入已保留。');
              }
              db.prepare('INSERT INTO body_revisions(body_id,revision,state) VALUES(?,?,?)').run(
                p.body_id,
                p.body_revision + 1,
                Buffer.from(request.state),
              );
            }
            // 旧请求没有属性字段时必须保留新版属性，不能按默认值回填。
            if (request.attributes) {
              const a = request.attributes;
              // 旧请求没有细分类型时保留当前细分；旧三值列只是兼容投影。
              const type =
                a.professional_type === undefined ? (currentType ?? null) : a.professional_type;
              db.prepare(
                'UPDATE matters SET project_type=?,professional_type=?,assignee=?,priority=?,start_date=?,target_date=?,tags=? WHERE id=?',
              ).run(
                type ? legacyProjectType(type) : a.project_type,
                type,
                a.assignee,
                a.priority,
                a.start_date,
                a.target_date,
                JSON.stringify([...new Set(a.tags)]),
                target,
              );
              if (a.professional_fields) {
                const previous = p.attributes?.professional_fields ?? {};
                const merged = { ...previous };
                // 仅合并提交过的字段；切换类型或旧表单省略字段都不删除已存资料。
                for (const key of Object.keys(
                  a.professional_fields,
                ) as (keyof ProjectProfessionalFields)[]) {
                  const group = a.professional_fields[key];
                  if (group) Object.assign(merged, { [key]: { ...previous[key], ...group } });
                }
                db.prepare('UPDATE matters SET professional_fields=? WHERE id=?').run(
                  JSON.stringify(merged),
                  target,
                );
              }
            }
            db.prepare(
              'UPDATE matters SET title=?,status=?,version=version+1,body_revision=?,updated_at=? WHERE id=?',
            ).run(
              request.title,
              request.status,
              p.body_revision + (request.state ? 1 : 0),
              now,
              target,
            );
          }
        }
        db.prepare(
          'INSERT INTO catalog_activity(id,workspace_id,target_id,operation,created_at) VALUES(?,?,?,?,?)',
        ).run(randomUUID(), workspace, target, request.operation, now);
        const projectWrite =
          request.operation === 'create_project' ||
          request.operation === 'promote_task' ||
          request.operation === 'update_project';
        const response = result(
          target,
          request.idempotency_key,
          null,
          projectWrite ? target : null,
        );
        return saveReceipt(response);
      })();
    },
  };
}
