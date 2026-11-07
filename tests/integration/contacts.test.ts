import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createContactsApplication } from '../../packages/application/src/contacts-application';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';

const roots: string[] = [];
const migrations = resolve('packages/local-db/migrations');
const list = { protocol_version: 1, operation: 'list' } as const;
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
it('migrates existing data, scopes relations, and reopens an idempotent contact save', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-contact-'));
  roots.push(root);
  const old = join(root, 'old-migrations');
  cpSync(migrations, old, { recursive: true });
  const journal = join(old, 'meta/_journal.json');
  const meta = JSON.parse(readFileSync(journal, 'utf8'));
  writeFileSync(journal, JSON.stringify({ ...meta, entries: meta.entries.slice(0, 16) }));
  const file = join(root, 'workspace.sqlite');
  const createProject = (store: ReturnType<typeof openTaskStore>, title: string) => {
    const result = store.catalog.execute({
      protocol_version: 1,
      operation: 'create_project',
      title,
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
    });
    if (!result.ok || !result.target_id) throw new Error('Synthetic project not created');
    return result.target_id;
  };
  const oldStore = openTaskStore(file, old);
  const projectId = createProject(oldStore, '合成项目');
  oldStore.close();
  const other = openTaskStore(file, migrations, 'other');
  const outside = createProject(other, '隔离项目');
  const local = openTaskStore(file, migrations);
  const app = createContactsApplication(local.contacts);
  const request = {
    ...list,
    operation: 'save',
    contact_id: randomUUID(),
    receipt: randomUUID(),
    expected_version: 0,
    name: '合成联系人',
    phone: '010-00000000',
    email: 'test@example.invalid',
    kind: 'person',
    project_ids: [projectId],
  } as const;
  try {
    expect(app.execute({ ...request, project_ids: [projectId, outside] })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(app.execute(list)).toMatchObject({ contacts: [] });
    expect(app.execute(request)).toMatchObject({
      ok: true,
      receipt: request.receipt,
      contacts: [{ version: 1 }],
    });
    expect(app.execute(request)).toMatchObject({ ok: true, contacts: [{ version: 1 }] });
    expect(app.execute({ ...request, name: '不同内容' })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    expect(app.execute({ ...request, receipt: randomUUID() })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    const update = {
      ...request,
      expected_version: 1,
      receipt: randomUUID(),
      phone: '010-00000001',
    };
    const probe = openToolchainProbe(file, migrations).sqlite;
    try {
      // 在关联更新之后中断回执插入，联系人和关系必须一并回滚。
      probe.exec(`CREATE TRIGGER test_contact_receipt_abort BEFORE INSERT ON contact_receipts BEGIN
        SELECT RAISE(ABORT, 'synthetic receipt failure'); END`);
      expect(app.execute({ ...update, project_ids: [] })).toMatchObject({
        ok: false,
        code: 'RESULT_UNKNOWN',
      });
      expect(app.execute(list)).toMatchObject({
        contacts: [{ version: 1, phone: request.phone, project_ids: [projectId] }],
      });
      probe.exec('DROP TRIGGER test_contact_receipt_abort');
    } finally {
      probe.close();
    }
    expect(app.execute(update)).toMatchObject({ ok: true, contacts: [{ version: 2 }] });
    expect(other.contacts.execute(list)).toMatchObject({ contacts: [] });
  } finally {
    other.close();
    local.close();
  }
  const reopened = openTaskStore(file, migrations);
  try {
    expect(reopened.contacts.execute(list)).toMatchObject({
      ok: true,
      contacts: [
        { id: request.contact_id, project_ids: [projectId], version: 2, phone: '010-00000001' },
      ],
    });
  } finally {
    reopened.close();
  }
});
