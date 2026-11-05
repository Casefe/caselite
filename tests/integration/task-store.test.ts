import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src/index';
import { createTaskApplication } from '../../packages/application/src/task-application';
import type { TaskRequest, TaskResponse } from '../../packages/contracts/src/task';
const require = createRequire(new URL('../../packages/local-db/package.json', import.meta.url));
const Y = require('yjs') as typeof import('yjs');
const migrations = resolve('packages/local-db/migrations');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
function value(r: TaskResponse) {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.message);
  return r;
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-task-test-'));
  roots.push(root);
  const file = join(root, 'task.sqlite');
  return { file, store: openTaskStore(file, migrations) };
}
function binary(text: string) {
  const d = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  const content = new Y.XmlText();
  content.insert(0, text);
  paragraph.insert(0, [content]);
  d.getXmlFragment('default').insert(0, [paragraph]);
  const bytes = Array.from(Y.encodeStateAsUpdate(d));
  d.destroy();
  return bytes;
}
describe('Task durable SQLite transactions', () => {
  it('upgrades an existing probe database without losing prior records', () => {
    const root = mkdtempSync(join(tmpdir(), 'caselite-task-upgrade-'));
    roots.push(root);
    const oldMigrations = join(root, 'old-migrations');
    mkdirSync(join(oldMigrations, 'meta'), { recursive: true });
    const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.slice(0, 1);
    writeFileSync(join(oldMigrations, 'meta/_journal.json'), JSON.stringify(journal));
    copyFileSync(
      join(migrations, '0000_peaceful_hercules.sql'),
      join(oldMigrations, '0000_peaceful_hercules.sql'),
    );
    const file = join(root, 'old.sqlite');
    const old = openToolchainProbe(file, oldMigrations);
    old.sqlite.prepare('INSERT INTO toolchain_probe(id,value) VALUES(?,?)').run('old', 'preserved');
    old.sqlite.close();
    const upgraded = openTaskStore(file, migrations);
    expect(value(upgraded.execute({ operation: 'list', protocol_version: 1 })).tasks).toEqual([]);
    upgraded.close();
    const verify = openToolchainProbe(file, migrations);
    expect(
      verify.sqlite.prepare('SELECT value FROM toolchain_probe WHERE id=?').get('old'),
    ).toEqual({ value: 'preserved' });
    expect(verify.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    verify.sqlite.close();
  });

  it('creates once across restart and rejects same-key changes, version conflicts and wrong workspace', () => {
    const { file, store } = setup();
    const request = {
      ...identity(),
      operation: 'create' as const,
      title: '事实梳理',
      objective: '内部沟通',
    };
    const task = value(store.execute(request)).tasks[0];
    store.close();
    const next = openTaskStore(file, migrations);
    expect(value(next.execute({ ...request, request_id: randomUUID() })).tasks[0].id).toBe(task.id);
    expect(next.execute({ ...request, title: '另一个任务' })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    expect(
      next.execute({
        ...identity(),
        operation: 'update',
        task_id: task.id,
        expected_version: 2,
        title: '过期',
        objective: '',
      }),
    ).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(value(next.execute({ operation: 'list', protocol_version: 1 })).tasks).toHaveLength(1);
    next.close();
    const other = openTaskStore(file, migrations, 'other');
    expect(
      other.execute({ operation: 'read', protocol_version: 1, task_id: task.id }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    other.close();
  });
  it('persists binary revisions and receipt; stale saves cannot overwrite current content or cross-bind', () => {
    const { file, store } = setup();
    const task = value(
      store.execute({ ...identity(), operation: 'create', title: 'A', objective: '' }),
    ).tasks[0];
    const save: TaskRequest = {
      ...identity(),
      operation: 'save',
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: 0,
      editor_schema: 1,
      state: binary('甲方12万元'),
    };
    expect(value(store.execute(save)).tasks[0].body_revision).toBe(1);
    expect(
      value(
        store.execute({ ...save, ...identity(), expected_revision: 1, state: binary('仍待核验') }),
      ).tasks[0].body_revision,
    ).toBe(2);
    expect(store.execute({ ...save, ...identity() })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    expect(store.execute({ ...save, ...identity(), document_id: randomUUID() })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    const unknown = new Y.Doc();
    unknown.getText('unsupported').insert(0, '未知内容');
    expect(
      store.execute({
        ...save,
        ...identity(),
        expected_revision: 2,
        state: Array.from(Y.encodeStateAsUpdate(unknown)),
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    unknown.destroy();
    store.close();
    const next = openTaskStore(file, migrations);
    const read = value(next.execute({ operation: 'read', protocol_version: 1, task_id: task.id }));
    const d = new Y.Doc();
    Y.applyUpdate(d, Uint8Array.from(read.state!));
    expect(d.getXmlFragment('default').toString()).toBe('<paragraph>仍待核验</paragraph>');
    d.destroy();
    expect(
      value(
        next.execute({
          operation: 'status',
          protocol_version: 1,
          idempotency_key: save.idempotency_key,
        }),
      ).tasks[0].body_revision,
    ).toBe(1);
    next.close();
  });
  it('rolls back body, receipt and event together on an injected event write failure', () => {
    const { file, store } = setup();
    const task = value(
      store.execute({ ...identity(), operation: 'create', title: 'A', objective: '' }),
    ).tasks[0];
    const raw = openToolchainProbe(file, migrations);
    raw.sqlite.exec(
      "CREATE TRIGGER fail_save BEFORE INSERT ON task_activity WHEN NEW.operation='save' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    );
    const save = {
      ...identity(),
      operation: 'save' as const,
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: 0,
      editor_schema: 1 as const,
      state: binary('不得假报成功'),
    };
    expect(createTaskApplication(store).execute(save)).toMatchObject({
      ok: false,
      code: 'WRITE_FAILED',
    });
    expect(
      value(store.execute({ operation: 'read', protocol_version: 1, task_id: task.id })).tasks[0]
        .body_revision,
    ).toBe(0);
    expect(raw.sqlite.prepare('SELECT count(*) AS n FROM body_revisions').get()).toEqual({ n: 0 });
    expect(
      store.execute({
        operation: 'status',
        protocol_version: 1,
        idempotency_key: save.idempotency_key,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    raw.sqlite.exec('DROP TRIGGER fail_save');
    expect(value(store.execute(save)).tasks[0].body_revision).toBe(1);
    raw.sqlite.close();
    store.close();
  });
});
