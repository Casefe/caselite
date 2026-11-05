import { createHash, randomUUID } from 'node:crypto';
import { validateBody } from './body-schema';
import {
  type Task,
  type TaskRequest,
  type TaskResponse,
  taskResponseSchema,
} from '@caselite/contracts';
import { openToolchainProbe } from './connection';

type Row = Omit<Task, 'matter_id'>;
const select = `SELECT t.id,t.title,t.objective,t.version,t.updated_at,d.id AS document_id,d.body_id,d.body_revision,d.editor_schema FROM task_items t JOIN documents d ON d.task_id=t.id`;
const fail = (
  code: 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'INVALID_REQUEST',
  message: string,
): TaskResponse => ({ ok: false, code, message });
export function openTaskStore(file: string, migrations: string, workspace = 'local') {
  const connection = openToolchainProbe(file, migrations);
  const db = connection.sqlite;
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  const get = (id: string): Task | null => {
    const row = db.prepare(`${select} WHERE t.id=? AND t.workspace_id=?`).get(id, workspace) as
      Row | undefined;
    return row ? { ...row, matter_id: null } : null;
  };
  const ok = (
    tasks: Task[],
    state: number[] | null = null,
    receipt: string | null = null,
  ): TaskResponse => ({ ok: true, tasks, state, receipt });
  return {
    execute(request: TaskRequest): TaskResponse {
      if (request.operation === 'list') {
        const rows = db
          .prepare(`${select} WHERE t.workspace_id=? ORDER BY t.updated_at DESC,t.id`)
          .all(workspace) as Row[];
        return ok(rows.map((row) => ({ ...row, matter_id: null })));
      }
      if (request.operation === 'status') {
        const row = db
          .prepare('SELECT result FROM task_receipts WHERE workspace_id=? AND key=?')
          .get(workspace, request.idempotency_key) as { result: string } | undefined;
        return row
          ? taskResponseSchema.parse(JSON.parse(row.result))
          : fail('NOT_FOUND', '尚未查到该提交；请保留输入并再次核对。');
      }
      if (request.operation === 'read') {
        const task = get(request.task_id);
        if (!task) return fail('NOT_FOUND', '任务不存在或不在当前工作区。');
        if (task.editor_schema !== 1)
          return fail('CONFLICT', '正文格式版本暂不兼容，原始数据已保留。');
        const row = db
          .prepare('SELECT state FROM body_revisions WHERE body_id=? AND revision=?')
          .get(task.body_id, task.body_revision) as { state: Buffer } | undefined;
        if (task.body_revision > 0 && !row) throw new Error('Missing committed body');
        if (row) validateBody(row.state);
        return ok([task], row ? Array.from(row.state) : null);
      }
      // 幂等结果、对象/正文修订和成功事件同事务提交；异常不留下半个成功结果。
      return db.transaction((): TaskResponse => {
        const { request_id: diagnosticId, ...content } = request;
        void diagnosticId;
        const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
        const old = db
          .prepare('SELECT digest,result FROM task_receipts WHERE workspace_id=? AND key=?')
          .get(workspace, request.idempotency_key) as
          { digest: string; result: string } | undefined;
        if (old)
          return old.digest === digest
            ? taskResponseSchema.parse(JSON.parse(old.result))
            : fail('CONFLICT', '同一提交身份已用于不同内容，请核对原结果。');
        let taskId: string;
        if (request.operation === 'create') {
          taskId = randomUUID();
          const now = new Date().toISOString();
          db.prepare(
            'INSERT INTO task_items(id,workspace_id,title,objective,version,updated_at) VALUES(?,?,?,?,1,?)',
          ).run(taskId, workspace, request.title, request.objective, now);
          db.prepare(
            'INSERT INTO documents(id,task_id,body_id,body_revision,editor_schema) VALUES(?,?,?,0,1)',
          ).run(randomUUID(), taskId, randomUUID());
        } else {
          taskId = request.task_id;
          const task = get(taskId);
          if (!task) return fail('NOT_FOUND', '任务不存在或不在当前工作区。');
          if (request.operation === 'update') {
            if (task.version !== request.expected_version)
              return fail('CONFLICT', '任务已更新，请重新读取后核对。');
            db.prepare(
              'UPDATE task_items SET title=?,objective=?,version=version+1,updated_at=? WHERE id=?',
            ).run(request.title, request.objective, new Date().toISOString(), taskId);
          } else {
            if (task.document_id !== request.document_id || task.body_id !== request.body_id)
              return fail('FORBIDDEN', '正文与当前任务不匹配。');
            if (task.editor_schema !== 1 || task.body_revision !== request.expected_revision)
              return fail('CONFLICT', '正文已有新修订或格式不兼容，请核对后再保存。');
            try {
              validateBody(Uint8Array.from(request.state));
            } catch {
              return fail('INVALID_REQUEST', '正文结构或格式不支持，原修订已保留。');
            }
            const next = task.body_revision + 1;
            db.prepare('INSERT INTO body_revisions(body_id,revision,state) VALUES(?,?,?)').run(
              task.body_id,
              next,
              Buffer.from(request.state),
            );
            db.prepare('UPDATE documents SET body_revision=? WHERE id=?').run(
              next,
              task.document_id,
            );
            db.prepare('UPDATE task_items SET updated_at=? WHERE id=?').run(
              new Date().toISOString(),
              taskId,
            );
          }
        }
        const result = ok([get(taskId)!], null, request.idempotency_key);
        db.prepare(
          'INSERT INTO task_activity(id,task_id,operation,created_at) VALUES(?,?,?,?)',
        ).run(randomUUID(), taskId, request.operation, new Date().toISOString());
        db.prepare('INSERT INTO task_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)').run(
          workspace,
          request.idempotency_key,
          digest,
          JSON.stringify(result),
        );
        return result;
      })();
    },
    close() {
      db.close();
    },
  };
}
