import * as Y from 'yjs';
import { agentRunSchema } from '../../packages/contracts/src';
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createContactsApplication } from '../../packages/application/src/contacts-application';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';

function body(text: string) {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  const value = new Y.XmlText();
  value.insert(0, text);
  paragraph.push([value]);
  doc.getXmlFragment('default').push([paragraph]);
  try {
    return Array.from(Y.encodeStateAsUpdate(doc));
  } finally {
    doc.destroy();
  }
}
const roots: string[] = [];
const migrations = resolve('packages/local-db/migrations');
const list = { protocol_version: 1, operation: 'list' } as const;
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
it('migrates existing data, scopes relations, and reopens an idempotent contact save', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-contact-'));
  roots.push(root);
  const old = join(root, 'old-migrations');
  cpSync(migrations, old, { recursive: true });
  rmSync(join(old, 'meta/dual-history-1826.json'));
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

it('atomically preserves record revisions and receipts, scopes links and persisted AI sources, and reopens them', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-customer-workspace-'));
  roots.push(root);
  const file = join(root, 'workspace.sqlite');
  const store = openTaskStore(file, migrations),
    outside = openTaskStore(file, migrations, 'outside');
  const app = createContactsApplication(store.contacts);
  const profile = {
    ...list,
    operation: 'save' as const,
    contact_id: randomUUID(),
    receipt: randomUUID(),
    expected_version: 0,
    name: '合成客户',
    kind: 'person' as const,
    phone: '',
    email: '',
    project_ids: [],
    wechat: 'synthetic-wechat',
    tags: ['合成'],
  };
  const read = { ...list, operation: 'read' as const, contact_id: profile.contact_id };
  const probe = openToolchainProbe(file, migrations).sqlite;
  const ok = (response: ReturnType<typeof app.execute>) => {
    if (!response.ok) throw Error(response.message);
    return response;
  };
  const entry = {
    ...list,
    operation: 'save_entry' as const,
    contact_id: profile.contact_id,
    entry_id: randomUUID(),
    receipt: randomUUID(),
    expected_version: 0,
    kind: 'communication' as const,
    title: '合成电话',
    channel: 'phone' as const,
    occurred_on: '2026-11-10',
    state: body('合成沟通原文'),
  };
  try {
    ok(app.execute(profile));
    const legacy = { ...profile, expected_version: 1, receipt: randomUUID() };
    const { wechat: _wechat, tags: _tags, ...oldFields } = legacy;
    void _wechat;
    void _tags;
    expect(app.execute(oldFields)).toMatchObject({
      ok: true,
      contacts: [{ wechat: 'synthetic-wechat', tags: ['合成'], version: 2 }],
    });
    const revisions = () =>
      probe.prepare('SELECT COUNT(*) n FROM body_revisions').get() as { n: number };
    const before = revisions().n;
    probe.exec(
      `CREATE TRIGGER synthetic_customer_abort BEFORE INSERT ON contact_workspace_receipts BEGIN SELECT RAISE(ABORT,'synthetic'); END`,
    );
    expect(app.execute(entry)).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
    expect(ok(app.execute(read)).detail?.entries).toEqual([]);
    expect(revisions().n).toBe(before);
    probe.exec('DROP TRIGGER synthetic_customer_abort');
    const first = ok(app.execute(entry)).detail!.entries[0];
    expect(first).toMatchObject({ content: '合成沟通原文', version: 1, body_revision: 1 });
    expect(ok(app.execute(entry)).detail!.entries).toHaveLength(1);
    expect(revisions().n).toBe(before + 1);
    expect(app.execute({ ...entry, title: '不同内容' })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    const update = {
      ...entry,
      receipt: randomUUID(),
      expected_version: 1,
      state: body('更正后的原文'),
    };
    expect(ok(app.execute(update)).detail!.entries[0]).toMatchObject({
      body_id: first.body_id,
      body_revision: 2,
      version: 2,
    });
    expect(
      probe
        .prepare('SELECT revision FROM body_revisions WHERE body_id=? ORDER BY revision')
        .all(first.body_id),
    ).toEqual([{ revision: 1 }, { revision: 2 }]);
    expect(app.execute({ ...entry, receipt: randomUUID() })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    expect(
      app.execute({
        ...entry,
        entry_id: randomUUID(),
        receipt: randomUUID(),
        state: body('坏\0正文'),
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(app.execute({ ...profile, expected_version: 2, receipt: entry.receipt })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    expect(
      app.execute({ ...entry, entry_id: randomUUID(), receipt: profile.receipt }),
    ).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(outside.contacts.execute(read)).toMatchObject({ ok: false });
    const task = store.execute({
      protocol_version: 1,
      operation: 'create',
      title: '关联任务',
      objective: '',
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
    });
    if (!task.ok) throw Error(task.message);
    const link = {
      ...list,
      operation: 'set_links' as const,
      contact_id: profile.contact_id,
      expected_version: 2,
      receipt: randomUUID(),
      kind: 'task' as const,
      target_ids: [task.tasks[0].id],
    };
    expect(app.execute({ ...link, target_ids: [randomUUID()] })).toMatchObject({ ok: false });
    expect(ok(app.execute(link)).detail?.task_ids).toEqual(link.target_ids);
    expect(app.execute({ ...link, receipt: randomUUID(), target_ids: [] })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    expect(ok(app.execute(link)).contacts[0].version).toBe(3);
    const docLink = {
      ...link,
      receipt: randomUUID(),
      expected_version: 3,
      kind: 'document' as const,
      target_ids: [task.tasks[0].document_id],
    };
    expect(ok(app.execute(docLink)).detail?.document_ids).toEqual(docLink.target_ids);
    const raw = agentRunSchema.parse({
      id: randomUUID(),
      scope: `contact:${profile.contact_id}`,
      model: 'gpt-4.1-mini',
      provider: 'openai',
      prompt: '记录本次沟通',
      output: JSON.stringify({
        kind: 'contact_record',
        title: '合成候选',
        channel: 'other',
        occurred_on: null,
        summary: '仅合成',
      }),
      status: 'succeeded',
      sequence: 2,
      message: '完成',
      usage: null,
    });
    const ai = { ...entry, entry_id: raw.id, receipt: randomUUID(), source_run_id: raw.id };
    expect(app.execute(ai)).toMatchObject({ ok: false });
    for (const patch of [
      { status: 'failed' as const },
      { output_incomplete: true },
      { scope: `contact:${randomUUID()}` },
      { output: '非法候选' },
    ]) {
      const invalid = { ...raw, ...patch, id: randomUUID() };
      store.agentHistory.register(invalid);
      expect(
        app.execute({
          ...ai,
          entry_id: randomUUID(),
          receipt: randomUUID(),
          source_run_id: invalid.id,
        }),
      ).toMatchObject({ ok: false });
    }
    store.agentHistory.register(raw);
    expect(ok(app.execute(ai)).detail!.entries).toHaveLength(2);
    expect(ok(app.execute(ai)).detail!.entries).toHaveLength(2);
    expect(app.execute({ ...ai, entry_id: randomUUID(), receipt: randomUUID() })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    const foreign = { ...raw, id: randomUUID() };
    outside.agentHistory.register(foreign);
    expect(
      app.execute({
        ...ai,
        entry_id: randomUUID(),
        receipt: randomUUID(),
        source_run_id: foreign.id,
      }),
    ).toMatchObject({ ok: false });
  } finally {
    probe.close();
    outside.close();
    store.close();
  }
  const reopened = openTaskStore(file, migrations);
  try {
    const result = ok(reopened.contacts.execute(read));
    expect(result.detail!.entries).toHaveLength(2);
    expect(result.detail!.entries.find((r) => r.id === entry.entry_id)?.content).toBe(
      '更正后的原文',
    );
    expect(result.detail!.task_ids).toHaveLength(1);
    expect(result.detail!.document_ids).toHaveLength(1);
  } finally {
    reopened.close();
  }
});
