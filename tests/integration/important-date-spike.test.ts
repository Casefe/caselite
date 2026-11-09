import Database from 'better-sqlite3';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';

it('spikes additive timezone/immutable confirmations in WAL, rolls back a failed confirmation and reopens old values', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-date-spike-'));
  const file = join(root, 'spike.sqlite');
  let db = new Database(file);
  try {
    db.pragma('journal_mode=WAL');
    db.pragma('foreign_keys=ON');
    db.exec(
      "CREATE TABLE task_items(id TEXT PRIMARY KEY, attention_source TEXT, attention_time TEXT, version INTEGER); CREATE TABLE agent_runs(id TEXT PRIMARY KEY); INSERT INTO task_items VALUES('task','custom','16:00',1); INSERT INTO agent_runs VALUES('run');",
    );
    const sql = readFileSync(
      resolve('packages/local-db/migrations/0021_important_date_confirmation.sql'),
      'utf8',
    );
    db.transaction(() => db.exec(sql))();
    expect(db.prepare('SELECT attention_timezone,version FROM task_items').get()).toEqual({
      attention_timezone: null,
      version: 1,
    });
    expect(() =>
      db.transaction(() => {
        db.prepare("UPDATE task_items SET attention_timezone='Asia/Shanghai',version=2").run();
        db.prepare(
          "INSERT INTO task_date_confirmations VALUES('local','key','task','run',2,'{}')",
        ).run();
        throw Error('injected receipt failure');
      })(),
    ).toThrow('injected');
    expect(db.prepare('SELECT count(*) AS n FROM task_date_confirmations').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT version FROM task_items').get()).toEqual({ version: 1 });
    db.prepare(
      "INSERT INTO task_date_confirmations VALUES('local','key','task','run',1,'{}')",
    ).run();
    expect(() => db.exec('DELETE FROM task_date_confirmations')).toThrow('Immutable');
    db.close();
    db = new Database(file);
    expect(db.prepare('SELECT version,attention_timezone FROM task_items').get()).toEqual({
      version: 1,
      attention_timezone: null,
    });
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
