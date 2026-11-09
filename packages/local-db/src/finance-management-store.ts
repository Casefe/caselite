import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  financeAllocationSchema,
  financeInvoiceSchema,
  financeExpenseSchema,
  financeReimbursementSchema,
  financeManagementSuccessSchema,
  financeRuleSchema,
  type FinanceManagementRequest,
  type FinanceManagementSuccess,
  type FinanceResponse,
  type FinanceRule,
  type FinanceAllocation,
} from '@caselite/contracts';
import { calculateFinanceShare } from './finance-calculation';
import { createFinanceSources } from './finance-source-store';

type Receipt = {
  digest: string;
  event_id: string;
  operation: string;
  target_id: string;
  project_id: string | null;
  value: string;
};
type AllocationRequest = Extract<
  FinanceManagementRequest,
  { operation: 'm_allocate' | 'm_preview_allocation' }
>;
const fail = (message: string): FinanceResponse => ({ ok: false, code: 'CONFLICT', message });

export function createFinanceManagementStore(db: Database.Database, workspace: string) {
  const sources = createFinanceSources(db, workspace);
  const rule = (id: string): FinanceRule => {
    const row = db
      .prepare('SELECT id,value,created_at FROM finance_rules WHERE id=? AND workspace_id=?')
      .get(id, workspace) as { id: string; value: string; created_at: string } | undefined;
    if (!row) throw new Error('当前工作区没有此提成规则。');
    return financeRuleSchema.parse({
      ...JSON.parse(row.value),
      id: row.id,
      created_at: row.created_at,
    });
  };
  const allocations = (): FinanceAllocation[] =>
    (
      db
        .prepare(
          'SELECT id,value,created_at,reversed_at FROM finance_allocations WHERE workspace_id=? ORDER BY rowid',
        )
        .all(workspace) as {
        id: string;
        value: string;
        created_at: string;
        reversed_at: string | null;
      }[]
    ).map((row) =>
      financeAllocationSchema.parse({
        ...JSON.parse(row.value),
        id: row.id,
        created_at: row.created_at,
        reversed_at: row.reversed_at,
      }),
    );
  const read = (receipt: Receipt | undefined = undefined): FinanceManagementSuccess => {
    const settings = db
      .prepare('SELECT default_rule_id,version FROM finance_settings WHERE workspace_id=?')
      .get(workspace) as { default_rule_id: string | null; version: number } | undefined;
    return financeManagementSuccessSchema.parse({
      ok: true,
      kind: 'management',
      receipt: receipt ? JSON.parse(receipt.value).request.idempotency_key : null,
      evidence: receipt
        ? { operation: receipt.operation, target_id: receipt.target_id, event_id: receipt.event_id }
        : null,
      effect: receipt ? JSON.parse(receipt.value).effect : null,
      state: {
        version: settings?.version ?? 0,
        default_rule_id: settings?.default_rule_id ?? null,
        projects: db
          .prepare(
            `SELECT m.id AS project_id,c.amount_cents,
          c.amount_cents-COALESCE((SELECT SUM(i.amount_cents-COALESCE((SELECT SUM(p.amount_cents) FROM finance_payments p WHERE p.installment_id=i.id AND NOT EXISTS(SELECT 1 FROM finance_reversals r WHERE r.payment_id=p.id)),0)) FROM finance_installments i WHERE i.project_id=m.id),0) AS received_cents,
          COALESCE((SELECT SUM(i.amount_cents-COALESCE((SELECT SUM(p.amount_cents) FROM finance_payments p WHERE p.installment_id=i.id AND NOT EXISTS(SELECT 1 FROM finance_reversals r WHERE r.payment_id=p.id)),0)) FROM finance_installments i WHERE i.project_id=m.id),0) AS outstanding_cents
          FROM matters m JOIN finance_contracts c ON c.project_id=m.id WHERE m.workspace_id=?`,
          )
          .all(workspace),
        rules: (
          db
            .prepare('SELECT id FROM finance_rules WHERE workspace_id=? ORDER BY rowid')
            .all(workspace) as { id: string }[]
        ).map((row) => rule(row.id)),
        bindings: db
          .prepare(
            'SELECT p.project_id,p.rule_id FROM finance_project_rules p JOIN matters m ON m.id=p.project_id WHERE m.workspace_id=?',
          )
          .all(workspace),
        allocations: allocations(),
        expenses: (
          db
            .prepare(
              'SELECT id,value,created_at,reversed_at FROM finance_expenses WHERE workspace_id=? ORDER BY rowid',
            )
            .all(workspace) as {
            id: string;
            value: string;
            created_at: string;
            reversed_at: string | null;
          }[]
        ).map((row) =>
          financeExpenseSchema.parse({
            ...JSON.parse(row.value),
            id: row.id,
            created_at: row.created_at,
            reversed_at: row.reversed_at,
          }),
        ),
        reimbursements: db
          .prepare('SELECT * FROM finance_reimbursements WHERE workspace_id=? ORDER BY rowid')
          .all(workspace),
        candidates: sources.candidates(),
        sources: sources.links(),
        invoices: db
          .prepare('SELECT * FROM finance_invoices WHERE workspace_id=? ORDER BY rowid')
          .all(workspace),
        payouts: db
          .prepare('SELECT * FROM finance_payouts WHERE workspace_id=? ORDER BY rowid')
          .all(workspace),
      },
    });
  };
  const receipt = (key: string): Receipt | undefined =>
    db
      .prepare(
        `SELECT r.digest,r.event_id,e.operation,e.target_id,e.project_id,e.value
    FROM finance_management_receipts r JOIN finance_management_events e ON e.id=r.event_id AND e.workspace_id=r.workspace_id
    WHERE r.workspace_id=? AND r.key=?`,
      )
      .get(workspace, key) as Receipt | undefined;
  const verify = (proof: Receipt) => {
    const stored = JSON.parse(proof.value);
    const request = stored.request as FinanceManagementRequest;
    if (request.operation !== proof.operation || !('idempotency_key' in request))
      throw new Error('财务回执内容不匹配。');
    if ('request_id' in request) {
      const { request_id, ...content } = request;
      void request_id;
      if (createHash('sha256').update(JSON.stringify(content)).digest('hex') !== proof.digest)
        throw new Error('财务回执摘要不匹配。');
    }
    const table =
      request.operation === 'm_prepare_source' || request.operation === 'm_dismiss_candidate'
        ? 'finance_candidates'
        : request.operation === 'm_record_expense' || request.operation === 'm_reverse_expense'
          ? 'finance_expenses'
          : request.operation === 'm_record_reimbursement' ||
              request.operation === 'm_reverse_reimbursement'
            ? 'finance_reimbursements'
            : request.operation === 'm_record_invoice' || request.operation === 'm_red_invoice'
              ? 'finance_invoices'
              : request.operation === 'm_save_rule'
                ? 'finance_rules'
                : request.operation === 'm_allocate' || request.operation === 'm_reverse_allocation'
                  ? 'finance_allocations'
                  : request.operation === 'm_record_payout' ||
                      request.operation === 'm_reverse_payout'
                    ? 'finance_payouts'
                    : null;
    if (
      table &&
      !db
        .prepare(`SELECT 1 FROM ${table} WHERE id=? AND workspace_id=?`)
        .get(proof.target_id, workspace)
    )
      throw new Error('财务回执目标缺失。');
    if (
      proof.project_id &&
      !db
        .prepare('SELECT 1 FROM matters WHERE id=? AND workspace_id=?')
        .get(proof.project_id, workspace)
    )
      throw new Error('财务回执项目不匹配。');
    if (request.operation === 'm_set_default') {
      const settings = db
        .prepare('SELECT version FROM finance_settings WHERE workspace_id=? AND id=?')
        .get(workspace, proof.target_id) as { version: number } | undefined;
      if (
        !settings ||
        settings.version < stored.effect.version ||
        stored.effect.default_rule_id !== request.rule_id ||
        stored.effect.version !== request.expected_version + 1
      )
        throw new Error('默认规则历史凭据缺失。');
    }
    if (
      request.operation === 'm_bind_rule' &&
      (proof.target_id !== request.project_id ||
        stored.effect.project_id !== request.project_id ||
        stored.effect.rule_id !== request.rule_id)
    )
      throw new Error('项目规则历史凭据不一致。');
    if (table) {
      if ('source' in request && request.source && 'project_id' in request)
        sources.verify(
          request.source.candidate_id,
          request.project_id,
          request.operation,
          proof.target_id,
        );
      const current = effect(request, proof.target_id);
      if (request.operation.startsWith('m_reverse_')) {
        if (!current.reversed_at || current.reversed_at !== stored.effect.reversed_at)
          throw new Error('冲回凭据缺失。');
      } else {
        // 后续允许追加冲回，但原金额、归属、规则和输入快照必须仍与原回执完全一致。
        const { reversed_at: currentReversal, ...actual } = current;
        const { reversed_at: originalReversal, ...original } = stored.effect;
        void currentReversal;
        void originalReversal;
        if (JSON.stringify(actual) !== JSON.stringify(original))
          throw new Error('原财务对象与回执不一致。');
      }
    }
    return proof;
  };
  function effect(request: FinanceManagementRequest, targetId: string): Record<string, unknown> {
    const value = rawEffect(request, targetId);
    const source = sources.forTarget(targetId);
    return source ? { ...value, source_candidate_id: source.candidate_id } : value;
  }
  function rawEffect(request: FinanceManagementRequest, targetId: string): Record<string, unknown> {
    if (request.operation === 'm_prepare_source')
      return sources.immutable(sources.candidate(targetId));
    if (request.operation === 'm_dismiss_candidate')
      return {
        ...sources.immutable(sources.candidate(targetId)),
        status: sources.candidate(targetId).status,
      };
    if (request.operation === 'm_save_rule') return { ...rule(targetId) };
    if (request.operation === 'm_record_expense' || request.operation === 'm_reverse_expense') {
      const row = db
        .prepare(
          'SELECT id,value,created_at,reversed_at FROM finance_expenses WHERE id=? AND workspace_id=?',
        )
        .get(targetId, workspace) as
        { id: string; value: string; created_at: string; reversed_at: string | null } | undefined;
      if (!row) throw new Error('支出未读回。');
      return financeExpenseSchema.parse({
        ...JSON.parse(row.value),
        id: row.id,
        created_at: row.created_at,
        reversed_at: row.reversed_at,
      });
    }
    if (
      request.operation === 'm_record_reimbursement' ||
      request.operation === 'm_reverse_reimbursement'
    )
      return financeReimbursementSchema.parse(
        db
          .prepare('SELECT * FROM finance_reimbursements WHERE id=? AND workspace_id=?')
          .get(targetId, workspace),
      );
    if (request.operation === 'm_record_invoice' || request.operation === 'm_red_invoice')
      return financeInvoiceSchema.parse(
        db
          .prepare('SELECT * FROM finance_invoices WHERE id=? AND workspace_id=?')
          .get(targetId, workspace),
      );
    if (request.operation === 'm_allocate' || request.operation === 'm_reverse_allocation') {
      const row = allocations().find((row) => row.id === targetId);
      if (!row) throw new Error('结算分配未读回。');
      return { ...row };
    }
    if (request.operation === 'm_record_payout' || request.operation === 'm_reverse_payout') {
      const row = db
        .prepare(
          'SELECT id,project_id,allocation_id,amount_cents,occurred_on,note,created_at,reversed_at FROM finance_payouts WHERE id=? AND workspace_id=?',
        )
        .get(targetId, workspace);
      if (!row) throw new Error('到账未读回。');
      return row as Record<string, unknown>;
    }
    if (request.operation === 'm_set_default') {
      const row = db
        .prepare('SELECT id,version,default_rule_id FROM finance_settings WHERE workspace_id=?')
        .get(workspace) as
        { id: string; version: number; default_rule_id: string | null } | undefined;
      if (
        !row ||
        row.id !== targetId ||
        row.version !== request.expected_version + 1 ||
        row.default_rule_id !== request.rule_id
      )
        throw new Error('默认规则未落盘。');
      return { ...row };
    }
    if (request.operation === 'm_bind_rule') {
      const row = read().state.bindings.find((row) => row.project_id === request.project_id);
      if (row?.rule_id !== request.rule_id) throw new Error('项目规则未落盘。');
      return { ...row };
    }
    throw new Error('无可核对的操作。');
  }
  const checkProject = (id: string) => {
    const row = db
      .prepare('SELECT archived_at FROM matters WHERE id=? AND workspace_id=?')
      .get(id, workspace) as { archived_at: string | null } | undefined;
    if (!row || row.archived_at) throw new Error('项目不存在、已归档或不属于当前工作区。');
  };
  const preview = (request: AllocationRequest) => {
    checkProject(request.project_id);
    const selected = rule(request.rule_id);
    const bound = db
      .prepare('SELECT rule_id FROM finance_project_rules WHERE project_id=?')
      .get(request.project_id) as { rule_id: string } | undefined;
    if (bound?.rule_id !== selected.id) throw new Error('项目规则已变更，请重新读取后核对。');
    const payment = db
      .prepare(
        `SELECT p.amount_cents,p.installment_id FROM finance_payments p
      JOIN finance_installments i ON i.id=p.installment_id WHERE p.id=? AND i.project_id=?
      AND NOT EXISTS(SELECT 1 FROM finance_reversals r WHERE r.payment_id=p.id)`,
      )
      .get(request.payment_id, request.project_id) as
      { amount_cents: number; installment_id: string } | undefined;
    if (!payment || payment.amount_cents > 1_000_000_000_000)
      throw new Error('回款不可结算或超出本轮可结算金额上限。');
    const all = allocations();
    if (all.some((row) => row.payment_id === request.payment_id && !row.reversed_at))
      throw new Error('这笔回款已有结算分配，不可重复确认。');
    if (request.occurred_on < selected.effective_date)
      throw new Error('本次结算日期早于规则生效日。');
    const annual = selected.method.startsWith('annual_');
    const previous = all.filter(
      (row) =>
        !row.reversed_at &&
        row.rule_id === selected.id &&
        (annual || row.project_id === request.project_id),
    );
    if (
      annual &&
      (Number(request.occurred_on.slice(0, 4)) !== selected.annual_year ||
        previous.some((row) => row.occurred_on > request.occurred_on))
    )
      throw new Error('年度规则不适用于本次日期，或存在较晚的已确认年度分配。');
    const previousBase = previous.reduce(
      (sum, row) => sum + row.distributable_cents,
      annual ? selected.opening_base_cents : 0,
    );
    const previousFirm = previous.reduce(
      (sum, row) => sum + row.firm_cents,
      annual ? selected.opening_firm_cents : 0,
    );
    const result = calculateFinanceShare(selected, {
      base: payment.amount_cents,
      tax: request.pre_tax_cents,
      cost: request.pre_cost_cents,
      post: request.post_deduction_cents,
      previousBase,
      previousFirm,
    });
    return {
      project_id: request.project_id,
      installment_id: payment.installment_id,
      payment_id: request.payment_id,
      rule_id: selected.id,
      base_cents: payment.amount_cents,
      pre_tax_cents: request.pre_tax_cents,
      pre_cost_cents: request.pre_cost_cents,
      post_deduction_cents: request.post_deduction_cents,
      ...result,
      occurred_on: request.occurred_on,
      note: request.note,
    };
  };
  const execute = db.transaction(
    (
      request: FinanceManagementRequest,
      parse?: (
        text: string,
      ) => Pick<
        ReturnType<typeof sources.candidate>,
        'kind' | 'amount_options' | 'date_options' | 'reference'
      >,
    ): FinanceResponse => {
      if (request.operation === 'm_read') return read();
      if (request.operation === 'm_preview_allocation') {
        try {
          const value = preview(request);
          return {
            ...read(),
            preview: value,
            preview_digest: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
          };
        } catch (error) {
          return fail((error as Error).message);
        }
      }
      const prior = receipt(request.idempotency_key);
      if (request.operation === 'm_status') return read(prior ? verify(prior) : undefined);
      const { request_id, ...content } = request;
      void request_id;
      const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
      if (prior)
        return prior.digest === digest
          ? read(verify(prior))
          : fail('此提交身份已用于其他财务内容。');
      if (
        db
          .prepare('SELECT 1 FROM finance_receipts WHERE workspace_id=? AND key=?')
          .get(workspace, request.idempotency_key)
      )
        return fail('此提交身份已用于合同或收款，请核对原提交。');
      if ('project_id' in request) {
        try {
          checkProject(request.project_id);
        } catch (error) {
          return fail((error as Error).message);
        }
      }
      if ('source' in request && request.source && 'project_id' in request) {
        try {
          sources.check(request.project_id, request.source);
        } catch (error) {
          return fail((error as Error).message);
        }
      }
      const now = new Date().toISOString();
      let targetId: string = randomUUID();
      let preparedSnapshot: string | undefined;
      let expectedReimbursementParties: { from_party: string; to_party: string } | undefined;
      let expectedAllocation: ReturnType<typeof preview> | undefined;
      if (request.operation === 'm_prepare_source') {
        if (!parse) throw new Error('本机候选提取器不可用。');
        const prepared = sources.prepare(request, parse, now);
        targetId = prepared.id;
        preparedSnapshot = JSON.stringify(prepared);
      } else if (request.operation === 'm_dismiss_candidate') {
        sources.dismiss(request.project_id, request.candidate_id);
        targetId = request.candidate_id;
      } else if (request.operation === 'm_save_rule') {
        const values = request.values;
        if (values.method === 'net_lawyer' && values.settlement_trigger === 'receipt')
          return fail('净额分成需先核定扣项，不能按回款直接分成。');
        if (values.method.startsWith('annual_')) {
          if (!values.annual_data_confirmed) return fail('年度初始数据须完整核定后才能保存。');
          const exists = db
            .prepare(
              `SELECT 1 FROM finance_rules WHERE workspace_id=? AND json_extract(value,'$.firm_name')=?
          AND json_extract(value,'$.annual_year')=? AND json_extract(value,'$.method') LIKE 'annual_%'`,
            )
            .get(workspace, values.firm_name, values.annual_year);
          if (exists) return fail('同一律所和年度已有累计规则；不能另建计数器重复享受阶梯或封顶。');
          try {
            calculateFinanceShare(
              { ...values, id: targetId, created_at: now },
              {
                base: 0,
                tax: 0,
                cost: 0,
                post: 0,
                previousBase: values.opening_base_cents,
                previousFirm: values.opening_firm_cents,
              },
            );
          } catch (error) {
            return fail((error as Error).message);
          }
        }
        db.prepare(
          'INSERT INTO finance_rules(id,workspace_id,value,created_at) VALUES(?,?,?,?)',
        ).run(targetId, workspace, JSON.stringify(values), now);
        rule(targetId);
      } else if (request.operation === 'm_set_default') {
        if (request.rule_id) rule(request.rule_id);
        const state = read().state;
        if (state.version !== request.expected_version)
          return fail('财务设置已更新，请重新读取；当前输入保留。');
        const entity = db
          .prepare('SELECT id FROM finance_settings WHERE workspace_id=?')
          .get(workspace) as { id: string } | undefined;
        targetId = entity?.id ?? targetId;
        db.prepare(
          `INSERT INTO finance_settings(workspace_id,id,default_rule_id,version) VALUES(?,?,?,?)
        ON CONFLICT(workspace_id) DO UPDATE SET default_rule_id=excluded.default_rule_id,version=excluded.version`,
        ).run(workspace, targetId, request.rule_id, state.version + 1);
      } else if (request.operation === 'm_bind_rule') {
        rule(request.rule_id);
        const previous = db
          .prepare('SELECT rule_id FROM finance_project_rules WHERE project_id=?')
          .get(request.project_id) as { rule_id: string } | undefined;
        if ((previous?.rule_id ?? null) !== request.expected_rule_id)
          return fail('此案件规则已被其他操作修改，请重新核对。');
        db.prepare(
          `INSERT INTO finance_project_rules(project_id,rule_id) VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET rule_id=excluded.rule_id`,
        ).run(request.project_id, request.rule_id);
        targetId = request.project_id;
      } else if (
        request.operation === 'm_record_invoice' ||
        request.operation === 'm_red_invoice'
      ) {
        if (
          !db
            .prepare('SELECT 1 FROM finance_installments WHERE id=? AND project_id=?')
            .get(request.installment_id, request.project_id)
        )
          return fail('当前项目没有这笔期款。');
        if (
          db
            .prepare('SELECT 1 FROM finance_invoices WHERE workspace_id=? AND invoice_number=?')
            .get(workspace, request.invoice_number)
        )
          return fail('此票号已登记，请查看原记录。');
        if (request.operation === 'm_red_invoice') {
          const original = db
            .prepare(
              "SELECT * FROM finance_invoices WHERE id=? AND project_id=? AND workspace_id=? AND kind='invoice'",
            )
            .get(request.original_invoice_id, request.project_id, workspace) as
            { amount_cents: number; installment_id: string; occurred_on: string } | undefined;
          if (
            !original ||
            original.installment_id !== request.installment_id ||
            request.occurred_on < original.occurred_on
          )
            return fail('原发票、期款或日期不匹配。');
          const credited = db
            .prepare(
              'SELECT COALESCE(SUM(amount_cents),0) n FROM finance_invoices WHERE original_invoice_id=? AND workspace_id=?',
            )
            .get(request.original_invoice_id, workspace) as { n: number };
          if (request.amount_cents > original.amount_cents - credited.n)
            return fail('红字金额超过原发票尚未冲红金额。');
        }
        db.prepare(
          'INSERT INTO finance_invoices(id,workspace_id,project_id,installment_id,invoice_number,kind,original_invoice_id,amount_cents,occurred_on,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        ).run(
          targetId,
          workspace,
          request.project_id,
          request.installment_id,
          request.invoice_number,
          request.operation === 'm_record_invoice' ? 'invoice' : 'red_invoice',
          'original_invoice_id' in request ? request.original_invoice_id : null,
          request.amount_cents,
          request.occurred_on,
          request.note,
          now,
        );
      } else if (request.operation === 'm_record_expense') {
        if (request.reimbursable && request.payer === request.bearer)
          return fail('付款人与承担方相同，不形成待报销。');
        const { operation, protocol_version, request_id, idempotency_key, source, ...value } =
          request;
        void source;
        void operation;
        void protocol_version;
        void request_id;
        void idempotency_key;
        db.prepare(
          'INSERT INTO finance_expenses(id,workspace_id,project_id,value,created_at) VALUES(?,?,?,?,?)',
        ).run(targetId, workspace, request.project_id, JSON.stringify(value), now);
      } else if (request.operation === 'm_record_reimbursement') {
        const expense = read().state.expenses.find(
          (row) =>
            row.id === request.expense_id &&
            row.project_id === request.project_id &&
            !row.reversed_at,
        );
        if (!expense || !expense.reimbursable) return fail('没有本案可报销的有效垫付。');
        const reimbursed = db
          .prepare(
            'SELECT COALESCE(SUM(amount_cents),0) n FROM finance_reimbursements WHERE workspace_id=? AND expense_id=? AND reversed_at IS NULL',
          )
          .get(workspace, expense.id) as { n: number };
        if (request.amount_cents > expense.amount_cents - reimbursed.n)
          return fail('报销金额超过该垫付尚未报销金额。');
        if (request.occurred_on < expense.occurred_on)
          return fail('报销日期早于支出日期，请核对。');
        expectedReimbursementParties = { from_party: expense.bearer, to_party: expense.payer };
        db.prepare(
          'INSERT INTO finance_reimbursements(id,workspace_id,project_id,expense_id,amount_cents,occurred_on,note,from_party,to_party,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        ).run(
          targetId,
          workspace,
          request.project_id,
          expense.id,
          request.amount_cents,
          request.occurred_on,
          request.note,
          expense.bearer,
          expense.payer,
          now,
        );
      } else if (request.operation === 'm_reverse_expense') {
        const expense = read().state.expenses.find(
          (row) =>
            row.id === request.expense_id &&
            row.project_id === request.project_id &&
            !row.reversed_at,
        );
        if (!expense) return fail('没有本案有效的支出。');
        if (
          db
            .prepare(
              'SELECT 1 FROM finance_reimbursements WHERE expense_id=? AND workspace_id=? AND reversed_at IS NULL',
            )
            .get(expense.id, workspace)
        )
          return fail('请先冲回本项支出关联的报销登记。');
        targetId = expense.id;
        db.prepare('UPDATE finance_expenses SET reversed_at=? WHERE id=?').run(now, targetId);
      } else if (request.operation === 'm_reverse_reimbursement') {
        const row = db
          .prepare(
            'SELECT id FROM finance_reimbursements WHERE id=? AND workspace_id=? AND project_id=? AND reversed_at IS NULL',
          )
          .get(request.reimbursement_id, workspace, request.project_id);
        if (!row) return fail('没有本案有效的报销登记。');
        targetId = request.reimbursement_id;
        db.prepare('UPDATE finance_reimbursements SET reversed_at=? WHERE id=?').run(now, targetId);
      } else if (request.operation === 'm_allocate') {
        let value: ReturnType<typeof preview>;
        try {
          value = preview(request);
        } catch (error) {
          return fail((error as Error).message);
        }
        if (
          createHash('sha256').update(JSON.stringify(value)).digest('hex') !==
          request.expected_preview_digest
        )
          return fail('输入或累计分配已变化，请重新核对本次分配。');
        expectedAllocation = value;
        db.prepare(
          `INSERT INTO finance_allocations(id,workspace_id,project_id,installment_id,payment_id,rule_id,value,created_at) VALUES(?,?,?,?,?,?,?,?)`,
        ).run(
          targetId,
          workspace,
          request.project_id,
          value.installment_id,
          request.payment_id,
          request.rule_id,
          JSON.stringify(value),
          now,
        );
      } else if (request.operation === 'm_record_payout') {
        const allocation = allocations().find(
          (row) =>
            row.id === request.allocation_id &&
            row.project_id === request.project_id &&
            !row.reversed_at,
        );
        if (!allocation) return fail('没有本项目有效的结算分配。');
        const paid = db
          .prepare(
            'SELECT COALESCE(SUM(amount_cents),0) AS n FROM finance_payouts WHERE allocation_id=? AND workspace_id=? AND reversed_at IS NULL',
          )
          .get(allocation.id, workspace) as { n: number };
        if (request.amount_cents > allocation.payable_cents - paid.n)
          return fail('本次到账金额超过该分配尚未发放金额。');
        if (request.occurred_on < allocation.occurred_on)
          return fail('到账日期早于结算分配，请核对。');
        db.prepare(
          'INSERT INTO finance_payouts(id,workspace_id,project_id,allocation_id,amount_cents,occurred_on,note,created_at) VALUES(?,?,?,?,?,?,?,?)',
        ).run(
          targetId,
          workspace,
          request.project_id,
          allocation.id,
          request.amount_cents,
          request.occurred_on,
          request.note,
          now,
        );
      } else if (request.operation === 'm_reverse_payout') {
        const row = db
          .prepare(
            'SELECT id FROM finance_payouts WHERE id=? AND workspace_id=? AND project_id=? AND reversed_at IS NULL',
          )
          .get(request.payout_id, workspace, request.project_id);
        if (!row) return fail('没有本项目有效的到账记录。');
        targetId = request.payout_id;
        db.prepare('UPDATE finance_payouts SET reversed_at=? WHERE id=?').run(now, targetId);
      } else {
        const active = allocations().filter((row) => !row.reversed_at);
        const allocation = active.find(
          (row) => row.id === request.allocation_id && row.project_id === request.project_id,
        );
        if (!allocation) return fail('没有本项目有效的结算分配。');
        const family = active.filter(
          (row) =>
            row.rule_id === allocation.rule_id &&
            (rule(row.rule_id).method.startsWith('annual_') ||
              row.project_id === request.project_id),
        );
        if (family.at(-1)?.id !== allocation.id)
          return fail('需先冲回同一累计规则中较晚的分配，防止改变历史累计口径。');
        if (
          db
            .prepare('SELECT 1 FROM finance_payouts WHERE allocation_id=? AND reversed_at IS NULL')
            .get(allocation.id)
        )
          return fail('请先核对并冲回该分配的到账记录。');
        targetId = allocation.id;
        db.prepare('UPDATE finance_allocations SET reversed_at=? WHERE id=?').run(now, targetId);
      }
      if ('source' in request && request.source && 'project_id' in request)
        sources.confirm(
          request.project_id,
          request.source,
          request.operation,
          targetId,
          request,
          now,
        );
      const eventId = randomUUID();
      const actualEffect = effect(request, targetId);
      if (request.operation === 'm_record_invoice' || request.operation === 'm_red_invoice')
        for (const key of [
          'project_id',
          'installment_id',
          'invoice_number',
          'amount_cents',
          'occurred_on',
          'note',
        ] as const)
          if (actualEffect[key] !== request[key]) throw new Error('发票内容未正确落盘。');
      if (request.operation === 'm_record_invoice' || request.operation === 'm_red_invoice')
        if (
          actualEffect.kind !==
            (request.operation === 'm_record_invoice' ? 'invoice' : 'red_invoice') ||
          actualEffect.original_invoice_id !==
            ('original_invoice_id' in request ? request.original_invoice_id : null)
        )
          throw new Error('发票原票关联未正确落盘。');
      if (
        request.operation === 'm_record_expense' ||
        request.operation === 'm_record_reimbursement'
      )
        for (const [key, value] of Object.entries(request))
          if (
            !['operation', 'protocol_version', 'request_id', 'idempotency_key', 'source'].includes(
              key,
            ) &&
            actualEffect[key] !== value
          )
            throw new Error('支出或报销内容未正确落盘。');
      if (
        expectedReimbursementParties &&
        (actualEffect.from_party !== expectedReimbursementParties.from_party ||
          actualEffect.to_party !== expectedReimbursementParties.to_party)
      )
        throw new Error('报销收付主体未正确落盘。');
      if (expectedAllocation)
        for (const [key, value] of Object.entries(expectedAllocation))
          if (actualEffect[key] !== value) throw new Error('分配快照未正确落盘。');
      if (
        request.operation === 'm_record_payout' &&
        (actualEffect.allocation_id !== request.allocation_id ||
          actualEffect.amount_cents !== request.amount_cents ||
          actualEffect.occurred_on !== request.occurred_on ||
          actualEffect.note !== request.note)
      )
        throw new Error('到账内容未正确落盘。');
      if (
        (request.operation.startsWith('m_reverse_') ||
          request.operation === 'm_reverse_expense' ||
          request.operation === 'm_reverse_reimbursement') &&
        actualEffect.reversed_at !== now
      )
        throw new Error('冲回未落盘。');
      if (request.operation === 'm_save_rule') {
        for (const [key, value] of Object.entries(request.values))
          if (actualEffect[key] !== value) throw new Error('规则内容未正确落盘。');
      }
      db.prepare(
        'INSERT INTO finance_management_events(id,workspace_id,project_id,operation,target_id,value,created_at) VALUES(?,?,?,?,?,?,?)',
      ).run(
        eventId,
        workspace,
        'project_id' in request ? request.project_id : null,
        request.operation,
        targetId,
        JSON.stringify({ request, effect: actualEffect }),
        now,
      );
      db.prepare(
        'INSERT INTO finance_management_receipts(workspace_id,key,digest,event_id) VALUES(?,?,?,?)',
      ).run(workspace, request.idempotency_key, digest, eventId);
      const saved = receipt(request.idempotency_key);
      if (
        !saved ||
        saved.digest !== digest ||
        saved.event_id !== eventId ||
        saved.target_id !== targetId
      )
        throw new Error('财务回执读回失败。');
      if (JSON.stringify(effect(request, targetId)) !== JSON.stringify(actualEffect))
        throw new Error('财务操作结果在回执确认前已变化。');
      if (preparedSnapshot && JSON.stringify(sources.candidate(targetId)) !== preparedSnapshot)
        throw new Error('待确认记录状态未正确保存。');
      return read(verify(saved));
    },
  );
  return {
    execute(
      request: FinanceManagementRequest,
      parse?: (
        text: string,
      ) => Pick<
        ReturnType<typeof sources.candidate>,
        'kind' | 'amount_options' | 'date_options' | 'reference'
      >,
    ) {
      return ['m_read', 'm_status', 'm_preview_allocation'].includes(request.operation)
        ? execute(request, parse)
        : execute.immediate(request, parse);
    },
  };
}
