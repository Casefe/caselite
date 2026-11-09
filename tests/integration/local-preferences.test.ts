import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openToolchainProbe } from '../../packages/local-db/src';
import { createLocalPreferencesStore } from '../../packages/local-db/src/local-preferences-store';
import { createLocalPreferencesApplication } from '@caselite/application';
import { defaultLocalPreferences, type LocalPreferencesRequest } from '@caselite/contracts';

const roots: string[] = [],
  closes: Array<() => void> = [];
afterEach(() => {
  closes.splice(0).forEach((close) => close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
const migrations = resolve('packages/local-db/migrations');
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-preferences-'));
  roots.push(root);
  const file = join(root, 'workspace.sqlite');
  const connection = openToolchainProbe(file, migrations);
  closes.push(() => connection.sqlite.close());
  const app = createLocalPreferencesApplication(
    createLocalPreferencesStore(connection.sqlite, 'synthetic-workspace'),
  );
  return { root, file, ...connection, app };
}
function set(
  name = '本地测试律师',
  expected_version = 0,
): Extract<LocalPreferencesRequest, { operation: 'set' }> {
  return {
    protocol_version: 1,
    operation: 'set',
    request_id: randomUUID(),
    idempotency_key: randomUUID(),
    expected_version,
    values: { name, email: 'synthetic@example.invalid', avatar: 'initials', show_word_count: true },
  };
}
const read = { protocol_version: 1, operation: 'read' } as const;
it('reads defaults without writing and keeps versioned preferences after reopening', () => {
  const s = setup();
  expect(s.app.execute(read)).toEqual({
    ok: true,
    preferences: defaultLocalPreferences,
    receipt: null,
  });
  expect(s.sqlite.prepare('SELECT count(*) AS n FROM local_preferences').get()).toEqual({ n: 0 });
  const request = set();
  expect(s.app.execute(request)).toMatchObject({
    ok: true,
    preferences: { ...request.values, version: 1 },
    receipt: request.idempotency_key,
  });
  const reopened = openToolchainProbe(s.file, migrations);
  closes.push(() => reopened.sqlite.close());
  expect(
    createLocalPreferencesStore(reopened.sqlite, 'synthetic-workspace').execute(read),
  ).toMatchObject({ ok: true, preferences: { ...request.values, version: 1 } });
  expect(
    createLocalPreferencesStore(reopened.sqlite, 'other-workspace').execute(read),
  ).toMatchObject({ ok: true, preferences: defaultLocalPreferences });
  expect(
    createLocalPreferencesStore(reopened.sqlite, 'other-workspace').execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: request.idempotency_key,
    }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
});
it('replays the original ACK, rejects conflicting keys and stale versions without overwriting later values', () => {
  const s = setup(),
    first = set(),
    ack = s.app.execute(first);
  expect(s.app.execute({ ...first, request_id: randomUUID() })).toEqual(ack);
  expect(s.app.execute({ ...first, values: { ...first.values, name: '变更' } })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  expect(s.app.execute(set('陈旧提交'))).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(s.app.execute(set('第二窗口', 1))).toMatchObject({
    ok: true,
    preferences: { name: '第二窗口', version: 2 },
  });
  expect(
    s.app.execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: first.idempotency_key,
    }),
  ).toEqual(ack);
  expect(s.app.execute(first)).toEqual(ack);
  expect(s.app.execute(read)).toMatchObject({
    ok: true,
    preferences: { name: '第二窗口', version: 2 },
  });
  expect(s.sqlite.prepare('SELECT count(*) AS n FROM local_preference_receipts').get()).toEqual({
    n: 2,
  });
});
it('rolls back value and version when receipt persistence fails, then retries the same request safely', () => {
  const s = setup(),
    first = set();
  s.sqlite.exec(
    "CREATE TRIGGER fail_receipt BEFORE INSERT ON local_preference_receipts BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END",
  );
  expect(s.app.execute(first)).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  expect(s.app.execute(read)).toMatchObject({ ok: true, preferences: { version: 0 } });
  expect(
    s.app.execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: first.idempotency_key,
    }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  s.sqlite.exec('DROP TRIGGER fail_receipt');
  expect(s.app.execute(first)).toMatchObject({ ok: true, preferences: { version: 1 } });
});
it('rejects untrusted extra scope and invalid values before storage', () => {
  const s = setup(),
    request = set();
  for (const invalid of [
    { ...request, workspace_id: 'other' },
    { ...request, path: '/tmp/other' },
    { ...request, values: { ...request.values, email: 'invalid-email' } },
    { ...request, values: { ...request.values, name: 'bad\nname' } },
  ]) {
    expect(s.app.execute(invalid)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  }
  expect(s.sqlite.prepare('SELECT count(*) AS n FROM local_preferences').get()).toEqual({ n: 0 });
});
it('upgrades the actual previous 19 migrations without changing existing rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-preferences-upgrade-'));
  roots.push(root);
  const previous = join(root, 'old-migrations');
  cpSync(migrations, previous, { recursive: true });
  const journalPath = join(previous, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.slice(0, 19);
  writeFileSync(journalPath, JSON.stringify(journal));
  const file = join(root, 'previous.sqlite'),
    old = openToolchainProbe(file, previous);
  expect(old.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
    n: 19,
  });
  old.sqlite
    .prepare('INSERT INTO toolchain_probe(id,value) VALUES(?,?)')
    .run('preserved', 'synthetic-body-and-key-marker');
  const before = old.sqlite.prepare('SELECT * FROM toolchain_probe').all();
  old.sqlite.close();
  const next = openToolchainProbe(file, migrations);
  closes.push(() => next.sqlite.close());
  expect(next.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
    n: 21,
  });
  expect(next.sqlite.prepare('SELECT * FROM toolchain_probe').all()).toEqual(before);
  expect(next.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
});
