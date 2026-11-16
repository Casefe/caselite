import { integrationMigrations } from '../../packages/local-db/src/migration-manifest';
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openToolchainProbe } from '../../packages/local-db/src';
import { createMemoStore } from '../../packages/local-db/src/memo-store';
import { createMemoApplication } from '@caselite/application';

const roots: string[] = [],
  closes: Array<() => void> = [];
afterEach(() => {
  closes.splice(0).forEach((close) => close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
const migrations = resolve('packages/local-db/migrations');
const workspace = 'synthetic-workspace';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-memos-'));
  roots.push(root);
  const file = join(root, 'workspace.sqlite');
  const connection = openToolchainProbe(file, migrations);
  closes.push(() => connection.sqlite.close());
  const store = createMemoStore(connection.sqlite, workspace);
  const app = createMemoApplication(store);
  return { root, file, ...connection, store, app };
}

const listDaily = { protocol_version: 1, operation: 'list', view: 'daily' } as const;
const listDeleted = { protocol_version: 1, operation: 'list', view: 'deleted' } as const;

function createRequest(text: string, id = randomUUID()) {
  const key = randomUUID();
  return {
    protocol_version: 1 as const,
    operation: 'create' as const,
    request_id: key,
    idempotency_key: key,
    memo_id: id,
    text,
    expected_version: 0 as const,
  };
}

it('creates without task or date, survives restart, scratches restores and soft-deletes', () => {
  const s = setup(),
    id = randomUUID(),
    first = createRequest('跨日保留的合成备忘', id);
  const created = s.app.execute(first);
  expect(created).toMatchObject({ ok: true, memos: [{ id, lifecycle: 'active', version: 1 }] });
  expect(s.app.execute(first)).toEqual(created);
  expect(s.app.execute(createRequest('另一身份', randomUUID()))).toMatchObject({ ok: true });
  const conflict = createRequest('冲突正文', id);
  expect(s.app.execute(conflict)).toMatchObject({ ok: false, code: 'CONFLICT' });

  const reopened = openToolchainProbe(s.file, migrations);
  closes.push(() => reopened.sqlite.close());
  const app2 = createMemoApplication(createMemoStore(reopened.sqlite, workspace));
  expect(app2.execute(listDaily)).toMatchObject({
    ok: true,
    memos: expect.arrayContaining([
      expect.objectContaining({ id, text: '跨日保留的合成备忘', lifecycle: 'active' }),
    ]),
  });

  const scratchKey = randomUUID();
  const scratched = app2.execute({
    protocol_version: 1,
    operation: 'scratch',
    request_id: scratchKey,
    idempotency_key: scratchKey,
    memo_id: id,
    expected_version: 1,
  });
  expect(scratched).toMatchObject({
    ok: true,
    memos: expect.arrayContaining([expect.objectContaining({ id, lifecycle: 'scratched' })]),
  });
  const scratchAgain = randomUUID();
  expect(
    app2.execute({
      protocol_version: 1,
      operation: 'scratch',
      request_id: scratchAgain,
      idempotency_key: scratchAgain,
      memo_id: id,
      expected_version: 2,
    }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });

  const restoreKey = randomUUID();
  expect(
    app2.execute({
      protocol_version: 1,
      operation: 'restore_scratch',
      request_id: restoreKey,
      idempotency_key: restoreKey,
      memo_id: id,
      expected_version: 2,
    }),
  ).toMatchObject({
    ok: true,
    memos: expect.arrayContaining([expect.objectContaining({ lifecycle: 'active' })]),
  });

  const stale = randomUUID();
  expect(
    app2.execute({
      protocol_version: 1,
      operation: 'update',
      request_id: stale,
      idempotency_key: stale,
      memo_id: id,
      expected_version: 1,
      text: '迟到版本',
    }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });

  const deleteKey = randomUUID();
  expect(
    app2.execute({
      protocol_version: 1,
      operation: 'soft_delete',
      request_id: deleteKey,
      idempotency_key: deleteKey,
      memo_id: id,
      expected_version: 3,
    }),
  ).toMatchObject({ ok: true });
  expect(app2.execute(listDaily).memos?.some((m) => m.id === id)).toBe(false);
  expect(app2.execute(listDeleted)).toMatchObject({
    ok: true,
    memos: expect.arrayContaining([expect.objectContaining({ id, lifecycle: 'deleted' })]),
  });

  const recoverKey = randomUUID();
  expect(
    app2.execute({
      protocol_version: 1,
      operation: 'restore_delete',
      request_id: recoverKey,
      idempotency_key: recoverKey,
      memo_id: id,
      expected_version: 4,
    }),
  ).toMatchObject({
    ok: true,
    memos: expect.arrayContaining([expect.objectContaining({ lifecycle: 'active' })]),
  });
});

it('isolates memos by workspace', () => {
  const s = setup(),
    id = randomUUID();
  expect(s.app.execute(createRequest('工作区 A', id))).toMatchObject({ ok: true });
  const other = createMemoStore(s.sqlite, 'other-workspace');
  expect(other.execute(listDaily)).toMatchObject({ ok: true, memos: [] });
  expect(
    other.execute({ protocol_version: 1, operation: 'list', view: 'daily' }).memos,
  ).toHaveLength(0);
});

it('records the frozen migration count after memo schema', () => {
  const s = setup();
  expect(s.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
    n: integrationMigrations.length,
  });
});
