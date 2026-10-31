import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { openToolchainProbe, toolchainProbe } from '../../packages/local-db/src/index';

const migrationsFolder = resolve(
  fileURLToPath(new URL('../../packages/local-db/migrations/', import.meta.url)),
);

describe('SQLite/Drizzle infrastructure probe', () => {
  it('migrates once, commits, rolls back, and reads data after reopening in a Unicode path', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'caselite-db-'));
    const folder = join(temporaryRoot, '中文 路径');
    const filePath = join(folder, 'probe.sqlite');
    mkdirSync(folder);

    try {
      const first = openToolchainProbe(filePath, migrationsFolder);
      try {
        first.db.insert(toolchainProbe).values({ id: 'saved', value: 'synthetic' }).run();
        expect(() =>
          first.db.transaction((tx) => {
            tx.insert(toolchainProbe).values({ id: 'rolled-back', value: 'temporary' }).run();
            throw new Error('deliberate rollback');
          }),
        ).toThrow('deliberate rollback');
      } finally {
        first.sqlite.close();
      }

      const second = openToolchainProbe(filePath, migrationsFolder);
      try {
        expect(
          second.sqlite.prepare('SELECT id, value FROM toolchain_probe ORDER BY id').all(),
        ).toEqual([{ id: 'saved', value: 'synthetic' }]);
        expect(
          second.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get(),
        ).toEqual({
          n: 1,
        });
      } finally {
        second.sqlite.close();
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
      expect(existsSync(temporaryRoot)).toBe(false);
    }
  });

  it('keeps existing records when a later migration fails', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'caselite-db-failure-'));
    const filePath = join(temporaryRoot, 'probe.sqlite');
    const badMigrations = join(temporaryRoot, 'bad-migrations');

    try {
      const first = openToolchainProbe(filePath, migrationsFolder);
      first.db.insert(toolchainProbe).values({ id: 'preserved', value: 'synthetic' }).run();
      first.sqlite.close();

      cpSync(migrationsFolder, badMigrations, { recursive: true });
      const journalPath = join(badMigrations, 'meta/_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: Array<{
          idx: number;
          version: string;
          when: number;
          tag: string;
          breakpoints: boolean;
        }>;
      };
      journal.entries.push({
        idx: 1,
        version: '6',
        when: journal.entries[0].when + 1,
        tag: '0001_deliberate_failure',
        breakpoints: true,
      });
      writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
      writeFileSync(join(badMigrations, '0001_deliberate_failure.sql'), 'THIS IS NOT SQL;\n');

      expect(() => openToolchainProbe(filePath, badMigrations)).toThrow();

      const recovered = openToolchainProbe(filePath, migrationsFolder);
      try {
        expect(
          recovered.sqlite
            .prepare('SELECT value FROM toolchain_probe WHERE id = ?')
            .get('preserved'),
        ).toEqual({ value: 'synthetic' });
      } finally {
        recovered.sqlite.close();
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
      expect(existsSync(temporaryRoot)).toBe(false);
    }
  });

  it('does not write through a second connection while the database is locked', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'caselite-db-lock-'));
    const filePath = join(temporaryRoot, 'probe.sqlite');

    try {
      const first = openToolchainProbe(filePath, migrationsFolder);
      const second = openToolchainProbe(filePath, migrationsFolder);
      try {
        second.sqlite.pragma('busy_timeout = 20');
        first.sqlite.exec('BEGIN IMMEDIATE');
        expect(() =>
          second.db.insert(toolchainProbe).values({ id: 'blocked', value: 'temporary' }).run(),
        ).toThrow();
        first.sqlite.exec('ROLLBACK');
        second.db.insert(toolchainProbe).values({ id: 'after-lock', value: 'saved' }).run();
        expect(
          second.sqlite.prepare('SELECT value FROM toolchain_probe WHERE id = ?').get('after-lock'),
        ).toEqual({ value: 'saved' });
      } finally {
        if (first.sqlite.inTransaction) first.sqlite.exec('ROLLBACK');
        second.sqlite.close();
        first.sqlite.close();
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
      expect(existsSync(temporaryRoot)).toBe(false);
    }
  });

  it('fails without creating a database when the target directory is not writable', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'caselite-db-permissions-'));
    const restricted = join(temporaryRoot, 'restricted');
    mkdirSync(restricted);
    chmodSync(restricted, 0o500);

    try {
      expect(() =>
        openToolchainProbe(join(restricted, 'probe.sqlite'), migrationsFolder),
      ).toThrow();
    } finally {
      chmodSync(restricted, 0o700);
      rmSync(temporaryRoot, { recursive: true, force: true });
      expect(existsSync(temporaryRoot)).toBe(false);
    }
  });
});
