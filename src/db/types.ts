import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

/**
 * Any Drizzle SQLite database. Left generic rather than tied to one driver so the
 * app can pass expo-sqlite while tests pass better-sqlite3 — see testDb.ts. The
 * schema generics are unconstrained because the two drivers instantiate them
 * differently; the table references in each repository are still fully typed.
 *
 * Shared from here rather than declared per-repository so a second repository
 * cannot accidentally widen or narrow it relative to the first.
 */
export type Db = BaseSQLiteDatabase<'sync' | 'async', unknown, Record<string, unknown>>;
