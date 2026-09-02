import { and, eq, or, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db } from './types';

/**
 * The dirty flag's mechanics, shared by every table that carries one — `db/dives.ts`,
 * `db/gearPresets.ts` and `db/catalogue.ts` are the owners that *use* it, exactly as they
 * use `db/tombstone.ts`'s `liveRows`.
 *
 * DESIGN.md §7.1 is three clauses: "rows flagged dirty go up … the server stamps updated_at
 * and returns canonical rows … the client clears its flags". The first clause is
 * `stampLocalWrite` below, the third is `clearDirtyFlags`, and the second belongs to the
 * server. Nothing here talks to one.
 *
 * **Every failure this file exists to prevent is silent.** A write that forgets the flag is a
 * row that never reaches the server and raises nothing, on one device, possibly for months. A
 * flag cleared for a row that changed while the push was in flight is the diver's edit gone
 * the same way. Neither shows up in a log, a screen or a gate — which is why both are held
 * structurally here rather than by remembering.
 */

/**
 * Any table §7 pushes: it has an id, a clock, and a flag. Structural rather than a union of
 * the four tables, for the reason `liveRows` takes a column rather than a table — `settings`
 * and `sync_state` have no flag, so passing one of them is a compile error rather than a
 * runtime surprise, and a fifth synced table needs no edit here.
 */
export type PushableTable = SQLiteTable & {
  readonly id: SQLiteColumn;
  readonly updatedAt: SQLiteColumn;
  readonly dirty: SQLiteColumn;
};

/**
 * **The stamp every local write carries: the clock and the flag, produced together.**
 *
 * The two are one fact — "this device changed this row and the server has not seen it yet" —
 * and §7's whole-row last-write-wins reads one half while §7's push reads the other. Written
 * separately they can come apart in the one direction nothing notices: `updated_at` advanced
 * without the flag is a row that wins a conflict it will never be in, because it never goes
 * up. So a writer takes both from here or neither.
 *
 * Callers that need a second timestamp equal to this one — `createDive`'s `created_at`, a
 * soft delete's `deleted_at` — take it from the returned `updatedAt` rather than calling
 * `new Date()` again, so the row's stamps cannot disagree by a millisecond.
 *
 * **A write that changes nothing must not call this.** §6 states that rule for `updated_at`
 * ("a device that did nothing must not win against one that did") and the flag inherits it
 * whole: a no-op write that flagged the row would push an unchanged row and let the server
 * restamp it, which is the same conflict lost by a slower route. `updateGearPreset` compares
 * before it writes and `updateDive` returns early on an empty patch; both are tested.
 */
export function stampLocalWrite(): { readonly updatedAt: string; readonly dirty: true } {
  return { updatedAt: new Date().toISOString(), dirty: true };
}

/**
 * The condition selecting the rows that still have to go up.
 *
 * **Deliberately not tombstone-filtered**, which is the one thing about it worth stating out
 * loud: §7 propagates a deletion as a row, so a soft-deleted dive is a dive that must be
 * pushed. Reusing `liveRows` here — the filter every *read* applies, and the obvious thing to
 * reach for — would mean deletions never left the device, and the diver's other phone would
 * keep showing a dive they deleted, with nothing raised anywhere. `db/dives.ts`'s own
 * `liveDives` docblock says every read of dives must go through `listDives`/`getDive`; this
 * is not a read of dives for the diver, it is the push set.
 */
export function pendingRows(table: PushableTable): SQL {
  return eq(table.dirty, true);
}

/** A row as it was when it went up: the id that was pushed, and the clock it was pushed at. */
export interface PushedRow {
  readonly id: string;
  readonly updatedAt: string;
}

/**
 * Clears the flag on rows that went up — **and only where the row has not changed since**.
 *
 * §7.1's last clause is "the client clears its flags", and the naive reading of it (clear
 * every flag that was set when the push started) loses data on a device that is still being
 * used: a push takes a second or two, a diver edits a dive while it is in flight, and the
 * clear sweeps away the flag for an edit the server has never seen. The dive stays on the
 * phone, correct on screen, and never syncs again — no error, nothing to notice.
 *
 * So the caller says which rows it pushed *and what their clock read at the time*, and a row
 * whose `updated_at` has moved since keeps its flag. The comparison is a plain string
 * equality on the value this device wrote, not a parse and not an ordering: `stampLocalWrite`
 * is the only producer of these strings, and any change to a row produces a new one.
 *
 * **An empty list clears nothing.** Drizzle's `and`/`or` return `undefined` for no arguments
 * and `.where(undefined)` is an UPDATE with no WHERE clause — every row in the table,
 * silently. The early return is that hazard, closed; it is tested.
 *
 * Returns the ids actually cleared, so a caller can tell what changed under it rather than
 * assuming its own list.
 */
export async function clearDirtyFlags(
  db: Db,
  table: PushableTable,
  pushed: readonly PushedRow[],
): Promise<string[]> {
  if (pushed.length === 0) return [];

  const matches = pushed.map((row) => and(eq(table.id, row.id), eq(table.updatedAt, row.updatedAt)));
  const cleared = await db
    .update(table)
    .set({ dirty: false } as Record<string, unknown>)
    .where(or(...matches))
    .returning({ id: table.id });

  return cleared.flatMap((row) => (typeof row.id === 'string' ? [row.id] : []));
}
