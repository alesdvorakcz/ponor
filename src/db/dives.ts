import { and, eq, isNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { compareDiveOrder } from '../domain/diveNumber';
import { newId } from '../domain/ids';
import type { Dive } from '../domain/types';
import { dives } from './schema';

/** Anything a caller may set. Only the date is required — DESIGN.md §6. */
export type NewDiveInput = Partial<Omit<Dive, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>> &
  Pick<Dive, 'date'>;

/**
 * Any Drizzle SQLite database. Left generic rather than tied to one driver so the
 * app can pass expo-sqlite while tests pass better-sqlite3 — see testDb.ts. The
 * schema generics are unconstrained because the two drivers instantiate them
 * differently; the table references below are still fully typed.
 */
type Db = BaseSQLiteDatabase<'sync' | 'async', unknown, Record<string, unknown>>;

/**
 * Type-level proof that the `dives` row and the `Dive` domain type describe the
 * same shape, so toDive's cast below has a contract to lean on rather than being
 * a bare escape hatch. If this stops compiling, the schema and domain/types.ts
 * have drifted apart — fix the drift, don't loosen this assertion.
 */
type Assert<T extends true> = T;
export type Mutual = Assert<
  (typeof dives.$inferSelect extends Dive ? true : false) extends true
    ? (Dive extends typeof dives.$inferSelect ? true : false)
    : false
>;

/**
 * The condition every read must apply. deleted_at is a soft delete (DESIGN.md §6):
 * rows are never removed so a deletion can propagate when sync arrives in M2, and
 * nothing at the schema level stops a query from forgetting to filter it out.
 * Exported and shared rather than repeated so there is exactly one place this
 * filter is written — a tombstoned dive reaching assignDiveNumbers would shift
 * the number of every dive after it.
 */
export const liveDives = isNull(dives.deletedAt);

const now = () => new Date().toISOString();

function toDive(row: typeof dives.$inferSelect): Dive {
  return { ...row, tanks: row.tanks ?? [] } as Dive;
}

export async function createDive(db: Db, input: NewDiveInput): Promise<Dive> {
  const timestamp = now();
  const id = newId();
  const row = {
    ...input,
    id,
    status: input.status ?? 'logged',
    tanks: input.tanks ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await db.insert(dives).values(row);
  // Read back rather than returning `row` as-is: fields NewDiveInput left unset
  // are absent keys on this in-memory object (undefined), but a real column read
  // back from SQLite is null — the shape the rest of the app is typed against.
  const created = await getDive(db, id);
  if (created === null) throw new Error(`createDive: dive vanished immediately after insert: ${id}`);
  return created;
}

export async function getDive(db: Db, id: string): Promise<Dive | null> {
  const rows = await db
    .select()
    .from(dives)
    .where(and(eq(dives.id, id), liveDives))
    .limit(1);
  return rows.length > 0 ? toDive(rows[0]) : null;
}

/**
 * Every live dive, newest date first — the exact reverse of the order
 * assignDiveNumbers numbers them in. Planned dives are included; the list
 * pins them itself.
 *
 * Sorted in JS with compareDiveOrder (reversed), not a SQL ORDER BY: this
 * function and assignDiveNumbers both need "every live dive, in DESIGN.md
 * §2.5's order," and a second, hand-written tier list here previously drifted
 * from the real one — missing the manualOrder tier entirely, and getting
 * SQL's NULL placement backwards for timeIn, so an untimed dive sorted to
 * the wrong end of its date. No LIMIT is used here — the numbering pass
 * already reads every logged dive by definition, and DESIGN.md targets a
 * few thousand dives — so a SQL-side ordering would only be a second tier
 * list to keep in sync with the first, for no observable benefit.
 */
export async function listDives(db: Db): Promise<Dive[]> {
  const rows = await db.select().from(dives).where(liveDives);
  return rows.map(toDive).sort((a, b) => compareDiveOrder(b, a));
}

/**
 * NewDiveInput's Omit keeps id, createdAt and deletedAt out of patch at the type
 * level, but that guarantee is compile-time only. A caller that has bypassed it
 * — a cast, an untyped form payload — could still hand one through, and a bare
 * `{ ...patch }` would spread it straight into the SET clause: id would rename
 * the primary key out from under the very WHERE clause meant to target it,
 * createdAt would forge the audit trail, and deletedAt would tombstone the row
 * as a side effect of what looks like an ordinary field edit. Strip them so the
 * guarantee holds even when the type system has been overridden.
 */
function withoutImmutableFields(
  patch: Partial<NewDiveInput> & { id?: unknown; createdAt?: unknown; deletedAt?: unknown },
): Partial<NewDiveInput> {
  const { id: _id, createdAt: _createdAt, deletedAt: _deletedAt, ...safe } = patch;
  return safe;
}

export async function updateDive(
  db: Db,
  id: string,
  patch: Partial<NewDiveInput>,
): Promise<Dive> {
  const existing = await getDive(db, id);
  if (existing === null) throw new Error(`updateDive: dive not found: ${id}`);
  await db
    .update(dives)
    .set({ ...withoutImmutableFields(patch), updatedAt: now() })
    .where(eq(dives.id, id));
  const updated = await getDive(db, id);
  if (updated === null) throw new Error(`updateDive: dive vanished during update: ${id}`);
  return updated;
}

/**
 * Tombstones the dive. Rows are never hard-deleted (DESIGN.md §6) so the deletion
 * can propagate to other devices when sync arrives in M2.
 *
 * Scoped to liveDives and rejects when nothing matched, rather than no-op-ing on
 * an id that was never real — the same "nothing may silently do nothing" rule
 * updateDive follows. Deleting an id that is already tombstoned takes the same
 * path: from the live view it is already gone, so it is reported the same as an
 * id that never existed, rather than being treated as a successful no-op.
 */
export async function softDeleteDive(db: Db, id: string): Promise<void> {
  const timestamp = now();
  const result = await db
    .update(dives)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(and(eq(dives.id, id), liveDives))
    .returning({ id: dives.id });
  if (result.length === 0) throw new Error(`softDeleteDive: dive not found: ${id}`);
}
