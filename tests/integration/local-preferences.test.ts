import { afterEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
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
it('persists ordered writing skills, preserves them across legacy writes, and distinguishes empty from omitted', () => {
  const s = setup();
  const first = set();
  first.values.writing_skills = [
    {
      id: 'custom-skill',
      name: '客户沟通',
      instruction: '将选区改为客户能读懂的说明。',
      enabled: false,
    },
    { id: 'second', name: '摘要', instruction: '保留限定条件，生成摘要。', enabled: true },
  ];
  const ack = s.app.execute(first);
  expect(ack).toMatchObject({
    ok: true,
    preferences: { writing_skills: first.values.writing_skills },
  });
  expect(s.app.execute(set('旧窗口', 1))).toMatchObject({
    ok: true,
    preferences: { version: 2, writing_skills: first.values.writing_skills },
  });
  expect(s.app.execute(first)).toEqual(ack);
  const reopened = openToolchainProbe(s.file, migrations);
  closes.push(() => reopened.sqlite.close());
  expect(
    createLocalPreferencesStore(reopened.sqlite, 'synthetic-workspace').execute(read),
  ).toMatchObject({
    ok: true,
    preferences: { version: 2, writing_skills: first.values.writing_skills },
  });
  const empty = set('清空技能', 2);
  empty.values.writing_skills = [];
  expect(s.app.execute(empty)).toMatchObject({ ok: true, preferences: { writing_skills: [] } });
  expect(s.app.execute(set('旧窗口再次保存', 3))).toMatchObject({
    ok: true,
    preferences: { writing_skills: [] },
  });
});
it('rejects malformed skills before persisting and keeps skill values atomic with receipts', () => {
  const s = setup();
  const skill = { id: 'custom', name: '技能', instruction: '整理选区。', enabled: true };
  for (const writing_skills of [
    [{ ...skill, name: '  ' }],
    [{ ...skill, instruction: '  ' }],
    [{ ...skill, instruction: 'a'.repeat(3001) }],
    [{ ...skill, name: 'a'.repeat(41) }],
    [skill, skill],
    Array.from({ length: 21 }, (_, i) => ({ ...skill, id: 'skill-' + i })),
    [{ ...skill, script: 'doSomething' }],
    [{ ...skill, enabled: 'yes' }],
  ])
    expect(s.app.execute({ ...set(), values: { ...set().values, writing_skills } })).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  expect(s.app.execute(read)).toMatchObject({ ok: true, preferences: { version: 0 } });
  const request = set();
  request.values.writing_skills = [skill];
  s.sqlite.exec(
    "CREATE TRIGGER fail_skill_receipt BEFORE INSERT ON local_preference_receipts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
  );
  expect(s.app.execute(request)).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  expect(s.app.execute(read)).toMatchObject({ ok: true, preferences: { version: 0 } });
  s.sqlite.exec('DROP TRIGGER fail_skill_receipt');
  expect(s.app.execute(request)).toMatchObject({
    ok: true,
    preferences: { version: 1, writing_skills: [skill] },
  });
});
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
it('keeps legacy receipt digests unchanged and persists the editor scheme through reopen and legacy writes', () => {
  const s = setup();
  const legacy = set();
  const { request_id, ...content } = legacy;
  void request_id;
  const ack = {
    ok: true,
    preferences: { ...legacy.values, version: 1 },
    receipt: legacy.idempotency_key,
  };
  // 使用旧版本实际序列化形状建立回执，防止可选字段默认值改写摘要。
  s.sqlite
    .prepare('INSERT INTO local_preferences(workspace_id,value,version) VALUES(?,?,?)')
    .run('synthetic-workspace', JSON.stringify(legacy.values), 1);
  s.sqlite
    .prepare(
      'INSERT INTO local_preference_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)',
    )
    .run(
      'synthetic-workspace',
      legacy.idempotency_key,
      createHash('sha256').update(JSON.stringify(content)).digest('hex'),
      JSON.stringify(ack),
    );
  expect(s.app.execute({ ...legacy, request_id: randomUUID() })).toEqual(ack);
  expect(s.app.execute(read)).toEqual({ ...ack, receipt: null });
  const word = set('Word方案', 1);
  word.values.editor_mode = 'word';
  expect(s.app.execute(word)).toMatchObject({
    ok: true,
    preferences: { editor_mode: 'word', version: 2 },
  });
  expect(s.app.execute(set('旧字段更新', 2))).toMatchObject({
    ok: true,
    preferences: { editor_mode: 'word', version: 3 },
  });
  const reopened = openToolchainProbe(s.file, migrations);
  closes.push(() => reopened.sqlite.close());
  const store = createLocalPreferencesStore(reopened.sqlite, 'synthetic-workspace');
  expect(store.execute(read)).toMatchObject({
    ok: true,
    preferences: { editor_mode: 'word', version: 3 },
  });
  expect(store.execute(legacy)).toEqual(ack);
  const markdown = set('Markdown方案', 3);
  markdown.values.editor_mode = 'markdown';
  expect(store.execute(markdown)).toMatchObject({
    ok: true,
    preferences: { editor_mode: 'markdown', version: 4 },
  });
  expect(
    s.app.execute({ ...set('非法方案', 4), values: { ...legacy.values, editor_mode: 'html' } }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
});
it('upgrades the actual previous 19 migrations without changing existing rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-preferences-upgrade-'));
  roots.push(root);
  const previous = join(root, 'old-migrations');
  cpSync(migrations, previous, { recursive: true });
  rmSync(join(previous, 'meta/dual-history-1826.json'));
  const journalPath = join(previous, 'meta/_journal.json');
  const journal = JSON.parse(
    readFileSync(resolve('tests/fixtures/migration-histories/A.json'), 'utf8'),
  );
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
    n: 25,
  });
  expect(next.sqlite.prepare('SELECT * FROM toolchain_probe').all()).toEqual(before);
  expect(next.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
});
