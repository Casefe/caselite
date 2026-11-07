import { afterEach, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
import { createTaskApplication } from '../../packages/application/src/task-application';
import { createCatalogApplication } from '../../packages/application/src/catalog-application';
import type { Task, TaskResponse, TaskStatus } from '../../packages/contracts/src';

const migrations = resolve('packages/local-db/migrations');
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
const root = () => {
  const value = mkdtempSync(join(tmpdir(), 'caselite-status-'));
  roots.push(value);
  return value;
};
const ok = (value: TaskResponse) => {
  expect(value.ok).toBe(true);
  if (!value.ok) throw new Error(value.message);
  return value;
};
function binary(text: string, heading = false) {
  const doc = new Y.Doc(),
    p = new Y.XmlElement(heading ? 'heading' : 'paragraph'),
    t = new Y.XmlText();
  t.insert(0, text);
  if (heading) p.setAttribute('level', 2);
  p.insert(0, [t]);
  doc.getXmlFragment('default').insert(0, [p]);
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return state;
}
function migrationCopy(directory: string, count: number, fail = false) {
  const target = join(directory, fail ? 'failed-migrations' : 'old-migrations');
  mkdirSync(join(target, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, count);
  for (const entry of journal.entries)
    copyFileSync(join(migrations, entry.tag + '.sql'), join(target, entry.tag + '.sql'));
  if (fail) {
    const file = join(target, journal.entries.at(-1).tag + '.sql');
    writeFileSync(
      file,
      readFileSync(file, 'utf8') +
        '\n--> statement-breakpoint\nSELECT * FROM synthetic_missing_status_table;',
    );
  }
  writeFileSync(join(target, 'meta/_journal.json'), JSON.stringify(journal));
  return target;
}

it('upgrades a WAL backup of a populated pre-status database without rewriting identities, bodies or receipts', async () => {
  const directory = root(),
    file = join(directory, 'old.sqlite'),
    backup = join(directory, 'backup.sqlite');
  const oldMigrations = migrationCopy(directory, 6);
  const connection = openToolchainProbe(file, oldMigrations),
    db = connection.sqlite;
  db.pragma('journal_mode=WAL');
  db.pragma('foreign_keys=ON');
  const id = randomUUID(),
    document = randomUUID(),
    body = randomUUID(),
    project = randomUUID();
  const bytes = binary('合成正文与说明，迁移不得改写。');
  const request = {
    ...identity(),
    operation: 'create' as const,
    title: '合成旧任务',
    objective: '合成目标',
  };
  const task = {
    id,
    title: request.title,
    objective: request.objective,
    matter_id: null,
    version: 1,
    document_id: document,
    body_id: body,
    body_revision: 2,
    editor_schema: 1,
    document_archived_at: null,
    matter_title: null,
    updated_at: '2026-11-01T00:00:00.000Z',
  };
  const response = JSON.stringify({
    ok: true,
    tasks: [task],
    state: null,
    receipt: request.idempotency_key,
  });
  const { request_id: diagnostic, ...content } = request;
  void diagnostic;
  const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  db.prepare(
    'INSERT INTO task_items(id,workspace_id,title,objective,version,updated_at) VALUES(?,?,?,?,?,?)',
  ).run(id, 'local', task.title, task.objective, 1, task.updated_at);
  db.prepare(
    'INSERT INTO documents(id,task_id,body_id,body_revision,editor_schema) VALUES(?,?,?,2,1)',
  ).run(document, id, body);
  db.prepare('INSERT INTO body_revisions(body_id,revision,state) VALUES(?,1,?)').run(body, bytes);
  db.prepare('INSERT INTO body_revisions(body_id,revision,state) VALUES(?,2,?)').run(
    body,
    binary('合成正文第二修订。'),
  );
  db.prepare('INSERT INTO task_objective_revisions(task_id,task_version,state) VALUES(?,1,?)').run(
    id,
    binary(task.objective, true),
  );
  db.prepare(
    'INSERT INTO matters(id,workspace_id,title,status,version,body_id,body_revision,editor_schema,updated_at) VALUES(?,?,?,?,1,?,0,1,?)',
  ).run(project, 'local', '合成旧项目', 'planned', randomUUID(), task.updated_at);
  db.prepare('INSERT INTO task_projects(task_id,matter_id) VALUES(?,?)').run(id, project);
  db.prepare('INSERT INTO task_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)').run(
    'local',
    request.idempotency_key,
    digest,
    response,
  );
  const protectedBefore = JSON.stringify({
    documents: db.prepare('SELECT * FROM documents').all(),
    bodies: db.prepare('SELECT * FROM body_revisions').all(),
    goals: db.prepare('SELECT * FROM task_objective_revisions').all(),
    projects: db.prepare('SELECT * FROM task_projects').all(),
  });
  await db.backup(backup);
  db.close();
  for (const candidate of [file, backup]) {
    const store = openTaskStore(candidate, migrations),
      app = createTaskApplication(store);
    const current = ok(app.execute({ protocol_version: 1, operation: 'read', task_id: id }))
      .tasks[0];
    expect(current).toMatchObject({
      id,
      status: 'todo',
      version: 1,
      updated_at: task.updated_at,
      document_id: document,
      body_id: body,
      body_revision: 2,
      matter_id: project,
    });
    ok(
      app.execute({
        ...identity(),
        operation: 'change_status',
        task_id: id,
        expected_version: 1,
        status: 'done',
      }),
    );
    expect(ok(app.execute(request)).tasks[0].status).toBe('todo');
    expect(
      ok(app.execute({ protocol_version: 1, operation: 'read', task_id: id })).tasks[0].status,
    ).toBe('done');
    store.close();
    const checked = openToolchainProbe(candidate, migrations);
    expect(
      JSON.stringify({
        documents: checked.sqlite.prepare('SELECT * FROM documents').all(),
        bodies: checked.sqlite.prepare('SELECT * FROM body_revisions').all(),
        goals: checked.sqlite.prepare('SELECT * FROM task_objective_revisions').all(),
        projects: checked.sqlite.prepare('SELECT * FROM task_projects').all(),
      }),
    ).toBe(protectedBefore);
    expect(
      checked.sqlite
        .prepare('SELECT digest,result FROM task_receipts WHERE key=?')
        .get(request.idempotency_key),
    ).toEqual({ digest, result: response });
    expect(checked.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(checked.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(checked.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
      n: 9,
    });
    checked.sqlite.close();
  }
});

it('rolls back a failed status migration, preserves the old library and can subsequently upgrade', () => {
  const directory = root(),
    file = join(directory, 'db.sqlite'),
    old = migrationCopy(directory, 6);
  const before = openToolchainProbe(file, old);
  before.sqlite
    .prepare('INSERT INTO toolchain_probe(id,value) VALUES(?,?)')
    .run('synthetic', 'preserved');
  const id = randomUUID(),
    body = randomUUID(),
    bytes = binary('合成失败迁移正文。');
  before.sqlite
    .prepare(
      'INSERT INTO task_items(id,workspace_id,title,objective,version,updated_at) VALUES(?,?,?,?,1,?)',
    )
    .run(id, 'local', '旧任务', '', '2026-11-01');
  before.sqlite
    .prepare(
      'INSERT INTO documents(id,task_id,body_id,body_revision,editor_schema) VALUES(?,?,?,1,1)',
    )
    .run(randomUUID(), id, body);
  before.sqlite
    .prepare('INSERT INTO body_revisions(body_id,revision,state) VALUES(?,1,?)')
    .run(body, bytes);
  before.sqlite.close();
  expect(() => openTaskStore(file, migrationCopy(directory, 7, true))).toThrow();
  const checked = openToolchainProbe(file, old);
  expect(
    checked.sqlite
      .prepare('PRAGMA table_info(task_items)')
      .all()
      .some((row) => (row as { name: string }).name === 'status'),
  ).toBe(false);
  expect(
    checked.sqlite.prepare('SELECT value FROM toolchain_probe WHERE id=?').get('synthetic'),
  ).toEqual({ value: 'preserved' });
  expect(checked.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
    n: 6,
  });
  expect(
    checked.sqlite.prepare('SELECT state FROM body_revisions WHERE body_id=?').get(body),
  ).toEqual({ state: bytes });
  expect(checked.sqlite.prepare('SELECT title,version FROM task_items WHERE id=?').get(id)).toEqual(
    { title: '旧任务', version: 1 },
  );
  checked.sqlite.close();
  const restored = openTaskStore(file, migrations);
  expect(
    ok(restored.execute({ protocol_version: 1, operation: 'read', task_id: id })).state,
  ).toEqual(Array.from(bytes));
  restored.close();
});

it('persists every directed manual transition with idempotent receipts, version guards and no cross-workspace access', () => {
  const file = join(root(), 'db.sqlite'),
    store = openTaskStore(file, migrations),
    app = createTaskApplication(store);
  let task = ok(
    app.execute({ ...identity(), operation: 'create', title: '合成状态任务', objective: '' }),
  ).tasks[0];
  const states: TaskStatus[] = ['todo', 'in_progress', 'done', 'canceled'];
  for (const from of states)
    for (const status of states.filter((value) => value !== from)) {
      if (task.status !== from)
        task = ok(
          app.execute({
            ...identity(),
            operation: 'change_status',
            task_id: task.id,
            expected_version: task.version,
            status: from,
          }),
        ).tasks[0];
      const change = {
        ...identity(),
        operation: 'change_status' as const,
        task_id: task.id,
        expected_version: task.version,
        status,
      };
      const result = ok(app.execute(change));
      task = result.tasks[0];
      expect(task.status).toBe(status);
      expect(app.execute({ ...change, request_id: randomUUID() })).toEqual(result);
      expect(app.execute({ ...change, status: from })).toMatchObject({
        ok: false,
        code: 'CONFLICT',
      });
      expect(
        app.execute({
          ...identity(),
          operation: 'change_status',
          task_id: task.id,
          expected_version: task.version - 1,
          status: from,
        }),
      ).toMatchObject({ ok: false, code: 'CONFLICT' });
      expect(
        app.execute({
          ...identity(),
          operation: 'change_status',
          task_id: task.id,
          expected_version: task.version,
          status,
        }),
      ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
      expect(
        ok(
          app.execute({
            protocol_version: 1,
            operation: 'status',
            idempotency_key: change.idempotency_key,
          }),
        ),
      ).toEqual(result);
    }
  const invalid = openToolchainProbe(file, migrations);
  expect(() =>
    invalid.sqlite
      .prepare('UPDATE task_items SET status=? WHERE id=?')
      .run('outside-enum', task.id),
  ).toThrow();
  invalid.sqlite.close();
  const other = openTaskStore(file, migrations, 'other');
  expect(
    createTaskApplication(other).execute({
      ...identity(),
      operation: 'change_status',
      task_id: task.id,
      expected_version: task.version,
      status: 'todo',
    }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  other.close();
  store.close();
  const reopened = openTaskStore(file, migrations);
  expect(
    ok(reopened.execute({ protocol_version: 1, operation: 'read', task_id: task.id })).tasks[0],
  ).toEqual(task);
  reopened.close();
});

it.each(['task_activity', 'task_receipts'])(
  'rolls status and version back when %s insertion fails, then commits the original request once',
  (table) => {
    const file = join(root(), 'db.sqlite'),
      store = openTaskStore(file, migrations),
      app = createTaskApplication(store);
    const before = ok(
      app.execute({ ...identity(), operation: 'create', title: '合成失败任务', objective: '' }),
    ).tasks[0];
    const db = openToolchainProbe(file, migrations).sqlite;
    db.exec(
      `CREATE TRIGGER fail_status BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic status commit failure'); END`,
    );
    const change = {
      ...identity(),
      operation: 'change_status' as const,
      task_id: before.id,
      expected_version: before.version,
      status: 'done' as const,
    };
    expect(app.execute(change)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
    expect(
      ok(app.execute({ protocol_version: 1, operation: 'read', task_id: before.id })).tasks[0],
    ).toEqual(before);
    expect(
      app.execute({
        protocol_version: 1,
        operation: 'status',
        idempotency_key: change.idempotency_key,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    db.exec('DROP TRIGGER fail_status');
    ok(app.execute(change));
    ok(app.execute(change));
    expect(
      db.prepare("SELECT count(*) AS n FROM task_activity WHERE operation='change_status'").get(),
    ).toEqual({ n: 1 });
    db.close();
    store.close();
  },
);

it('shares version conflicts with grouping, preserves rich body/Run data and keeps status on old update/save commands', () => {
  const file = join(root(), 'db.sqlite'),
    store = openTaskStore(file, migrations),
    app = createTaskApplication(store),
    catalog = createCatalogApplication(store.catalog);
  let task: Task = ok(
    app.execute({ ...identity(), operation: 'create', title: '合成归组任务', objective: '' }),
  ).tasks[0];
  const project = catalog.execute({
    ...identity(),
    operation: 'create_project',
    title: '合成项目',
  });
  if (!project.ok) throw new Error(project.message);
  const group = {
    ...identity(),
    operation: 'assign_task' as const,
    task_id: task.id,
    expected_version: task.version,
    matter_id: project.target_id!,
  };
  task = ok(
    app.execute({
      ...identity(),
      operation: 'change_status',
      task_id: task.id,
      expected_version: task.version,
      status: 'done',
    }),
  ).tasks[0];
  expect(catalog.execute(group)).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(catalog.execute({ ...group, expected_version: task.version }).ok).toBe(true);
  expect(
    app.execute({
      ...identity(),
      operation: 'change_status',
      task_id: task.id,
      expected_version: task.version,
      status: 'todo',
    }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  task = ok(app.execute({ protocol_version: 1, operation: 'read', task_id: task.id })).tasks[0];
  task = ok(
    app.execute({
      ...identity(),
      operation: 'update',
      task_id: task.id,
      expected_version: task.version,
      title: task.title,
      objective: '合成新目标',
      objective_state: Array.from(binary('合成新目标')),
    }),
  ).tasks[0];
  task = ok(
    app.execute({
      ...identity(),
      operation: 'save',
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: 0,
      editor_schema: 1,
      state: Array.from(binary('合成正文')),
    }),
  ).tasks[0];
  expect(task.status).toBe('done');
  store.agentHistory.register({
    id: randomUUID(),
    scope: task.id,
    model: 'deepseek-flash',
    provider: 'deepseek',
    prompt: '合成输入',
    output: '',
    status: 'cancelled',
    sequence: 1,
    message: '',
    usage: null,
  });
  const runs = store.agentHistory.load();
  const db = openToolchainProbe(file, migrations).sqlite;
  const protectedRows = () =>
    JSON.stringify({
      body: db.prepare('SELECT * FROM body_revisions').all(),
      goal: db.prepare('SELECT * FROM task_objective_revisions').all(),
      group: db.prepare('SELECT * FROM task_projects').all(),
      docs: db.prepare('SELECT * FROM documents').all(),
    });
  const before = protectedRows();
  ok(
    app.execute({
      ...identity(),
      operation: 'change_status',
      task_id: task.id,
      expected_version: task.version,
      status: 'todo',
    }),
  );
  expect(protectedRows()).toBe(before);
  expect(store.agentHistory.load()).toEqual(runs);
  db.close();
  store.close();
});
