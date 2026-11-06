import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import {
  catalogResponseSchema,
  type CatalogRequest,
  type CatalogResponse,
  type Matter,
  type CatalogDocument,
} from '@caselite/contracts';
import { validateBody } from './body-schema';

type Success = Extract<CatalogResponse, { ok: true }>;
const fail = (
  code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_REQUEST',
  message: string,
): CatalogResponse => ({ ok: false, code, message });
// 与TaskStore共用连接；仅元数据/绑定在这里维护，正文写入继续复用统一Yjs校验与修订表。
export function createCatalogStore(db: Database.Database, workspace: string) {
  const projects = () =>
    db
      .prepare(
        `SELECT m.id,m.title,m.status,m.version,m.archived_at,m.body_id,m.body_revision,m.editor_schema,m.updated_at,(SELECT count(*) FROM task_projects p JOIN task_items t ON t.id=p.task_id WHERE p.matter_id=m.id AND t.workspace_id=m.workspace_id) AS task_count FROM matters m WHERE m.workspace_id=? ORDER BY m.updated_at DESC,m.id`,
      )
      .all(workspace) as Matter[];
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
  ): Success => ({
    ok: true,
    projects: projects(),
    documents: documents(),
    state,
    target_id: target,
    receipt,
  });
  const getProject = (id: string) => projects().find((p) => p.id === id);
  return {
    execute(request: CatalogRequest): CatalogResponse {
      if (request.operation === 'list') return result();
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
        return result(p.id, null, row ? Array.from(row.state) : null);
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
        let target: string;
        const now = new Date().toISOString();
        if (request.operation === 'create_project') {
          target = randomUUID();
          db.prepare(
            'INSERT INTO matters(id,workspace_id,title,version,body_id,updated_at) VALUES(?,?,?,1,?,?)',
          ).run(target, workspace, request.title, randomUUID(), now);
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
          db.prepare(
            'INSERT INTO matters(id,workspace_id,title,version,body_id,updated_at) VALUES(?,?,?,1,?,?)',
          ).run(target, workspace, request.title, randomUUID(), now);
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
          const p = getProject(target);
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
        const response = result(target, request.idempotency_key);
        db.prepare(
          'INSERT INTO catalog_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)',
        ).run(workspace, request.idempotency_key, digest, JSON.stringify(response));
        return response;
      })();
    },
  };
}
