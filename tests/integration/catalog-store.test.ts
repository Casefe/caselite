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
  it('commits the initial project overview once and reads the same revision after restart', () => {
    const { file, store, app } = setup();
    const request = {
      ...ids(),
      operation: 'create_project' as const,
      title: '概述原子创建',
      state: binary('创建时填写的项目概述'),
    };
    const saved = ok(app.execute(request));
    const project = saved.projects[0];
    expect(project.body_revision).toBe(1);
    expect(ok(app.execute({ ...request, request_id: randomUUID() })).target_id).toBe(project.id);
    expect(app.execute({ ...request, state: binary('同键修改概述') })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    store.close();
    const reopened = openTaskStore(file, migrations);
    const read = ok(
      reopened.catalog.execute({ protocol_version: 1, operation: 'read_project', id: project.id }),
    );
    expect(read.state).toEqual(request.state);
    expect(read.projects).toHaveLength(1);
    expect(read.projects[0]).toMatchObject({
      id: project.id,
      body_id: project.body_id,
      body_revision: 1,
    });
    reopened.close();
  });
  it('rejects malformed initial bodies and rolls back body, activity or receipt failures before retrying the same request', () => {
    for (const table of ['body_revisions', 'catalog_activity', 'catalog_receipts']) {
      const { file, store, app } = setup();
      const request = {
        ...ids(),
        operation: 'create_project' as const,
        title: '失败保全',
        state: binary('完整概述'),
      };
      expect(app.execute({ ...request, state: [1, 2, 3] })).toMatchObject({
        ok: false,
        code: 'INVALID_REQUEST',
      });
      const connection = openToolchainProbe(file, migrations);
      connection.sqlite.exec(
        `CREATE TRIGGER reject_initial_body BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic initial body failure'); END`,
      );
      expect(app.execute(request)).toMatchObject({ ok: false });
      for (const name of ['matters', 'body_revisions', 'catalog_activity', 'catalog_receipts'])
        expect(connection.sqlite.prepare(`SELECT count(*) AS n FROM ${name}`).get()).toEqual({
          n: 0,
        });
      expect(
        app.execute({
          protocol_version: 1,
          operation: 'status',
          idempotency_key: request.idempotency_key,
        }),
      ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      connection.sqlite.exec('DROP TRIGGER reject_initial_body');
      expect(ok(app.execute(request)).projects).toHaveLength(1);
      expect(ok(app.execute(request)).projects).toHaveLength(1);
      connection.sqlite.close();
      store.close();
    }
  });
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
      state: binary('项目初始概述'),
    };
    const result = ok(app.execute(request));
    const projectId = result.target_id;
    expect(result.projects[0].body_revision).toBe(1);
    expect(
      ok(app.execute({ protocol_version: 1, operation: 'read_project', id: projectId })).state,
    ).toEqual(request.state);
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
      ok(next.catalog.execute({ protocol_version: 1, operation: 'read_project', id: projectId }))
        .state,
    ).toEqual(request.state);
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
      const initialBodies = connection.sqlite
        .prepare('SELECT count(*) AS n FROM body_revisions')
        .get();
      connection.sqlite.exec(trigger);
      const request = {
        ...ids(),
        operation: 'promote_task' as const,
        task_id: task.id,
        expected_version: task.version,
        title: '原子项目',
        state: binary('失败必须回滚的项目概述'),
      };
      expect(app.execute(request)).toMatchObject({ ok: false });
      expect(ok(app.execute({ operation: 'list', protocol_version: 1 })).projects).toEqual([]);
      expect(connection.sqlite.prepare('SELECT count(*) AS n FROM body_revisions').get()).toEqual(
        initialBodies,
      );
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

it('uses the latest explicitly published health for only its project', () => {
  const { app, file, store } = setup();
  const project = ok(
    app.execute({ ...ids(), operation: 'create_project', title: '合成健康度' }),
  ).target_id!;
  const publication = {
    operation: 'publish_discussion',
    scope: { kind: 'update', project_id: project },
    state: binary('合成项目更新'),
  };
  const list = { operation: 'list_discussion', protocol_version: 1, scope: publication.scope };
  const read = { operation: 'read_project', protocol_version: 1, id: project };
  expect(ok(app.execute(read)).projects.find((p) => p.id === project)?.health).toBeUndefined();
  expect(
    app.execute({
      ...ids(),
      ...publication,
      scope: { ...publication.scope, kind: 'project_comment' },
      health: 'off_track',
    }),
  ).toMatchObject({ code: 'INVALID_REQUEST' });
  const publish = { ...ids(), ...publication, health: 'at_risk' };
  const receipt = ok(app.execute(publish));
  expect(app.execute(publish)).toEqual(receipt);
  ok(app.execute({ ...ids(), ...publication }));
  expect(ok(app.execute(list)).discussion?.entries).toMatchObject([
    { id: expect.any(String) },
    { id: receipt.target_id, health: 'at_risk' },
  ]);
  store.close();
  const reopened = openTaskStore(file, migrations);
  expect(
    ok(
      reopened.catalog.execute({ ...read, operation: 'read_project', protocol_version: 1 }),
    ).projects.find((p) => p.id === project)?.health,
  ).toBe('at_risk');
  reopened.close();
});

it('publishes scoped fixed discussion entries atomically and reopens them without changing system activity or project description', () => {
  const { app, file, store } = setup();
  const create = (title: string) =>
    ok(app.execute({ ...ids(), operation: 'create_project', title })).projects.find(
      (project) => project.title === title,
    )!;
  const project = create('讨论项目');
  const foreign = create('另一个项目');
  const state = binary('本机讨论合成样本');
  const root = { kind: 'project_comment', project_id: project.id } as const;
  const updates = { ...root, kind: 'update' } as const;
  const publish = (scope: object) => ({ ...ids(), operation: 'publish_discussion', scope, state });
  const query = (scope: object) => ({ protocol_version: 1, operation: 'list_discussion', scope });
  const activity = {
    protocol_version: 1,
    operation: 'list_activity',
    scope: { type: 'project', id: project.id },
    offset: 0,
  };
  const before = ok(app.execute(activity)).activity!;
  const request = publish(root);
  const receipt = ok(app.execute(request));
  expect(receipt).toEqual({
    ok: true,
    projects: [],
    documents: [],
    state: null,
    target_id: expect.any(String),
    receipt: request.idempotency_key,
  });
  const status = {
    protocol_version: 1,
    operation: 'status',
    idempotency_key: request.idempotency_key,
  };
  expect(app.execute(status)).toEqual(receipt);
  expect(app.execute({ ...request, request_id: randomUUID() })).toEqual(receipt);
  expect(app.execute({ ...request, state: binary('变更后重放') })).toMatchObject({
    code: 'CONFLICT',
  });

  const update = ok(app.execute(publish(updates))).target_id!;
  const replies = { ...root, kind: 'update_comment', update_id: update } as const;
  const reply = ok(app.execute(publish(replies))).target_id;
  for (const invalid of [
    { ...replies, project_id: foreign.id },
    { ...replies, update_id: before[0].id },
    { ...replies, update_id: receipt.target_id },
    { ...replies, update_id: randomUUID() },
  ]) {
    expect(app.execute(publish(invalid))).toMatchObject({ code: 'NOT_FOUND' });
    expect(app.execute(query(invalid))).toMatchObject({ code: 'NOT_FOUND' });
  }
  const other = openTaskStore(file, migrations, 'other-workspace');
  try {
    const foreignApp = createCatalogApplication(other.catalog);
    expect(foreignApp.execute(query(root))).toMatchObject({ code: 'NOT_FOUND' });
    expect(foreignApp.execute(publish(root))).toMatchObject({ code: 'NOT_FOUND' });
    expect(foreignApp.execute(status)).toMatchObject({ code: 'NOT_FOUND' });
  } finally {
    other.close();
  }
  expect(app.execute({ ...publish(root), state: [255] })).toMatchObject({
    code: 'INVALID_REQUEST',
  });
  expect(app.execute({ ...publish(root), state: binary(' ') })).toMatchObject({
    code: 'INVALID_REQUEST',
  });
  expect(app.execute({ ...publish(root), state: Array(32769).fill(0) })).toMatchObject({
    code: 'INVALID_REQUEST',
  });

  const fault = publish(root);
  const connection = openToolchainProbe(file, migrations);
  const bodies = () => connection.sqlite.prepare('SELECT count(*) AS n FROM body_revisions').get();
  const originalBodyCount = bodies();
  connection.sqlite.exec(
    "CREATE TRIGGER discussion_failure BEFORE INSERT ON catalog_receipts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
  );
  try {
    expect(app.execute(fault)).toMatchObject({ code: 'UNAVAILABLE' });
    expect(app.execute({ ...status, idempotency_key: fault.idempotency_key })).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(bodies()).toEqual(originalBodyCount);
    expect(ok(app.execute(query(root))).discussion?.entries).toHaveLength(1);
  } finally {
    connection.sqlite.exec('DROP TRIGGER discussion_failure');
    connection.sqlite.close();
  }
  expect(ok(app.execute(fault)).target_id).not.toBe(receipt.target_id);
  for (let i = 0; i < 10; i++) ok(app.execute(publish(root)));
  const first = ok(app.execute(query(root))).discussion!;
  const second = ok(app.execute({ ...query(root), before: first.next })).discussion!;
  expect(new Set([...first.entries, ...second.entries].map(({ id }) => id)).size).toBe(12);
  expect(second.next).toBeNull();
  expect(ok(app.execute(activity)).activity).toEqual(before);
  const read = { protocol_version: 1, operation: 'read_project', id: project.id };
  expect(ok(app.execute(read)).projects.find(({ id }) => id === project.id)).toEqual(project);

  ok(
    app.execute({
      ...ids(),
      operation: 'archive_project',
      id: project.id,
      expected_version: project.version,
      archived: true,
    }),
  );
  for (const scope of [root, updates, replies])
    expect(app.execute(publish(scope))).toMatchObject({ code: 'CONFLICT' });
  expect(app.execute(request)).toEqual(receipt);
  store.close();
  const reopened = openTaskStore(file, migrations);
  try {
    const reopenedApp = createCatalogApplication(reopened.catalog);
    for (const [scope, id] of [
      [root, receipt.target_id],
      [updates, update],
      [replies, reply],
    ] as const) {
      const response = ok(
        reopenedApp.execute(query(scope.kind === 'project_comment' ? root : scope)),
      );
      const entries =
        scope.kind === 'project_comment'
          ? ok(reopenedApp.execute({ ...query(scope), before: first.next })).discussion!.entries
          : response.discussion!.entries;
      expect(entries.find((entry) => entry.id === id)?.state).toEqual(state);
    }
    expect(reopenedApp.execute(status)).toEqual(receipt);
    expect(ok(reopenedApp.execute(read)).state).toBeNull();
  } finally {
    reopened.close();
  }
});

async function verifyDiscussionMigrationRollback(index: 11 | 13) {
  const root = mkdtempSync(join(tmpdir(), 'caselite-discussion-ddl-'));
  roots.push(root);
  const oldFolder = join(root, 'old');
  const badFolder = join(root, 'bad');
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'));
  for (const [folder, entries] of [
    [oldFolder, journal.entries.slice(0, index)],
    [badFolder, journal.entries],
  ]) {
    mkdirSync(join(folder, 'meta'), { recursive: true });
    writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries)
      copyFileSync(join(migrations, entry.tag + '.sql'), join(folder, entry.tag + '.sql'));
  }
  const migration = join(badFolder, journal.entries[index].tag + '.sql');
  writeFileSync(
    migration,
    readFileSync(migration, 'utf8') +
      '\n--> statement-breakpoint\nSELECT * FROM synthetic_missing_table;',
  );
  const file = join(root, 'data.sqlite');
  const backup = join(root, 'before-upgrade.sqlite');
  const old = openTaskStore(file, oldFolder);
  const app = createCatalogApplication(old.catalog);
  const project = ok(app.execute({ ...ids(), operation: 'create_project', title: '旧库项目' }))
    .projects[0];
  const state = binary('既有说明必须保留');
  const save = {
    ...ids(),
    operation: 'update_project',
    id: project.id,
    expected_version: project.version,
    expected_body_revision: project.body_revision,
    title: project.title,
    status: project.status,
    state,
  };
  const receipt = ok(app.execute(save));
  const read = { protocol_version: 1, operation: 'read_project', id: project.id };
  const activity = {
    protocol_version: 1,
    operation: 'list_activity',
    scope: { type: 'project', id: project.id },
    offset: 0,
  };
  const scope = { kind: 'project_comment', project_id: project.id };
  const query = { protocol_version: 1, operation: 'list_discussion', scope };
  const publish = {
    ...ids(),
    operation: 'publish_discussion',
    scope,
    state: binary('旧库项目评论'),
  };
  const oldDiscussion = index === 13 ? ok(app.execute(publish)) : null;
  const priorDiscussion =
    index === 13 ? ok(app.execute(query)).discussion : { entries: [], next: null };
  const prior = [app.execute(read), app.execute(activity)];
  const connection = openToolchainProbe(file, oldFolder);
  try {
    await connection.sqlite.backup(backup);
  } finally {
    connection.sqlite.close();
    old.close();
  }

  expect(() => openToolchainProbe(file, badFolder)).toThrow();
  for (const path of [file, backup]) {
    const pre = openToolchainProbe(path, oldFolder);
    try {
      expect(pre.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
        n: index,
      });
      expect(
        pre.sqlite
          .prepare('SELECT name FROM sqlite_master WHERE name=?')
          .get(index === 11 ? 'project_discussion' : 'task_comment'),
      ).toBeUndefined();
      expect(pre.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      pre.sqlite.close();
    }

    const next = openTaskStore(path, migrations);
    try {
      const migrated = createCatalogApplication(next.catalog);
      expect([migrated.execute(read), migrated.execute(activity)]).toEqual(prior);
      expect(migrated.execute({ ...save, request_id: randomUUID() })).toEqual(receipt);
      expect(ok(migrated.execute(query)).discussion).toEqual(priorDiscussion);
      if (oldDiscussion)
        expect(migrated.execute({ ...publish, request_id: randomUUID() })).toEqual(oldDiscussion);
    } finally {
      next.close();
    }
  }
}

it('rolls back interrupted 0011 migration and preserves populated 0010 project bytes, activity, and old receipts', () =>
  verifyDiscussionMigrationRollback(11));
it('rolls back interrupted 0013 migration and preserves populated 0012 project discussion and receipts', () =>
  verifyDiscussionMigrationRollback(13));

it('keeps task comments scoped to the original task across grouping, rollback and reopen', () => {
  const { app, file, store } = setup();
  const task = ok(
    store.execute({ ...ids(), operation: 'create', title: '任务评论样本', objective: '原说明' }),
  ).tasks[0];
  const second = ok(
    store.execute({ ...ids(), operation: 'create', title: '隔离任务', objective: '' }),
  ).tasks[0];
  const project = ok(app.execute({ ...ids(), operation: 'create_project', title: '归组样本' }))
    .projects[0];
  const scope = { kind: 'task_comment', task_id: task.id } as const;
  const state = binary('任务评论合成正文');
  const request = { ...ids(), operation: 'publish_discussion', scope, state };
  const query = { operation: 'list_discussion', protocol_version: 1, scope };
  const status = {
    operation: 'status',
    protocol_version: 1,
    idempotency_key: request.idempotency_key,
  };
  const activity = {
    operation: 'list_activity',
    protocol_version: 1,
    scope: { type: 'task', id: task.id },
    offset: 0,
  };
  const before = ok(app.execute(activity)).activity!;
  for (const id of [project.id, before[0].id]) {
    const invalid = { ...scope, task_id: id };
    expect(app.execute({ ...query, scope: invalid })).toMatchObject({ code: 'NOT_FOUND' });
    expect(app.execute({ ...request, scope: invalid })).toMatchObject({ code: 'NOT_FOUND' });
  }
  expect(app.execute({ ...request, scope: { ...scope, project_id: project.id } })).toMatchObject({
    code: 'INVALID_REQUEST',
  });
  const db = openToolchainProbe(file, migrations);
  try {
    const counts = () =>
      db.sqlite
        .prepare(
          'SELECT (SELECT count(*) FROM task_comment) AS comments,(SELECT count(*) FROM body_revisions) AS bodies',
        )
        .get();
    const prior = counts();
    db.sqlite.exec(
      "CREATE TRIGGER reject_task_comment_receipt BEFORE INSERT ON catalog_receipts BEGIN SELECT RAISE(ABORT,'synthetic task comment failure'); END",
    );
    expect(app.execute(request)).toMatchObject({ code: 'UNAVAILABLE' });
    expect(app.execute(status)).toMatchObject({ code: 'NOT_FOUND' });
    expect(counts()).toEqual(prior);
    db.sqlite.exec('DROP TRIGGER reject_task_comment_receipt');
  } finally {
    db.sqlite.close();
  }
  const receipt = ok(app.execute(request));
  expect(app.execute(status)).toEqual(receipt);
  expect(app.execute({ ...request, request_id: randomUUID() })).toEqual(receipt);
  expect(app.execute({ ...request, state: binary('不可覆盖') })).toMatchObject({
    code: 'CONFLICT',
  });
  expect(ok(app.execute(activity)).activity).toEqual(before);
  const first = ok(app.execute(query)).discussion!.entries;
  expect(first).toMatchObject([{ id: receipt.target_id, state }]);
  const assign = (matter_id: string | null, expected_version: number) =>
    ok(
      app.execute({
        ...ids(),
        operation: 'assign_task',
        task_id: task.id,
        matter_id,
        expected_version,
      }),
    );
  assign(project.id, task.version);
  expect(ok(app.execute(query)).discussion?.entries).toEqual(first);
  const grouped = ok(app.execute({ ...request, ...ids(), state: binary('归组后发布') }));
  expect(
    ok(app.execute({ ...query, scope: { ...scope, task_id: second.id } })).discussion?.entries,
  ).toEqual([]);
  ok(
    app.execute({
      ...ids(),
      operation: 'archive_project',
      id: project.id,
      expected_version: project.version,
      archived: true,
    }),
  );
  expect(app.execute({ ...request, ...ids() })).toMatchObject({ code: 'CONFLICT' });
  expect(ok(app.execute(query)).discussion).toMatchObject({ read_only: true });
  expect(app.execute(request)).toEqual(receipt);
  assign(null, task.version + 1);
  expect(ok(app.execute(query)).discussion).toMatchObject({
    read_only: false,
    entries: [{ id: grouped.target_id }, { id: receipt.target_id }],
  });
  const other = openTaskStore(file, migrations, 'other-workspace');
  try {
    const foreign = createCatalogApplication(other.catalog);
    for (const operation of [query, request, status]) {
      expect(foreign.execute(operation)).toMatchObject({ code: 'NOT_FOUND' });
    }
  } finally {
    other.close();
  }
  const persisted = ok(app.execute(query)).discussion;
  store.close();
  const reopened = openTaskStore(file, migrations);
  try {
    const reopenedApp = createCatalogApplication(reopened.catalog);
    expect(ok(reopenedApp.execute(query)).discussion).toEqual(persisted);
    expect(reopenedApp.execute(status)).toEqual(receipt);
    expect(
      ok(reopened.execute({ operation: 'read', protocol_version: 1, task_id: task.id })).tasks[0],
    ).toMatchObject({
      document_id: task.document_id,
      body_id: task.body_id,
      objective: task.objective,
    });
  } finally {
    reopened.close();
  }
});

it('binds milestones only to their current project, computes real progress and preserves receipts on reopen', () => {
  const { app, file, store } = setup();
  const project = (title: string) =>
    ok(app.execute({ ...ids(), operation: 'create_project', title })).target_id!;
  const first = project('合成里程碑甲');
  const second = project('合成里程碑乙');
  const milestone = (project_id: string, title: string) =>
    ok(
      app.execute({
        ...ids(),
        operation: 'create_milestone',
        project_id,
        title,
        target_date: '2026-12-01',
      }),
    ).target_id!;
  const plan = (project_id: string) =>
    ok(
      app.execute({
        protocol_version: 1,
        operation: 'read_project_plan',
        project_id,
      }),
    ).project_plan!;
  const firstMilestone = milestone(first, '完成核对');
  const otherMilestone = milestone(second, '另一项目阶段');
  const task = ok(
    store.execute({
      ...ids(),
      operation: 'create',
      title: '合成里程碑任务',
      objective: '',
      matter_id: first,
    }),
  ).tasks[0];
  const assign = {
    ...ids(),
    operation: 'assign_milestone',
    project_id: first,
    task_id: task.id,
    expected_version: task.version,
    milestone_id: firstMilestone,
  };
  expect(app.execute({ ...assign, milestone_id: otherMilestone })).toMatchObject({
    code: 'NOT_FOUND',
  });
  const foreign = openTaskStore(file, migrations, 'another-workspace');
  expect(createCatalogApplication(foreign.catalog).execute(assign)).toMatchObject({
    code: 'NOT_FOUND',
  });
  foreign.close();
  const db = openToolchainProbe(file, migrations).sqlite;
  db.exec(
    "CREATE TRIGGER reject_milestone BEFORE INSERT ON task_activity WHEN NEW.operation='assign_milestone' BEGIN SELECT RAISE(ABORT,'synthetic milestone activity failure'); END",
  );
  expect(app.execute(assign)).toMatchObject({ code: 'UNAVAILABLE' });
  expect(plan(first).assignments).toEqual([]);
  expect(
    app.execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: assign.idempotency_key,
    }),
  ).toMatchObject({ code: 'NOT_FOUND' });
  db.exec('DROP TRIGGER reject_milestone');
  db.close();
  const receipt = ok(app.execute(assign));
  expect(app.execute(assign)).toEqual(receipt);
  expect(plan(first).milestones[0]).toMatchObject({ total: 1, done: 0 });
  const saved = ok(
    store.execute({
      ...ids(),
      operation: 'change_status',
      task_id: task.id,
      expected_version: task.version + 1,
      status: 'done',
    }),
  ).tasks[0];
  expect(plan(first).milestones[0]).toMatchObject({ total: 1, done: 1 });
  ok(
    app.execute({
      ...ids(),
      operation: 'assign_task',
      task_id: task.id,
      expected_version: saved.version,
      matter_id: first,
    }),
  );
  expect(plan(first).assignments).toHaveLength(1);
  ok(
    app.execute({
      ...ids(),
      operation: 'assign_task',
      task_id: task.id,
      expected_version: saved.version + 1,
      matter_id: second,
    }),
  );
  expect(plan(first).assignments).toEqual([]);
  expect(plan(first).milestones[0]).toMatchObject({ total: 0, done: 0 });
  expect(plan(second).assignments).toEqual([]);
  store.close();
  const reopened = openTaskStore(file, migrations);
  expect(
    reopened.catalog.execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: assign.idempotency_key,
    }),
  ).toEqual(receipt);
  expect(
    ok(
      reopened.catalog.execute({
        protocol_version: 1,
        operation: 'read_project_plan',
        project_id: first,
      }),
    ).project_plan?.milestones[0],
  ).toMatchObject({ id: firstMilestone, title: '完成核对', target_date: '2026-12-01' });
  reopened.close();
});
