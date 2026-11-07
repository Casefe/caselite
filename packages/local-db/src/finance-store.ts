import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import {
  financeResponseSchema,
  financeEvidenceSchema,
  type FinanceRequest,
  type FinanceResponse,
} from '@caselite/contracts';

// 只汇总有效分配，避免反复收款、冲回导致历史流水求和溢出。
const activePayments = `SELECT SUM(p.amount_cents) FROM finance_payments p
  WHERE p.installment_id=i.id AND NOT EXISTS
    (SELECT 1 FROM finance_reversals r WHERE r.payment_id=p.id)`;
const installmentBalance = `i.amount_cents-COALESCE((${activePayments}),0)`;
export const projectOutstanding = `SELECT SUM(${installmentBalance}) FROM finance_installments i
  WHERE i.project_id=m.id`;

type Success = Extract<FinanceResponse, { kind: 'ledger' }>;
type Write = Exclude<FinanceRequest, { operation: 'read' | 'status' }>;
type Ledger = NonNullable<Success['ledger']>;
const fail = (code: 'NOT_FOUND' | 'CONFLICT', message: string): FinanceResponse => ({
  ok: false,
  code,
  message,
});

const isWrite = (request: FinanceRequest): request is Write =>
  request.operation !== 'read' && request.operation !== 'status';

export function createFinanceStore(db: Database.Database, workspace: string) {
  const detail = (
    projectId: string,
    now: Date,
    ack?: { key: string; evidence: NonNullable<Success['evidence']> },
  ): Success => {
    const today = [
      String(now.getFullYear()).padStart(4, '0'),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const contract = db
      .prepare('SELECT number, amount_cents FROM finance_contracts WHERE project_id=?')
      .get(projectId) as Pick<Ledger, 'number' | 'amount_cents'> | undefined;
    let ledger: Ledger | null = null;
    if (contract) {
      const installments = db
        .prepare(
          `SELECT i.id,i.amount_cents,i.due_date,
        ${installmentBalance} AS outstanding_cents
        FROM finance_installments i WHERE i.project_id=? ORDER BY i.due_date,i.rowid`,
        )
        .all(projectId) as Ledger['installments'];
      const payments = db
        .prepare(
          `SELECT p.*,r.committed_at AS reversed_at
        FROM finance_payments p JOIN finance_installments i ON i.id=p.installment_id
        LEFT JOIN finance_reversals r ON r.payment_id=p.id
        WHERE i.project_id=? ORDER BY p.committed_at DESC,p.rowid DESC`,
        )
        .all(projectId) as Ledger['payments'];
      if (
        installments.reduce((sum, row) => sum + BigInt(row.amount_cents), 0n) !==
        BigInt(contract.amount_cents)
      )
        throw new Error('Finance contract has incomplete installments');
      ledger = {
        ...contract,
        installments,
        payments,
        outstanding_cents: installments.reduce((sum, row) => sum + row.outstanding_cents, 0),
        due_cents: installments.reduce(
          (sum, row) => sum + (row.due_date <= today ? row.outstanding_cents : 0),
          0,
        ),
      };
    }
    // 在提交前校验读回，结果损坏或缺失时整笔回滚。
    const result = financeResponseSchema.parse({
      ok: true,
      kind: 'ledger',
      project_id: projectId,
      receipt: ack?.key ?? null,
      evidence: ack?.evidence ?? null,
      today,
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ledger,
    });
    if (!result.ok || result.kind !== 'ledger' || (ack && !result.ledger))
      throw new Error('Finance readback failed');
    return result;
  };

  const findReceipt = (key: string) =>
    db
      .prepare(
        'SELECT digest,project_id,operation,target_id,activity_id FROM finance_receipts WHERE workspace_id=? AND key=?',
      )
      .get(workspace, key) as
      | {
          digest: string;
          project_id: string;
          operation: string;
          target_id: string;
          activity_id: string;
        }
      | undefined;

  function verifyReceipt(prior: NonNullable<ReturnType<typeof findReceipt>>) {
    const evidence = financeEvidenceSchema.parse(prior);
    const { project_id: projectId } = prior;
    const { activity_id: activityId, operation, target_id: targetId } = evidence;
    const activity = db
      .prepare(
        `SELECT 1 FROM catalog_activity
      WHERE id=? AND workspace_id=? AND target_id=? AND operation=?`,
      )
      .get(activityId, workspace, projectId, operation);
    const target =
      operation === 'register_contract'
        ? targetId === projectId &&
          db.prepare('SELECT 1 FROM finance_contracts WHERE project_id=?').get(projectId)
        : db
            .prepare(
              `SELECT 1 FROM finance_payments p JOIN finance_installments i ON i.id=p.installment_id
        LEFT JOIN finance_reversals r ON r.payment_id=p.id WHERE p.id=? AND i.project_id=?
        AND (? <> 'reverse_payment' OR r.payment_id IS NOT NULL)`,
            )
            .get(targetId, projectId, operation);
    if (!activity || !target) throw new Error('Finance receipt evidence missing');
    return evidence;
  }

  const execute = db.transaction((request: FinanceRequest): FinanceResponse => {
    const projectId = request.project_id;
    const project = db
      .prepare('SELECT archived_at FROM matters WHERE id=? AND workspace_id=?')
      .get(projectId, workspace) as { archived_at: string | null } | undefined;
    if (!project) return fail('NOT_FOUND', '项目不存在或不属于当前工作区。');
    const now = new Date();
    if (request.operation === 'read') return detail(projectId, now);

    const key = request.idempotency_key;
    const prior = findReceipt(key);
    if (prior && prior.project_id !== projectId)
      return fail('CONFLICT', '此提交身份不属于当前项目。');
    if (request.operation === 'status') {
      return {
        ok: true,
        kind: 'status',
        project_id: projectId,
        receipt: key,
        evidence: prior ? verifyReceipt(prior) : null,
      };
    }

    const { request_id: diagnostic, ...content } = request;
    void diagnostic;
    const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    if (prior) {
      if (prior.digest !== digest) return fail('CONFLICT', '此提交身份已用于其他内容。');
      return detail(projectId, now, { key, evidence: verifyReceipt(prior) });
    }
    if (project.archived_at) return fail('CONFLICT', '已归档项目的账本只读。');

    const committed = now.toISOString();
    let targetId = projectId;
    if (request.operation === 'register_contract') {
      if (db.prepare('SELECT 1 FROM finance_contracts WHERE project_id=?').get(projectId))
        return fail('CONFLICT', '此项目已有合同账本。');
      db.prepare('INSERT INTO finance_contracts(project_id,number,amount_cents) VALUES(?,?,?)').run(
        projectId,
        request.number,
        request.amount_cents,
      );
      const insert = db.prepare(
        'INSERT INTO finance_installments(id,project_id,amount_cents,due_date) VALUES(?,?,?,?)',
      );
      for (const row of request.installments)
        insert.run(randomUUID(), projectId, row.amount_cents, row.due_date);
    } else if (request.operation === 'record_payment') {
      const row = db
        .prepare(
          `SELECT ${installmentBalance} AS remaining FROM finance_installments i
        WHERE i.id=? AND i.project_id=?`,
        )
        .get(request.installment_id, projectId) as { remaining: number } | undefined;
      if (!row) return fail('NOT_FOUND', '当前项目没有这笔期款。');
      if (request.amount_cents > row.remaining) return fail('CONFLICT', '收款金额超过本期未收。');
      targetId = randomUUID();
      db.prepare(
        'INSERT INTO finance_payments(id,installment_id,amount_cents,committed_at) VALUES(?,?,?,?)',
      ).run(targetId, request.installment_id, request.amount_cents, committed);
    } else {
      const payment = db
        .prepare(
          `SELECT r.payment_id AS reversed FROM finance_payments p
        JOIN finance_installments i ON i.id=p.installment_id
        LEFT JOIN finance_reversals r ON r.payment_id=p.id WHERE p.id=? AND i.project_id=?`,
        )
        .get(request.payment_id, projectId) as { reversed: string | null } | undefined;
      if (!payment) return fail('NOT_FOUND', '当前项目没有这笔收款。');
      if (payment.reversed) return fail('CONFLICT', '这笔收款已冲回。');
      targetId = request.payment_id;
      db.prepare('INSERT INTO finance_reversals(payment_id,committed_at) VALUES(?,?)').run(
        request.payment_id,
        committed,
      );
    }
    const activityId = randomUUID();
    db.prepare(
      'INSERT INTO catalog_activity(id,workspace_id,target_id,operation,created_at) VALUES(?,?,?,?,?)',
    ).run(activityId, workspace, projectId, request.operation, committed);
    db.prepare(
      'INSERT INTO finance_receipts(workspace_id,key,digest,project_id,operation,target_id,activity_id) VALUES(?,?,?,?,?,?,?)',
    ).run(workspace, key, digest, projectId, request.operation, targetId, activityId);
    const saved = findReceipt(key);
    if (
      !saved ||
      saved.digest !== digest ||
      saved.project_id !== projectId ||
      saved.operation !== request.operation ||
      saved.target_id !== targetId ||
      saved.activity_id !== activityId
    )
      throw new Error('Finance receipt readback failed');
    return detail(projectId, now, { key, evidence: verifyReceipt(saved) });
  });
  return {
    execute(request: FinanceRequest) {
      // 先取得写锁，再检查余额、幂等键和归档状态。
      return isWrite(request) ? execute.immediate(request) : execute(request);
    },
  };
}
