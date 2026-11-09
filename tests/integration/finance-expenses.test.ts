import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
import { createFinanceApplication } from '../../packages/application/src/finance-application';
import type { FinanceResponse } from '../../packages/contracts/src';
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
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-finance-expense-'));
  roots.push(root);
  const file = join(root, 'data.sqlite');
  const store = openTaskStore(file, resolve('packages/local-db/migrations'));
  handles.push(store);
  const app = createFinanceApplication(store.finance);
  const created = store.catalog.execute({
    ...keys(),
    operation: 'create_project',
    title: '合成支出项目',
  });
  if (!created.ok || !created.target_id) throw Error('No project');
  const project_id = created.target_id;
  const expense = {
    ...keys(),
    operation: 'm_record_expense',
    project_id,
    description: '合成鉴定费',
    category: 'client_advance',
    payer: 'lawyer',
    bearer: 'client',
    payee: '合成鉴定机构',
    reimbursable: true,
    amount_cents: 50000,
    occurred_on: '2026-11-09',
    note: '合成垫付',
  };
  return { app, store, file, project_id, expense };
}
it('keeps partial reimbursement and actual payer separate from fee receipts, survives restart and reverses in dependency order', () => {
  const s = setup();
  const created = managed(s.app.execute(s.expense));
  const expense = created.state.expenses[0];
  expect(expense).toMatchObject({
    payer: 'lawyer',
    bearer: 'client',
    amount_cents: 50000,
    reimbursable: true,
  });
  expect(
    managed(s.app.execute({ ...s.expense, request_id: randomUUID() })).state.expenses,
  ).toHaveLength(1);
  const request = {
    ...keys(),
    operation: 'm_record_reimbursement',
    project_id: s.project_id,
    expense_id: expense.id,
    amount_cents: 20000,
    occurred_on: '2026-11-09',
    note: '合成部分报销',
  };
  const paid = managed(s.app.execute(request));
  expect(paid.state.reimbursements[0]).toMatchObject({
    from_party: 'client',
    to_party: 'lawyer',
    amount_cents: 20000,
  });
  expect(paid.state.projects).toEqual([]);
  expect(paid.state.allocations).toEqual([]);
  expect(s.app.execute({ ...request, ...keys(), amount_cents: 30001 })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  const reopened = openTaskStore(s.file, resolve('packages/local-db/migrations'));
  handles.push(reopened);
  expect(
    managed(
      createFinanceApplication(reopened.finance).execute({
        protocol_version: 1,
        operation: 'm_status',
        idempotency_key: request.idempotency_key,
      }),
    ).state.reimbursements,
  ).toEqual(paid.state.reimbursements);
  const reverse = {
    ...keys(),
    operation: 'm_reverse_expense',
    project_id: s.project_id,
    expense_id: expense.id,
    note: '更正误记，非实际退款',
  };
  expect(s.app.execute(reverse)).toMatchObject({ ok: false, code: 'CONFLICT' });
  managed(
    s.app.execute({
      ...keys(),
      operation: 'm_reverse_reimbursement',
      project_id: s.project_id,
      reimbursement_id: paid.state.reimbursements[0].id,
      note: '更正报销登记',
    }),
  );
  managed(s.app.execute(reverse));
  expect(
    managed(
      s.app.execute({
        protocol_version: 1,
        operation: 'm_status',
        idempotency_key: s.expense.idempotency_key,
      }),
    ).state.expenses[0].reversed_at,
  ).toBeTruthy();
  expect(s.app.execute({ ...request, ...keys() })).toMatchObject({ ok: false });
});
it('rejects incompatible reimbursement, dates and project ownership and rolls back missing effects or receipts', () => {
  const s = setup();
  const db = openToolchainProbe(s.file, resolve('packages/local-db/migrations')).sqlite;
  handles.push(db);
  expect(s.app.execute({ ...s.expense, ...keys(), bearer: 'lawyer' })).toMatchObject({ ok: false });
  db.exec(
    'CREATE TRIGGER finance_test_expense BEFORE INSERT ON finance_expenses BEGIN SELECT RAISE(IGNORE); END',
  );
  expect(s.app.execute(s.expense)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(
    managed(
      s.app.execute({
        protocol_version: 1,
        operation: 'm_status',
        idempotency_key: s.expense.idempotency_key,
      }),
    ).evidence,
  ).toBeNull();
  db.exec('DROP TRIGGER finance_test_expense');
  const expense = managed(s.app.execute(s.expense)).state.expenses[0];
  const request = {
    ...keys(),
    operation: 'm_record_reimbursement',
    project_id: s.project_id,
    expense_id: expense.id,
    amount_cents: 10000,
    occurred_on: '2026-11-09',
    note: '',
  };
  expect(s.app.execute({ ...request, ...keys(), occurred_on: '2026-11-08' })).toMatchObject({
    ok: false,
  });
  db.exec(
    "CREATE TRIGGER finance_test_expense BEFORE INSERT ON finance_management_receipts BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  expect(s.app.execute(request)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(
    managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state.reimbursements,
  ).toEqual([]);
  db.exec('DROP TRIGGER finance_test_expense');
  const foreign = openTaskStore(s.file, resolve('packages/local-db/migrations'), 'foreign');
  handles.push(foreign);
  expect(
    managed(
      createFinanceApplication(foreign.finance).execute({
        protocol_version: 1,
        operation: 'm_read',
      }),
    ).state.expenses,
  ).toEqual([]);
  expect(createFinanceApplication(foreign.finance).execute(request)).toMatchObject({ ok: false });
  expect(() => db.prepare('DELETE FROM finance_expenses WHERE id=?').run(expense.id)).toThrow(
    'immutable expense',
  );
  const noReimburse = managed(
    s.app.execute({ ...s.expense, ...keys(), reimbursable: false }),
  ).state.expenses.at(-1)!;
  expect(s.app.execute({ ...request, ...keys(), expense_id: noReimburse.id })).toMatchObject({
    ok: false,
  });
});

it('checks derived reimbursement parties and the actual reversal effect before acknowledging either operation', () => {
  const s = setup();
  const db = openToolchainProbe(s.file, resolve('packages/local-db/migrations')).sqlite;
  handles.push(db);
  const expense = managed(s.app.execute(s.expense)).state.expenses[0];
  const paidRequest = {
    ...keys(),
    operation: 'm_record_reimbursement',
    project_id: s.project_id,
    expense_id: expense.id,
    amount_cents: 10000,
    occurred_on: '2026-11-09',
    note: '',
  };
  db.exec(
    "CREATE TRIGGER finance_test_parties BEFORE INSERT ON finance_reimbursements BEGIN INSERT INTO finance_reimbursements(id,workspace_id,project_id,expense_id,amount_cents,occurred_on,note,from_party,to_party,created_at) VALUES(NEW.id,NEW.workspace_id,NEW.project_id,NEW.expense_id,NEW.amount_cents,NEW.occurred_on,NEW.note,'firm',NEW.to_party,NEW.created_at); SELECT RAISE(IGNORE); END",
  );
  expect(s.app.execute(paidRequest)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(
    managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state.reimbursements,
  ).toHaveLength(0);
  db.exec('DROP TRIGGER finance_test_parties');
  const paid = managed(s.app.execute(paidRequest)).state.reimbursements[0];
  const reversePaid = {
    ...keys(),
    operation: 'm_reverse_reimbursement',
    project_id: s.project_id,
    reimbursement_id: paid.id,
    note: '合成更正',
  };
  db.exec(
    'CREATE TRIGGER finance_test_reverse AFTER INSERT ON finance_management_receipts BEGIN UPDATE finance_reimbursements SET reversed_at=NULL; END',
  );
  expect(s.app.execute(reversePaid)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(
    managed(
      s.app.execute({
        protocol_version: 1,
        operation: 'm_status',
        idempotency_key: reversePaid.idempotency_key,
      }),
    ).evidence,
  ).toBeNull();
  db.exec('DROP TRIGGER finance_test_reverse');
  managed(s.app.execute(reversePaid));
  const reverseExpense = {
    ...keys(),
    operation: 'm_reverse_expense',
    project_id: s.project_id,
    expense_id: expense.id,
    note: '合成更正',
  };
  db.exec(
    'CREATE TRIGGER finance_test_reverse AFTER INSERT ON finance_management_receipts BEGIN UPDATE finance_expenses SET reversed_at=NULL; END',
  );
  expect(s.app.execute(reverseExpense)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(
    managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state.expenses[0]
      .reversed_at,
  ).toBeNull();
});
