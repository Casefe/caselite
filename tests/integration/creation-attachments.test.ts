import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { openTaskStore } from '../../packages/local-db/src/task-store';
import { createMaterialApplication } from '../../packages/application/src/material-application';
import { createTaskApplication } from '../../packages/application/src/task-application';
import { createMaterialFiles } from '../../apps/desktop/src/main/adapters/material-files';
import { emptyTaskCalendar, type MaterialResponse } from '../../packages/contracts/src';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const fixture = resolve('tests/fixtures/case-materials/development/contract-v1-text.pdf');
function ok(value: MaterialResponse) {
  expect(value.ok).toBe(true);
  if (!value.ok) throw Error(value.message);
  return value;
}
function setup(root = mkdtempSync(join(tmpdir(), 'caselite-create-attachments-'))) {
  if (!roots.includes(root)) roots.push(root);
  const store = openTaskStore(join(root, 'db.sqlite'), resolve('packages/local-db/migrations'));
  const files = createMaterialFiles(join(root, 'materials'));
  let failPlace = false;
  let failDiscard = false;
  const app = createMaterialApplication({
    store: store.materials,
    files: {
      ...files,
      async place(...args) {
        if (failPlace) {
          failPlace = false;
          throw Error('Synthetic disk failure');
        }
        return files.place(...args);
      },
      async discard(...args) {
        if (failDiscard) {
          failDiscard = false;
          throw Error('Synthetic cleanup failure');
        }
        return files.discard(...args);
      },
    },
    processor: {
      configuration: 'synthetic-no-extraction',
      inspect: async () => 1,
      process: async () => {},
    },
    id: randomUUID,
    hash: (text) => createHash('sha256').update(text).digest('hex'),
    taskExists: (id) => store.execute({ protocol_version: 1, operation: 'read', task_id: id }).ok,
    createTask() {
      throw Error('Creation draft must never create a home task');
    },
  });
  const scope = randomUUID();
  const request = (operation: string, extra: Record<string, unknown> = {}) =>
    app.execute({ protocol_version: 1, operation, scope, ...extra });
  return {
    root,
    store,
    files,
    app,
    scope,
    request,
    fail() {
      failPlace = true;
    },
    failCleanup() {
      failDiscard = true;
    },
  };
}
it('binds Task/calendar/attachment identity before the creation ACK, resumes partial file failure after restart and replays the original IDs', async () => {
  const first = setup();
  await first.request('creation_open');
  const one = ok(await first.app.stage(fixture, first.scope)).creation_draft!.files[0];
  const two = ok(await first.app.stage(fixture, first.scope)).creation_draft!.files[1];
  expect(first.store.materials.task('home')).toBeUndefined();
  expect(first.store.execute({ protocol_version: 1, operation: 'list' })).toMatchObject({
    ok: true,
    tasks: [],
  });
  const create = {
    protocol_version: 1 as const,
    operation: 'create' as const,
    request_id: randomUUID(),
    idempotency_key: randomUUID(),
    title: '合成日程创建',
    objective: '',
    creation_draft_id: first.scope,
    initial_calendar: {
      ...emptyTaskCalendar,
      planned_date: '2026-11-11',
      schedule: { date: '2026-11-11', start: '14:00', end: '15:00', timezone: 'Asia/Shanghai' },
    },
  };
  const result = first.store.execute(create);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.message);
  const taskId = result.tasks[0].id;
  expect(result.tasks[0].calendar).toEqual(create.initial_calendar);
  expect(first.store.materials.creationDraft(first.scope)).toMatchObject({
    state: 'bound',
    task_id: taskId,
  });
  expect(first.store.execute(create)).toEqual(result);
  expect(
    first.store.execute({ ...create, request_id: randomUUID(), idempotency_key: randomUUID() }),
  ).toMatchObject({ ok: false });
  ok(
    await first.app.execute({
      protocol_version: 1,
      operation: 'commit',
      scope: taskId,
      token: one.token,
    }),
  );
  first.fail();
  expect(
    await first.app.execute({
      protocol_version: 1,
      operation: 'commit',
      scope: taskId,
      token: two.token,
    }),
  ).toMatchObject({ ok: false });
  first.store.close();
  const second = setup(first.root);
  try {
    const resumed = ok(await second.request('creation_resume', { scope: 'home' })).creation_draft!;
    expect(second.store.materials.pending(taskId)).toBeUndefined();
    expect(
      await second.app.execute({
        protocol_version: 1,
        operation: 'discard',
        scope: taskId,
        token: two.token,
      }),
    ).toMatchObject({ ok: false, code: 'CREATION_DRAFT' });
    expect(resumed).toMatchObject({
      id: first.scope,
      task_id: taskId,
      files: [
        { token: one.token, saved: true },
        { token: two.token, saved: false },
      ],
    });
    ok(
      await second.app.execute({
        protocol_version: 1,
        operation: 'commit',
        scope: taskId,
        token: two.token,
      }),
    );
    ok(
      await second.app.execute({
        protocol_version: 1,
        operation: 'commit',
        scope: taskId,
        token: two.token,
      }),
    );
    ok(await second.request('creation_finish', { scope: first.scope }));
    expect(
      ok(await second.request('creation_resume', { scope: 'home' })).creation_draft,
    ).toBeNull();
    const saved = second.store.materials.list(taskId);
    expect(saved.map((file) => file.id)).toEqual([one.token, two.token]);
    for (const file of saved)
      expect(Buffer.from(await second.files.read(file.asset_version_id, file.sha256))).toEqual(
        readFileSync(fixture),
      );
    expect(second.store.execute(create)).toEqual(result);
  } finally {
    second.store.close();
  }
});
it('preserves bytes when cancellation metadata fails and retains only cancelled residue when cleanup fails', async () => {
  const s = setup();
  try {
    await s.request('creation_open');
    const file = ok(await s.app.stage(fixture, s.scope)).creation_draft!.files[0];
    const stage = s.store.materials.stage(file.token)!;
    const put = s.store.materials.putCreationDraft;
    s.store.materials.putCreationDraft = () => {
      throw Error('Synthetic cancellation database failure');
    };
    expect(await s.request('creation_remove', { token: file.token })).toMatchObject({ ok: false });
    expect(Buffer.from(await s.files.placedOrStaged(file.token, stage.sha256))).toEqual(
      readFileSync(fixture),
    );
    expect(s.store.materials.stage(file.token)?.state).toBe('staged');
    s.store.materials.putCreationDraft = put;
    s.failCleanup();
    expect(ok(await s.request('creation_remove', { token: file.token }))).toMatchObject({
      creation_warning: expect.any(String),
      creation_draft: { files: [] },
    });
    expect(s.store.materials.stage(file.token)?.state).toBe('cancelled');
    expect(s.store.materials.creationDraft(s.scope)?.tokens).toEqual([]);
  } finally {
    s.store.close();
  }
});
it('creates successfully with an empty draft after picker cancellation or removing the last file', async () => {
  const s = setup();
  try {
    for (const removeLast of [false, true]) {
      const scope = randomUUID();
      ok(await s.request('creation_open', { scope }));
      if (removeLast) {
        const file = ok(await s.app.stage(fixture, scope)).creation_draft!.files[0];
        ok(await s.request('creation_remove', { scope, token: file.token }));
      }
      const result = s.store.execute({
        protocol_version: 1,
        operation: 'create',
        request_id: randomUUID(),
        idempotency_key: randomUUID(),
        title: '空附件创建',
        objective: '',
        creation_draft_id: scope,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw Error(result.message);
      ok(await s.request('creation_bind', { scope, task_id: result.tasks[0].id }));
      ok(await s.request('creation_finish', { scope }));
      expect(s.store.materials.list(result.tasks[0].id)).toEqual([]);
    }
  } finally {
    s.store.close();
  }
});
it('removes only this draft staging, rejects other tokens and leaves original files and existing tasks untouched', async () => {
  const s = setup();
  try {
    const original = readFileSync(fixture);
    await s.request('creation_open');
    const file = ok(await s.app.stage(fixture, s.scope)).creation_draft!.files[0];
    expect(await s.request('creation_remove', { token: randomUUID() })).toMatchObject({
      ok: false,
    });
    expect(s.store.materials.stage(s.scope)).toBeUndefined();
    ok(await s.request('creation_discard'));
    expect(s.store.materials.stage(file.token)?.state).toBe('cancelled');
    expect(readFileSync(fixture)).toEqual(original);
    expect(s.store.execute({ protocol_version: 1, operation: 'list' })).toMatchObject({
      ok: true,
      tasks: [],
    });
    expect(await s.app.stage(fixture, s.scope)).toMatchObject({ ok: false });
    const bad = join(s.root, 'wrong.png');
    writeFileSync(bad, original);
    const freshScope = randomUUID();
    await s.request('creation_open', { scope: freshScope });
    expect(await s.app.stage(bad, freshScope)).toMatchObject({ ok: false });
  } finally {
    s.store.close();
  }
});
it('rolls Task, attachment binding and receipt back together, and cannot overwrite another staging record kind', async () => {
  const s = setup();
  const db = new Database(join(s.root, 'db.sqlite'));
  try {
    await s.request('creation_open');
    ok(await s.app.stage(fixture, s.scope));
    const workspace = (
      db.prepare('SELECT workspace_id FROM material_stages LIMIT 1').get() as {
        workspace_id: string;
      }
    ).workspace_id;
    const collision = randomUUID(),
      payload = JSON.stringify({ kind: 'batch', sentinel: true });
    db.prepare('INSERT INTO material_stages(token,workspace_id,payload) VALUES(?,?,?)').run(
      collision,
      workspace,
      payload,
    );
    expect(await s.request('creation_open', { scope: collision })).toMatchObject({
      ok: true,
      creation_draft: { id: s.scope },
    });
    // 先取消活跃草稿，才能让身份冲突路径真正走到写入边界。
    ok(await s.request('creation_discard'));
    expect(await s.request('creation_open', { scope: collision })).toMatchObject({ ok: false });
    expect(db.prepare('SELECT payload FROM material_stages WHERE token=?').get(collision)).toEqual({
      payload,
    });
    const freshScope = randomUUID();
    await s.request('creation_open', { scope: freshScope });
    ok(await s.app.stage(fixture, freshScope));
    db.exec(
      "CREATE TRIGGER fail_creation_receipt BEFORE INSERT ON task_receipts BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END",
    );
    const command = {
      protocol_version: 1 as const,
      operation: 'create' as const,
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
      title: '合成原子创建',
      objective: '',
      creation_draft_id: freshScope,
    };
    const tasks = createTaskApplication(s.store);
    expect(tasks.execute(command)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
    expect(s.store.materials.creationDraft(freshScope)).toMatchObject({ state: 'open' });
    expect(s.store.execute({ protocol_version: 1, operation: 'list' })).toMatchObject({
      ok: true,
      tasks: [],
    });
    db.exec('DROP TRIGGER fail_creation_receipt');
    expect(tasks.execute(command)).toMatchObject({ ok: true });
  } finally {
    db.close();
    s.store.close();
  }
});
