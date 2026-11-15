import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openToolchainProbe } from '../../packages/local-db/src/index';

it('spikes same-connection view/Catalog receipt atomicity, two-connection CAS, lost acknowledgement and reopen on a synthetic file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'viz-spike-'));
  const file = join(dir, 'synthetic.sqlite');
  const migrations = resolve('packages/local-db/migrations');
  const a = openToolchainProbe(file, migrations).sqlite;
  const b = openToolchainProbe(file, migrations).sqlite;
  try {
    a.prepare('INSERT INTO toolchain_probe VALUES(?,?)').run('synthetic-view', '0');
    const save = (db: typeof a, expected: number, key: string) =>
      db
        .transaction(() => {
          const prior = db
            .prepare('SELECT result FROM catalog_receipts WHERE workspace_id=? AND key=?')
            .get('synthetic', key);
          if (prior) return prior;
          const update = db
            .prepare(
              'UPDATE toolchain_probe SET value=CAST(value AS INTEGER)+1 WHERE id=? AND CAST(value AS INTEGER)=?',
            )
            .run('synthetic-view', expected);
          if (!update.changes) return 'conflict';
          db.prepare('INSERT INTO catalog_receipts VALUES(?,?,?,?)').run(
            'synthetic',
            key,
            'synthetic-digest',
            JSON.stringify({ revision: expected + 1 }),
          );
          return { result: JSON.stringify({ revision: expected + 1 }) };
        })
        .immediate();
    a.exec(
      "CREATE TRIGGER synthetic_reject BEFORE INSERT ON catalog_receipts BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END",
    );
    expect(() => save(a, 0, 'one')).toThrow();
    expect(
      a
        .prepare(
          "SELECT CAST(value AS INTEGER) AS revision FROM toolchain_probe WHERE id='synthetic-view'",
        )
        .get(),
    ).toEqual({ revision: 0 });
    a.exec('DROP TRIGGER synthetic_reject');
    expect(save(a, 0, 'one')).toEqual({ result: '{"revision":1}' });
    expect(save(b, 0, 'two')).toBe('conflict');
    // 提交之后模拟调用方丢弃回执；原键核对不能再增加修订。
    save(b, 1, 'two');
    expect(save(a, 0, 'two')).toEqual({ result: '{"revision":2}' });
    a.close();
    b.close();
    const reopened = openToolchainProbe(file, migrations).sqlite;
    expect(
      reopened
        .prepare(
          "SELECT CAST(value AS INTEGER) AS revision FROM toolchain_probe WHERE id='synthetic-view'",
        )
        .get(),
    ).toEqual({ revision: 2 });
    expect(reopened.prepare('SELECT count(*) AS n FROM catalog_receipts').get()).toEqual({ n: 2 });
    reopened.close();
  } finally {
    if (a.open) a.close();
    if (b.open) b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
