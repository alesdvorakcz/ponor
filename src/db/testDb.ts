import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

/**
 * An in-memory database with the real migrations applied.
 *
 * expo-sqlite is a native module and cannot run under Jest, so the repository
 * takes its db as an argument and tests supply this instead. Same schema, same
 * migration files, same SQL dialect — real round-trips, no mocks.
 */
export function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './src/db/migrations' });
  return db;
}

export type TestDb = ReturnType<typeof createTestDb>;
