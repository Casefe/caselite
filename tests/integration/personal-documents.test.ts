import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as Y from 'yjs';
import { openTaskStore } from '../../packages/local-db/src/task-store';
import { openToolchainProbe } from '../../packages/local-db/src/connection';
import { createCatalogApplication } from '../../packages/application/src/catalog-application';
import { validateBody } from '../../packages/local-db/src/body-schema';
import type { CatalogResponse, TaskResponse } from '../../packages/contracts/src';

const migrations = resolve('packages/local-db/migrations');
const roots: string[] = [];
const closes: Array<() => void> = [];
afterEach(() => {
  for (const close of closes.splice(0).reverse()) close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
function good<T extends CatalogResponse | TaskResponse>(result: T): Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result as Extract<T, { ok: true }>;
}
function binary(text: string) {
  const doc = new Y.Doc(),
    paragraph = new Y.XmlElement('paragraph'),
    value = new Y.XmlText();
  value.insert(0, text);
  paragraph.insert(0, [value]);
  doc.getXmlFragment('default').insert(0, [paragraph]);
  const state = Array.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return state;
}
function tableBinary(text = '表格单元格') {
  const doc = new Y.Doc();
  const table = new Y.XmlElement('table');
  const row = new Y.XmlElement('tableRow');
  const cell = new Y.XmlElement('tableCell');
  cell.setAttribute('colwidth', [0]);
  const paragraph = new Y.XmlElement('paragraph');
  const value = new Y.XmlText();
  value.insert(0, text);
  paragraph.insert(0, [value]);
  cell.insert(0, [paragraph]);
  row.insert(0, [cell]);
  table.insert(0, [row]);
  doc.getXmlFragment('default').insert(0, [table]);
  const state = Array.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return state;
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-personal-document-'));
  roots.push(root);
  const file = join(root, 'synthetic.sqlite');
  const store = openTaskStore(file, migrations);
  let closed = false;
  const close = () => {
    if (!closed) {
      store.close();
      closed = true;
    }
  };
  closes.push(close);
  const connection = openToolchainProbe(file, migrations);
  closes.push(() => {
    if (connection.sqlite.open) connection.sqlite.close();
  });
  return {
    file,
    store,
    close,
    db: connection.sqlite,
    app: createCatalogApplication(store.catalog),
  };
}
function created(s: ReturnType<typeof setup>, title = '独立文档') {
  const command = { ...identity(), operation: 'create_document' as const, title };
  const result = good(s.app.execute(command));
  return { command, result, document: result.documents[0] };
}
function save(document: ReturnType<typeof created>['document'], text = '独立文档已保存正文') {
  return {
    ...identity(),
    operation: 'save_document_body' as const,
    document_id: document.id,
    body_id: document.body_id,
    expected_revision: document.body_revision,
    editor_schema: 1 as const,
    state: binary(text),
  };
}

it('creates one real personal Document with a legal blank Yjs paragraph and no hidden Task, then reopens it', () => {
  const s = setup(),
    { command, result, document } = created(s);
  expect(document).toMatchObject({
    owner_kind: 'personal',
    task_id: null,
    matter_id: null,
    body_revision: 1,
    editor_schema: 1,
    version: 1,
    in_library: false,
  });
  expect(result).toMatchObject({
    target_id: document.id,
    receipt: command.idempotency_key,
    state: null,
  });
  expect(s.db.prepare('SELECT count(*) AS n FROM task_items').get()).toEqual({ n: 0 });
  const read = good(
    s.app.execute({ protocol_version: 1, operation: 'read_document', id: document.id }),
  );
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(read.state!));
  expect(
    doc
      .getXmlFragment('default')
      .toArray()
      .map((node) => (node as Y.XmlElement).nodeName),
  ).toEqual(['paragraph']);
  expect(doc.getXmlFragment('default').toString()).toBe('<paragraph></paragraph>');
  doc.destroy();
  expect(good(s.app.execute({ ...command, request_id: randomUUID() })).target_id).toBe(document.id);
  expect(s.app.execute({ ...command, title: '同键异内容' })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  expect(s.db.prepare('SELECT count(*) AS n FROM documents').get()).toEqual({ n: 1 });
  s.close();
  const reopened = openTaskStore(s.file, migrations);
  closes.push(() => reopened.close());
  expect(
    good(
      reopened.catalog.execute({
        protocol_version: 1,
        operation: 'read_document',
        id: document.id,
      }),
    ).state,
  ).toEqual(read.state);
  expect(good(reopened.execute({ protocol_version: 1, operation: 'list' })).tasks).toEqual([]);
});

it('saves revisions atomically, reconciles the original key, and preserves separate metadata versions', () => {
  const s = setup(),
    { document } = created(s),
    command = save(document);
  const organized = good(
    s.app.execute({
      ...identity(),
      operation: 'organize_document',
      id: document.id,
      expected_version: 1,
      collection: '合成资料',
      tags: ['测试'],
      favorite: true,
      in_library: true,
    }),
  );
  expect(organized.documents[0]).toMatchObject({ version: 2, body_revision: 1, in_library: true });
  const result = good(s.app.execute(command));
  expect(result).toMatchObject({
    receipt: command.idempotency_key,
    target_id: document.id,
    state: null,
  });
  expect(result.documents[0]).toMatchObject({
    version: 2,
    body_revision: 2,
    tags: ['测试'],
    in_library: true,
  });
  const status = good(
    s.app.execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: command.idempotency_key,
    }),
  );
  expect(status).toEqual(result);
  expect(good(s.app.execute({ ...command, request_id: randomUUID() }))).toEqual(result);
  expect(s.app.execute({ ...command, state: binary('同键不同正文') })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  expect(
    good(s.app.execute({ protocol_version: 1, operation: 'read_document', id: document.id })).state,
  ).toEqual(command.state);
  expect(
    s.db.prepare('SELECT count(*) AS n FROM body_revisions WHERE body_id=?').get(document.body_id),
  ).toEqual({ n: 2 });
  expect(
    s.db
      .prepare('SELECT count(*) AS n FROM catalog_activity WHERE operation=?')
      .get('save_document_body'),
  ).toEqual({ n: 1 });
  expect(s.db.pragma('foreign_key_check')).toEqual([]);
  s.close();
  const reopened = openTaskStore(s.file, migrations);
  closes.push(() => reopened.close());
  expect(
    good(
      reopened.catalog.execute({
        protocol_version: 1,
        operation: 'read_document',
        id: document.id,
      }),
    ).state,
  ).toEqual(command.state);
  expect(
    good(
      reopened.catalog.execute({
        protocol_version: 1,
        operation: 'status',
        idempotency_key: command.idempotency_key,
      }),
    ),
  ).toEqual(result);
});

it('rejects cross-workspace reads, saves, status and page references without creating a Task', () => {
  const s = setup(),
    { document, command } = created(s);
  const other = openTaskStore(s.file, migrations, 'other-workspace');
  closes.push(() => other.close());
  expect(good(other.catalog.execute({ protocol_version: 1, operation: 'list' })).documents).toEqual(
    [],
  );
  expect(
    other.catalog.execute({ protocol_version: 1, operation: 'read_document', id: document.id }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(other.catalog.execute(save(document))).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(
    other.catalog.execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: command.idempotency_key,
    }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(other.reviewDocumentExists(document.id)).toBe(false);
  expect(other.agentPage.read(`document:${document.id}`)).toBeUndefined();
  expect(s.store.agentPage.read(`document:${document.id}`)).toMatchObject({
    title: document.title,
    version: '1:1',
    archived: false,
    text: document.title,
  });
  expect(
    s.store.reviewState({
      task_id: randomUUID(),
      document_id: document.id,
      body_id: document.body_id,
      revision: 1,
      paragraph: 0,
      from: 0,
      to: 0,
      text: '',
    }),
  ).toBeUndefined();
});

it('keeps invalid bodies, wrong identities, stale revisions, format downgrade and archived saves from changing the original', () => {
  const s = setup(),
    { document } = created(s),
    original = good(
      s.app.execute({ protocol_version: 1, operation: 'read_document', id: document.id }),
    );
  expect(s.app.execute({ ...save(document), body_id: randomUUID() })).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
  });
  expect(s.app.execute({ ...save(document), expected_revision: 2 })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  expect(s.app.execute({ ...save(document), state: [1, 2, 3] })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(
    good(s.app.execute({ protocol_version: 1, operation: 'read_document', id: document.id })).state,
  ).toEqual(original.state);
  const v2 = good(s.app.execute({ ...save(document), editor_schema: 2 })).documents[0];
  expect(s.app.execute(save(v2))).toMatchObject({ ok: false, code: 'CONFLICT' });
  good(
    s.app.execute({
      ...identity(),
      operation: 'archive_document',
      id: document.id,
      expected_version: v2.version,
      archived: true,
    }),
  );
  expect(s.app.execute({ ...save(v2), editor_schema: 2 })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  expect(
    good(s.app.execute({ protocol_version: 1, operation: 'read_document', id: document.id }))
      .documents[0],
  ).toMatchObject({ body_revision: 2, editor_schema: 2 });
});

it.each(['body_revisions', 'catalog_activity', 'catalog_receipts'])(
  'rolls back a failed %s creation step and retries the same key once',
  (table) => {
    const s = setup(),
      command = { ...identity(), operation: 'create_document' as const, title: '故障保全文档' };
    s.db.exec(
      `CREATE TRIGGER reject_personal_step BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`,
    );
    expect(s.app.execute(command)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    for (const name of [
      'documents',
      'body_revisions',
      'catalog_activity',
      'catalog_receipts',
      'task_items',
    ])
      expect(s.db.prepare(`SELECT count(*) AS n FROM ${name}`).get()).toEqual({ n: 0 });
    expect(
      s.app.execute({
        protocol_version: 1,
        operation: 'status',
        idempotency_key: command.idempotency_key,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    s.db.exec('DROP TRIGGER reject_personal_step');
    const result = good(s.app.execute(command));
    expect(good(s.app.execute(command))).toEqual(result);
    expect(s.db.prepare('SELECT count(*) AS n FROM documents').get()).toEqual({ n: 1 });
  },
);

it.each(['body_revisions', 'catalog_activity', 'catalog_receipts'])(
  'retains the old body and revision after a failed %s save step',
  (table) => {
    const s = setup(),
      { document } = created(s),
      command = save(document);
    s.db.exec(
      `CREATE TRIGGER reject_personal_step BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`,
    );
    expect(s.app.execute(command)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(
      good(s.app.execute({ protocol_version: 1, operation: 'read_document', id: document.id }))
        .documents[0].body_revision,
    ).toBe(1);
    expect(
      s.db
        .prepare('SELECT count(*) AS n FROM body_revisions WHERE body_id=?')
        .get(document.body_id),
    ).toEqual({ n: 1 });
    s.db.exec('DROP TRIGGER reject_personal_step');
    expect(good(s.app.execute(command)).documents[0].body_revision).toBe(2);
  },
);

it('reopens a committed personal table revision and rejects malformed grids without replacing it', () => {
  const s = setup(),
    { document } = created(s, '表格独立文档');
  const tableState = tableBinary('已提交单元格');
  const committed = good(s.app.execute({ ...save(document), state: tableState })).documents[0];
  expect(committed.body_revision).toBe(2);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(tableState));
  doc
    .getXmlFragment('default')
    .get(0)
    .insert(1, [new Y.XmlElement('tableRow')]);
  const malformed = Array.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  expect(() => validateBody(Uint8Array.from(malformed), true)).toThrow('Incomplete table grid');
  expect(
    s.app.execute({
      ...save(committed),
      state: malformed,
    }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  expect(
    good(s.app.execute({ protocol_version: 1, operation: 'read_document', id: document.id })).state,
  ).toEqual(tableState);
  expect(
    s.db.prepare('SELECT count(*) AS n FROM body_revisions WHERE body_id=?').get(document.body_id),
  ).toEqual({ n: 2 });
  s.close();
  const reopened = openTaskStore(s.file, migrations);
  closes.push(() => reopened.close());
  expect(
    good(
      reopened.catalog.execute({
        protocol_version: 1,
        operation: 'read_document',
        id: document.id,
      }),
    ).documents[0],
  ).toMatchObject({ body_revision: 2 });
  expect(
    good(
      reopened.catalog.execute({
        protocol_version: 1,
        operation: 'read_document',
        id: document.id,
      }),
    ).state,
  ).toEqual(tableState);
});

it('preserves the original Task write/read/status path and enforces ownership CHECKs with a valid local Task parent', () => {
  const s = setup();
  const create = {
    ...identity(),
    operation: 'create' as const,
    title: '升级后原任务',
    objective: '',
  };
  const task = good(s.store.execute(create)).tasks[0];
  expect(
    good(
      s.store.execute({
        protocol_version: 1,
        operation: 'status',
        idempotency_key: create.idempotency_key,
      }),
    ).tasks[0].id,
  ).toBe(task.id);
  const command = {
    ...identity(),
    operation: 'save' as const,
    task_id: task.id,
    document_id: task.document_id,
    body_id: task.body_id,
    expected_revision: task.body_revision,
    editor_schema: 1 as const,
    state: binary('旧路径继续保存'),
  };
  const result = good(s.store.execute(command));
  expect(
    good(s.store.execute({ protocol_version: 1, operation: 'read', task_id: task.id })).state,
  ).toEqual(command.state);
  expect(
    good(
      s.store.execute({
        protocol_version: 1,
        operation: 'status',
        idempotency_key: command.idempotency_key,
      }),
    ),
  ).toEqual(result);
  expect(
    s.app.execute({
      ...save(good(s.app.execute({ protocol_version: 1, operation: 'list' })).documents[0]),
      expected_revision: result.tasks[0].body_revision,
    }),
  ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  const insert = s.db.prepare(
    'INSERT INTO documents(id,task_id,body_id,body_revision,editor_schema,owner_kind,personal_workspace_id,personal_title,personal_updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
  );
  const validTask = good(
    s.store.execute({ ...identity(), operation: 'create', title: '合法父任务', objective: '' }),
  ).tasks[0];
  // 使用同库真实父Task，确保拒绝来自owner互斥约束而非找不到外键目标。
  for (const [owner, taskId, workspace, title] of [
    ['personal', validTask.id, 'local', '冲突'],
    ['task', validTask.id, 'local', '冲突'],
    ['invalid', null, 'local', '冲突'],
    ['personal', null, 'local', ''],
    ['personal', null, null, '缺范围'],
  ] as const) {
    expect(() =>
      insert.run(
        randomUUID(),
        taskId,
        randomUUID(),
        1,
        1,
        owner,
        workspace,
        title,
        new Date().toISOString(),
      ),
    ).toThrow(/CHECK/);
  }
});
