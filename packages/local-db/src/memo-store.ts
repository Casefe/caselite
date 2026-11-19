import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  memoResponseSchema,
  type Memo,
  type MemoRequest,
  type MemoResponse,
} from '@caselite/contracts';

const rowQuery = `SELECT id,text,lifecycle,version,created_at,updated_at,scratched_at,deleted_at FROM memo_items WHERE workspace_id=?`;
export function createMemoStore(db: Database.Database, workspace: string) {
  const decode = (row: Memo): Memo => row;
  const list = (view: 'daily' | 'deleted'): Memo[] => {
    const lifecycles = view === 'daily' ? "('active','scratched')" : "('deleted')";
    return (
      db
        .prepare(`${rowQuery} AND lifecycle IN ${lifecycles} ORDER BY updated_at DESC,id`)
        .all(workspace) as Memo[]
    ).map(decode);
  };
  const get = (id: string) =>
    db.prepare(`${rowQuery} AND id=?`).get(workspace, id) as Memo | undefined;
  const fail = (
    code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_REQUEST',
    message: string,
  ): MemoResponse => ({ ok: false, code, message });
  const ok = (memos: Memo[], receipt: string | null = null): MemoResponse => ({
    ok: true,
    memos,
    receipt,
  });
  const receiptRow = (key: string) =>
    db
      .prepare('SELECT digest,result FROM memo_receipts WHERE workspace_id=? AND key=?')
      .get(workspace, key) as { digest: string; result: string } | undefined;
  return {
    execute(request: MemoRequest): MemoResponse {
      if (request.operation === 'list') return ok(list(request.view));
      if (request.operation === 'receipt') {
        const row = receiptRow(request.idempotency_key);
        return row
          ? memoResponseSchema.parse(JSON.parse(row.result))
          : fail('NOT_FOUND', '尚未找到此备忘提交，请保留原键后重试核对。');
      }
      return db
        .transaction((): MemoResponse => {
          const { request_id, ...content } = request;
          void request_id;
          const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
          const previous = receiptRow(request.idempotency_key);
          if (previous)
            return previous.digest === digest
              ? memoResponseSchema.parse(JSON.parse(previous.result))
              : fail('CONFLICT', '该提交身份已用于其他备忘内容，请核对原提交。');
          const now = new Date().toISOString();
          const current = get(request.memo_id);
          if (request.operation === 'create') {
            if (current) return fail('CONFLICT', '备忘身份已存在，不能重复创建。');
            db.prepare(
              `INSERT INTO memo_items(id,workspace_id,text,lifecycle,version,created_at,updated_at) VALUES(?,?,?,'active',1,?,?)`,
            ).run(request.memo_id, workspace, request.text.trim(), now, now);
          } else {
            if (!current) return fail('NOT_FOUND', '备忘不存在或不在当前工作区。');
            if (current.version !== request.expected_version)
              return fail('CONFLICT', '备忘已有新版本，请重新读取核对；本次输入已保留。');
            if (request.operation === 'update') {
              if (current.lifecycle !== 'active')
                return fail('INVALID_REQUEST', '只有活跃备忘可以编辑正文。');
              db.prepare(
                'UPDATE memo_items SET text=?,version=version+1,updated_at=? WHERE id=?',
              ).run(request.text.trim(), now, request.memo_id);
            } else if (request.operation === 'scratch') {
              if (current.lifecycle !== 'active')
                return fail('INVALID_REQUEST', '只有活跃备忘可以划掉。');
              db.prepare(
                `UPDATE memo_items SET lifecycle='scratched',scratched_at=?,version=version+1,updated_at=? WHERE id=?`,
              ).run(now, now, request.memo_id);
            } else if (request.operation === 'restore_scratch') {
              if (current.lifecycle !== 'scratched')
                return fail('INVALID_REQUEST', '只有已划掉备忘可以恢复为活跃。');
              db.prepare(
                `UPDATE memo_items SET lifecycle='active',scratched_at=NULL,version=version+1,updated_at=? WHERE id=?`,
              ).run(now, request.memo_id);
            } else if (request.operation === 'soft_delete') {
              if (current.lifecycle === 'deleted') return fail('INVALID_REQUEST', '备忘已删除。');
              db.prepare(
                `UPDATE memo_items SET lifecycle='deleted',deleted_at=?,version=version+1,updated_at=? WHERE id=?`,
              ).run(now, now, request.memo_id);
            } else if (request.operation === 'restore_delete') {
              if (current.lifecycle !== 'deleted')
                return fail('INVALID_REQUEST', '只有已删除备忘可以恢复。');
              db.prepare(
                `UPDATE memo_items SET lifecycle='active',deleted_at=NULL,scratched_at=NULL,version=version+1,updated_at=? WHERE id=?`,
              ).run(now, request.memo_id);
            }
          }
          const view =
            request.operation === 'restore_delete' || request.operation === 'soft_delete'
              ? 'deleted'
              : 'daily';
          const result = ok(
            request.operation === 'create' || request.operation === 'restore_delete'
              ? list('daily')
              : request.operation === 'soft_delete'
                ? list('deleted')
                : list(view),
            request.idempotency_key,
          );
          db.prepare(
            'INSERT INTO memo_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)',
          ).run(workspace, request.idempotency_key, digest, JSON.stringify(result));
          return result;
        })
        .immediate();
    },
  };
}
