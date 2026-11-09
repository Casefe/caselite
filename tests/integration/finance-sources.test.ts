import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
import { createFinanceApplication } from '../../packages/application/src/finance-application';
import { createTaskApplication } from '../../packages/application/src/task-application';
import { extractFinanceSuggestions } from '../../packages/application/src/finance-source-parser';
import type { FinanceResponse, TextPage } from '../../packages/contracts/src';
const roots: string[] = [],
  handles: { close(): void }[] = [];
afterEach(() => {
  handles
    .splice(0)
    .reverse()
    .forEach((h) => h.close());
  roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
const keys = () => ({
  protocol_version: 1,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
const managed = (r: FinanceResponse) => {
  if (!r.ok || r.kind !== 'management') throw Error(JSON.stringify(r));
  return r;
};
const ledger = (r: FinanceResponse) => {
  if (!r.ok || r.kind !== 'ledger' || !r.ledger) throw Error(JSON.stringify(r));
  return r.ledger;
};
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-finance-source-'));
  roots.push(root);
  const file = join(root, 'data.sqlite');
  const store = openTaskStore(file, resolve('packages/local-db/migrations'));
  handles.push(store);
  const app = createFinanceApplication(store.finance);
  const created = store.catalog.execute({
    ...keys(),
    operation: 'create_project',
    title: '合成材料财务项目',
  });
  if (!created.ok || !created.target_id) throw Error('No project');
  const project_id = created.target_id;
  const tasks = createTaskApplication(store);
  const made = tasks.execute({
    ...keys(),
    operation: 'create',
    title: '合成财务原件',
    objective: '',
    matter_id: project_id,
  });
  if (!made.ok) throw Error('No task');
  const task = made.tasks[0];
  const text = '电子回单\n交易编号：SYNTH-RECEIPT-001\n金额：30,000.00元\n收款日期：2026年11月9日';
  const pages: TextPage[] = [
    { page: 1, text, origin: 'pdf_text', blocks: [], width: 600, height: 800, rotation: 0 },
  ];
  function source() {
    const id = randomUUID(),
      derivation_id = randomUUID(),
      sha256 = createHash('sha256').update(text).digest('hex');
    const stage = {
      token: id,
      scope: task.id,
      name: '合成收款凭证.pdf',
      bytes: 100,
      sha256,
      state: 'staged' as const,
    };
    store.materials.putStage(stage);
    const material = store.materials.commit(stage, task.id, 1);
    store.materials.begin(id, derivation_id, 'synthetic-text-v1', pages);
    store.materials.checkpoint(id, derivation_id, 'ready', pages);
    return {
      project_id,
      source_id: id,
      asset_version_id: material.asset_version_id,
      derivation_id,
      sha256,
      page: 1,
    };
  }
  const ref = source();
  const prepare = { ...keys(), operation: 'm_prepare_source', ...ref };
  return { app, store, file, project_id, task, ref, prepare, source, pages };
}
it('persists a candidate without posting money and confirms a fixed source atomically once, including duplicate-file/restart handling', () => {
  const s = setup();
  const prepared = managed(s.app.execute(s.prepare));
  const candidate = prepared.state.candidates[0];
  expect(candidate).toMatchObject({
    kind: 'payment',
    amount_options: [3000000],
    date_options: ['2026-11-09'],
    status: 'pending',
  });
  expect(prepared.state.projects).toEqual([]);
  expect(prepared.state.allocations).toEqual([]);
  const contract = ledger(
    s.app.execute({
      ...keys(),
      operation: 'register_contract',
      project_id: s.project_id,
      number: 'SYNTH',
      amount_cents: 10000000,
      installments: [{ amount_cents: 10000000, due_date: '2026-11-09' }],
    }),
  );
  const request = {
    ...keys(),
    operation: 'record_payment',
    occurred_on: '2026-11-09',
    project_id: s.project_id,
    installment_id: contract.installments[0].id,
    amount_cents: 3000000,
    source: { candidate_id: candidate.id, confirmed: true },
  };
  const paid = ledger(s.app.execute(request));
  expect(paid).toMatchObject({
    outstanding_cents: 7000000,
    payments: [{ source_candidate_id: candidate.id }],
  });
  expect(ledger(s.app.execute({ ...request, request_id: randomUUID() })).payments).toHaveLength(1);
  expect(s.app.execute({ ...request, ...keys() })).toMatchObject({ ok: false, code: 'CONFLICT' });
  const duplicate = managed(
    s.app.execute({ ...keys(), operation: 'm_prepare_source', ...s.source() }),
  );
  expect(duplicate.state.candidates).toHaveLength(1);
  expect(duplicate.state.candidates[0].status).toBe('confirmed');
  expect(duplicate.state.sources).toMatchObject([
    { candidate_id: candidate.id, target_id: paid.payments[0].id, edited: false },
  ]);
  const reopened = openTaskStore(s.file, resolve('packages/local-db/migrations'));
  handles.push(reopened);
  expect(
    createFinanceApplication(reopened.finance).execute({
      protocol_version: 1,
      operation: 'status',
      project_id: s.project_id,
      idempotency_key: request.idempotency_key,
    }),
  ).toMatchObject({ ok: true, evidence: { target_id: paid.payments[0].id } });
  const reversed = ledger(
    s.app.execute({
      ...keys(),
      operation: 'reverse_payment',
      project_id: s.project_id,
      payment_id: paid.payments[0].id,
    }),
  );
  expect(reversed.outstanding_cents).toBe(10000000);
  expect(reversed.payments[0].reversed_at).toBeTruthy();
  expect(
    managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state.sources[0]
      .candidate_id,
  ).toBe(candidate.id);
  expect(
    s.app.execute({
      protocol_version: 1,
      operation: 'status',
      project_id: s.project_id,
      idempotency_key: request.idempotency_key,
    }),
  ).toMatchObject({ ok: true, evidence: { operation: 'record_payment' } });
});
it('rejects foreign/stale/changed sources and rolls back financial writes when the source confirmation or final receipt is damaged', () => {
  const s = setup();
  const prepared = managed(s.app.execute(s.prepare));
  const candidate = prepared.state.candidates[0];
  const db = openToolchainProbe(s.file, resolve('packages/local-db/migrations')).sqlite;
  handles.push(db);
  expect(s.app.execute({ ...s.prepare, ...keys(), derivation_id: randomUUID() })).toMatchObject({
    ok: false,
  });
  const foreign = openTaskStore(s.file, resolve('packages/local-db/migrations'), 'foreign');
  handles.push(foreign);
  expect(createFinanceApplication(foreign.finance).execute(s.prepare)).toMatchObject({ ok: false });
  const expense = {
    ...keys(),
    operation: 'm_record_expense',
    project_id: s.project_id,
    description: '合成手工核定支出',
    category: 'case_cost',
    payer: 'lawyer',
    bearer: 'client',
    payee: '合成收款方',
    reimbursable: true,
    amount_cents: 20000,
    occurred_on: '2026-11-09',
    note: '用户已核对金额修正',
    source: { candidate_id: candidate.id, confirmed: true },
  };
  db.exec(
    'CREATE TRIGGER finance_test_source BEFORE INSERT ON finance_source_links BEGIN SELECT RAISE(IGNORE); END',
  );
  expect(s.app.execute(expense)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state).toMatchObject({
    expenses: [],
    sources: [],
    candidates: [{ status: 'pending' }],
  });
  db.exec('DROP TRIGGER finance_test_source');
  db.exec(
    "CREATE TRIGGER finance_test_source AFTER INSERT ON finance_management_receipts BEGIN UPDATE finance_candidates SET status='dismissed'; END",
  );
  expect(s.app.execute(expense)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(
    managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state.expenses,
  ).toHaveLength(0);
  db.exec('DROP TRIGGER finance_test_source');
  db.prepare('UPDATE material_derivations SET pages=? WHERE id=?').run(
    JSON.stringify([{ ...s.pages[0], text: '已变化的文字' }]),
    s.ref.derivation_id,
  );
  expect(s.app.execute(expense)).toMatchObject({ ok: false, code: 'CONFLICT' });
  db.prepare('UPDATE material_derivations SET pages=? WHERE id=?').run(
    JSON.stringify(s.pages),
    s.ref.derivation_id,
  );
  const done = managed(s.app.execute(expense));
  expect(done.state.sources[0].edited).toBe(true);
  expect(done.state.candidates[0].status).toBe('confirmed');
});
it('rolls back candidate preparation if a receipt trigger changes its pending snapshot', () => {
  const s = setup();
  const probe = openToolchainProbe(s.file, resolve('packages/local-db/migrations'));
  handles.push(probe.sqlite);
  probe.sqlite.exec(
    "CREATE TRIGGER finance_test_prepare AFTER INSERT ON finance_management_receipts BEGIN UPDATE finance_candidates SET status='dismissed'; END",
  );
  expect(s.app.execute(s.prepare)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(
    managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state.candidates,
  ).toEqual([]);
  probe.sqlite.exec('DROP TRIGGER finance_test_prepare');
  expect(managed(s.app.execute(s.prepare)).state.candidates).toMatchObject([{ status: 'pending' }]);
});
it('leaves ambiguous or unrecognized values for human confirmation and does not truncate malformed amounts or infer account numbers', () => {
  expect(
    extractFinanceSuggestions(
      '委托合同 编号：SYNTH-001 金额：100000元；首期金额：30000元 付款日期2026年11月9日，尾期支付日期2026-11-20',
    ),
  ).toMatchObject({
    kind: 'contract',
    amount_options: [10000000, 3000000],
    date_options: ['2026-11-09', '2026-11-20'],
  });
  expect(
    extractFinanceSuggestions(
      '账号123456789 票号123456789 金额：1.001元 金额：1,2,3元 日期2026-02-30',
    ),
  ).toMatchObject({ amount_options: [], date_options: [] });
  expect(extractFinanceSuggestions('大写人民币壹万元整')).toMatchObject({ amount_options: [] });
});
