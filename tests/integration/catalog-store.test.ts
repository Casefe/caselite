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
  it('promotes an original Task once and preserves its document, body and receipt across restart', () => {
    const { file, store, app } = setup();
    const created = ok(
      store.execute({ ...ids(), operation: 'create', title: '原任务', objective: '原目标' }),
    ).tasks[0];
    ok(
      store.execute({
        ...ids(),
        operation: 'save',
        task_id: created.id,
        document_id: created.document_id,
        body_id: created.body_id,
        expected_revision: 0,
        editor_schema: 1,
        state: binary('原任务正文不得复制或覆盖'),
      }),
    );
    const original = ok(
      store.execute({ operation: 'read', protocol_version: 1, task_id: created.id }),
    );
    const task = original.tasks[0];
    const request = {
      ...ids(),
      operation: 'promote_task' as const,
      task_id: task.id,
      expected_version: task.version,
      title: '由原任务创建',
    };
    const result = ok(app.execute(request));
    const projectId = result.target_id;
    expect(projectId).toBe(result.projects[0].id);
    expect(ok(app.execute({ ...request, request_id: randomUUID() })).target_id).toBe(projectId);
    expect(app.execute({ ...request, title: '同键异内容' })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    const after = ok(store.execute({ operation: 'read', protocol_version: 1, task_id: task.id }));
    expect(after.tasks[0]).toMatchObject({
      id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      body_revision: task.body_revision,
      matter_id: projectId,
      version: task.version + 1,
    });
    expect(after.state).toEqual(original.state);
    expect(app.execute({ ...request, ...ids(), expected_version: task.version + 1 })).toMatchObject(
      { ok: false, code: 'CONFLICT' },
    );
    store.close();
    const next = openTaskStore(file, migrations);
    expect(
      ok(
        next.catalog.execute({
          operation: 'status',
          protocol_version: 1,
          idempotency_key: request.idempotency_key,
        }),
      ).target_id,
    ).toBe(projectId);
    expect(ok(next.catalog.execute(request)).projects).toHaveLength(1);
    expect(
      ok(next.execute({ operation: 'read', protocol_version: 1, task_id: task.id })).state,
    ).toEqual(original.state);
    next.close();
  });
  it('rolls promotion back before linking and after linking, then reuses the same request safely', () => {
    for (const trigger of [
      "CREATE TRIGGER reject_promotion BEFORE INSERT ON task_projects BEGIN SELECT RAISE(ABORT,'synthetic link failure'); END",
      "CREATE TRIGGER reject_promotion BEFORE INSERT ON catalog_activity BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END",
    ]) {
      const { file, store, app } = setup();
      const task = ok(
        store.execute({ ...ids(), operation: 'create', title: '原任务', objective: '' }),
      ).tasks[0];
      const connection = openToolchainProbe(file, migrations);
      connection.sqlite.exec(trigger);
      const request = {
        ...ids(),
        operation: 'promote_task' as const,
        task_id: task.id,
        expected_version: task.version,
        title: '原子项目',
      };
      expect(app.execute(request)).toMatchObject({ ok: false });
      expect(ok(app.execute({ operation: 'list', protocol_version: 1 })).projects).toEqual([]);
      expect(
        ok(store.execute({ operation: 'read', protocol_version: 1, task_id: task.id })).tasks[0],
      ).toMatchObject({ version: task.version, matter_id: null });
      expect(
        app.execute({
          operation: 'status',
          protocol_version: 1,
          idempotency_key: request.idempotency_key,
        }),
      ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      connection.sqlite.exec('DROP TRIGGER reject_promotion');
      expect(ok(app.execute(request)).projects).toHaveLength(1);
      expect(ok(app.execute(request)).projects).toHaveLength(1);
      connection.sqlite.close();
      store.close();
    }
  });
  it('rejects stale and cross-workspace promotion before creating any project', () => {
    const { file, store, app } = setup();
    const task = ok(
      store.execute({ ...ids(), operation: 'create', title: '原任务', objective: '' }),
    ).tasks[0];
    const request = {
      ...ids(),
      operation: 'promote_task' as const,
      task_id: task.id,
      expected_version: task.version,
      title: '受限项目',
    };
    expect(app.execute({ ...request, expected_version: 99 })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    const other = openTaskStore(file, migrations, 'other');
    expect(other.catalog.execute(request)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(ok(other.catalog.execute({ operation: 'list', protocol_version: 1 })).projects).toEqual(
      [],
    );
    expect(ok(app.execute({ operation: 'list', protocol_version: 1 })).projects).toEqual([]);
    other.close();
    store.close();
  });
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

it('migrates populated 0008 project, keeps original receipts/digests/Yjs, and preserves new attributes on legacy updates', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-project-properties-'));
  roots.push(root);
  const oldFolder = join(root, 'old');
  mkdirSync(join(oldFolder, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, 9);
  writeFileSync(join(oldFolder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries)
    copyFileSync(join(migrations, e.tag + '.sql'), join(oldFolder, e.tag + '.sql'));
  const file = join(root, 'old.sqlite'),
    old = openToolchainProbe(file, oldFolder),
    id = randomUUID(),
    body = randomUUID(),
    state = binary('旧说明原字节');
  old.sqlite
    .prepare(
      'INSERT INTO matters(id,workspace_id,title,status,version,body_id,body_revision,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    )
    .run(id, 'local', '旧项目', 'active', 2, body, 1, '2026-11-06');
  old.sqlite.prepare('INSERT INTO body_revisions VALUES(?,?,?)').run(body, 1, Buffer.from(state));
  const legacy = {
    protocol_version: 1 as const,
    request_id: randomUUID(),
    idempotency_key: randomUUID(),
    operation: 'update_project' as const,
    id,
    expected_version: 1,
    title: '旧项目',
    status: 'active' as const,
    expected_body_revision: 0,
    state,
  };
  const receipt = {
    ok: true,
    projects: [
      {
        id,
        title: '旧项目',
        status: 'active',
        version: 2,
        archived_at: null,
        body_id: body,
        body_revision: 1,
        editor_schema: 1,
        updated_at: '2026-11-06',
        task_count: 0,
      },
    ],
    documents: [],
    state: null,
    target_id: id,
    receipt: legacy.idempotency_key,
  };
  const { request_id: ignored, ...content } = legacy;
  void ignored;
  const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  old.sqlite
    .prepare('INSERT INTO catalog_receipts VALUES(?,?,?,?)')
    .run('local', legacy.idempotency_key, digest, JSON.stringify(receipt));
  old.sqlite.close();
  const store = openTaskStore(file, migrations),
    app = createCatalogApplication(store.catalog);
  expect(app.execute(legacy)).toEqual(receipt);
  expect(app.execute({ ...legacy, operation: 'status' })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(
    app.execute({
      operation: 'status',
      protocol_version: 1,
      idempotency_key: legacy.idempotency_key,
    }),
  ).toEqual(receipt);
  const attributes = {
    project_type: 'contract_review' as const,
    assignee: '合成负责人',
    priority: 3,
    start_date: '2024-02-29',
    target_date: '2024-03-01',
    tags: ['合成', '合成'],
  };
  const update = {
    ...ids(),
    operation: 'update_project' as const,
    id,
    expected_version: 2,
    title: '新项目',
    status: 'done' as const,
    expected_body_revision: 1,
    attributes,
  };
  let p = ok(app.execute(update)).projects[0];
  expect(p).toMatchObject({
    version: 3,
    body_revision: 1,
    attributes: { ...attributes, tags: ['合成'] },
  });
  expect(ok(app.execute({ ...update, request_id: randomUUID() })).projects[0]).toEqual(p);
  expect(app.execute({ ...update, attributes: { ...attributes, priority: 1 } })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  expect(
    ok(
      app.execute({
        ...ids(),
        operation: 'update_project',
        id,
        expected_version: 3,
        title: '旧客户端改名',
        status: 'active',
        expected_body_revision: 1,
      }),
    ).projects[0],
  ).toMatchObject({ body_revision: 1, attributes: p.attributes });
  const combined = {
    ...ids(),
    operation: 'update_project' as const,
    id,
    expected_version: 4,
    title: '同存',
    status: 'active' as const,
    expected_body_revision: 1,
    state: binary('新说明'),
    attributes: { ...attributes, start_date: null, target_date: null, tags: [] },
  };
  p = ok(app.execute(combined)).projects[0];
  expect(p).toMatchObject({ version: 5, body_revision: 2, attributes: combined.attributes });
  const connection = openToolchainProbe(file, migrations);
  expect(
    Array.from(
      (
        connection.sqlite
          .prepare('SELECT state FROM body_revisions WHERE body_id=? AND revision=1')
          .get(body) as { state: Buffer }
      ).state,
    ),
  ).toEqual(state);
  expect(
    connection.sqlite
      .prepare('SELECT digest,result FROM catalog_receipts WHERE key=?')
      .get(legacy.idempotency_key),
  ).toEqual({ digest, result: JSON.stringify(receipt) });
  const before = connection.sqlite.prepare('SELECT * FROM matters WHERE id=?').get(id);
  connection.sqlite.exec(
    "CREATE TRIGGER fail_attributes BEFORE INSERT ON catalog_activity BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
  );
  const failure = { ...combined, ...ids(), expected_version: 5, expected_body_revision: 2 };
  expect(app.execute(failure)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(connection.sqlite.prepare('SELECT * FROM matters WHERE id=?').get(id)).toEqual(before);
  expect(
    connection.sqlite.prepare('SELECT count(*) AS n FROM body_revisions WHERE body_id=?').get(body),
  ).toEqual({ n: 2 });
  expect(
    app.execute({
      operation: 'status',
      protocol_version: 1,
      idempotency_key: failure.idempotency_key,
    }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  connection.sqlite.exec('DROP TRIGGER fail_attributes');
  connection.sqlite.close();
  expect(app.execute({ ...failure, expected_version: 4 })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  const other = openTaskStore(file, migrations, 'other');
  expect(other.catalog.execute(failure)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  other.close();
  ok(
    app.execute({
      ...ids(),
      operation: 'archive_project',
      id,
      expected_version: 5,
      archived: true,
    }),
  );
  expect(app.execute({ ...failure, expected_version: 6 })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  store.close();
  const next = openTaskStore(file, migrations);
  expect(
    ok(next.catalog.execute({ operation: 'read_project', protocol_version: 1, id })),
  ).toMatchObject({
    projects: [
      {
        id: p.id,
        version: 6,
        body_revision: 2,
        attributes: combined.attributes,
        archived_at: expect.any(String),
      },
    ],
    state: combined.state,
  });
  next.close();
});

it('rejects invalid direct SQL attributes before they can poison catalog reads', () => {
  const { file, store, app } = setup();
  const p = ok(app.execute({ ...ids(), operation: 'create_project', title: '合成' })).projects[0];
  const connection = openToolchainProbe(file, migrations);
  for (const [field, value] of [
    ['project_type', 'unknown'],
    ['priority', 5],
    ['priority', 1.5],
    ['assignee', ' '],
    ['assignee', 'x'.repeat(81)],
    ['start_date', '0000-01-01'],
    ['start_date', '2023-02-29'],
    ['target_date', '2024-02-30'],
    ['tags', 'not-json'],
    ['tags', '{}'],
    ['tags', JSON.stringify(Array(21).fill('x'))],
  ] as const)
    expect(() =>
      connection.sqlite.prepare(`UPDATE matters SET ${field}=? WHERE id=?`).run(value, p.id),
    ).toThrow();
  connection.sqlite
    .prepare('UPDATE matters SET start_date=?,target_date=? WHERE id=?')
    .run('2024-03-01', '2024-03-02', p.id);
  expect(() =>
    connection.sqlite.prepare('UPDATE matters SET start_date=? WHERE id=?').run('2024-03-03', p.id),
  ).toThrow();
  expect(
    ok(app.execute({ operation: 'list', protocol_version: 1 })).projects[0].attributes?.target_date,
  ).toBe('2024-03-02');
  connection.sqlite.close();
  store.close();
});

it('rolls failed 0009 DDL back completely with a populated project and unchanged old receipts, then upgrades', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-project-ddl-'));
  roots.push(root);
  const oldFolder = join(root, 'old'),
    badFolder = join(root, 'bad');
  for (const folder of [oldFolder, badFolder]) mkdirSync(join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'));
  for (const folder of [oldFolder, badFolder]) {
    const entries = folder === oldFolder ? journal.entries.slice(0, 9) : journal.entries;
    writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const e of entries)
      copyFileSync(join(migrations, e.tag + '.sql'), join(folder, e.tag + '.sql'));
  }
  const last = join(badFolder, journal.entries[9].tag + '.sql');
  writeFileSync(
    last,
    readFileSync(last, 'utf8') +
      '\n--> statement-breakpoint\nSELECT * FROM synthetic_missing_table;',
  );
  const file = join(root, 'data.sqlite'),
    old = openToolchainProbe(file, oldFolder),
    id = randomUUID(),
    body = randomUUID(),
    state = Buffer.from(binary('DDL失败也保全')),
    key = randomUUID();
  old.sqlite
    .prepare(
      'INSERT INTO matters(id,workspace_id,title,version,body_id,body_revision,updated_at) VALUES(?,?,?,?,?,?,?)',
    )
    .run(id, 'local', '合成旧项目', 2, body, 1, '2026-11-06');
  old.sqlite.prepare('INSERT INTO body_revisions VALUES(?,?,?)').run(body, 1, state);
  old.sqlite
    .prepare('INSERT INTO catalog_receipts VALUES(?,?,?,?)')
    .run('local', key, 'old-digest', '{"legacy":"unchanged"}');
  const snapshot = () =>
    ['matters', 'body_revisions', 'catalog_receipts'].map((table) =>
      old.sqlite.prepare(`SELECT * FROM ${table}`).all(),
    );
  const before = snapshot();
  old.sqlite.close();
  expect(() => openToolchainProbe(file, badFolder)).toThrow();
  const verify = openToolchainProbe(file, oldFolder);
  expect(verify.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
    n: 9,
  });
  const columns = (verify.sqlite.pragma('table_info(matters)') as { name: string }[]).map(
    (c) => c.name,
  );
  for (const col of ['project_type', 'assignee', 'priority', 'start_date', 'target_date', 'tags'])
    expect(columns).not.toContain(col);
  expect(
    ['matters', 'body_revisions', 'catalog_receipts'].map((table) =>
      verify.sqlite.prepare(`SELECT * FROM ${table}`).all(),
    ),
  ).toEqual(before);
  verify.sqlite.close();
  const next = openTaskStore(file, migrations);
  expect(
    ok(next.catalog.execute({ operation: 'read_project', protocol_version: 1, id })),
  ).toMatchObject({
    projects: [{ id, body_revision: 1, attributes: { project_type: 'general', priority: 0 } }],
    state: Array.from(state),
  });
  next.close();
});

it.each(['catalog_activity', 'catalog_receipts'])(
  'rolls back changed properties, new Yjs, activity and receipt when %s insert fails',
  (table) => {
    const { file, store, app } = setup(),
      p = ok(app.execute({ ...ids(), operation: 'create_project', title: '回滚合成项目' }))
        .projects[0];
    const db = openToolchainProbe(file, migrations);
    const before = ['matters', 'body_revisions', 'catalog_activity', 'catalog_receipts'].map((t) =>
      db.sqlite.prepare(`SELECT * FROM ${t}`).all(),
    );
    db.sqlite.exec(
      `CREATE TRIGGER reject_property_commit BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic property rollback'); END`,
    );
    const request = {
      ...ids(),
      operation: 'update_project' as const,
      id: p.id,
      expected_version: 1,
      expected_body_revision: 0,
      title: '失败的新名称',
      status: 'done' as const,
      state: binary('失败的新说明'),
      attributes: {
        project_type: 'litigation' as const,
        assignee: '失败的新负责人',
        priority: 4,
        start_date: '2024-02-29',
        target_date: '2024-03-01',
        tags: ['失败的新标签'],
      },
    };
    expect(app.execute(request)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(
      ['matters', 'body_revisions', 'catalog_activity', 'catalog_receipts'].map((t) =>
        db.sqlite.prepare(`SELECT * FROM ${t}`).all(),
      ),
    ).toEqual(before);
    expect(
      app.execute({
        operation: 'status',
        protocol_version: 1,
        idempotency_key: request.idempotency_key,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    db.sqlite.exec('DROP TRIGGER reject_property_commit');
    expect(ok(app.execute(request)).projects[0]).toMatchObject({
      version: 2,
      body_revision: 1,
      attributes: request.attributes,
    });
    db.sqlite.close();
    store.close();
  },
);

it('upgrades a populated 0009 database without classifying old litigation or changing its receipt', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-professional-ddl-'));
  roots.push(root);
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'));
  const oldFolder = join(root, 'old'),
    badFolder = join(root, 'bad');
  for (const [folder, entries] of [
    [oldFolder, journal.entries.slice(0, 10)],
    [badFolder, journal.entries],
  ]) {
    mkdirSync(join(folder, 'meta'), { recursive: true });
    writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const e of entries)
      copyFileSync(join(migrations, e.tag + '.sql'), join(folder, e.tag + '.sql'));
  }
  const last = join(badFolder, journal.entries[10].tag + '.sql');
  writeFileSync(
    last,
    readFileSync(last, 'utf8') +
      '\n--> statement-breakpoint\nSELECT * FROM synthetic_missing_table;',
  );
  const file = join(root, 'data.sqlite'),
    old = openToolchainProbe(file, oldFolder);
  const id = randomUUID(),
    body = randomUUID(),
    state = binary('旧库保留正文');
  const attributes = {
    project_type: 'litigation',
    assignee: null,
    priority: 0,
    start_date: null,
    target_date: null,
    tags: [],
  };
  const request = {
    ...ids(),
    operation: 'update_project',
    id,
    expected_version: 1,
    title: '旧诉讼',
    status: 'planned',
    expected_body_revision: 0,
    state,
    attributes,
  };
  const { request_id, ...content } = request;
  expect(request_id).toBeTruthy();
  const oldProject = {
    id,
    title: '旧诉讼',
    status: 'planned',
    version: 2,
    archived_at: null,
    body_id: body,
    body_revision: 1,
    editor_schema: 1,
    updated_at: '2026-11-07',
    task_count: 0,
    attributes,
  };
  const oldReceipt = {
    ok: true,
    projects: [oldProject],
    documents: [],
    state: null,
    target_id: id,
    receipt: request.idempotency_key,
  };
  const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  old.sqlite
    .prepare(
      'INSERT INTO matters(id,workspace_id,title,status,version,body_id,body_revision,updated_at,project_type) VALUES(?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      'local',
      oldProject.title,
      oldProject.status,
      2,
      body,
      1,
      oldProject.updated_at,
      'litigation',
    );
  old.sqlite.prepare('INSERT INTO body_revisions VALUES(?,?,?)').run(body, 1, Buffer.from(state));
  old.sqlite
    .prepare('INSERT INTO catalog_receipts VALUES(?,?,?,?)')
    .run('local', request.idempotency_key, digest, JSON.stringify(oldReceipt));
  old.sqlite.close();
  expect(() => openToolchainProbe(file, badFolder)).toThrow();
  const pre = openToolchainProbe(file, oldFolder);
  expect(pre.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
    n: 10,
  });
  expect(pre.sqlite.pragma('table_info(matters)')).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'professional_type' })]),
  );
  expect(pre.sqlite.prepare('SELECT digest,result FROM catalog_receipts').get()).toEqual({
    digest,
    result: JSON.stringify(oldReceipt),
  });
  pre.sqlite.close();
  const next = openTaskStore(file, migrations),
    app = createCatalogApplication(next.catalog);
  expect(app.execute({ ...request, request_id: randomUUID() })).toEqual(oldReceipt);
  expect(ok(app.execute({ protocol_version: 1, operation: 'read_project', id }))).toMatchObject({
    projects: [oldProject],
    state,
  });
  expect(
    ok(app.execute({ protocol_version: 1, operation: 'list' })).projects[0].attributes,
  ).toEqual(attributes);
  next.close();
});

it('merges explicit professional edits, guards the original key and preserves hidden fields after reopening', () => {
  const { store, file, app } = setup();
  const base = {
    project_type: 'litigation',
    assignee: null,
    priority: 0,
    start_date: null,
    target_date: null,
    tags: [],
  };
  const created = ok(
    app.execute({
      ...ids(),
      operation: 'create_project',
      title: '合成专业项目',
      attributes: {
        ...base,
        professional_type: 'civil_litigation',
        professional_fields: { civil_litigation: { court: '合成法院', stage: '原阶段' } },
      },
    }),
  ).projects[0];
  const id = created.id;
  const update = {
    ...ids(),
    operation: 'update_project',
    id,
    title: created.title,
    status: created.status,
    expected_version: 1,
    expected_body_revision: 0,
    attributes: {
      ...base,
      professional_type: 'criminal_litigation',
      professional_fields: {
        criminal_litigation: { authority: '合成机关' },
        civil_litigation: { stage: '' },
      },
    },
  };
  for (const attributes of [
    { ...update.attributes, project_type: 'general' },
    { ...update.attributes, professional_type: 'other' },
    {
      ...update.attributes,
      professional_fields: { criminal_litigation: { court: '字段不属于刑事' } },
    },
    {
      ...update.attributes,
      professional_fields: { criminal_litigation: { authority: '长'.repeat(241) } },
    },
  ])
    expect(app.execute({ ...update, attributes })).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  const other = openTaskStore(file, migrations, 'other');
  expect(createCatalogApplication(other.catalog).execute(update)).toMatchObject({
    ok: false,
    code: 'NOT_FOUND',
  });
  other.close();
  const connection = openToolchainProbe(file, migrations);
  expect(() =>
    connection.sqlite.prepare("UPDATE matters SET professional_type='other' WHERE id=?").run(id),
  ).toThrow();
  expect(() =>
    connection.sqlite
      .prepare('UPDATE matters SET professional_fields=\'{"other":{}}\' WHERE id=?')
      .run(id),
  ).toThrow();
  connection.sqlite.exec(
    "CREATE TRIGGER reject_professional BEFORE INSERT ON catalog_receipts BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END",
  );
  expect(app.execute(update)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  const read = { operation: 'read_project', protocol_version: 1, id };
  const status = {
    operation: 'status',
    protocol_version: 1,
    idempotency_key: update.idempotency_key,
  };
  expect(ok(app.execute(read)).projects[0]).toEqual(created);
  expect(app.execute(status)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  connection.sqlite.exec('DROP TRIGGER reject_professional');
  const saved = ok(app.execute(update));
  expect(app.execute(status)).toEqual(saved);
  expect(
    app.execute({ ...update, attributes: { ...update.attributes, priority: 1 } }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  const professional_fields = {
    civil_litigation: { court: '合成法院', stage: '' },
    criminal_litigation: { authority: '合成机关' },
  };
  expect(saved.projects[0]).toMatchObject({
    version: 2,
    body_revision: 0,
    attributes: { professional_type: 'criminal_litigation', professional_fields },
  });
  expect(
    connection.sqlite
      .prepare('SELECT professional_type,professional_fields FROM matters WHERE id=?')
      .get(id),
  ).toMatchObject({
    professional_type: 'criminal_litigation',
    professional_fields: JSON.stringify(professional_fields),
  });
  expect(app.execute({ ...update, ...ids() })).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(
    ok(app.execute({ operation: 'list', protocol_version: 1 })).projects[0].attributes,
  ).not.toHaveProperty('professional_fields');
  expect(
    ok(app.execute({ operation: 'list', protocol_version: 1, project_properties: true }))
      .projects[0].attributes?.professional_fields,
  ).toEqual(professional_fields);
  const oldWrite = {
    ...update,
    ...ids(),
    expected_version: 2,
    attributes: { ...base, priority: 3 },
  };
  expect(
    app.execute({
      ...oldWrite,
      attributes: { ...oldWrite.attributes, project_type: 'contract_review' },
      state: binary('不能覆盖'),
    }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(ok(app.execute(oldWrite)).projects[0].attributes).toMatchObject({
    professional_type: 'criminal_litigation',
    professional_fields,
    priority: 3,
  });
  ok(
    app.execute({
      ...ids(),
      operation: 'archive_project',
      id,
      expected_version: 3,
      archived: true,
    }),
  );
  expect(app.execute({ ...update, ...ids(), expected_version: 4 })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  connection.sqlite.close();
  store.close();
  const next = openTaskStore(file, migrations);
  expect(
    ok(next.catalog.execute({ operation: 'read_project', protocol_version: 1, id })).projects[0],
  ).toMatchObject({
    id,
    body_revision: 0,
    archived_at: expect.any(String),
    attributes: { professional_fields, professional_type: 'criminal_litigation' },
  });
  next.close();
});
