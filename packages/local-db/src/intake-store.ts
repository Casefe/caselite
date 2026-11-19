import { createHash, randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import {
  intakeResponseSchema,
  type CreationDraftRecord,
  type IntakeRequest,
  type IntakeResponse,
  type TaskRequest,
  type TaskResponse,
  type WorkRequest,
} from '@caselite/contracts';

type Row = Omit<WorkRequest, 'snooze_due' | 'text'> & { body: string };
type Failure = Extract<IntakeResponse, { ok: false }>;
type FailureCode = Failure['code'];

class IntakeRejected extends Error {
  constructor(readonly response: Failure) {
    super('intake rejected');
  }
}

const fail = (code: FailureCode, message: string): Failure => ({ ok: false, code, message });
const stableUuid = (seed: string) => {
  const hex = createHash('sha256').update(`caselite-intake:${seed}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const due = (status: string, until: string | null, now: string) =>
  status === 'snoozed' &&
  !!until &&
  Number.isFinite(Date.parse(until)) &&
  Date.parse(until) <= Date.parse(now);

function canonical(request: Exclude<IntakeRequest, { operation: 'list' | 'receipt' }>) {
  const common = {
    protocol_version: 1 as const,
    operation: request.operation,
    idempotency_key: request.idempotency_key,
  };
  switch (request.operation) {
    case 'submit':
      return JSON.stringify({
        ...common,
        title: request.title,
        text: request.text,
        attachment_draft_id: request.attachment_draft_id ?? null,
      });
    case 'accept_create':
      return JSON.stringify({
        ...common,
        work_request_id: request.work_request_id,
        matter_id: request.matter_id ?? null,
      });
    case 'accept_link':
      return JSON.stringify({
        ...common,
        work_request_id: request.work_request_id,
        task_id: request.task_id,
      });
    case 'reject':
      return JSON.stringify({ ...common, work_request_id: request.work_request_id });
    case 'snooze':
      return JSON.stringify({
        ...common,
        work_request_id: request.work_request_id,
        until: request.until,
      });
    case 'duplicate':
      return JSON.stringify({
        ...common,
        work_request_id: request.work_request_id,
        target: request.target,
      });
  }
}

export function unavailableIntake() {
  return {
    execute(): IntakeResponse {
      return { ok: false, code: 'CONFLICT', message: '此工作区尚未升级收件格式。' };
    },
  };
}

export function createIntakeStore(
  db: Database,
  workspace: string,
  tasks: { execute(request: TaskRequest): TaskResponse },
  materials: { creationDraft(id: string): CreationDraftRecord | undefined },
) {
  const columns = `id,title,body,source,status,attachment_draft_id,target_task_id,target_task_version,duplicate_of_request_id,snooze_until,version,updated_at`;
  const present = (row: Row, now: string): WorkRequest => {
    const { body, ...rest } = row;
    return { ...rest, text: body, snooze_due: due(row.status, row.snooze_until, now) };
  };
  const get = (id: string) =>
    db
      .prepare(`SELECT ${columns} FROM work_requests WHERE id=? AND workspace_id=?`)
      .get(id, workspace) as Row | undefined;
  const ok = (requests: WorkRequest[], receipt: string | null, taskId?: string): IntakeResponse =>
    intakeResponseSchema.parse({
      ok: true,
      requests,
      receipt,
      ...(taskId ? { task_id: taskId } : {}),
    });
  const readReceipt = (key: string) =>
    db
      .prepare('SELECT digest,result FROM work_request_receipts WHERE workspace_id=? AND key=?')
      .get(workspace, key) as { digest: string; result: string } | undefined;
  const save = (key: string, digest: string, result: IntakeResponse) => {
    db.prepare(
      'INSERT INTO work_request_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)',
    ).run(workspace, key, digest, JSON.stringify(result));
  };
  const replay = (digest: string, prior: { digest: string; result: string }) => {
    if (prior.digest !== digest)
      return fail('CONFLICT', '同一提交已经用于不同内容，请核对原结果。');
    return intakeResponseSchema.parse(JSON.parse(prior.result));
  };
  const openDraft = (draftId: string | null) => {
    if (!draftId) return null;
    const draft = materials.creationDraft(draftId);
    if (!draft || draft.state !== 'open')
      return fail('INVALID_REQUEST', '只能引用仍打开的本机附件草稿。');
    return null;
  };

  return {
    execute(request: IntakeRequest): IntakeResponse {
      if (request.operation === 'list') {
        const rows = db
          .prepare(
            `SELECT ${columns} FROM work_requests WHERE workspace_id=? ORDER BY updated_at DESC,id LIMIT 200`,
          )
          .all(workspace) as Row[];
        // 暂缓到期只计算是否该重新给人看，读取不能把状态改成已采纳。
        return ok(
          rows.map((row) => present(row, request.now)),
          null,
        );
      }
      if (request.operation === 'receipt') {
        const prior = readReceipt(request.idempotency_key);
        return prior
          ? intakeResponseSchema.parse(JSON.parse(prior.result))
          : fail('NOT_FOUND', '尚未查到该提交；请保留输入并再次核对。');
      }
      const digest = createHash('sha256').update(canonical(request)).digest('hex');
      const now = new Date().toISOString();
      // 分拣结果、原 Task 写入和回执同一事务提交；中断后两边都保持原样。
      const commit = db.transaction((): IntakeResponse => {
        const prior = readReceipt(request.idempotency_key);
        if (prior) return replay(digest, prior);
        if (request.operation === 'submit') {
          const blocked = openDraft(request.attachment_draft_id ?? null);
          if (blocked) return blocked;
          const id = randomUUID();
          db.prepare(
            `INSERT INTO work_requests(id,workspace_id,title,body,source,status,attachment_draft_id,version,created_at,updated_at) VALUES(?,?,?,?,'local_manual','pending',?,1,?,?)`,
          ).run(
            id,
            workspace,
            request.title,
            request.text,
            request.attachment_draft_id ?? null,
            now,
            now,
          );
          const result = ok([present(get(id)!, now)], request.idempotency_key);
          save(request.idempotency_key, digest, result);
          return result;
        }
        const current = get(request.work_request_id);
        if (!current) return fail('NOT_FOUND', '这条请求不存在或不在当前工作区。');
        if (current.status === 'accepted') {
          const result = ok(
            [present(current, now)],
            request.idempotency_key,
            current.target_task_id ?? undefined,
          );
          save(request.idempotency_key, digest, result);
          return result;
        }
        if (current.status !== 'pending' && current.status !== 'snoozed')
          return fail('CONFLICT', '这条请求已经分拣，不会自动变成任务。');
        // 换状态时清掉上一状态的暂缓或关联，避免已采纳仍带着到期时间。
        let next: Row = {
          ...current,
          version: current.version + 1,
          updated_at: now,
          target_task_id: null,
          target_task_version: null,
          duplicate_of_request_id: null,
          snooze_until: null,
        };
        let taskId: string | undefined;
        if (request.operation === 'accept_create' || request.operation === 'accept_link') {
          if (request.operation === 'accept_link') {
            const task = db
              .prepare('SELECT workspace_id,version FROM task_items WHERE id=?')
              .get(request.task_id) as { workspace_id: string; version: number } | undefined;
            if (!task) return fail('NOT_FOUND', '找不到可关联的任务。');
            if (task.workspace_id !== workspace) return fail('FORBIDDEN', '无权关联该任务。');
            taskId = request.task_id;
            next = {
              ...next,
              status: 'accepted',
              target_task_id: request.task_id,
              target_task_version: task.version,
            };
          } else {
            const blocked = openDraft(current.attachment_draft_id);
            if (blocked) throw new IntakeRejected(blocked);
            const created = tasks.execute({
              protocol_version: 1,
              operation: 'create',
              request_id: request.request_id,
              idempotency_key: stableUuid(current.id),
              title: current.title,
              objective: current.body,
              ...(current.attachment_draft_id
                ? { creation_draft_id: current.attachment_draft_id }
                : {}),
              ...(request.matter_id ? { matter_id: request.matter_id } : {}),
            });
            if (!created.ok) throw new IntakeRejected(fail(created.code, created.message));
            const task = created.tasks[0];
            if (!task) throw new Error('采纳未返回任务。');
            taskId = task.id;
            next = {
              ...next,
              status: 'accepted',
              target_task_id: task.id,
              target_task_version: task.version,
            };
          }
        } else if (request.operation === 'reject') {
          next = { ...next, status: 'rejected' };
        } else if (request.operation === 'snooze') {
          next = { ...next, status: 'snoozed', snooze_until: request.until };
        } else {
          if (request.target.type === 'request') {
            if (request.target.id === current.id)
              return fail('INVALID_REQUEST', '不能把请求标成它自己的重复。');
            const target = db
              .prepare('SELECT workspace_id,status FROM work_requests WHERE id=?')
              .get(request.target.id) as { workspace_id: string; status: string } | undefined;
            if (!target) return fail('NOT_FOUND', '找不到可关联的请求。');
            if (target.workspace_id !== workspace)
              return fail('FORBIDDEN', '无权把该请求标为重复。');
            if (target.status === 'duplicate')
              return fail('CONFLICT', '不能把已经标成重复的请求再串成一条链。');
            next = { ...next, status: 'duplicate', duplicate_of_request_id: request.target.id };
          } else {
            const task = db
              .prepare('SELECT workspace_id,version FROM task_items WHERE id=?')
              .get(request.target.id) as { workspace_id: string; version: number } | undefined;
            if (!task) return fail('NOT_FOUND', '找不到可关联的任务。');
            if (task.workspace_id !== workspace) return fail('FORBIDDEN', '无权关联该任务。');
            next = {
              ...next,
              status: 'duplicate',
              target_task_id: request.target.id,
              target_task_version: task.version,
            };
          }
        }
        const saved = db
          .prepare(
            `UPDATE work_requests SET status=?,target_task_id=?,target_task_version=?,duplicate_of_request_id=?,snooze_until=?,version=?,updated_at=? WHERE id=? AND workspace_id=? AND status IN ('pending','snoozed')`,
          )
          .run(
            next.status,
            next.target_task_id,
            next.target_task_version,
            next.duplicate_of_request_id,
            next.snooze_until,
            next.version,
            next.updated_at,
            current.id,
            workspace,
          );
        if (saved.changes !== 1) throw new Error('收件状态未能更新。');
        const result = ok([present(get(current.id)!, now)], request.idempotency_key, taskId);
        save(request.idempotency_key, digest, result);
        return result;
      });
      try {
        return commit.immediate();
      } catch (error) {
        if (error instanceof IntakeRejected) return error.response;
        throw error;
      }
    },
  };
}
