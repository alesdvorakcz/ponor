import { and, eq, isNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { compareDiveOrder } from '../domain/diveNumber';
import { newId } from '../domain/ids';
import type { Dive } from '../domain/types';
import { dives } from './schema';

/**
 * Fields nothing may set after the row is created: id is the primary key,
 * createdAt is the audit trail, updatedAt is stamped by createDive and
 * updateDive themselves, and deletedAt only ever moves through
 * softDeleteDive. The single source for NewDiveInput's Omit below and the
 * runtime strip in withoutImmutableFields, so the two cannot drift apart —
 * updatedAt used to be excluded from NewDiveInput's type but not stripped at
 * runtime, protected only by its position after a spread in an object
 * literal in createDive and updateDive. Reorder either literal for
 * readability and forging it silently reopens, with nothing to catch it.
 * M2 adds user_id to every synced table; with this in place that is one
 * edit here, not three.
 */
const IMMUTABLE_FIELDS = ['id', 'createdAt', 'updatedAt', 'deletedAt'] as const;
type ImmutableField = (typeof IMMUTABLE_FIELDS)[number];

/** Anything a caller may set. Only the date is required — DESIGN.md §6. */
export type NewDiveInput = Partial<Omit<Dive, ImmutableField>> & Pick<Dive, 'date'>;

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
    ...withoutImmutableFields(input),
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
 * NewDiveInput's Omit keeps IMMUTABLE_FIELDS out of patch at the type level,
 * but that guarantee is compile-time only. A caller that has bypassed it —
 * a cast, an untyped form payload — could still hand one through, and a bare
 * `{ ...patch }` would spread it straight into the SET clause: id would rename
 * the primary key out from under the very WHERE clause meant to target it,
 * createdAt would forge the audit trail, updatedAt would forge the sync clock,
 * and deletedAt would tombstone the row as a side effect of what looks like an
 * ordinary field edit. Strip all of IMMUTABLE_FIELDS so the guarantee holds
 * even when the type system has been overridden — and even if a caller later
 * reorders the object literal that sets the real values, since this no longer
 * depends on that order the way updatedAt alone used to.
 */
function withoutImmutableFields<T extends object>(patch: T): Omit<T, ImmutableField> {
  const safe = { ...patch } as Record<string, unknown>;
  for (const field of IMMUTABLE_FIELDS) delete safe[field];
  return safe as Omit<T, ImmutableField>;
}

/**
 * Scoped to liveDives, and the write itself — not a separate pre-check ahead
 * of an unscoped write — rejects when nothing matched, the same "nothing may
 * silently do nothing" rule softDeleteDive follows. A pre-check-then-write
 * split leaves a window between the two where a concurrent softDeleteDive can
 * land: the pre-check already passed, so the old unscoped write went ahead
 * regardless of the row's liveness by the time it ran, landing an edit on an
 * already-tombstoned row while telling the caller the update had failed.
 *
 * Reads the result back from the UPDATE's own RETURNING clause rather than a
 * separate trailing getDive. A second, later SELECT would reopen a race of
 * its own: a delete landing between a successful scoped write and that
 * SELECT would make a genuinely-applied edit report as rejected, even though
 * this function's own write was valid at the moment it ran. RETURNING is
 * part of the same atomic statement as the write, so there is no gap left
 * for anything else to land in between the write and reading its result.
 */
export async function updateDive(
  db: Db,
  id: string,
  patch: Partial<NewDiveInput>,
): Promise<Dive> {
  const rows = await db
    .update(dives)
    .set({ ...withoutImmutableFields(patch), updatedAt: now() })
    .where(and(eq(dives.id, id), liveDives))
    .returning();
  if (rows.length === 0) throw new Error(`updateDive: dive not found: ${id}`);
  return toDive(rows[0]);
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
