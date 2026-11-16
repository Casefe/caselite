import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openTaskStore } from '../../packages/local-db/src';
import { createIntakeApplication } from '../../packages/application/src/intake-application';
import { createTaskApplication } from '../../packages/application/src/task-application';
import type { IntakeRequest, IntakeResponse, TaskResponse } from '../../packages/contracts/src';

const migrations = resolve('packages/local-db/migrations');
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
const file = () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-intake-'));
  roots.push(root);
  return join(root, 'workspace.sqlite');
};
const ids = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
const ok = (result: IntakeResponse) => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
};
const taskOk = (result: TaskResponse) => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
};
const open = () => {
  const path = file();
  const store = openTaskStore(path, migrations);
  return {
    path,
    store,
    intake: createIntakeApplication(store.intake),
    tasks: createTaskApplication(store),
    db: new Database(path),
  };
};
const count = (db: Database.Database, table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const matterRow = (db: Database.Database, id: string) =>
  db
    .prepare(
      'SELECT title,status,archived_at,version,updated_at,professional_fields FROM matters WHERE id=?',
    )
    .get(id);
const submit = (
  intake: ReturnType<typeof createIntakeApplication>,
  extra: Partial<Extract<IntakeRequest, { operation: 'submit' }>> = {},
) =>
  intake.execute({
    ...ids(),
    operation: 'submit',
    title: '来访记录',
    text: '先不要立任务。',
    ...extra,
  });

it('creates a task once when accept is repeated, and leaves a rejected or expired snooze untouched', () => {
  const { store, intake, db } = open();
  const created = ok(submit(intake));
  const requestId = created.requests[0]!.id;
  const firstKey = ids();
  const accepted = ok(
    intake.execute({ ...firstKey, operation: 'accept_create', work_request_id: requestId }),
  );
  const again = ok(
    intake.execute({ ...ids(), operation: 'accept_create', work_request_id: requestId }),
  );
  const replay = ok(
    intake.execute({ ...firstKey, operation: 'accept_create', work_request_id: requestId }),
  );
  expect(again.task_id).toBe(accepted.task_id);
  expect(replay.task_id).toBe(accepted.task_id);
  expect(count(db, 'task_items')).toBe(1);
  expect(accepted.requests[0]).toMatchObject({
    status: 'accepted',
    target_task_id: accepted.task_id,
    target_task_version: 1,
  });

  const held = ok(submit(intake, { title: '暂缓事项', text: '下周再看' }));
  const snoozed = ok(
    intake.execute({
      ...ids(),
      operation: 'snooze',
      work_request_id: held.requests[0]!.id,
      until: '2000-01-02T00:00:00.000Z',
    }),
  );
  expect(snoozed.requests[0]).toMatchObject({ status: 'snoozed' });
  const listed = ok(
    intake.execute({ protocol_version: 1, operation: 'list', now: '2099-01-01T00:00:00.000Z' }),
  );
  expect(listed.requests.find((row) => row.id === held.requests[0]!.id)).toMatchObject({
    status: 'snoozed',
    snooze_due: true,
  });
  expect(count(db, 'task_items')).toBe(1);

  const refused = ok(submit(intake, { title: '不收', text: '' }));
  expect(
    ok(intake.execute({ ...ids(), operation: 'reject', work_request_id: refused.requests[0]!.id }))
      .requests[0],
  ).toMatchObject({ status: 'rejected', target_task_id: null });
  expect(
    intake.execute({
      ...ids(),
      operation: 'accept_create',
      work_request_id: refused.requests[0]!.id,
    }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(count(db, 'task_items')).toBe(1);
  db.close();
  store.close();
});

it('reopens the same receipt after restart and rolls back when the intake update cannot be stored', () => {
  const { path, store, intake, db } = open();
  const created = ok(submit(intake, { title: '重启后仍在', text: '同一条' }));
  const key = ids();
  const accepted = ok(
    intake.execute({
      ...key,
      operation: 'accept_create',
      work_request_id: created.requests[0]!.id,
    }),
  );
  store.close();
  const reopened = openTaskStore(path, migrations);
  const again = createIntakeApplication(reopened.intake);
  expect(
    ok(
      again.execute({
        protocol_version: 1,
        operation: 'receipt',
        idempotency_key: key.idempotency_key,
      }),
    ).task_id,
  ).toBe(accepted.task_id);
  expect(
    again.execute({ protocol_version: 1, operation: 'receipt', idempotency_key: randomUUID() }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(count(new Database(path), 'task_items')).toBe(1);

  const pending = ok(submit(again, { title: '失败保留', text: '不要半个任务' }));
  db.exec(
    "CREATE TRIGGER synthetic_intake_failure BEFORE UPDATE ON work_requests BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  const failed = again.execute({
    ...ids(),
    operation: 'accept_create',
    work_request_id: pending.requests[0]!.id,
  });
  expect(failed).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
  expect(count(db, 'task_items')).toBe(1);
  expect(
    ok(
      again.execute({ protocol_version: 1, operation: 'list', now: '2026-11-16T00:00:00.000Z' }),
    ).requests.find((row) => row.id === pending.requests[0]!.id),
  ).toMatchObject({ status: 'pending', target_task_id: null });
  db.exec('DROP TRIGGER synthetic_intake_failure');
  expect(
    ok(
      again.execute({
        ...ids(),
        operation: 'accept_create',
        work_request_id: pending.requests[0]!.id,
      }),
    ).task_id,
  ).not.toBe(accepted.task_id);
  expect(count(db, 'task_items')).toBe(2);
  db.close();
  reopened.close();
});

it('blocks duplicate chains, self references and tasks outside the workspace without creating a task', () => {
  const { store, intake, db } = open();
  const first = ok(submit(intake, { title: '甲', text: '' }));
  const second = ok(submit(intake, { title: '乙', text: '' }));
  const third = ok(submit(intake, { title: '丙', text: '' }));
  expect(
    ok(
      intake.execute({
        ...ids(),
        operation: 'duplicate',
        work_request_id: second.requests[0]!.id,
        target: { type: 'request', id: first.requests[0]!.id },
      }),
    ).requests[0],
  ).toMatchObject({ status: 'duplicate', duplicate_of_request_id: first.requests[0]!.id });
  expect(
    intake.execute({
      ...ids(),
      operation: 'duplicate',
      work_request_id: third.requests[0]!.id,
      target: { type: 'request', id: second.requests[0]!.id },
    }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(
    intake.execute({
      ...ids(),
      operation: 'duplicate',
      work_request_id: first.requests[0]!.id,
      target: { type: 'request', id: first.requests[0]!.id },
    }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  const foreignRequest = randomUUID();
  db.prepare(
    `INSERT INTO work_requests(id,workspace_id,title,body,source,status,version,created_at,updated_at) VALUES(?,?,?,?, 'local_manual','pending',1,?,?)`,
  ).run(
    foreignRequest,
    'foreign',
    '别人的请求',
    '',
    '2026-11-16T00:00:00.000Z',
    '2026-11-16T00:00:00.000Z',
  );
  expect(
    intake.execute({
      ...ids(),
      operation: 'duplicate',
      work_request_id: third.requests[0]!.id,
      target: { type: 'request', id: foreignRequest },
    }),
  ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  const foreignTask = randomUUID();
  db.prepare(
    'INSERT INTO task_items(id,workspace_id,title,objective,version,updated_at) VALUES(?,?,?,?,1,?)',
  ).run(foreignTask, 'foreign', '别人的任务', '', '2026-11-16T00:00:00.000Z');
  expect(
    intake.execute({
      ...ids(),
      operation: 'accept_link',
      work_request_id: third.requests[0]!.id,
      task_id: foreignTask,
    }),
  ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(
    ok(
      intake.execute({ protocol_version: 1, operation: 'list', now: '2026-11-16T00:00:00.000Z' }),
    ).requests.find((row) => row.id === third.requests[0]!.id)?.status,
  ).toBe('pending');
  expect(count(db, 'task_items')).toBe(1);
  db.close();
  store.close();
});

it('keeps attachment drafts open until one accept and does not change a matter', () => {
  const { store, intake, tasks, db } = open();
  const draftId = randomUUID();
  store.materials.putCreationDraft({ id: draftId, state: 'open', tokens: [] });
  const refused = ok(
    submit(intake, { title: '带附件但拒绝', text: '', attachment_draft_id: draftId }),
  );
  ok(intake.execute({ ...ids(), operation: 'reject', work_request_id: refused.requests[0]!.id }));
  const refusedDraft = store.materials.creationDraft(draftId);
  expect(refusedDraft?.state).toBe('open');
  expect(refusedDraft?.task_id).toBeUndefined();
  const matter = randomUUID();
  const before = '2026-11-16T00:00:00.000Z';
  db.prepare(
    'INSERT INTO matters(id,workspace_id,title,status,version,body_id,body_revision,editor_schema,updated_at) VALUES(?,?,?,?,1,?,0,1,?)',
  ).run(matter, 'local', '既有案件', 'planned', randomUUID(), before);
  const snapshot = matterRow(db, matter);
  const accepted = ok(
    submit(intake, { title: '采纳这一条', text: '说明', attachment_draft_id: draftId }),
  );
  const result = ok(
    intake.execute({
      ...ids(),
      operation: 'accept_create',
      work_request_id: accepted.requests[0]!.id,
      matter_id: matter,
    }),
  );
  expect(store.materials.creationDraft(draftId)).toMatchObject({
    state: 'bound',
    task_id: result.task_id,
  });
  expect(matterRow(db, matter)).toEqual(snapshot);
  expect(
    db.prepare('SELECT matter_id FROM task_projects WHERE task_id=?').get(result.task_id!),
  ).toEqual({ matter_id: matter });
  const linked = taskOk(
    tasks.execute({ ...ids(), operation: 'create', title: '原任务', objective: '不要复制' }),
  ).tasks[0]!;
  const pending = ok(submit(intake, { title: '只关联', text: '' }));
  ok(
    intake.execute({
      ...ids(),
      operation: 'accept_link',
      work_request_id: pending.requests[0]!.id,
      task_id: linked.id,
    }),
  );
  expect(
    taskOk(tasks.execute({ protocol_version: 1, operation: 'read', task_id: linked.id })).tasks[0],
  ).toMatchObject({
    id: linked.id,
    version: linked.version,
    title: '原任务',
  });
  expect(count(db, 'task_items')).toBe(2);
  db.prepare('UPDATE matters SET archived_at=? WHERE id=?').run(before, matter);
  const archived = matterRow(db, matter);
  const blocked = ok(submit(intake, { title: '不能动归档案件', text: '' }));
  expect(
    intake.execute({
      ...ids(),
      operation: 'accept_create',
      work_request_id: blocked.requests[0]!.id,
      matter_id: matter,
    }),
  ).toMatchObject({ ok: false });
  expect(count(db, 'task_items')).toBe(2);
  expect(matterRow(db, matter)).toEqual(archived);
  expect(
    ok(
      intake.execute({ protocol_version: 1, operation: 'list', now: '2026-11-16T00:00:00.000Z' }),
    ).requests.find((row) => row.id === blocked.requests[0]!.id)?.status,
  ).toBe('pending');
  db.close();
  store.close();
});
