import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import * as Y from 'yjs';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src/index';
import { createCatalogApplication } from '../../packages/application/src/catalog-application';
import type { CatalogResponse, TaskResponse } from '../../packages/contracts/src/index';
const migrations = resolve('packages/local-db/migrations'),
  roots: string[] = [];
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { force: true, recursive: true })));
const ids = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
function ok<T extends CatalogResponse | TaskResponse>(r: T): Extract<T, { ok: true }> {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.message);
  return r as Extract<T, { ok: true }>;
}
function binary(text: string) {
  const d = new Y.Doc(),
    p = new Y.XmlElement('paragraph'),
    t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  d.getXmlFragment('default').insert(0, [p]);
  const bytes = Array.from(Y.encodeStateAsUpdate(d));
  d.destroy();
  return bytes;
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-catalog-'));
  roots.push(root);
  const file = join(root, 'data.sqlite'),
    store = openTaskStore(file, migrations);
  return { root, file, store, app: createCatalogApplication(store.catalog) };
}
describe('Five-page catalog persistence', () => {
  it('keeps the same document/body across organization, archive, restart and restore', () => {
    const { file, store, app } = setup();
    const t = ok(store.execute({ ...ids(), operation: 'create', title: '中文成果', objective: '' }))
      .tasks[0];
    ok(
      store.execute({
        ...ids(),
        operation: 'save',
        task_id: t.id,
        document_id: t.document_id,
        body_id: t.body_id,
        expected_revision: 0,
        editor_schema: 1,
        state: binary('原正文不被分类覆盖'),
      }),
    );
    const organize = {
      ...ids(),
      operation: 'organize_document' as const,
      id: t.document_id,
      expected_version: 1,
      collection: '合同',
      tags: ['金标准', '金标准'],
      favorite: true,
      in_library: true,
    };
    const d = ok(app.execute(organize)).documents[0];
    expect(d.tags).toEqual(['金标准']);
    expect(ok(app.execute({ ...organize, request_id: randomUUID() })).documents).toEqual([d]);
    const archive = {
      ...ids(),
      operation: 'archive_document' as const,
      id: d.id,
      expected_version: d.version,
      archived: true,
    };
    ok(app.execute(archive));
    expect(ok(store.execute({ operation: 'list', protocol_version: 1 })).tasks).toHaveLength(1);
    expect(
      store.execute({
        ...ids(),
        operation: 'save',
        task_id: t.id,
        document_id: t.document_id,
        body_id: t.body_id,
        expected_revision: 1,
        editor_schema: 1,
        state: binary('禁止改写'),
      }),
    ).toMatchObject({ ok: false, code: 'CONFLICT' });
    store.close();
    const next = openTaskStore(file, migrations),
      c = createCatalogApplication(next.catalog);
    const archived = ok(c.execute({ operation: 'list', protocol_version: 1 })).documents[0];
    expect(archived).toMatchObject({
      id: d.id,
      body_id: t.body_id,
      body_revision: 1,
      collection: '合同',
      favorite: true,
      in_library: true,
    });
    const restored = ok(
      c.execute({
        ...ids(),
        operation: 'archive_document',
        id: d.id,
        expected_version: archived.version,
        archived: false,
      }),
    ).documents[0];
    expect(restored.archived_at).toBeNull();
    expect(
      ok(next.execute({ operation: 'read', protocol_version: 1, task_id: t.id })).state,
    ).not.toBeNull();
    next.close();
  });
  it('creates once, saves separate Yjs project body and associates original Task without replacing identity', () => {
    const { file, store, app } = setup();
    const create = { ...ids(), operation: 'create_project' as const, title: '事实梳理项目' };
    const p = ok(app.execute(create)).projects[0];
    expect(ok(app.execute({ ...create, request_id: randomUUID() })).target_id).toBe(p.id);
    expect(app.execute({ ...create, title: '同键异内容' })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    const t = ok(
      store.execute({ ...ids(), operation: 'create', title: '独立任务', objective: '目标' }),
    ).tasks[0];
    const saved = ok(
      app.execute({
        ...ids(),
        operation: 'update_project',
        id: p.id,
        expected_version: 1,
        title: p.title,
        status: 'active',
        expected_body_revision: 0,
        state: binary('项目说明'),
      }),
    ).projects[0];
    expect(saved.body_id).not.toBe(t.body_id);
    const assign = {
      ...ids(),
      operation: 'assign_task' as const,
      task_id: t.id,
      expected_version: 1,
      matter_id: p.id,
    };
    ok(app.execute(assign));
    ok(app.execute(assign));
    const task = ok(store.execute({ operation: 'read', protocol_version: 1, task_id: t.id }))
      .tasks[0];
    expect(task).toMatchObject({
      id: t.id,
      document_id: t.document_id,
      body_id: t.body_id,
      matter_id: p.id,
      version: 2,
      matter_title: p.title,
    });
    ok(
      app.execute({
        ...ids(),
        operation: 'archive_project',
        id: p.id,
        expected_version: saved.version,
        archived: true,
      }),
    );
    expect(
      ok(store.execute({ operation: 'read', protocol_version: 1, task_id: t.id })).tasks[0].id,
    ).toBe(t.id);
    expect(
      app.execute({
        ...ids(),
        operation: 'assign_task',
        task_id: t.id,
        expected_version: 2,
        matter_id: p.id,
      }),
    ).toMatchObject({ ok: false });
    store.close();
    const next = openTaskStore(file, migrations);
    const r = ok(
      next.catalog.execute({ operation: 'read_project', protocol_version: 1, id: p.id }),
    );
    expect(r.state).not.toBeNull();
    expect(r.projects[0].task_count).toBe(1);
    next.close();
  });
  it('rejects cross-workspace targets, old versions and invalid bodies without half-saving metadata', () => {
    const { file, store, app } = setup();
    const p = ok(app.execute({ ...ids(), operation: 'create_project', title: 'A' })).projects[0];
    expect(
      app.execute({
        ...ids(),
        operation: 'update_project',
        id: p.id,
        expected_version: 1,
        title: '不得写入',
        status: 'done',
        expected_body_revision: 0,
        state: [1, 2, 3],
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(ok(app.execute({ operation: 'list', protocol_version: 1 })).projects[0].title).toBe('A');
    const other = openTaskStore(file, migrations, 'other');
    expect(
      other.catalog.execute({
        ...ids(),
        operation: 'archive_project',
        id: p.id,
        expected_version: 1,
        archived: true,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    other.close();
    expect(
      app.execute({
        ...ids(),
        operation: 'archive_project',
        id: p.id,
        expected_version: 99,
        archived: true,
      }),
    ).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(app.execute({ ...ids(), operation: 'create_project', title: '  ' })).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    store.close();
  });
  it('rolls back business mutation and receipt when the success activity cannot commit', () => {
    const { file, store, app } = setup();
    const connection = openToolchainProbe(file, migrations);
    connection.sqlite.exec(
      "CREATE TRIGGER reject_catalog_activity BEFORE INSERT ON catalog_activity BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    );
    const request = { ...ids(), operation: 'create_project' as const, title: '不应残留' };
    expect(app.execute(request)).toMatchObject({ ok: false });
    expect(ok(app.execute({ operation: 'list', protocol_version: 1 })).projects).toEqual([]);
    expect(
      app.execute({
        operation: 'status',
        protocol_version: 1,
        idempotency_key: request.idempotency_key,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    connection.sqlite.exec('DROP TRIGGER reject_catalog_activity');
    expect(ok(app.execute(request)).projects).toHaveLength(1);
    connection.sqlite.close();
    store.close();
  });
  it('upgrades a populated 0002 database and keeps legacy receipts and Yjs bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'caselite-catalog-upgrade-'));
    roots.push(root);
    const oldFolder = join(root, 'old');
    mkdirSync(join(oldFolder, 'meta'), { recursive: true });
    const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.slice(0, 3);
    writeFileSync(join(oldFolder, 'meta/_journal.json'), JSON.stringify(journal));
    for (const e of journal.entries)
      copyFileSync(join(migrations, e.tag + '.sql'), join(oldFolder, e.tag + '.sql'));
    const file = join(root, 'old.sqlite'),
      old = openToolchainProbe(file, oldFolder),
      task = randomUUID(),
      document = randomUUID(),
      body = randomUUID(),
      key = randomUUID();
    const state = binary('升级保全');
    old.sqlite
      .prepare('INSERT INTO task_items VALUES(?,?,?,?,?,?)')
      .run(task, 'local', '旧任务', '旧目标', 1, '2026-11-05');
    old.sqlite.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(document, task, body, 1, 1);
    old.sqlite.prepare('INSERT INTO body_revisions VALUES(?,?,?)').run(body, 1, Buffer.from(state));
    const request = {
      ...ids(),
      idempotency_key: key,
      operation: 'create' as const,
      title: '旧任务',
      objective: '旧目标',
    };
    const { request_id: ignored, ...content } = request;
    void ignored;
    const result = {
      ok: true,
      tasks: [
        {
          id: task,
          title: '旧任务',
          objective: '旧目标',
          matter_id: null,
          version: 1,
          document_id: document,
          body_id: body,
          body_revision: 1,
          editor_schema: 1,
          updated_at: '2026-11-05',
        },
      ],
      state: null,
      receipt: key,
    };
    old.sqlite
      .prepare('INSERT INTO task_receipts VALUES(?,?,?,?)')
      .run(
        'local',
        key,
        createHash('sha256').update(JSON.stringify(content)).digest('hex'),
        JSON.stringify(result),
      );
    old.sqlite.close();
    const next = openTaskStore(file, migrations);
    expect(
      ok(next.execute({ operation: 'read', protocol_version: 1, task_id: task })).state,
    ).toEqual(state);
    expect(ok(next.execute(request)).tasks[0].id).toBe(task);
    expect(
      ok(next.catalog.execute({ operation: 'list', protocol_version: 1 })).documents[0],
    ).toMatchObject({
      id: document,
      version: 1,
      archived_at: null,
      collection: '',
      tags: [],
      favorite: false,
    });
    next.close();
  });
});
