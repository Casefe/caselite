import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';

import { toolchainProbe } from './schema';

export { toolchainProbe };

export function openToolchainProbe(filePath: string, migrationsFolder: string) {
  const sqlite = new Database(filePath);
  try {
    const db = drizzle(sqlite, { schema: { toolchainProbe } });
    migrate(db, { migrationsFolder });
    return { sqlite, db };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

// A fixed synthetic adapter for DEV-1566. No product table or arbitrary SQL is exposed.
export function openOfflineProbePort(filePath: string, migrationsFolder: string) {
  const connection = openToolchainProbe(filePath, migrationsFolder);
  return {
    write() {
      connection.db
        .insert(toolchainProbe)
        .values({ id: 'dev-1566-synthetic', value: 'offline-integration-verified' })
        .onConflictDoUpdate({
          target: toolchainProbe.id,
          set: { value: 'offline-integration-verified' },
        })
        .run();
    },
    read(): string | null {
      return (
        connection.db
          .select({ value: toolchainProbe.value })
          .from(toolchainProbe)
          .where(eq(toolchainProbe.id, 'dev-1566-synthetic'))
          .get()?.value ?? null
      );
    },
    migrationCount(): number {
      const result = connection.sqlite
        .prepare('SELECT count(*) AS n FROM __drizzle_migrations')
        .get() as { n: number };
      return result.n;
    },
    close() {
      connection.sqlite.close();
    },
  };
}
