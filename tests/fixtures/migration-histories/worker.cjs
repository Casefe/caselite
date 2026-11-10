// 合成旧库的独立进程探针；仅父测试传入临时路径，不接生产目录或凭据。
const { readFileSync, existsSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');
const localRequire = createRequire(resolve('packages/local-db/package.json'));
const Database = localRequire('better-sqlite3');
function load(file) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)(
    (id) =>
      id.startsWith('./') ? load(resolve('packages/local-db/src', id + '.ts')) : localRequire(id),
    module,
    module.exports,
  );
  return module.exports;
}
const { bridgeMigrationHistories, migrateDatabase } = load(
  resolve('packages/local-db/src/migration-bridge.ts'),
);
// READY 前固定实际解析的运行依赖；只用内存库加载 ABI，不打开父测试的目标文件。
new Database(':memory:').close();
const runtime = Object.fromEntries(
  [
    ...[
      'drizzle-orm/migrator',
      'drizzle-orm/better-sqlite3/migrator',
      'drizzle-orm/sqlite-core/dialect',
      'drizzle-orm/sqlite-core/session',
      'drizzle-orm/better-sqlite3/session',
    ].map((id) => localRequire.resolve(id)),
    ...Object.keys(require.cache).filter((file) => file.endsWith('.node')),
  ].map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
);
process.send({ phase: 'ready', pid: process.pid, targetOpened: false, runtime });
process.once('message', () => {
  let db;
  try {
    if (process.argv[3] === 'open') {
      // 普通分支走真正生产连接入口；只有下面的故障/旧版基准分支手工持有连接。
      db = load(resolve('packages/local-db/src/connection.ts')).openToolchainProbe(
        process.argv[2],
        resolve('packages/local-db/migrations'),
      ).sqlite;
      process.send({ phase: 'done', ok: true });
      return;
    }
    db = new Database(process.argv[2]);
    if (process.argv[3]?.startsWith('atomic')) {
      const prepare = db.prepare.bind(db);
      db.prepare = (sql) => {
        const statement = prepare(sql);
        if (/SELECT.*__drizzle_migrations.*ORDER BY created_at DESC LIMIT 1/s.test(sql)) {
          const get = statement.get.bind(statement);
          statement.get = (...args) => {
            const result = get(...args);
            process.send({ phase: 'atomic-read', inTransaction: db.inTransaction });
            if (process.argv[3] === 'atomic-pause') {
              const deadline = Date.now() + 10000;
              while (!existsSync(process.argv[4])) {
                if (Date.now() > deadline) throw Error('Synthetic atomic barrier timeout');
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
              }
            }
            return result;
          };
        }
        if (process.argv[3] === 'atomic-crash' && sql.includes('ADD COLUMN attention_timezone')) {
          const run = statement.run.bind(statement);
          statement.run = (...args) => {
            const result = run(...args);
            process.send({ phase: 'uncommitted-later-ddl' });
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
            return result;
          };
        }
        return statement;
      };
      process.send({ phase: 'opening' });
      migrateDatabase(db, resolve('packages/local-db/migrations'));
      process.send({ phase: 'done', ok: true });
      return;
    }
    if (process.argv[3] === 'crash') {
      const exec = db.exec.bind(db);
      db.exec = (sql) => {
        const result = exec(sql);
        if (sql.includes('ADD `subscribed`')) {
          process.send({ phase: 'uncommitted-ddl' });
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        return result;
      };
    }
    // 保留已安装 Drizzle 的两段旧路径作为失败基准，不作为生产 fallback。
    bridgeMigrationHistories(db, resolve('packages/local-db/migrations'));
    if (process.argv[3] === 'pause-drizzle') {
      const prepare = db.prepare.bind(db);
      db.prepare = (sql) => {
        const statement = prepare(sql);
        if (sql.includes('ORDER BY created_at DESC LIMIT 1')) {
          const all = statement.all.bind(statement);
          statement.all = (...args) => {
            const result = all(...args);
            process.send({ phase: 'drizzle-read' });
            const deadline = Date.now() + 10000;
            while (!existsSync(process.argv[4])) {
              if (Date.now() > deadline) throw Error('Synthetic migration barrier timeout');
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
            }
            return result;
          };
        }
        return statement;
      };
    }
    localRequire('drizzle-orm/better-sqlite3/migrator').migrate(
      localRequire('drizzle-orm/better-sqlite3').drizzle(db),
      { migrationsFolder: resolve('packages/local-db/migrations') },
    );
    process.send({ phase: 'done', ok: true });
  } catch (error) {
    let cause = error;
    while (cause.cause) cause = cause.cause;
    process.send({ phase: 'done', ok: false, error: cause.code ?? cause.message });
  } finally {
    db?.close();
    process.disconnect();
  }
});
