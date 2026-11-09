import { emptyTaskCalendar } from '@caselite/contracts';
import { afterEach, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
import { createFinanceApplication } from '../../packages/application/src/finance-application';
import type { FinanceResponse } from '../../packages/contracts/src';

const migrations = resolve('packages/local-db/migrations');
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const temp = () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-finance-'));
  roots.push(root);
  return root;
};
const protocol_version = 1 as const;
const keys = () => ({ protocol_version, request_id: randomUUID(), idempotency_key: randomUUID() });
function createProject(store: ReturnType<typeof openTaskStore>, title: string) {
  const result = store.catalog.execute({ ...keys(), operation: 'create_project', title });
  if (!result.ok || !result.target_id) throw new Error('Synthetic project creation failed');
  return result.target_id;
}
function list(store: ReturnType<typeof openTaskStore>, id: string) {
  const result = store.catalog.execute({ operation: 'list', protocol_version });
  if (!result.ok) throw new Error(result.message);
  return result.projects.find((project) => project.id === id);
}
function ledger(response: FinanceResponse) {
  if (!response.ok || response.kind !== 'ledger' || !response.ledger)
    throw new Error('Missing finance detail');
  return response.ledger;
}
const contract = (project_id: string) => ({
  ...keys(),
  operation: 'register_contract',
  project_id,
  number: 'SYNTH-100000',
  amount_cents: 10_000_000,
  installments: [
    { amount_cents: 6_000_000, due_date: '2020-01-01' },
    { amount_cents: 4_000_000, due_date: '2099-01-01' },
  ],
});
const read = (project_id: string) => ({ protocol_version, operation: 'read', project_id });
const status = (request: { project_id: string; idempotency_key: string }) => ({
  protocol_version,
  operation: 'status',
  project_id: request.project_id,
  idempotency_key: request.idempotency_key,
});

it('keeps one scoped finance ledger, exact balances and stable evidence through replay and restart', () => {
  const file = join(temp(), 'data.sqlite');
  const store = openTaskStore(file, migrations);
  const other = openTaskStore(file, migrations, 'other');
  const app = createFinanceApplication(store.finance);
  const foreignApp = createFinanceApplication(other.finance);
  const project = createProject(store, '合成收费项目');
  const sameWorkspace = createProject(store, '同工作区其他项目');
  const foreign = createProject(other, '其他工作区项目');
  const create = contract(project);
  expect(list(store, project)?.outstanding_cents).toBeNull();
  expect(app.execute(read(project))).toMatchObject({ ok: true, ledger: null });
  for (const invalid of [
    { ...create, amount_cents: 9_999_999 },
    { ...create, number: 'SYNTH\0' },
    { ...create, amount_cents: Number.MAX_SAFE_INTEGER + 1 },
    { ...create, installments: [{ amount_cents: 10_000_000, due_date: '2026-02-29' }] },
    {
      ...create,
      installments: [{ amount_cents: 10_000_000, due_date: '2026-03-01' }],
      actor: 'forged',
    },
  ])
    expect(app.execute(invalid)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  const registered = ledger(app.execute(create));
  expect(registered).toMatchObject({ outstanding_cents: 10_000_000, due_cents: 6_000_000 });
  expect(app.execute(contract(project))).toMatchObject({ code: 'CONFLICT' });
  expect(ledger(app.execute({ ...create, request_id: randomUUID() }))).toEqual(registered);
  expect(app.execute({ ...create, number: 'different' })).toMatchObject({ code: 'CONFLICT' });
  expect(foreignApp.execute(status(create))).toMatchObject({ code: 'NOT_FOUND' });
  expect(app.execute({ ...status(create), project_id: sameWorkspace })).toMatchObject({
    code: 'CONFLICT',
  });

  const payment = {
    ...keys(),
    operation: 'record_payment',
    project_id: project,
    installment_id: registered.installments[0].id,
    amount_cents: 3_000_000,
  };
  expect(app.execute({ ...payment, project_id: sameWorkspace })).toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(foreignApp.execute({ ...payment, project_id: foreign })).toMatchObject({
    code: 'NOT_FOUND',
  });
  for (const amount_cents of [-1, 0, 1.1])
    expect(app.execute({ ...payment, amount_cents })).toMatchObject({ code: 'INVALID_REQUEST' });
  expect(app.execute({ ...payment, amount_cents: 6_000_001 })).toMatchObject({ code: 'CONFLICT' });
  expect(app.execute(status(payment))).toMatchObject({ ok: true, kind: 'status', evidence: null });

  // 模拟丢失写入响应。原键只读核对不新增收款或活动。
  app.execute(payment);
  const evidence = app.execute(status(payment));
  expect(evidence).toMatchObject({
    ok: true,
    kind: 'status',
    receipt: payment.idempotency_key,
    evidence: { operation: 'record_payment' },
  });
  expect(evidence).not.toHaveProperty('ledger');
  const after = ledger(app.execute({ ...payment, request_id: randomUUID() }));
  expect(after).toMatchObject({ outstanding_cents: 7_000_000, due_cents: 3_000_000 });
  expect(after.payments).toHaveLength(1);
  expect(list(store, project)?.outstanding_cents).toBe(7_000_000);
  expect(app.execute({ ...payment, amount_cents: 1 })).toMatchObject({ code: 'CONFLICT' });
  other.close();
  store.close();

  const reopened = openTaskStore(file, migrations);
  try {
    const again = createFinanceApplication(reopened.finance);
    expect(again.execute(status(payment))).toEqual(evidence);
    expect(ledger(again.execute(read(project)))).toEqual(after);
    const reverse = {
      ...keys(),
      operation: 'reverse_payment',
      project_id: project,
      payment_id: after.payments[0].id,
    };
    expect(again.execute({ ...reverse, project_id: sameWorkspace })).toMatchObject({
      code: 'NOT_FOUND',
    });
    const reversed = ledger(again.execute(reverse));
    expect(reversed).toMatchObject({ outstanding_cents: 10_000_000, due_cents: 6_000_000 });
    expect(reversed.payments).toHaveLength(1);
    expect(reversed.payments[0].reversed_at).toBeTruthy();
    expect(ledger(again.execute(reverse))).toEqual(reversed);
    expect(again.execute({ ...reverse, ...keys() })).toMatchObject({ code: 'CONFLICT' });
    const activity = reopened.catalog.execute({
      protocol_version,
      operation: 'list_activity',
      scope: { type: 'project', id: project },
      offset: 0,
    });
    if (!activity.ok) throw new Error(activity.message);
    expect(activity.activity?.map((event) => event.operation).sort()).toEqual(
      ['create_project', 'register_contract', 'record_payment', 'reverse_payment'].sort(),
    );
    expect(activity.activity?.every((event) => event.target_type === 'project')).toBe(true);
    for (const row of reversed.installments)
      ledger(
        again.execute({
          ...keys(),
          operation: 'record_payment',
          project_id: project,
          installment_id: row.id,
          amount_cents: row.amount_cents,
        }),
      );
    expect(list(reopened, project)?.outstanding_cents).toBe(0);
    expect(list(reopened, sameWorkspace)?.outstanding_cents).toBeNull();
    const archived = reopened.catalog.execute({
      ...keys(),
      operation: 'archive_project',
      id: project,
      expected_version: 1,
      archived: true,
    });
    expect(archived.ok).toBe(true);
    expect(again.execute({ ...reverse, ...keys() })).toMatchObject({ code: 'CONFLICT' });
    expect(ledger(again.execute(read(project))).outstanding_cents).toBe(0);
  } finally {
    reopened.close();
  }
});

it('rolls back ledger, activity and receipt together on activity, receipt or readback failure', () => {
  const file = join(temp(), 'fault.sqlite');
  const store = openTaskStore(file, migrations);
  const app = createFinanceApplication(store.finance);
  const db = openToolchainProbe(file, migrations).sqlite;
  const project = createProject(store, '合成故障样本');
  const request = contract(project);
  try {
    for (const sql of [
      "BEFORE INSERT ON catalog_activity BEGIN SELECT RAISE(ABORT,'synthetic activity failure'); END",
      "BEFORE INSERT ON finance_receipts BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END",
      'AFTER INSERT ON finance_receipts BEGIN DELETE FROM finance_contracts; END',
    ]) {
      db.exec(`CREATE TRIGGER finance_test_fault ${sql}`);
      expect(app.execute(request)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
      expect(app.execute(status(request))).toMatchObject({
        ok: true,
        kind: 'status',
        evidence: null,
      });
      expect(app.execute(read(project))).toMatchObject({ ok: true, ledger: null });
      expect(
        db
          .prepare("SELECT COUNT(*) AS n FROM catalog_activity WHERE operation='register_contract'")
          .get(),
      ).toEqual({ n: 0 });
      db.exec('DROP TRIGGER finance_test_fault');
    }
    const registered = ledger(app.execute(request));
    const payment = {
      ...keys(),
      operation: 'record_payment',
      project_id: project,
      installment_id: registered.installments[0].id,
      amount_cents: 3_000_000,
    };
    db.exec(
      "CREATE TRIGGER finance_test_fault AFTER INSERT ON finance_receipts BEGIN UPDATE finance_payments SET committed_at='invalid'; END",
    );
    expect(app.execute(payment)).toMatchObject({ code: 'UNAVAILABLE' });
    expect(app.execute(status(payment))).toMatchObject({ evidence: null });
    expect(ledger(app.execute(read(project)))).toEqual(registered);
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM catalog_activity WHERE operation='record_payment'")
        .get(),
    ).toEqual({ n: 0 });
    db.exec('DROP TRIGGER finance_test_fault');
    expect(ledger(app.execute(payment)).outstanding_cents).toBe(7_000_000);
  } finally {
    db.close();
    store.close();
  }
});

it('preserves a populated 0014 store and rolls back interrupted 0015 before a clean retry', () => {
  const dir = temp();
  const file = join(dir, 'legacy.sqlite');
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'));
  const copy = (name: string, count: number) => {
    const folder = join(dir, name);
    const entries = journal.entries.slice(0, count);
    mkdirSync(join(folder, 'meta'), { recursive: true });
    writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries)
      copyFileSync(join(migrations, entry.tag + '.sql'), join(folder, entry.tag + '.sql'));
    return folder;
  };
  const old = copy('old', 15);
  const bad = copy('bad', 16);
  const last = join(bad, '0015_finance_ledger.sql');
  writeFileSync(
    last,
    readFileSync(last, 'utf8') + '\n--> statement-breakpoint\nSELECT * FROM finance_missing_test;',
  );
  const legacy = openTaskStore(file, old);
  const project = createProject(legacy, '旧库合成项目');
  legacy.close();
  const taskId = randomUUID();
  const docId = randomUUID();
  const bodyId = randomUUID();
  const timestamp = '2026-11-01T00:00:00.000Z';
  const legacyDb = openToolchainProbe(file, old).sqlite;
  legacyDb
    .prepare(
      'INSERT INTO task_items(id,workspace_id,title,objective,version,updated_at) VALUES(?,?,?,?,1,?)',
    )
    .run(taskId, 'local', '旧库合成任务', '保留原任务', timestamp);
  legacyDb
    .prepare(
      'INSERT INTO documents(id,task_id,body_id,body_revision,editor_schema) VALUES(?,?,?,0,1)',
    )
    .run(docId, taskId, bodyId);
  legacyDb.prepare('INSERT INTO task_projects(task_id,matter_id) VALUES(?,?)').run(taskId, project);
  legacyDb.close();
  const readTask = { operation: 'read' as const, protocol_version, task_id: taskId };
  const expectedTask = {
    ok: true,
    state: null,
    objective_state: null,
    receipt: null,
    tasks: [
      {
        id: taskId,
        title: '旧库合成任务',
        objective: '保留原任务',
        version: 1,
        status: 'todo',
        priority: 0,
        due_date: null,
        tags: [],
        assignee: '本人',
        updated_at: timestamp,
        document_id: docId,
        body_id: bodyId,
        body_revision: 0,
        editor_schema: 1,
        document_archived_at: null,
        matter_id: project,
        matter_title: '旧库合成项目',
        subscribed: false,
      },
    ],
  };

  expect(() => openTaskStore(file, bad)).toThrow();
  const rolledBack = openToolchainProbe(file, old).sqlite;
  expect(
    rolledBack.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'finance_%'").all(),
  ).toEqual([]);
  expect(rolledBack.pragma('integrity_check', { simple: true })).toBe('ok');
  rolledBack.close();

  const next = openTaskStore(file, migrations);
  try {
    expect(next.execute(readTask)).toEqual({
      ...expectedTask,
      tasks: expectedTask.tasks.map((task) => ({
        ...task,
        document_metadata_version: 1,
        calendar: emptyTaskCalendar,
      })),
    });
    expect(list(next, project)).toMatchObject({
      id: project,
      title: '旧库合成项目',
      task_count: 1,
      outstanding_cents: null,
    });
    expect(
      ledger(createFinanceApplication(next.finance).execute(contract(project))).amount_cents,
    ).toBe(10_000_000);
  } finally {
    next.close();
  }
});
