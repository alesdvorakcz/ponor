import { and, eq } from 'drizzle-orm';

import { stampLocalWrite } from './dirty';
import { diveSamples, type DiveSample } from './schema';
import { liveRows } from './tombstone';
import type { Db } from './types';

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
