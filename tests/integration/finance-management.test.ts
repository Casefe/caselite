import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
import { createFinanceApplication } from '../../packages/application/src/finance-application';
import type { FinanceResponse, FinanceRule } from '../../packages/contracts/src';
import { calculateFinanceShare } from '../../packages/local-db/src/finance-calculation';

const roots: string[] = [];
const handles: { close(): void }[] = [];
afterEach(() => {
  handles
    .splice(0)
    .reverse()
    .forEach((handle) => handle.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
const keys = () => ({
  protocol_version: 1,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
const values = {
  name: '合成留所20%',
  firm_name: '合成律所',
  method: 'firm_percent',
  rate_bps: 2000,
  second_rate_bps: 8500,
  threshold_cents: 60000000,
  cap_cents: 30000000,
  settlement_trigger: 'approval',
  effective_date: '2020-01-01',
  annual_year: 2026,
  opening_base_cents: 0,
  opening_firm_cents: 0,
  annual_data_confirmed: false,
};
function managed(result: FinanceResponse) {
  if (!result.ok || result.kind !== 'management') throw new Error(JSON.stringify(result));
  return result;
}
function detail(result: FinanceResponse) {
  if (!result.ok || result.kind !== 'ledger' || !result.ledger)
    throw new Error(JSON.stringify(result));
  return result.ledger;
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-finance-management-'));
  roots.push(root);
  const file = join(root, 'data.sqlite');
  const store = openTaskStore(file, resolve('packages/local-db/migrations'));
  handles.push(store);
  const app = createFinanceApplication(store.finance);
  const created = store.catalog.execute({
    ...keys(),
    operation: 'create_project',
    title: '合成结算项目',
  });
  if (!created.ok || !created.target_id) throw new Error('Missing project');
  const project_id = created.target_id;
  const contract = detail(
    app.execute({
      ...keys(),
      operation: 'register_contract',
      project_id,
      number: 'SYNTH',
      amount_cents: 10000000,
      installments: [{ amount_cents: 10000000, due_date: '2020-01-01' }],
    }),
  );
  const paid = detail(
    app.execute({
      ...keys(),
      operation: 'record_payment',
      project_id,
      installment_id: contract.installments[0].id,
      amount_cents: 3000000,
    }),
  );
  const saved = { ...keys(), operation: 'm_save_rule', values };
  const result = managed(app.execute(saved));
  const rule_id = result.evidence!.target_id;
  const bind = { ...keys(), operation: 'm_bind_rule', project_id, rule_id, expected_rule_id: null };
  managed(app.execute(bind));
  const allocation = {
    ...keys(),
    operation: 'm_allocate' as const,
    project_id,
    payment_id: paid.payments[0].id,
    rule_id,
    pre_tax_cents: 0,
    pre_cost_cents: 0,
    post_deduction_cents: 0,
    deductions_confirmed: true,
    occurred_on: '2026-11-09',
    note: '合成核定',
  };
  const {
    request_id: allocationRequest,
    idempotency_key: allocationKey,
    ...previewInput
  } = allocation;
  void allocationRequest;
  void allocationKey;
  const checked = managed(app.execute({ ...previewInput, operation: 'm_preview_allocation' }));
  const confirmedAllocation = { ...allocation, expected_preview_digest: checked.preview_digest! };
  return {
    file,
    store,
    app,
    project_id,
    rule_id,
    payment: paid.payments[0],
    allocation: confirmedAllocation,
    saved,
    bind,
  };
}

it('persists immutable rules, exact allocation and payouts without changing client balances, with original-key replay', () => {
  const s = setup();
  const { app, project_id } = s;
  const result = managed(app.execute(s.allocation));
  const allocation = result.state.allocations[0];
  expect(allocation).toMatchObject({
    base_cents: 3000000,
    firm_cents: 600000,
    lawyer_cents: 2400000,
    payable_cents: 2400000,
  });
  expect(
    managed(app.execute({ ...s.allocation, request_id: randomUUID() })).state.allocations,
  ).toHaveLength(1);
  expect(app.execute({ ...s.allocation, pre_cost_cents: 1 })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  expect(app.execute({ ...s.allocation, ...keys() })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  const payout = {
    ...keys(),
    operation: 'm_record_payout',
    project_id,
    allocation_id: allocation.id,
    amount_cents: 1000000,
    occurred_on: '2026-11-09',
    note: '合成到账',
  };
  const paid = managed(app.execute(payout));
  expect(paid.state.payouts).toHaveLength(1);
  expect(
    detail(app.execute({ protocol_version: 1, operation: 'read', project_id })).outstanding_cents,
  ).toBe(7000000);
  expect(app.execute({ ...payout, ...keys(), amount_cents: 1400001 })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  const rule2 = managed(
    app.execute({
      ...keys(),
      operation: 'm_save_rule',
      values: { ...values, name: '新规则85%', rate_bps: 1500 },
    }),
  ).evidence!.target_id;
  managed(
    app.execute({
      ...keys(),
      operation: 'm_bind_rule',
      project_id,
      rule_id: rule2,
      expected_rule_id: s.rule_id,
    }),
  );
  expect(
    managed(
      app.execute({
        protocol_version: 1,
        operation: 'm_status',
        idempotency_key: s.bind.idempotency_key,
      }),
    ).evidence?.operation,
  ).toBe('m_bind_rule');
  expect(
    managed(app.execute({ protocol_version: 1, operation: 'm_read' })).state.allocations[0],
  ).toEqual(allocation);
  const reopened = openTaskStore(s.file, resolve('packages/local-db/migrations'));
  handles.push(reopened);
  const again = createFinanceApplication(reopened.finance);
  expect(
    managed(
      again.execute({
        protocol_version: 1,
        operation: 'm_status',
        idempotency_key: payout.idempotency_key,
      }),
    ).state.payouts,
  ).toEqual(paid.state.payouts);
  expect(
    managed(again.execute({ ...s.allocation, request_id: randomUUID() })).state.allocations[0],
  ).toEqual(allocation);
});

it('keeps workspace/project ownership opaque and rejects out-of-order reversal until payouts are reversed', () => {
  const s = setup();
  const other = openTaskStore(s.file, resolve('packages/local-db/migrations'), 'other');
  handles.push(other);
  const foreign = createFinanceApplication(other.finance);
  expect(
    managed(foreign.execute({ protocol_version: 1, operation: 'm_read' })).state.rules,
  ).toEqual([]);
  expect(foreign.execute(s.allocation)).toMatchObject({ ok: false });
  const allocation = managed(s.app.execute(s.allocation)).state.allocations[0];
  const paid = managed(
    s.app.execute({
      ...keys(),
      operation: 'm_record_payout',
      project_id: s.project_id,
      allocation_id: allocation.id,
      amount_cents: 10000,
      occurred_on: '2026-11-09',
      note: '',
    }),
  ).state.payouts[0];
  const reverse = {
    ...keys(),
    operation: 'reverse_payment',
    project_id: s.project_id,
    payment_id: s.payment.id,
  };
  expect(s.app.execute(reverse)).toMatchObject({ ok: false, code: 'CONFLICT' });
  const foreignProject = other.catalog.execute({
    ...keys(),
    operation: 'create_project',
    title: '其他工作区',
  });
  if (!foreignProject.ok || !foreignProject.target_id) throw new Error('Missing foreign project');
  expect(foreign.execute({ ...reverse, project_id: foreignProject.target_id })).toMatchObject({
    ok: false,
    code: 'NOT_FOUND',
  });
  const reverseAllocation = {
    ...keys(),
    operation: 'm_reverse_allocation',
    project_id: s.project_id,
    allocation_id: allocation.id,
    note: '合成更正',
  };
  expect(s.app.execute(reverseAllocation)).toMatchObject({ ok: false });
  const reversePayout = {
    ...keys(),
    operation: 'm_reverse_payout',
    project_id: s.project_id,
    payout_id: paid.id,
    note: '更正误登记，并非资金退回',
  };
  managed(s.app.execute(reversePayout));
  managed(s.app.execute(reverseAllocation));
  expect(
    managed(
      s.app.execute({
        protocol_version: 1,
        operation: 'm_status',
        idempotency_key: reversePayout.idempotency_key,
      }),
    ).state.payouts[0].reversed_at,
  ).toBeTruthy();
  expect(detail(s.app.execute(reverse)).outstanding_cents).toBe(10000000);
});

it('verifies actual settings/rollback effects, rejects ignored writes and preserves previous defaults history', () => {
  const s = setup();
  const db = openToolchainProbe(s.file, resolve('packages/local-db/migrations')).sqlite;
  handles.push(db);
  const request = {
    ...keys(),
    operation: 'm_set_default',
    rule_id: s.rule_id,
    expected_version: 0,
  };
  db.exec(
    'CREATE TRIGGER finance_test_ignore BEFORE INSERT ON finance_settings BEGIN SELECT RAISE(IGNORE); END',
  );
  expect(s.app.execute(request)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(
    managed(
      s.app.execute({
        protocol_version: 1,
        operation: 'm_status',
        idempotency_key: request.idempotency_key,
      }),
    ).evidence,
  ).toBeNull();
  db.exec('DROP TRIGGER finance_test_ignore');
  const first = managed(s.app.execute(request));
  expect(first.state.version).toBe(1);
  managed(
    s.app.execute({ ...keys(), operation: 'm_set_default', rule_id: null, expected_version: 1 }),
  );
  expect(
    managed(
      s.app.execute({
        protocol_version: 1,
        operation: 'm_status',
        idempotency_key: request.idempotency_key,
      }),
    ).evidence?.target_id,
  ).toBe(first.evidence?.target_id);
  const before = managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state;
  db.exec(
    "CREATE TRIGGER finance_test_ignore BEFORE INSERT ON finance_management_receipts BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  expect(s.app.execute(s.allocation)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state).toEqual(
    before,
  );
  db.exec('DROP TRIGGER finance_test_ignore');
  const allocated = managed(s.app.execute(s.allocation)).state.allocations[0];
  db.exec(
    'CREATE TRIGGER finance_test_ignore BEFORE UPDATE ON finance_allocations BEGIN SELECT RAISE(IGNORE); END',
  );
  const reverse = {
    ...keys(),
    operation: 'm_reverse_allocation',
    project_id: s.project_id,
    allocation_id: allocated.id,
    note: '合成冲回',
  };
  expect(s.app.execute(reverse)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(
    managed(
      s.app.execute({
        protocol_version: 1,
        operation: 'm_status',
        idempotency_key: reverse.idempotency_key,
      }),
    ).evidence,
  ).toBeNull();
});

it('calculates net, cumulative tier and cap amounts with confirmed contexts and exact partition rounding', () => {
  const rule = { ...values, id: randomUUID(), created_at: new Date().toISOString() } as FinanceRule;
  const initial = { base: 3000000, tax: 0, cost: 0, post: 0, previousBase: 0, previousFirm: 0 };
  expect(
    calculateFinanceShare(
      { ...rule, method: 'net_lawyer', rate_bps: 3000 },
      { ...initial, tax: 50000, cost: 100000, post: 50000 },
    ),
  ).toMatchObject({ distributable_cents: 2850000, lawyer_cents: 855000, payable_cents: 805000 });
  expect(() => calculateFinanceShare(rule, { ...initial, cost: 1 })).toThrow();
  const annual = {
    ...rule,
    annual_data_confirmed: true,
    method: 'annual_tier',
    rate_bps: 8200,
  } as FinanceRule;
  expect(calculateFinanceShare(annual, { ...initial, previousBase: 59000000 })).toMatchObject({
    lawyer_cents: 2520000,
  });
  const cap = {
    ...rule,
    method: 'annual_cap',
    rate_bps: 5000,
    annual_data_confirmed: true,
  } as FinanceRule;
  const first = calculateFinanceShare(cap, { ...initial, base: 1 });
  const second = calculateFinanceShare(cap, {
    ...initial,
    base: 1,
    previousBase: 1,
    previousFirm: first.firm_cents,
  });
  expect(first.firm_cents + second.firm_cents).toBe(1);
  expect(
    calculateFinanceShare({ ...cap, rate_bps: 1000 }, { ...initial, previousFirm: 29900000 }),
  ).toMatchObject({ firm_cents: 100000, lawyer_cents: 2900000 });
});

it('binds the confirmed default on a new ledger and atomically allocates receipt-triggered rules', () => {
  const s = setup();
  const rule_id = managed(
    s.app.execute({
      ...keys(),
      operation: 'm_save_rule',
      values: { ...values, name: '回款自动分配', settlement_trigger: 'receipt' },
    }),
  ).evidence!.target_id;
  managed(s.app.execute({ ...keys(), operation: 'm_set_default', rule_id, expected_version: 0 }));
  const project = s.store.catalog.execute({
    ...keys(),
    operation: 'create_project',
    title: '合成自动分配项目',
  });
  if (!project.ok || !project.target_id) throw new Error('Missing project');
  const project_id = project.target_id;
  const ledger = detail(
    s.app.execute({
      ...keys(),
      operation: 'register_contract',
      project_id,
      number: 'AUTO',
      amount_cents: 10000,
      installments: [{ amount_cents: 10000, due_date: '2020-01-01' }],
    }),
  );
  expect(
    managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state.bindings,
  ).toContainEqual({ project_id, rule_id });
  const payment = {
    ...keys(),
    operation: 'record_payment',
    project_id,
    installment_id: ledger.installments[0].id,
    amount_cents: 10000,
  };
  const db = openToolchainProbe(s.file, resolve('packages/local-db/migrations')).sqlite;
  handles.push(db);
  db.exec(
    "CREATE TRIGGER finance_test_auto_abort BEFORE INSERT ON finance_allocations BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  expect(s.app.execute(payment)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(
    detail(s.app.execute({ protocol_version: 1, operation: 'read', project_id })).payments,
  ).toHaveLength(0);
  expect(
    managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state.allocations,
  ).toHaveLength(0);
  db.exec('DROP TRIGGER finance_test_auto_abort');
  detail(s.app.execute(payment));
  const allocation = managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state
    .allocations[0];
  expect(allocation).toMatchObject({
    project_id,
    rule_id,
    base_cents: 10000,
    firm_cents: 2000,
    payable_cents: 8000,
  });
  detail(s.app.execute({ ...payment, request_id: randomUUID() }));
  expect(
    managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state.allocations,
  ).toHaveLength(1);
});

it('keeps large legacy ledgers readable and rejects allocation confirmation after preview changes', () => {
  const s = setup();
  const created = s.store.catalog.execute({
    ...keys(),
    operation: 'create_project',
    title: '合成大额旧合同',
  });
  if (!created.ok || !created.target_id) throw new Error('Missing project');
  detail(
    s.app.execute({
      ...keys(),
      operation: 'register_contract',
      project_id: created.target_id,
      number: 'LARGE',
      amount_cents: 1_000_000_000_001,
      installments: [{ amount_cents: 1_000_000_000_001, due_date: '2020-01-01' }],
    }),
  );
  expect(
    managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state.projects.find(
      (row) => row.project_id === created.target_id,
    )?.amount_cents,
  ).toBe(1_000_000_000_001);
  expect(s.app.execute({ ...s.allocation, post_deduction_cents: 1 })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  expect(
    managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state.allocations,
  ).toHaveLength(0);
  managed(s.app.execute(s.allocation));
});

it('rejects parent-transaction corruption of new automatic allocation and default binding', () => {
  const s = setup();
  const db = openToolchainProbe(s.file, resolve('packages/local-db/migrations')).sqlite;
  handles.push(db);
  const rule_id = managed(
    s.app.execute({
      ...keys(),
      operation: 'm_save_rule',
      values: { ...values, settlement_trigger: 'receipt' },
    }),
  ).evidence!.target_id;
  managed(s.app.execute({ ...keys(), operation: 'm_set_default', rule_id, expected_version: 0 }));
  const project = s.store.catalog.execute({
    ...keys(),
    operation: 'create_project',
    title: '合成父事务故障',
  });
  if (!project.ok || !project.target_id) throw new Error('Missing project');
  const project_id = project.target_id;
  const contract = {
    ...keys(),
    operation: 'register_contract',
    project_id,
    number: 'FAULT',
    amount_cents: 10000,
    installments: [{ amount_cents: 10000, due_date: '2020-01-01' }],
  };
  db.exec(
    "CREATE TRIGGER finance_test_parent AFTER INSERT ON finance_receipts WHEN NEW.operation='register_contract' BEGIN DELETE FROM finance_project_rules; END",
  );
  expect(s.app.execute(contract)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(s.app.execute({ protocol_version: 1, operation: 'read', project_id })).toMatchObject({
    ok: true,
    ledger: null,
  });
  db.exec('DROP TRIGGER finance_test_parent');
  const ledger = detail(s.app.execute(contract));
  db.exec(
    "CREATE TRIGGER finance_test_parent AFTER INSERT ON finance_receipts WHEN NEW.operation='record_payment' BEGIN UPDATE finance_allocations SET reversed_at='2026-11-09T00:00:00.000Z'; END",
  );
  expect(
    s.app.execute({
      ...keys(),
      operation: 'record_payment',
      project_id,
      installment_id: ledger.installments[0].id,
      amount_cents: 10000,
    }),
  ).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(
    detail(s.app.execute({ protocol_version: 1, operation: 'read', project_id })).payments,
  ).toHaveLength(0);
  expect(
    managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state.allocations,
  ).toHaveLength(0);
});
