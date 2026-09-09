import { and, eq } from 'drizzle-orm';

import {
  applyPulledRows,
  clearDirtyFlags,
  countPendingRows,
  flagAllRows,
  pendingRows,
  stampLocalWrite,
  tombstoneAllRows,
  type LocalWriteStamp,
  type PushedRow,
} from './dirty';
import { diveSamples, type DiveSample } from './schema';
import { liveRows } from './tombstone';
import type { Db } from './types';
import { EVERY_ROW } from './wipe';

/** A `dive_samples` row exactly as Drizzle returns it — the shape the five sync functions
 * below move around, none of which reach into it. */
type DiveSampleRow = typeof diveSamples.$inferSelect;

/** Live rows only — a tombstoned series is gone as far as anything that draws is concerned,
 * even though the row itself survives so §7 can carry the deletion to other devices. The same
 * `liveRows` (db/tombstone.ts) every other repository's own live-filter is built from, rather
 * than a fifth hand-written `isNull` — that helper's own docblock is the reason not to. */
const liveSeries = liveRows(diveSamples);

/**
 * Writes a dive's profile, replacing whatever was there.
 *
 * An upsert on the dive's own id rather than an insert: re-importing the same file must not
 * produce a second series, and the import flow's dedupe (db/importDives.ts) is about *dives*,
 * not about this row. Un-tombstones on write, so a re-import after a delete restores the curve.
 */
export async function putDiveSamples(db: Db, diveId: string, series: readonly DiveSample[]): Promise<void> {
  const stamp = stampLocalWrite();
  await db
    .insert(diveSamples)
    .values({ id: diveId, series: [...series], createdAt: stamp.updatedAt, ...stamp })
    .onConflictDoUpdate({
      target: diveSamples.id,
      set: { series: [...series], deletedAt: null, ...stamp },
    });
}

/** A dive's profile, or `null` where there is none — which is most dives, and is not an error
 * (§0.4: no curve is drawn for a dive without a real sample series). */
export async function getDiveSamples(db: Db, diveId: string): Promise<DiveSample[] | null> {
  const [row] = await db
    .select()
    .from(diveSamples)
    .where(and(eq(diveSamples.id, diveId), liveSeries));
  if (!row) return null;
  return row.series.length > 0 ? row.series : null;
}

/** Marks a dive's series deleted without removing the row, so §7 carries the deletion. */
export async function tombstoneDiveSamples(db: Db, diveId: string): Promise<void> {
  const stamp = stampLocalWrite();
  await db
    .update(diveSamples)
    .set({ deletedAt: stamp.updatedAt, ...stamp })
    .where(and(eq(diveSamples.id, diveId), liveSeries));
}

/**
 * **The sixth synced table (§7), and the five functions below are thin wrappers over
 * `db/dirty.ts` alone** — copied from `db/certifications.ts`'s own five, which is the shape
 * every synced table's sync surface takes and must not grow logic of its own. `cloud/sync.ts`'s
 * `SYNCED_TABLES` is the caller; see that file for how a series joins the push/pull loop with
 * no protocol change, because a series is one row keyed by its dive's own id, carried exactly
 * as a dive is by §7's whole-row last-write-wins.
 */

/** The series this device still owes the server — `pendingRows` (db/dirty.ts). */
export async function pendingDiveSamples(db: Db): Promise<DiveSampleRow[]> {
  return db.select().from(diveSamples).where(pendingRows(diveSamples));
}

/** Clears the flag on series that have gone up, and only where the row has not been re-written
 * since — see `clearDirtyFlags` (db/dirty.ts). */
export async function clearDiveSampleDirtyFlags(
  db: Db,
  pushed: readonly PushedRow[],
): Promise<string[]> {
  return clearDirtyFlags(db, diveSamples, pushed);
}

/** How many series this device still owes the server — `countPendingRows` (db/dirty.ts). */
export async function countPendingDiveSamples(db: Db): Promise<number> {
  return countPendingRows(db, diveSamples);
}

/** A series as `pull_changes` hands it over — no `dirty`, which never leaves a device. */
export type PulledDiveSample = Omit<DiveSampleRow, 'dirty'>;

/** Writes series the server sent, clean, and only where they may safely replace what is here —
 * `applyPulledRows` (db/dirty.ts) is the rule. */
export async function applyPulledDiveSamples(
  db: Db,
  rows: readonly PulledDiveSample[],
): Promise<string[]> {
  return applyPulledRows(db, diveSamples, rows);
}

/**
 * §7.4's *start over*, for series — `tombstoneAllRows` (db/dirty.ts) is the rule.
 *
 * A profile is one dive's, so it goes exactly where that dive goes: §7.4's own account of the
 * local logbook makes dives one of the tables that "came from an account" and must not survive
 * a start over standing beside a dive that no longer does.
 */
export async function tombstoneAllDiveSamples(db: Db, stamp: LocalWriteStamp): Promise<string[]> {
  return tombstoneAllRows(db, diveSamples, stamp);
}

/** §7.4's adoption, for series — `flagAllRows` (db/dirty.ts) is the rule, and `adoptCertifications`
 * (db/certifications.ts) carries the reasoning: nothing changes but the dirty flags. */
export async function adoptDiveSamples(db: Db): Promise<void> {
  await flagAllRows(db, diveSamples);
}

/**
 * §7.4's sign-out erase, for series.
 *
 * A profile came from the same account its dive did and goes with it — `wipeDives`
 * (db/dives.ts) carries why that is a hard delete rather than a tombstone, and a device left
 * holding another diver's depth profiles after they sign out is the same failure `wipeDives`
 * exists to prevent, one table over.
 */
export async function wipeDiveSamples(db: Db): Promise<void> {
  await db.delete(diveSamples).where(EVERY_ROW);
}
