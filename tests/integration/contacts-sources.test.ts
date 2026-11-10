import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { integrationMigrations } from '../../packages/local-db/src/migration-manifest';
import { createContactsStore } from '../../packages/local-db/src/contacts-store';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { agentRunSchema } from '../../packages/contracts/src';
import { createContactsApplication } from '../../packages/application/src/contacts-application';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
const roots: string[] = [];
const migrations = resolve('packages/local-db/migrations');
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const profile = () => ({
  protocol_version: 1 as const,
  operation: 'save' as const,
  contact_id: randomUUID(),
  receipt: randomUUID(),
  expected_version: 0,
  name: '合成书记员',
  kind: 'person' as const,
  phone: '',
  email: '',
  city: '北京',
  project_ids: [],
});
it('upgrades existing profiles without inferring address and preserves old receipts and omitted address on reopen', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-contact-address-'));
  roots.push(root);
  const file = join(root, 'work.sqlite');
  const old = new Database(file);
  old.exec(
    'CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY,hash TEXT NOT NULL,created_at NUMERIC)',
  );
  for (const migration of integrationMigrations.slice(0, -1)) {
    old.exec(readFileSync(join(migrations, migration.tag + '.sql'), 'utf8'));
    old
      .prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)')
      .run(migration.hash, migration.when);
  }
  const previous = createContactsStore(old, 'local');
  const saved = profile();
  expect(previous.execute(saved)).toMatchObject({ ok: true });
  old.close();
  const store = openTaskStore(file, migrations);
  const app = createContactsApplication(store.contacts);
  expect(app.execute({ protocol_version: 1, operation: 'list' })).toMatchObject({
    contacts: [{ city: '北京', address: '' }],
  });
  expect(
    app.execute({
      ...saved,
      receipt: randomUUID(),
      expected_version: 1,
      address: '合成法院办公地址',
    }),
  ).toMatchObject({ ok: true, contacts: [{ version: 2 }] });
  expect(app.execute(saved)).toMatchObject({
    ok: true,
    contacts: [{ version: 2, address: '合成法院办公地址' }],
  });
  expect(app.execute({ ...saved, receipt: randomUUID(), expected_version: 2 })).toMatchObject({
    ok: true,
    contacts: [{ version: 3, city: '北京', address: '合成法院办公地址' }],
  });
  store.close();
  const reopened = openTaskStore(file, migrations);
  try {
    expect(reopened.contacts.execute({ protocol_version: 1, operation: 'list' })).toMatchObject({
      contacts: [{ version: 3, address: '合成法院办公地址' }],
    });
  } finally {
    reopened.close();
  }
});
it('authenticates source scope, rolls back whole relations on failure, replays committed receipts after access loss and preserves sources when unlinked', async () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-contact-sources-'));
  roots.push(root);
  const file = join(root, 'work.sqlite');
  const store = openTaskStore(file, migrations);
  const probe = openToolchainProbe(file, migrations).sqlite;
  const app = createContactsApplication(store.contacts);
  const saved = profile();
  const run = agentRunSchema.parse({
    id: randomUUID(),
    scope: 'home',
    model: 'gpt-4.1-mini',
    provider: 'openai',
    prompt: '合成对话',
    output: '原始内容',
    status: 'succeeded',
    sequence: 2,
    message: '完成',
    usage: null,
  });
  store.agentHistory.register(run);
  const source = { kind: 'run' as const, id: run.id, scope: run.scope };
  const request = {
    protocol_version: 1 as const,
    operation: 'set_source_links' as const,
    contact_id: saved.contact_id,
    receipt: randomUUID(),
    expected_version: 1,
    kind: 'run' as const,
    source_refs: [source],
  };
  const allowed = async (ref: typeof source, owner: string) =>
    owner === 'window-a' && ref.id === source.id && ref.scope === 'home';
  try {
    expect(app.execute(saved)).toMatchObject({ ok: true });
    expect(app.execute(request)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await app.executeForOwner(request, 'window-b', allowed)).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(
      await app.executeForOwner({ ...request, source_refs: [source, source] }, 'window-a', allowed),
    ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(
      await app.executeForOwner(
        { ...request, source_refs: [{ ...source, scope: `project:${randomUUID()}` }] },
        'window-a',
        async () => true,
      ),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(
      await app.executeForOwner(
        { ...request, source_refs: [source, { ...source, id: randomUUID() }] },
        'window-a',
        async () => true,
      ),
    ).toMatchObject({ ok: false });
    expect(probe.prepare('SELECT count(*) n FROM contact_source_links').get()).toEqual({ n: 0 });
    probe.exec(
      "CREATE TRIGGER synthetic_contact_source_abort BEFORE INSERT ON contact_workspace_receipts BEGIN SELECT RAISE(ABORT, 'synthetic'); END",
    );
    expect(await app.executeForOwner(request, 'window-a', allowed)).toMatchObject({
      ok: false,
      code: 'RESULT_UNKNOWN',
    });
    expect(probe.prepare('SELECT count(*) n FROM contact_source_links').get()).toEqual({ n: 0 });
    expect(app.execute({ protocol_version: 1, operation: 'list' })).toMatchObject({
      contacts: [{ version: 1 }],
    });
    probe.exec('DROP TRIGGER synthetic_contact_source_abort');
    expect(await app.executeForOwner(request, 'window-a', allowed)).toMatchObject({
      ok: true,
      contacts: [{ version: 2 }],
      detail: { source_links: [source] },
    });
    const read = { protocol_version: 1, operation: 'read', contact_id: saved.contact_id };
    const positiveReopen = openTaskStore(file, migrations);
    try {
      expect(
        await createContactsApplication(positiveReopen.contacts).executeForOwner(
          read,
          'window-a',
          allowed,
        ),
      ).toMatchObject({ ok: true, contacts: [{ version: 2 }], detail: { source_links: [source] } });
    } finally {
      positiveReopen.close();
    }

    expect(await app.executeForOwner(request, 'window-a', async () => false)).toMatchObject({
      ok: true,
      receipt: request.receipt,
      contacts: [{ version: 2 }],
      detail: { source_links: [], sources_unavailable: true },
    });
    expect(
      await app.executeForOwner({ ...request, source_refs: [] }, 'window-a', allowed),
    ).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(
      await app.executeForOwner(
        { ...request, receipt: randomUUID(), source_refs: [] },
        'window-a',
        allowed,
      ),
    ).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(app.execute(read)).toMatchObject({
      ok: true,
      detail: { source_links: [], sources_unavailable: true },
    });
    expect(
      await app.executeForOwner(
        { ...request, receipt: randomUUID(), expected_version: 2, source_refs: [] },
        'window-a',
        allowed,
      ),
    ).toMatchObject({ ok: true, contacts: [{ version: 3 }], detail: { source_links: [] } });
    expect(store.agentHistory.load().find((item) => item.id === run.id)?.output).toBe('原始内容');
    expect(app.execute({ ...saved, expected_version: 3, receipt: request.receipt })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
  } finally {
    probe.close();
    store.close();
  }
  const reopened = openTaskStore(file, migrations);
  try {
    expect(
      reopened.contacts.execute({
        protocol_version: 1,
        operation: 'read',
        contact_id: saved.contact_id,
      }),
    ).toMatchObject({ ok: true, contacts: [{ version: 3 }], detail: { source_links: [] } });
  } finally {
    reopened.close();
  }
});
it('scopes material and payment relationships through their original owners and SQLite, then reopens positive links and current reversals', async () => {
  const { createMaterialApplication } =
    await import('../../packages/application/src/material-application');
  const { createMaterialFiles } =
    await import('../../apps/desktop/src/main/adapters/material-files');
  const { createFinanceApplication } =
    await import('../../packages/application/src/finance-application');
  const root = mkdtempSync(join(tmpdir(), 'caselite-contact-owner-sources-'));
  roots.push(root);
  const file = join(root, 'work.sqlite');
  const store = openTaskStore(file, migrations);
  const outside = openTaskStore(file, migrations, 'outside');
  const db = openToolchainProbe(file, migrations).sqlite;
  const app = createContactsApplication(store.contacts);
  const saved = profile();
  const seed = (owner: typeof store, workspace: string) => {
    const task = owner.execute({
      protocol_version: 1,
      operation: 'create',
      title: '合成材料任务',
      objective: '',
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
    });
    const project = owner.catalog.execute({
      protocol_version: 1,
      operation: 'create_project',
      title: '合成账款项目',
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
    });
    if (!task.ok || !project.ok || !project.target_id) throw Error('Synthetic setup failed');
    const material = randomUUID(),
      scope = task.tasks[0].id,
      projectId = project.target_id;
    db.prepare(
      'INSERT INTO material_sources(id,workspace_id,task_id,asset_version_id,name,sha256,bytes,page_count) VALUES(?,?,?,?,?,?,?,?)',
    ).run(material, workspace, scope, randomUUID(), '合成微信截图.png', 'a'.repeat(64), 32, 0);
    const finance = createFinanceApplication(owner.finance);
    const ledger = finance.execute({
      protocol_version: 1,
      operation: 'register_contract',
      project_id: projectId,
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
      number: '合成合同',
      amount_cents: 100,
      installments: [{ amount_cents: 100, due_date: '2026-11-10' }],
    });
    if (!ledger.ok || ledger.kind !== 'ledger' || !ledger.ledger)
      throw Error('Synthetic contract failed');
    const paid = finance.execute({
      protocol_version: 1,
      operation: 'record_payment',
      project_id: projectId,
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
      installment_id: ledger.ledger.installments[0].id,
      amount_cents: 100,
    });
    if (!paid.ok || paid.kind !== 'ledger' || !paid.ledger) throw Error('Synthetic payment failed');
    return {
      material: { kind: 'material' as const, id: material, scope },
      payment: { kind: 'payment' as const, id: paid.ledger.payments[0].id, scope: projectId },
      finance,
    };
  };
  const local = seed(store, 'local'),
    foreign = seed(outside, 'outside');
  const materials = createMaterialApplication({
    store: store.materials,
    files: createMaterialFiles(join(root, 'materials')),
    processor: {
      configuration: 'NOT_RUN',
      inspect: async () => {
        throw Error('No processing allowed');
      },
      process: async () => {
        throw Error('No processing allowed');
      },
    },
    createTask: () => {
      throw Error('No hidden task allowed');
    },
    taskExists: (id) => store.execute({ protocol_version: 1, operation: 'read', task_id: id }).ok,
    id: randomUUID,
    hash: (text) => text,
  });
  const allowed = async (ref: typeof local.material | typeof local.payment) => {
    if (ref.kind === 'material') {
      const result = await materials.execute({
        protocol_version: 1,
        operation: 'list',
        scope: ref.scope,
      });
      return (
        result.ok && result.materials.some((row) => row.id === ref.id && row.task_id === ref.scope)
      );
    }
    const result = local.finance.execute({
      protocol_version: 1,
      operation: 'read',
      project_id: ref.scope,
    });
    return (
      result.ok &&
      result.kind === 'ledger' &&
      Boolean(result.ledger?.payments.some((row) => row.id === ref.id))
    );
  };
  try {
    expect(app.execute(saved)).toMatchObject({ ok: true });
    for (const ref of [
      foreign.material,
      foreign.payment,
      { ...local.material, scope: foreign.material.scope },
      { ...local.payment, scope: foreign.payment.scope },
    ]) {
      const request = {
        protocol_version: 1,
        operation: 'set_source_links',
        contact_id: saved.contact_id,
        receipt: randomUUID(),
        expected_version: 1,
        kind: ref.kind,
        source_refs: [ref],
      };
      expect(
        await app.executeForOwner(request, 'window', (ref) =>
          ref.kind === 'run' ? Promise.resolve(false) : allowed(ref),
        ),
      ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
      expect(await app.executeForOwner(request, 'window', async () => true)).toMatchObject({
        ok: false,
        code: 'FORBIDDEN',
      });
    }
    for (const [index, ref] of [local.material, local.payment].entries())
      expect(
        await app.executeForOwner(
          {
            protocol_version: 1,
            operation: 'set_source_links',
            contact_id: saved.contact_id,
            receipt: randomUUID(),
            expected_version: index + 1,
            kind: ref.kind,
            source_refs: [ref],
          },
          'window',
          (ref) => (ref.kind === 'run' ? Promise.resolve(false) : allowed(ref)),
        ),
      ).toMatchObject({ ok: true });
    expect(
      local.finance.execute({
        protocol_version: 1,
        operation: 'reverse_payment',
        project_id: local.payment.scope,
        request_id: randomUUID(),
        idempotency_key: randomUUID(),
        payment_id: local.payment.id,
      }),
    ).toMatchObject({ ok: true });
  } finally {
    materials.close();
    db.close();
    outside.close();
    store.close();
  }
  const reopened = openTaskStore(file, migrations);
  try {
    const read = reopened.contacts.execute({
      protocol_version: 1,
      operation: 'read',
      contact_id: saved.contact_id,
    });
    expect(read).toMatchObject({
      ok: true,
      detail: { source_links: expect.arrayContaining([local.material, local.payment]) },
    });
    const ledger = createFinanceApplication(reopened.finance).execute({
      protocol_version: 1,
      operation: 'read',
      project_id: local.payment.scope,
    });
    expect(ledger).toMatchObject({
      ok: true,
      kind: 'ledger',
      ledger: { payments: [{ id: local.payment.id, reversed_at: expect.any(String) }] },
    });
  } finally {
    reopened.close();
  }
});
