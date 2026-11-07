import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  reminderResponseSchema,
  type Reminder,
  type ReminderRequest,
  type ReminderResponse,
} from '@caselite/contracts';

type Request = Exclude<ReminderRequest, { operation: 'resolve' }>;
export function createReminderStore(db: Database.Database, workspace: string) {
  const query = `SELECT r.id,r.task_id,t.title AS task_title,r.date,r.time,r.timezone,r.instant,r.version,r.plan_revision,r.status,r.read_at,r.updated_at,a.status AS attempt,a.attempted_at FROM reminders r JOIN task_items t ON t.id=r.task_id LEFT JOIN reminder_attempts a ON a.reminder_id=r.id AND a.plan_revision=r.plan_revision WHERE r.workspace_id=? AND t.workspace_id=?`;
  const list = (task?: string) =>
    db
      .prepare(query + (task ? ' AND r.task_id=?' : '') + ' ORDER BY r.instant,r.id')
      .all(workspace, workspace, ...(task ? [task] : [])) as Reminder[];
  const fail = (
    code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_REQUEST',
    message: string,
  ): ReminderResponse => ({ ok: false, code, message });
  const ok = (reminders: Reminder[], receipt: string | null = null): ReminderResponse => ({
    ok: true,
    reminders,
    choices: [],
    receipt,
  });
  const activity = (task: string, operation: string) =>
    db
      .prepare('INSERT INTO task_activity(id,task_id,operation,created_at) VALUES(?,?,?,?)')
      .run(randomUUID(), task, operation, new Date().toISOString());
  return {
    execute(request: Request): ReminderResponse {
      if (request.operation === 'list') return ok(list(request.task_id));
      if (request.operation === 'receipt') {
        const row = db
          .prepare('SELECT result FROM reminder_receipts WHERE workspace_id=? AND key=?')
          .get(workspace, request.idempotency_key) as { result: string } | undefined;
        return row
          ? reminderResponseSchema.parse(JSON.parse(row.result))
          : fail('NOT_FOUND', '尚未查到原提醒提交，请保留身份核对或重试原提交。');
      }
      return db.transaction((): ReminderResponse => {
        const { request_id, ...content } = request;
        void request_id;
        const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
        const previous = db
          .prepare('SELECT digest,result FROM reminder_receipts WHERE workspace_id=? AND key=?')
          .get(workspace, request.idempotency_key) as
          { digest: string; result: string } | undefined;
        if (previous)
          return previous.digest === digest
            ? reminderResponseSchema.parse(JSON.parse(previous.result))
            : fail('CONFLICT', '该提交身份已用于不同提醒内容。');
        if (
          !db
            .prepare('SELECT id FROM task_items WHERE id=? AND workspace_id=?')
            .get(request.task_id, workspace)
        )
          return fail('NOT_FOUND', '任务不存在或不在当前工作区。');
        const current = list(request.task_id)[0];
        if (
          (current &&
            (current.id !== request.reminder_id || current.version !== request.expected_version)) ||
          (!current && request.expected_version !== 0)
        )
          return fail('CONFLICT', '提醒已有新版本，请重新读取核对。');
        const now = new Date().toISOString();
        if (request.operation === 'schedule') {
          if (current)
            db.prepare(
              "UPDATE reminders SET date=?,time=?,timezone=?,instant=?,version=version+1,plan_revision=plan_revision+1,status='scheduled',read_at=NULL,updated_at=? WHERE id=?",
            ).run(request.date, request.time, request.timezone, request.instant, now, current.id);
          else
            db.prepare(
              "INSERT INTO reminders(id,workspace_id,task_id,date,time,timezone,instant,version,plan_revision,status,updated_at) VALUES(?,?,?,?,?,?,?,1,1,'scheduled',?)",
            ).run(
              request.reminder_id,
              workspace,
              request.task_id,
              request.date,
              request.time,
              request.timezone,
              request.instant,
              now,
            );
        } else {
          if (!current) return fail('NOT_FOUND', '提醒不存在，请重新读取。');
          if (request.operation === 'cancel') {
            if (current.status === 'canceled') return fail('INVALID_REQUEST', '提醒已取消。');
            db.prepare(
              "UPDATE reminders SET status='canceled',version=version+1,plan_revision=plan_revision+1,updated_at=? WHERE id=?",
            ).run(now, current.id);
          } else {
            if (current.status !== 'scheduled' || current.instant > now)
              return fail('INVALID_REQUEST', '只有已到期的当前提醒可以标记已读或未读。');
            db.prepare(
              'UPDATE reminders SET read_at=?,version=version+1,updated_at=? WHERE id=?',
            ).run(request.read ? now : null, now, current.id);
          }
        }
        activity(request.task_id, 'reminder_' + request.operation);
        const result = ok(list(request.task_id), request.idempotency_key);
        db.prepare(
          'INSERT INTO reminder_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)',
        ).run(workspace, request.idempotency_key, digest, JSON.stringify(result));
        return result;
      })();
    },
    claimDue(now: string): Reminder[] {
      // 先持久化未知尝试再调用OS；崩溃间隙宁可显示未知，不盲目重复通知。
      return db.transaction(() => {
        const due = list()
          .filter((r) => r.status === 'scheduled' && r.instant <= now && !r.attempt)
          .slice(0, 50);
        for (const r of due) {
          db.prepare(
            "INSERT INTO reminder_attempts(reminder_id,plan_revision,status,attempted_at) VALUES(?,?,'unknown',?)",
          ).run(r.id, r.plan_revision, now);
          activity(r.task_id, 'reminder_attempt');
        }
        return due;
      })();
    },
    recordAttempt(id: string, revision: number, status: 'shown' | 'failed' | 'unsupported') {
      db.transaction(() => {
        const row = list().find(
          (r) => r.id === id && r.plan_revision === revision && r.status === 'scheduled',
        );
        if (!row) return;
        const result = db
          .prepare(
            'UPDATE reminder_attempts SET status=? WHERE reminder_id=? AND plan_revision=? AND status=?',
          )
          .run(status, id, revision, 'unknown');
        if (result.changes) activity(row.task_id, 'reminder_' + status);
      })();
    },
  };
}
