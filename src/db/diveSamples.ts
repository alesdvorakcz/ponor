import { and, eq } from 'drizzle-orm';

import { sparklinePoints, SPARK_BUCKETS, type ProfilePoint } from '../domain/profile';
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

/** A `dive_samples` row exactly as Drizzle returns it — the shape the seven functions below
 * move around, none of which reach into it. */
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

/**
 * Every live series' row query, unfiltered by dive — `gearPresetRowsQuery`'s shape
 * (db/gearPresets.ts): a query BUILDER, not an executed read, so `useDiveSampleShapes`
 * (db/useDiveSampleShapes.ts, Task 6's row sparkline) can hand it to `useLiveQuery` directly
 * and have it re-run on every database change, the same way `diveSampleRowsQuery` below
 * already lets `useDiveSamples` do for one dive.
 *
 * **Named apart from `diveSampleRowsQuery` below, and that split is deliberate rather than a
 * missed rename.** Every OTHER table in this app with both an all-rows live query and a list
 * read spends the plain `<entity>RowsQuery(db)` name on the all-rows one (`gearPresetRowsQuery`,
 * `diveSiteRowsQuery`, `certificationRowsQuery` — none of them also needs a single-row live
 * query, so none of them had to choose). This table already had `diveSampleRowsQuery(db,
 * diveId)` for the one-dive read before Task 6 existed, and renaming that one — `useDiveSamples`'
 * own subscription, tested at the repository and through the hook alike — to free up the
 * "obvious" name would cost far more than the sibling name this function carries instead.
 */
export function everyDiveSampleRowsQuery(db: Db) {
  return db.select().from(diveSamples).where(liveSeries);
}

/** Every live series this device holds, for §8's JSON export (`db/exportSource.ts`) — the CSV
 * has no shape for a profile (`domain/dataExport.ts`'s own split) and nothing else needs every
 * series at once. A thin wrapper over `everyDiveSampleRowsQuery` above — `listGearPresets`'s
 * own relationship to `gearPresetRowsQuery` — so the export path and `useDiveSampleShapes`'s
 * reactive one are built from the same query and cannot read two different sets of rows. */
export async function listDiveSamples(db: Db): Promise<DiveSampleRow[]> {
  return everyDiveSampleRowsQuery(db);
}

/**
 * One dive's series, tombstone-filtered — `gearPresetRowsQuery`'s shape (db/gearPresets.ts),
 * and the same split for the same reason: `getDiveSamples` below awaits it, and
 * `useDiveSamples` hands it to drizzle's `useLiveQuery`, which needs a synchronous query it
 * can re-run on every database change.
 *
 * It lives **here**, beside the table's other reads, rather than inside that hook: §4.1 gives
 * one owner to one rule, and "which rows of `dive_samples` may be read" is this file's rule —
 * the `liveSeries` filter above is part of it, and a second `isNull` written in a hook is
 * exactly the drift `liveRows` (db/tombstone.ts) exists to prevent.
 *
 * Unlike its sibling this one is parameterised, because a profile is only ever read one dive
 * at a time: `everyDiveSampleRowsQuery` above is the whole-table read, for §8's export and for
 * Task 6's row sparkline alike.
 */
export function diveSampleRowsQuery(db: Db, diveId: string) {
  return db.select().from(diveSamples).where(and(eq(diveSamples.id, diveId), liveSeries));
}

/**
 * Raw rows to a drawable series — `toGearPresets`' counterpart, and the half of the pipeline
 * that carries the rule.
 *
 * **A missing row and a stored-but-empty series are the same answer, `null`.** `[]` would
 * reach a chart as "draw nothing here", which is a different instruction from "there is
 * nothing to draw" — §0.4 forbids the second being rendered as the first, and
 * `diveSamples.test.ts` pins the equivalence at the repository.
 *
 * Takes `unknown[]` rather than the row type for the reason `toGearPresets` records:
 * `useLiveQuery`'s `.data` is typed that loosely, and this function existing is what stops
 * every caller writing its own `.at(0)`. The cast is sound because both callers only ever
 * hand it rows `diveSampleRowsQuery` itself produced — which is also why the id filter is not
 * restated here.
 */
export function toDiveSamples(rows: unknown[]): DiveSample[] | null {
  // `.at(0)` plus an explicit undefined check rather than a destructure: `getGearPreset`
  // (db/gearPresets.ts) records why — TypeScript cannot narrow an element type from a length
  // check, and provable is what `noUncheckedIndexedAccess` is on for.
  const row = (rows as DiveSampleRow[]).at(0);
  if (row === undefined) return null;
  return row.series.length > 0 ? row.series : null;
}

/**
 * Raw rows to a per-dive map of drawable sparkline POINTS, not raw series — `toDiveSamples`'
 * counterpart across every dive rather than one, for Task 6's row sparkline
 * (`useDiveSampleShapes`, db/useDiveSampleShapes.ts).
 *
 * **Downsamples here, at the map builder, rather than handing `ProfileSparkline` the raw
 * series and letting it call `sparklinePoints` itself.** That was the original design, and a
 * review costed what it did to every render: a dive's series runs to ~250 samples, and
 * `ProfileSparkline` was calling `sparklinePoints` on the full series to produce the same
 * `SPARK_BUCKETS` points again — per row, on every render that row took for any reason at all,
 * a scroll or a sibling row's own state changing included. Moved here, the downsampling runs
 * once per query run instead: `useDiveSampleShapes`'s `useMemo` reruns this function only when
 * the live rows themselves change, so a render that changes nothing underneath allocates no
 * new points at all. `ProfileSparkline` now only ever draws the points it is handed, which is
 * also the honest shape of the prop: a component that draws forty points is handed forty
 * points, not a ~250-sample series it must re-derive them from itself.
 *
 * **What this move does not buy: the raw series does not become collectable.** An earlier
 * version of this docblock claimed moving the call here would let a 500-dive logbook's full
 * series — ~3 MB of JSON, ~125,000 four-element samples — be freed the moment this map is
 * built, "instead of" retained; that was false, and a later review found it so. This function's
 * caller, `useDiveSampleShapes`, reads rows through `useLiveQuery` (drizzle-orm/expo-sqlite),
 * which holds whatever it fetches in `useState` regardless of what any caller then does with
 * it, so the raw series stays resident for as long as the screen that called the hook stays
 * mounted — and three of the six call sites that render a row with a `points` prop
 * (`DivesScreen`, `MapScreen`, `SearchScreen`) live under `(tabs)` and never unmount once
 * visited, so for them that is the life of the app, not of one screen visit. What this
 * function returns — on the order of 20,000 `ProfilePoint`s for that same 500-dive logbook —
 * is retained ON TOP of those raw rows, not instead of them, so total retention is marginally
 * higher than the original design, not lower. Landing the actual fix would mean not reading
 * this table through `useLiveQuery` at all, which is a bigger change than this feature
 * warrants: every other live read in this app is built on it.
 *
 * **The same "missing and empty are one answer" rule as `toDiveSamples`, one step further
 * in**: a dive with no series, a stored-but-empty one, or one too short for `sparklinePoints`
 * to draw anything from (a single sample, say) all get no entry, so `.get(id)` reads
 * `undefined` — the spelling `useDives()`'s own `numbers` map already uses for "this dive has
 * no number" (a planned dive), and the one `DiveRow`'s `points` prop is typed against.
 * Emitting an empty-array entry instead would reach that row as "draw nothing HERE" rather
 * than "there is nothing to draw", exactly the distinction `toDiveSamples`'s own docblock
 * draws — and, one step further than that function ever had to worry about, would reserve an
 * empty bottom row on `DiveRow` for a shape that can never actually appear there.
 *
 * Takes `unknown[]` for the reason `toDiveSamples` does: `useLiveQuery`'s `.data` is typed
 * that loosely, and the cast is sound because this function's one caller only ever hands it
 * rows `everyDiveSampleRowsQuery` itself produced.
 */
export function toDiveSampleShapes(rows: unknown[]): Map<string, ProfilePoint[]> {
  // Built from an entries array rather than an imperative loop calling the map's own
  // single-pair mutator, which `dirty.test.ts`'s dirty-flag sweep text-scans for and cannot
  // tell apart from Drizzle's own update builder.
  const entries = (rows as DiveSampleRow[])
    .map((row): [string, ProfilePoint[]] => [row.id, sparklinePoints(row.series, SPARK_BUCKETS)])
    .filter(([, points]) => points.length > 0);
  return new Map(entries);
}

/** A dive's profile, or `null` where there is none — which is most dives, and is not an error
 * (§0.4: no curve is drawn for a dive without a real sample series). A thin wrapper over the
 * two parts above, so that this async read and `useDiveSamples`' reactive one are built from
 * the same query and the same rule and cannot diverge. */
export async function getDiveSamples(db: Db, diveId: string): Promise<DiveSample[] | null> {
  return toDiveSamples(await diveSampleRowsQuery(db, diveId));
}

/**
 * Marks a dive's series deleted without removing the row, so §7 carries the deletion.
 *
 * **A no-op when nothing live matches, unlike its sibling soft-deletes.** `softDeleteCertification`
 * and `softDeleteDive` both throw when their own UPDATE touches no row, because their caller
 * handed them an id nobody asked to delete. This function's caller is different: `softDeleteDive`
 * calls it on **every** dive it deletes, and most dives have no profile at all, so "no live row
 * matched" is the ordinary case here, not a caller's mistake. Throwing would turn deleting an
 * unprofiled dive into a crash on the save path deletion itself is part of, over a series that
 * was correctly never written in the first place.
 */
export async function tombstoneDiveSamples(db: Db, diveId: string): Promise<void> {
  const stamp = stampLocalWrite();
  await db
    .update(diveSamples)
    .set({ deletedAt: stamp.updatedAt, ...stamp })
    .where(and(eq(diveSamples.id, diveId), liveSeries));
}

/**
 * **The sixth synced table (§7), and the seven functions below are its sync surface** —
 * copied from `db/certifications.ts`'s own seven, which is the shape every synced table's
 * sync surface takes and must not grow logic of its own. **Six of the seven are thin wrappers
 * over `db/dirty.ts` alone**; `wipeDiveSamples` at the end is the one exception, wrapping
 * `db/wipe.ts`'s `EVERY_ROW` instead, because a sign-out erase is not part of push/pull.
 * `cloud/sync.ts`'s `SYNCED_TABLES` is the caller; see that file for how a series joins the
 * push/pull loop with no protocol change, because a series is one row keyed by its dive's own
 * id, carried exactly as a dive is by §7's whole-row last-write-wins.
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
