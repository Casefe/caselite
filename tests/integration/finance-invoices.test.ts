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
const ledger = (r: FinanceResponse) => {
  if (!r.ok || r.kind !== 'ledger' || !r.ledger) throw Error(JSON.stringify(r));
  return r.ledger;
};
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-finance-invoice-'));
  roots.push(root);
  const file = join(root, 'data.sqlite');
  const store = openTaskStore(file, resolve('packages/local-db/migrations'));
  handles.push(store);
  const app = createFinanceApplication(store.finance);
  const created = store.catalog.execute({
    ...keys(),
    operation: 'create_project',
    title: '合成开票项目',
  });
  if (!created.ok || !created.target_id) throw Error('No project');
  const project_id = created.target_id;
  const contract = ledger(
    app.execute({
      ...keys(),
      operation: 'register_contract',
      project_id,
      number: 'SYNTH',
      amount_cents: 10000000,
      installments: [{ amount_cents: 10000000, due_date: '2026-11-09' }],
    }),
  );
  const installment_id = contract.installments[0].id;
  ledger(
    app.execute({
      ...keys(),
      operation: 'record_payment',
      project_id,
      installment_id,
      amount_cents: 3000000,
    }),
  );
  const invoice = {
    ...keys(),
    operation: 'm_record_invoice',
    project_id,
    installment_id,
    invoice_number: 'SYNTH-BLUE-1',
    amount_cents: 5000000,
    occurred_on: '2026-11-09',
    note: '合成蓝票',
  };
  return { app, store, file, project_id, installment_id, invoice };
}
it('keeps invoice, client receipt and settlement balances separate across idempotency, red invoices and restart', () => {
  const s = setup();
  const saved = managed(s.app.execute(s.invoice));
  const original = saved.state.invoices[0];
  expect(saved.effect).toMatchObject({
    invoice_number: s.invoice.invoice_number,
    amount_cents: 5000000,
  });
  expect(
    managed(s.app.execute({ ...s.invoice, request_id: randomUUID() })).state.invoices,
  ).toHaveLength(1);
  expect(s.app.execute({ ...s.invoice, ...keys() })).toMatchObject({ ok: false, code: 'CONFLICT' });
  const red = {
    ...s.invoice,
    ...keys(),
    operation: 'm_red_invoice',
    invoice_number: 'SYNTH-RED-1',
    original_invoice_id: original.id,
    amount_cents: 1000000,
  };
  const result = managed(s.app.execute(red));
  expect(
    result.state.invoices.reduce(
      (sum, row) => sum + (row.kind === 'red_invoice' ? -row.amount_cents : row.amount_cents),
      0,
    ),
  ).toBe(4000000);
  expect(
    ledger(s.app.execute({ protocol_version: 1, operation: 'read', project_id: s.project_id })),
  ).toMatchObject({ outstanding_cents: 7000000, payments: [{ amount_cents: 3000000 }] });
  expect(result.state.allocations).toEqual([]);
  expect(
    s.app.execute({ ...red, ...keys(), invoice_number: 'SYNTH-RED-EXCESS', amount_cents: 4000001 }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  const reopened = openTaskStore(s.file, resolve('packages/local-db/migrations'));
  handles.push(reopened);
  expect(
    managed(
      createFinanceApplication(reopened.finance).execute({
        protocol_version: 1,
        operation: 'm_status',
        idempotency_key: red.idempotency_key,
      }),
    ).state.invoices,
  ).toEqual(result.state.invoices);
});
it('rejects wrong project/period/red date and rolls back a missing invoice effect or receipt failure', () => {
  const s = setup();
  const db = openToolchainProbe(s.file, resolve('packages/local-db/migrations')).sqlite;
  handles.push(db);
  db.exec(
    'CREATE TRIGGER finance_test_invoice BEFORE INSERT ON finance_invoices BEGIN SELECT RAISE(IGNORE); END',
  );
  expect(s.app.execute(s.invoice)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(
    managed(
      s.app.execute({
        protocol_version: 1,
        operation: 'm_status',
        idempotency_key: s.invoice.idempotency_key,
      }),
    ).evidence,
  ).toBeNull();
  db.exec('DROP TRIGGER finance_test_invoice');
  db.exec(
    "CREATE TRIGGER finance_test_invoice BEFORE INSERT ON finance_management_receipts BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  expect(s.app.execute(s.invoice)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(
    managed(s.app.execute({ protocol_version: 1, operation: 'm_read' })).state.invoices,
  ).toHaveLength(0);
  db.exec('DROP TRIGGER finance_test_invoice');
  const original = managed(s.app.execute(s.invoice)).state.invoices[0];
  expect(
    s.app.execute({
      ...s.invoice,
      ...keys(),
      installment_id: randomUUID(),
      invoice_number: 'WRONG',
    }),
  ).toMatchObject({ ok: false });
  expect(
    s.app.execute({
      ...s.invoice,
      ...keys(),
      operation: 'm_red_invoice',
      original_invoice_id: original.id,
      invoice_number: 'EARLY',
      occurred_on: '2026-11-08',
    }),
  ).toMatchObject({ ok: false });
  const foreign = openTaskStore(s.file, resolve('packages/local-db/migrations'), 'foreign');
  handles.push(foreign);
  expect(
    managed(
      createFinanceApplication(foreign.finance).execute({
        protocol_version: 1,
        operation: 'm_read',
      }),
    ).state.invoices,
  ).toEqual([]);
  expect(createFinanceApplication(foreign.finance).execute(s.invoice)).toMatchObject({ ok: false });
  expect(() => db.prepare('DELETE FROM finance_invoices WHERE id=?').run(original.id)).toThrow(
    'immutable invoice',
  );
});
