import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  memoResponseSchema,
  memoSchema,
  type Memo,
  type MemoRequest,
  type MemoResponse,
} from '@caselite/contracts';

const columns = 'id,text,status,version,created_at,updated_at,deleted_at';
type MemoRow = {
  id: string;
  text: string;
  status: 'active' | 'done';
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
function constraint(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String((error as { code: unknown }).code).startsWith('SQLITE_CONSTRAINT')
  );
}
// 备忘只存在于当前工作区的 memos 表。不写 Document、Task 或 task_activity，避免划掉和删除污染其他对象。
export function createMemoStore(
  db: Database.Database,
  workspace: string,
  now: () => string = () => new Date().toISOString(),
) {
  const ready = () =>
    Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memos'").get());
  const unavailable = (): MemoResponse => ({
    ok: false,
    code: 'CONFLICT',
    message: '此工作区尚未升级备忘格式。',
  });
  const fail = (
    code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_REQUEST',
    message: string,
  ): MemoResponse => ({ ok: false, code, message });
  // 旧迁移夹具会打开尚未有备忘表的库。构造时不能预编译，否则升级演练无法打开 Task。
  let cached:
    | {
        one: Database.Statement;
        lists: Record<'active' | 'done' | 'deleted', Database.Statement>;
        readReceipt: Database.Statement;
        insertReceipt: Database.Statement;
      }
    | undefined;
  const statements = () => {
    if (!ready()) return undefined;
    if (cached) return cached;
    cached = {
      one: db.prepare(`SELECT ${columns} FROM memos WHERE id=? AND workspace_id=?`),
      lists: {
        active: db.prepare(
          `SELECT ${columns} FROM memos WHERE workspace_id=? AND status='active' AND deleted_at IS NULL ORDER BY updated_at DESC, id`,
        ),
        done: db.prepare(
          `SELECT ${columns} FROM memos WHERE workspace_id=? AND status='done' AND deleted_at IS NULL ORDER BY updated_at DESC, id`,
        ),
        deleted: db.prepare(
          `SELECT ${columns} FROM memos WHERE workspace_id=? AND deleted_at IS NOT NULL ORDER BY updated_at DESC, id`,
        ),
      },
      readReceipt: db.prepare(
        'SELECT digest,result FROM memo_receipts WHERE workspace_id=? AND key=?',
      ),
      insertReceipt: db.prepare(
        'INSERT INTO memo_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)',
      ),
    };
    return cached;
  };
  return {
    execute(request: MemoRequest): MemoResponse {
      const sql = statements();
      if (!sql) return unavailable();
      const load = (id: string) => {
        const row = sql.one.get(id, workspace) as MemoRow | undefined;
        return row ? memoSchema.parse(row) : undefined;
      };
      const listed = (view: keyof typeof sql.lists) =>
        (sql.lists[view].all(workspace) as MemoRow[]).map((row) => memoSchema.parse(row));
      if (request.operation === 'list')
        return { ok: true, memos: listed(request.view), receipt: null };
      if (request.operation === 'receipt') {
        const row = sql.readReceipt.get(workspace, request.idempotency_key) as
          { result: string } | undefined;
        return row
          ? memoResponseSchema.parse(JSON.parse(row.result))
          : fail('NOT_FOUND', '尚未查到原备忘提交，请保留身份核对或重试原提交。');
      }
      // 行更新和回执同事务。逻辑拒绝不记回执，这样原键仍可在核对后重试。
      return db
        .transaction((): MemoResponse => {
          const { request_id, ...content } = request;
          void request_id;
          const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
          const previous = sql.readReceipt.get(workspace, request.idempotency_key) as
            { digest: string; result: string } | undefined;
          if (previous)
            return previous.digest === digest
              ? memoResponseSchema.parse(JSON.parse(previous.result))
              : fail('CONFLICT', '该提交身份已用于不同备忘内容。');
          const stamp = now();
          const persist = (memo: Memo) => {
            const result: MemoResponse = {
              ok: true,
              memos: [memo],
              receipt: request.idempotency_key,
            };
            sql.insertReceipt.run(
              workspace,
              request.idempotency_key,
              digest,
              JSON.stringify(result),
            );
            return result;
          };
          const saved = (id: string) => {
            const memo = load(id);
            if (!memo) throw new Error('备忘写入后无法在当前工作区读取');
            return persist(memo);
          };
          if (request.operation === 'create') {
            try {
              db.prepare(
                'INSERT INTO memos(id,workspace_id,text,status,version,created_at,updated_at,deleted_at) VALUES(?,?,?,?,1,?,?,NULL)',
              ).run(request.memo_id, workspace, request.text, 'active', stamp, stamp);
            } catch (error) {
              if (constraint(error)) return fail('CONFLICT', '该备忘身份已存在。');
              throw error;
            }
            return saved(request.memo_id);
          }
          const current = load(request.memo_id);
          if (!current) return fail('NOT_FOUND', '备忘不存在或不在当前工作区。');
          if (current.version !== request.expected_version)
            return fail('CONFLICT', '备忘已有新版本，请重新读取后再提交。');
          const hit = (statement: Database.Statement, values: Array<string | number | null>) => {
            if (statement.run(...values).changes !== 1) throw new Error('备忘更新没有命中当前版本');
          };
          if (request.operation === 'recover') {
            if (!current.deleted_at) return fail('INVALID_REQUEST', '备忘未删除。');
            hit(
              db.prepare(
                'UPDATE memos SET deleted_at=NULL,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND deleted_at IS NOT NULL',
              ),
              [stamp, current.id, workspace, current.version],
            );
            return saved(current.id);
          }
          if (current.deleted_at) return fail('INVALID_REQUEST', '备忘已删除，请先恢复后再修改。');
          if (request.operation === 'delete') {
            hit(
              db.prepare(
                'UPDATE memos SET deleted_at=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND deleted_at IS NULL',
              ),
              [stamp, stamp, current.id, workspace, current.version],
            );
            return saved(current.id);
          }
          if (request.operation === 'scratch') {
            if (current.status !== 'active') return fail('INVALID_REQUEST', '备忘已划掉。');
            hit(
              db.prepare(
                "UPDATE memos SET status='done',version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND status='active' AND deleted_at IS NULL",
              ),
              [stamp, current.id, workspace, current.version],
            );
            return saved(current.id);
          }
          if (request.operation === 'restore') {
            if (current.status !== 'done') return fail('INVALID_REQUEST', '备忘仍是活跃状态。');
            hit(
              db.prepare(
                "UPDATE memos SET status='active',version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND status='done' AND deleted_at IS NULL",
              ),
              [stamp, current.id, workspace, current.version],
            );
            return saved(current.id);
          }
          hit(
            db.prepare(
              'UPDATE memos SET text=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND deleted_at IS NULL',
            ),
            [request.text, stamp, current.id, workspace, current.version],
          );
          return saved(current.id);
        })
        .immediate();
    },
  };
}
