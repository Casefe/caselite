import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openToolchainProbe } from '../../packages/local-db/src';

it('spikes transactional additive calendar columns on an isolated WAL library and backup without changing old rows', async () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-calendar-spike-'));
  const db = openToolchainProbe(
    join(root, 'old.sqlite'),
    resolve('packages/local-db/migrations'),
  ).sqlite;
  try {
    db.pragma('journal_mode=WAL');
    db.prepare(
      'INSERT INTO task_items(id,workspace_id,title,objective,version,updated_at) VALUES(?,?,?,?,?,?)',
    ).run('synthetic-spike', 'local', '合成旧任务', '保留说明', 1, '2026-11-09');
    const before = db.prepare('SELECT * FROM task_items').all();
    await db.backup(join(root, 'backup.sqlite'));
    expect(() =>
      db.transaction(() => {
        db.exec(
          'ALTER TABLE task_items ADD COLUMN calendar_spike_date TEXT CHECK(calendar_spike_date IS NULL OR (length(calendar_spike_date)=10 AND date(calendar_spike_date)=calendar_spike_date)); CREATE TABLE calendar_spike_types(id TEXT PRIMARY KEY,name TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0))',
        );
        db.prepare('UPDATE task_items SET calendar_spike_date=?').run('2026-11-10');
        throw new Error('synthetic migration fault');
      })(),
    ).toThrow('synthetic migration fault');
    expect(db.prepare('SELECT * FROM task_items').all()).toEqual(before);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name='calendar_spike_types'").get(),
    ).toBeUndefined();
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    const backup = openToolchainProbe(
      join(root, 'backup.sqlite'),
      resolve('packages/local-db/migrations'),
    ).sqlite;
    expect(backup.prepare('SELECT * FROM task_items').all()).toEqual(before);
    backup.close();
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
