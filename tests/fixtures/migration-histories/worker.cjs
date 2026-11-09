// 合成旧库的独立进程探针；仅父测试传入临时路径，不接生产目录或凭据。
const { readFileSync, existsSync } = require('node:fs');
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
const { bridgeMigrationHistories } = load(resolve('packages/local-db/src/migration-bridge.ts'));
process.send({ phase: 'ready' });
process.once('message', () => {
  const db = new Database(process.argv[2]);
  try {
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
    db.close();
    process.disconnect();
  }
});
