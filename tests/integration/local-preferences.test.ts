import { integrationMigrations } from '../../packages/local-db/src/migration-manifest';
import { afterEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openToolchainProbe } from '../../packages/local-db/src';
import { createLocalPreferencesStore } from '../../packages/local-db/src/local-preferences-store';
import { createLocalPreferencesApplication } from '@caselite/application';
import {
  defaultExportStyle,
  defaultLocalPreferences,
  type LocalPreferencesRequest,
} from '@caselite/contracts';

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
it('keeps the saved export style through legacy and calendar writes, replay and SQLite reopen', () => {
  const s = setup();
  const first = set();
  first.values.export_style = {
    ...defaultExportStyle,
    paper: 'Letter',
    font_size: 14,
    header: '合成审阅稿',
    footer: '第 {page} 页',
  };
  const ack = s.app.execute(first);
  expect(ack).toMatchObject({ ok: true, preferences: { export_style: first.values.export_style } });
  const legacy = set('旧字段名称', 1);
  legacy.values.calendar_layout = { dates_width: 280, inspector_width: 360 };
  expect(s.app.execute(legacy)).toMatchObject({
    ok: true,
    preferences: { version: 2, export_style: first.values.export_style },
  });
  const receipt = s.sqlite
    .prepare('SELECT digest FROM local_preference_receipts WHERE key=?')
    .get(legacy.idempotency_key) as { digest: string };
  const { request_id, ...originalContent } = legacy;
  void request_id;
  expect(receipt.digest).toBe(
    createHash('sha256').update(JSON.stringify(originalContent)).digest('hex'),
  );
  expect(s.app.execute(first)).toEqual(ack);
  const reopened = openToolchainProbe(s.file, migrations);
  closes.push(() => reopened.sqlite.close());
  expect(
    createLocalPreferencesStore(reopened.sqlite, 'synthetic-workspace').execute(read),
  ).toMatchObject({
    ok: true,
    preferences: {
      version: 2,
      export_style: first.values.export_style,
      calendar_layout: legacy.values.calendar_layout,
    },
  });
  const changed = set('更新页脚', 2);
  changed.values.export_style = { ...first.values.export_style, footer: '' };
  expect(s.app.execute(changed)).toMatchObject({
    ok: true,
    preferences: { version: 3, export_style: { footer: '' } },
  });
  expect(
    s.app.execute({ ...first, values: { ...first.values, export_style: defaultExportStyle } }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
});

it('preserves calendar widths through legacy profile writes, original receipts, and SQLite reopen', () => {
  const s = setup(),
    request = set();
  request.values.calendar_layout = { dates_width: (230 * 7) / 6, inspector_width: 420 };
  const ack = s.app.execute(request);
  expect(ack).toMatchObject({
    ok: true,
    preferences: { calendar_layout: request.values.calendar_layout },
  });
  expect(s.app.execute(set('第二个名称', 1))).toMatchObject({
    ok: true,
    preferences: {
      name: '第二个名称',
      calendar_layout: request.values.calendar_layout,
      version: 2,
    },
  });
  expect(s.app.execute(request)).toEqual(ack);
  const reopened = openToolchainProbe(s.file, migrations);
  closes.push(() => reopened.sqlite.close());
  expect(
    createLocalPreferencesStore(reopened.sqlite, 'synthetic-workspace').execute(read),
  ).toMatchObject({
    ok: true,
    preferences: { calendar_layout: request.values.calendar_layout, version: 2 },
  });
  for (const layout of [
    { dates_width: 0, inspector_width: 340 },
    { dates_width: 270, inspector_width: 900 },
    { dates_width: 270, inspector_width: 340, path: '/outside' },
  ]) {
    expect(
      s.app.execute({ ...set('越界', 2), values: { ...request.values, calendar_layout: layout } }),
    ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  }
});
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
it('keeps both calendar layout and writing skills across independent legacy-shaped updates', () => {
  const s = setup(),
    first = set();
  first.values.calendar_layout = { dates_width: 300, inspector_width: 380 };
  first.values.writing_skills = [
    { id: 'saved', name: '保存技能', instruction: '合成指令', enabled: true },
  ];
  const ack = s.app.execute(first);
  expect(ack.ok).toBe(true);
  const calendar = set('只改布局', 1);
  calendar.values.calendar_layout = { dates_width: 320, inspector_width: 400 };
  expect(s.app.execute(calendar)).toMatchObject({
    ok: true,
    preferences: {
      writing_skills: first.values.writing_skills,
      calendar_layout: calendar.values.calendar_layout,
    },
  });
  const skills = set('只改技能', 2);
  skills.values.writing_skills = [];
  expect(s.app.execute(skills)).toMatchObject({
    ok: true,
    preferences: {
      writing_skills: [],
      calendar_layout: calendar.values.calendar_layout,
      version: 3,
    },
  });
  expect(s.app.execute(first)).toEqual(ack);
  expect(s.app.execute(read)).toMatchObject({
    ok: true,
    preferences: {
      version: 3,
      writing_skills: [],
      calendar_layout: calendar.values.calendar_layout,
    },
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
    n: integrationMigrations.length,
  });
  expect(next.sqlite.prepare('SELECT * FROM toolchain_probe').all()).toEqual(before);
  expect(next.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
});

it('retains statistics configuration and unchanged legacy receipts through legacy writes, replay and reopen', () => {
  const s = setup();
  const legacy = set();
  const { request_id, ...content } = legacy;
  void request_id;
  const ack = {
    ok: true,
    preferences: { ...legacy.values, version: 1 },
    receipt: legacy.idempotency_key,
  };
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
  const request = set('统计卡片', 1);
  request.values.statistics_cards = {
    tasks: { enabled: false, position: 'bottom' },
    projects: { enabled: true, position: 'middle' },
    finance: { enabled: true, position: 'top' },
    contacts: { enabled: false, position: 'top' },
  };
  const saved = s.app.execute(request);
  expect(saved).toMatchObject({
    ok: true,
    preferences: { version: 2, statistics_cards: request.values.statistics_cards },
  });
  expect(s.app.execute({ ...legacy, request_id: randomUUID() })).toEqual(ack);
  expect(
    s.app.execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: legacy.idempotency_key,
    }),
  ).toEqual(ack);
  expect(s.app.execute(set('旧客户端字段', 2))).toMatchObject({
    ok: true,
    preferences: { version: 3, statistics_cards: request.values.statistics_cards },
  });
  const reopened = openToolchainProbe(s.file, migrations);
  closes.push(() => reopened.sqlite.close());
  const store = createLocalPreferencesStore(reopened.sqlite, 'synthetic-workspace');
  expect(store.execute(read)).toMatchObject({
    ok: true,
    preferences: { version: 3, statistics_cards: request.values.statistics_cards },
  });
  expect(store.execute(request)).toEqual(saved);
  expect(store.execute(legacy)).toEqual(ack);
  const changed = {
    ...request,
    values: {
      ...request.values,
      statistics_cards: {
        ...request.values.statistics_cards,
        tasks: { enabled: true, position: 'top' as const },
      },
    },
  };
  expect(store.execute(changed)).toMatchObject({ ok: false, code: 'CONFLICT' });
});

it('rejects malformed statistics settings and rolls back configuration and version when the receipt fails', () => {
  const s = setup();
  const request = set();
  request.values.statistics_cards = {
    tasks: { enabled: true, position: 'top' },
    projects: { enabled: true, position: 'middle' },
    finance: { enabled: false, position: 'bottom' },
    contacts: { enabled: false, position: 'top' },
  };
  for (const statistics_cards of [
    { tasks: request.values.statistics_cards.tasks },
    { ...request.values.statistics_cards, tasks: { enabled: true, position: 'left' } },
    {
      ...request.values.statistics_cards,
      finance: { enabled: false, position: 'bottom', path: '/synthetic' },
    },
  ])
    expect(
      s.app.execute({ ...request, values: { ...request.values, statistics_cards } }),
    ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  s.sqlite.exec(
    "CREATE TRIGGER fail_statistics_receipt BEFORE INSERT ON local_preference_receipts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
  );
  expect(s.app.execute(request)).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  expect(s.app.execute(read)).toMatchObject({ ok: true, preferences: { version: 0 } });
  expect(s.sqlite.prepare('SELECT count(*) AS n FROM local_preferences').get()).toEqual({ n: 0 });
  expect(
    s.app.execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: request.idempotency_key,
    }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  s.sqlite.exec('DROP TRIGGER fail_statistics_receipt');
  const saved = s.app.execute(request);
  expect(saved).toMatchObject({
    ok: true,
    preferences: { version: 1, statistics_cards: request.values.statistics_cards },
  });
  expect(s.app.execute(request)).toEqual(saved);
});
