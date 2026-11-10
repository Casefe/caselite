import { integrationMigrations } from '../../packages/local-db/src/migration-manifest';
import { emptyTaskCalendar } from '@caselite/contracts';
import { afterEach, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import * as Y from 'yjs';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
import { createTaskApplication } from '../../packages/application/src/task-application';
import type { Task, TaskRequest, TaskResponse } from '../../packages/contracts/src';

const migrations = resolve('packages/local-db/migrations');
const roots: string[] = [],
  closes: Array<() => void> = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
function ok(response: TaskResponse) {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error(response.message);
  return response;
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
function storeAt(file: string, folder = migrations, workspace = 'local') {
  const store = openTaskStore(file, folder, workspace),
    app = createTaskApplication(store);
  let open = true;
  const close = () => {
    if (open) {
      store.close();
      open = false;
    }
  };
  closes.push(close);
  return { app, close };
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-fixed-snapshot-'));
  roots.push(root);
  const file = join(root, 'workspace.sqlite');
  return { root, file, ...storeAt(file) };
}
function seed(app: ReturnType<typeof createTaskApplication>, title = '合成合同') {
  const task = ok(app.execute({ ...identity(), operation: 'create', title, objective: '' }))
    .tasks[0];
  return save(app, task, '付款期限为十日。');
}
function save(app: ReturnType<typeof createTaskApplication>, task: Task, text: string) {
  return ok(
    app.execute({
      ...identity(),
      operation: 'save',
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: task.body_revision,
      editor_schema: 1,
      state: binary(text),
    }),
  ).tasks[0];
}
function create(task: Task): Extract<TaskRequest, { operation: 'create_snapshot' }> {
  return {
    ...identity(),
    operation: 'create_snapshot',
    task_id: task.id,
    document_id: task.document_id,
    body_id: task.body_id,
    expected_revision: task.body_revision,
    expected_metadata_version: task.document_metadata_version!,
    expected_task_version: task.version,
    note: '付款核对稿',
  };
}
function query(task: Task, snapshot_id: string): TaskRequest {
  return {
    protocol_version: 1,
    operation: 'read_snapshot',
    task_id: task.id,
    document_id: task.document_id,
    snapshot_id,
  };
}
function inspect(file: string) {
  const db = openToolchainProbe(file, migrations).sqlite;
  closes.push(() => {
    if (db.open) db.close();
  });
  return db;
}

it('keeps exact saved v1 and immutable metadata after editing v2, renaming and reopening', () => {
  const { app, file, close } = setup(),
    task = seed(app);
  const original = ok(
    app.execute({ protocol_version: 1, operation: 'read', task_id: task.id }),
  ).state;
  const snapshot = ok(app.execute(create(task))).snapshots![0];
  const updated = save(app, task, '付款期限为三十日。');
  ok(
    app.execute({
      ...identity(),
      operation: 'update',
      task_id: task.id,
      expected_version: updated.version,
      title: '新标题',
      objective: '',
    }),
  );
  close();
  const next = storeAt(file);
  const fixed = ok(next.app.execute(query(task, snapshot.id)));
  expect(fixed.state).toEqual(original);
  expect(fixed.snapshots![0]).toMatchObject({
    title: '合成合同',
    body_revision: 1,
    kind: 'draft',
    source_refs: [],
    content_sha256: createHash('sha256').update(Uint8Array.from(original!)).digest('hex'),
  });
  expect(
    ok(next.app.execute({ protocol_version: 1, operation: 'read', task_id: task.id })).state,
  ).not.toEqual(original);
});

it('reuses one snapshot and activity for same-key replay or a new-key duplicate and preserves original note', () => {
  const { app, file, close } = setup(),
    task = seed(app),
    request = create(task);
  const first = ok(app.execute(request));
  close();
  const next = storeAt(file);
  expect(ok(next.app.execute({ ...request, request_id: randomUUID() }))).toEqual(first);
  const repeated = ok(next.app.execute({ ...request, ...identity(), note: '不同说明不得覆盖' }));
  expect(repeated.snapshot_created).toBe(false);
  expect(repeated.snapshots).toEqual(first.snapshots);
  expect(next.app.execute({ ...request, note: '篡改相同键' })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  const db = inspect(file);
  expect(db.prepare('SELECT count(*) AS n FROM deliverable_snapshots').get()).toEqual({ n: 1 });
  expect(
    db.prepare("SELECT count(*) AS n FROM task_activity WHERE operation='create_snapshot'").get(),
  ).toEqual({ n: 1 });
  expect(
    ok(
      next.app.execute({
        protocol_version: 1,
        operation: 'status',
        idempotency_key: request.idempotency_key,
      }),
    ),
  ).toEqual(first);
});

it.each(['task_receipts', 'task_activity'])(
  'rolls back the snapshot if %s fails, then retries the original key',
  (table) => {
    const { app, file } = setup(),
      task = seed(app),
      request = create(task),
      db = inspect(file);
    db.exec(
      `CREATE TRIGGER synthetic_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;`,
    );
    expect(app.execute(request)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
    expect(db.prepare('SELECT count(*) AS n FROM deliverable_snapshots').get()).toEqual({ n: 0 });
    expect(
      app.execute({
        protocol_version: 1,
        operation: 'status',
        idempotency_key: request.idempotency_key,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    db.exec('DROP TRIGGER synthetic_failure');
    expect(ok(app.execute(request)).snapshot_created).toBe(true);
    expect(db.prepare('SELECT count(*) AS n FROM deliverable_snapshots').get()).toEqual({ n: 1 });
  },
);

it('rejects wrong workspace, cross-document binding, stale revision and metadata, and archived creation', () => {
  const { app, file } = setup(),
    task = seed(app),
    otherTask = seed(app, '另一份文档'),
    request = create(task);
  const fixed = ok(app.execute(request)).snapshots![0];
  const other = storeAt(file, migrations, 'other');
  expect(other.app.execute(create(task))).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(other.app.execute(query(task, fixed.id))).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(app.execute(query(otherTask, fixed.id))).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(app.execute({ ...create(task), body_id: otherTask.body_id })).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
  });
  const updated = save(app, task, '新版');
  expect(app.execute(create(task))).toMatchObject({ ok: false, code: 'CONFLICT' });
  const db = inspect(file);
  db.prepare('UPDATE documents SET metadata_version=metadata_version+1 WHERE id=?').run(
    task.document_id,
  );
  expect(app.execute(create(updated))).toMatchObject({ ok: false, code: 'CONFLICT' });
  db.prepare('UPDATE documents SET archived_at=? WHERE id=?').run(
    new Date().toISOString(),
    task.document_id,
  );
  const archived = ok(app.execute({ protocol_version: 1, operation: 'read', task_id: task.id }))
    .tasks[0];
  expect(app.execute(create(archived))).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(ok(app.execute(query(task, fixed.id))).snapshots![0].id).toBe(fixed.id);
});

it('enforces immutable rows and referenced body and fails closed on a corrupted digest', () => {
  const { app, file } = setup(),
    task = seed(app),
    snapshot = ok(app.execute(create(task))).snapshots![0],
    db = inspect(file);
  expect(() =>
    db.prepare('UPDATE deliverable_snapshots SET note=? WHERE id=?').run('changed', snapshot.id),
  ).toThrow();
  expect(() =>
    db.prepare('DELETE FROM deliverable_snapshots WHERE id=?').run(snapshot.id),
  ).toThrow();
  expect(() =>
    db
      .prepare('UPDATE body_revisions SET state=? WHERE body_id=? AND revision=?')
      .run(Buffer.from(binary('伪造')), task.body_id, 1),
  ).toThrow();
  expect(() =>
    db.prepare('DELETE FROM body_revisions WHERE body_id=? AND revision=?').run(task.body_id, 1),
  ).toThrow();
  // 仅隔离夹具故意撤去触发器模拟损坏；读取不能静默改读最新稿。
  db.exec('DROP TRIGGER delivery_snapshot_no_update');
  db.prepare('UPDATE deliverable_snapshots SET content_sha256=? WHERE id=?').run(
    '0'.repeat(64),
    snapshot.id,
  );
  expect(app.execute(query(task, snapshot.id))).toMatchObject({ ok: false, code: 'READ_FAILED' });
});

it('lists bounded pages and cannot list another document by changing only the document id', () => {
  const { app } = setup();
  let task = seed(app);
  for (let index = 0; index < 22; index++) {
    ok(app.execute(create(task)));
    task = save(app, task, `合成第${index + 2}版`);
  }
  const first = ok(
    app.execute({
      protocol_version: 1,
      operation: 'list_snapshots',
      task_id: task.id,
      document_id: task.document_id,
      offset: 0,
    }),
  );
  const last = ok(
    app.execute({
      protocol_version: 1,
      operation: 'list_snapshots',
      task_id: task.id,
      document_id: task.document_id,
      offset: 20,
    }),
  );
  expect(first.snapshots).toHaveLength(20);
  expect(first.page).toMatchObject({ total: 22, has_more: true });
  expect(last.snapshots).toHaveLength(2);
  expect(last.page).toMatchObject({ total: 22, has_more: false });
  expect(new Set([...first.snapshots!, ...last.snapshots!].map((item) => item.id)).size).toBe(22);
  expect(
    app.execute({
      protocol_version: 1,
      operation: 'list_snapshots',
      task_id: task.id,
      document_id: randomUUID(),
      offset: 0,
    }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
});

it('upgrades the existing 17-migration database without changing old bodies, identities or receipts', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-snapshot-upgrade-'));
  roots.push(root);
  const oldFolder = join(root, 'old-migrations');
  mkdirSync(join(oldFolder, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, 17);
  writeFileSync(join(oldFolder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    copyFileSync(join(migrations, entry.tag + '.sql'), join(oldFolder, entry.tag + '.sql'));
  const file = join(root, 'old.sqlite'),
    old = storeAt(file, oldFolder),
    task = seed(old.app);
  const before = ok(old.app.execute({ protocol_version: 1, operation: 'read', task_id: task.id }));
  old.close();
  const upgraded = storeAt(file),
    db = inspect(file);
  expect(
    ok(upgraded.app.execute({ protocol_version: 1, operation: 'read', task_id: task.id })),
  ).toEqual({
    ...before,
    tasks: before.tasks.map((task) => ({
      ...task,
      subscribed: false,
      calendar: emptyTaskCalendar,
      start_date: null,
    })),
  });
  expect(db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
    n: integrationMigrations.length,
  });
  expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  expect(ok(upgraded.app.execute(create(task))).snapshot_created).toBe(true);
});
