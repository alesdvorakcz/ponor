import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

/**
 * What a test can ask this database to do beyond existing.
 *
 * Optional and empty by default, so the twelve existing callers of `createTestDb()` are
 * untouched.
 */
export interface TestDbOptions {
  /**
   * Called with the SQL of every statement Drizzle executes on this database.
   *
   * **The one thing `better-sqlite3` cannot be asked directly.** `wipe.test.ts` (M2i) has to
   * check the *statement* a wipe emits rather than its effect, because the defect it guards
   * against — a `delete` with no WHERE taking SQLite's truncate path and firing no update hook
   * — is invisible in the rows afterwards: they are gone either way. Building the query a
   * second time in the test and asserting on that would be asserting about the test's own
   * code, so the statement is taken from the run itself.
   *
   * Migration statements come through here too, since `migrate` runs on the same connection.
   */
  readonly onStatement?: (sql: string) => void;
}

/**
 * An in-memory database with the real migrations applied.
 *
 * expo-sqlite is a native module and cannot run under Jest, so the repository
 * takes its db as an argument and tests supply this instead. Same schema, same
 * migration files, same SQL dialect — real round-trips, no mocks.
 */
export function createTestDb(options: TestDbOptions = {}) {
  const { onStatement } = options;
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, {
    schema,
    logger: onStatement === undefined ? undefined : { logQuery: (query) => onStatement(query) },
  });
  migrate(db, { migrationsFolder: './src/db/migrations' });
  return db;
}

export type TestDb = ReturnType<typeof createTestDb>;
