import { drizzle } from 'drizzle-orm/expo-sqlite';
import { useMigrations as useDrizzleMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { openDatabaseSync } from 'expo-sqlite';
import migrations from './migrations/migrations';
import * as schema from './schema';

const sqlite = openDatabaseSync('ponor.db', { enableChangeListener: true });

/** The app's database. Tests never touch this — they build their own (see testDb.ts). */
export const db = drizzle(sqlite, { schema });

/** Applies any pending migrations. Returns `{ success, error }`. */
export function useMigrations() {
  return useDrizzleMigrations(db, migrations);
}
