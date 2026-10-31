import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

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
