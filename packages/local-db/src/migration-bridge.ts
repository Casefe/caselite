import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { integrationMigrations } from './migration-manifest';

type Migration = { tag: string; when: number; hash: string; sql: string };
type History = { hash: string; created_at: number };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const rejected = () =>
  new Error('工作区迁移历史或结构无法识别，未继续升级；请保留原库并联系维护者。');

function schema(db: Database.Database) {
  return db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name<>'__drizzle_migrations' ORDER BY type,name",
    )
    .all();
}

function validate(db: Database.Database, migrations: Migration[]) {
  const exists = db
    .prepare("SELECT name FROM sqlite_schema WHERE name='__drizzle_migrations' AND type='table'")
    .get();
  const rows = exists
    ? (db
        .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY rowid')
        .all() as History[])
    : [];
  const applied = rows.map((row) => {
    const entry = migrations.find((m) => m.hash === row.hash && m.when === row.created_at);
    if (!entry) throw rejected();
    return entry;
  });
  if (new Set(applied).size !== applied.length) throw rejected();
  const common = migrations.slice(0, 17),
    b = migrations.slice(17, 20),
    a = migrations.slice(20);
  const prefix = (chain: Migration[]) => {
    const present = chain.filter((m) => applied.includes(m));
    if (present.some((m, i) => m !== chain[i])) throw rejected();
    return present.length;
  };
  const nc = prefix(common),
    nb = prefix(b),
    na = prefix(a);
  if ((nc < 17 && (na || nb)) || (na && nb && nb !== 3)) throw rejected();
  // 重放仅在内存中生成已知形状，包含约束、索引、外键和不可变触发器；不读取或复制业务数据。
  const expected = new Database(':memory:');
  try {
    for (const entry of applied) expected.exec(entry.sql);
    if (JSON.stringify(schema(db)) !== JSON.stringify(schema(expected))) throw rejected();
  } finally {
    expected.close();
  }
  return { applied, missing: na && !nb ? b : [] };
}

/** 仅完整冻结目录启用；旧版迁移夹具仍只执行其自己的 SQL，不自动扩容。 */
export function bridgeMigrationHistories(db: Database.Database, folder: string) {
  const marker = join(folder, 'meta/dual-history-1826.json');
  const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
  if (!Array.isArray(journal.entries)) throw rejected();
  if (!existsSync(marker)) {
    const tags = new Set(journal.entries.map((entry: { tag?: string } | null) => entry?.tag));
    const hasB = integrationMigrations.slice(17, 20).some((m) => tags.has(m.tag));
    const hasA = integrationMigrations.slice(20, 24).some((m) => tags.has(m.tag));
    // 混合目录缺少冻结身份不能降级成普通迁移，否则 A 库会再次静默跳过较早的 B。
    if (hasA && hasB) throw rejected();
    return;
  }
  const markerValue = JSON.parse(readFileSync(marker, 'utf8'));
  if (
    markerValue.version !== 1 ||
    markerValue.issue !== 'DEV-1826' ||
    markerValue.manifestSha256 !== digest(JSON.stringify(integrationMigrations))
  )
    throw rejected();
  if (!Array.isArray(journal.entries) || journal.entries.length !== integrationMigrations.length)
    throw rejected();
  const migrations = integrationMigrations.map((m, i) => {
    const entry = journal.entries[i];
    if (
      entry.idx !== i ||
      entry.tag !== m.tag ||
      entry.when !== m.when ||
      entry.version !== '6' ||
      entry.breakpoints !== true
    )
      throw rejected();
    const sql = readFileSync(join(folder, m.tag + '.sql'), 'utf8');
    if (digest(sql) !== m.hash) throw rejected();
    return { ...m, sql };
  });
  // 锁内重读历史和实际结构，防止双开在检查与补写之间交错；失败撤回全部 DDL 和原迁移记录。
  db.transaction(() => {
    const { missing } = validate(db, migrations);
    for (const migration of missing) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)').run(
        migration.hash,
        migration.when,
      );
    }
    if (missing.length) validate(db, migrations);
  }).immediate();
}
