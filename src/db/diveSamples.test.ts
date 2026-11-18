import { eq } from 'drizzle-orm';

import {
  applyPulledDiveSamples,
  clearDiveSampleDirtyFlags,
  countPendingDiveSamples,
  everyDiveSampleRowsQuery,
  getDiveSamples,
  listDiveSamples,
  pendingDiveSamples,
  putDiveSamples,
  toDiveSampleShapes,
  tombstoneDiveSamples,
  tombstoneSamplesOfDeletedDives,
} from './diveSamples';
import { onLocalWrite } from './dirty';
import { createDive, softDeleteDive } from './dives';
import { dives, type DiveSample } from './schema';
import { createTestDb, type TestDb } from './testDb';

/**
 * **`dive_samples`, at the repository (DESIGN.md §6, and the import spec).**
 *
 * One row per dive, keyed on the dive's own id (see that table's docblock in `schema.ts` for
 * why it is a 1:1 extension rather than a child table). What matters here is not the columns
 * — there are only six (`id`, `series`, `created_at`, `updated_at`, `deleted_at`, `dirty`) —
 * but four things a review cannot see:
 *
 * · **A round trip is exact.** The series is opaque tuples to this layer; nothing here may
 *   reorder, coerce or drop a sample, because §0.4 draws a profile from exactly what a dive
 *   computer recorded.
 * · **Absence and "no series yet" are the same answer, `null`** — not `[]`, which would make a
 *   chart try to draw zero points instead of not drawing at all (§0.4: no curve for a dive
 *   without a real sample series).
 * · **A re-import replaces rather than appends**, because `putDiveSamples` is the one write
 *   path an importer calls on every run, including a second run over the same file.
 * · **A write over a tombstoned series brings it back**, because that same write path
 *   un-tombstones. No caller relies on it: since #9 the import writes onto a dive it already has
 *   only when that dive has no series row at all, so a deleted profile stays deleted.
 * · **A dive's deletion takes its profile with it, even one that arrived by sync**
 *   (`tombstoneSamplesOfDeletedDives`, run after every pull).
 */

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});

it('stores a series and reads back exactly what it was given', async () => {
  const series: DiveSample[] = [
    [0.57, 1.27, 27.7, 188.9],
    [10.31, 2.96, 27.7, 188.0],
  ];
  await putDiveSamples(db, 'dive-1', series);
  expect(await getDiveSamples(db, 'dive-1')).toEqual(series);
});

it('answers null for a dive with no series, which is most dives', async () => {
  expect(await getDiveSamples(db, 'never-imported')).toBeNull();
});

it('replaces a series rather than appending, so re-import cannot double it', async () => {
  await putDiveSamples(db, 'dive-1', [[0, 1, null, null]]);
  await putDiveSamples(db, 'dive-1', [
    [0, 2, null, null],
    [10, 3, null, null],
  ]);

  const back = await getDiveSamples(db, 'dive-1');
  expect(back).toHaveLength(2);
  expect(back?.[0]?.[1]).toBe(2);
});

// A tombstoned series reads as absent — the row survives for sync, but nothing may draw it.
it('reads a tombstoned series as absent rather than as data', async () => {
  await putDiveSamples(db, 'dive-1', [[0, 1, null, null]]);
  await tombstoneDiveSamples(db, 'dive-1');
  expect(await getDiveSamples(db, 'dive-1')).toBeNull();
});

/**
 * **A write over a tombstoned series brings it back.** `putDiveSamples`'s own docblock says it
 * un-tombstones on write (`deletedAt: null` in the `onConflictDoUpdate` set), and this is that
 * behaviour exercised: `getDiveSamples` filters through `liveSeries`, so a row still carrying
 * its old `deletedAt` would read as absent even though a fresh series had just been written
 * into it. **The import does not use this** (#9): it writes onto a dive it already has only
 * when that dive has no series row at all, so a profile the diver deleted is not restored by
 * re-importing the file (`importDives.test.ts`).
 */
it('restores a tombstoned series it writes over, rather than leaving it hidden', async () => {
  await putDiveSamples(db, 'dive-1', [[0, 1, null, null]]);
  await tombstoneDiveSamples(db, 'dive-1');
  expect(await getDiveSamples(db, 'dive-1')).toBeNull();

  await putDiveSamples(db, 'dive-1', [[0, 2, null, null]]);

  expect(await getDiveSamples(db, 'dive-1')).toEqual([[0, 2, null, null]]);
});

/**
 * **`dive_samples`, offered to §7's push exactly as any other synced table** — the five
 * functions `db/dirty.ts` supplies and this file's own docblock names as the specification. A
 * series behaves like a dive for the protocol's purposes: it goes up dirty, comes off the push
 * set once acknowledged, and a pulled row lands clean rather than pushing itself straight back.
 */
it('offers a freshly written series to the push, and stops once it has gone up', async () => {
  await putDiveSamples(db, 'dive-1', [[0, 1.27, 27.7, 188.9]]);

  const pending = await pendingDiveSamples(db);
  expect(pending.map((row) => row.id)).toEqual(['dive-1']);
  expect(await countPendingDiveSamples(db)).toBe(1);

  await clearDiveSampleDirtyFlags(db, pending.map((row) => ({ id: row.id, updatedAt: row.updatedAt })));
  expect(await countPendingDiveSamples(db)).toBe(0);
});

it('writes a series the server sent without flagging it to go straight back up', async () => {
  await applyPulledDiveSamples(db, [
    {
      id: 'dive-9',
      series: [[0, 5.5, 21, 200]],
      createdAt: '2026-02-19T11:22:08.000Z',
      updatedAt: '2026-02-19T11:22:08.000Z',
      deletedAt: null,
    },
  ]);
  expect(await getDiveSamples(db, 'dive-9')).toEqual([[0, 5.5, 21, 200]]);
  expect(await countPendingDiveSamples(db)).toBe(0);
});

/**
 * **`everyDiveSampleRowsQuery`, Task 6's basis for `useDiveSampleShapes`** (the row
 * sparkline's hook, db/useDiveSampleShapes.ts) — `gearPresetRowsQuery`'s shape
 * (db/gearPresets.ts): a query builder for every LIVE row rather than one dive's, so
 * `useLiveQuery` can subscribe to it directly. Named apart from `diveSampleRowsQuery` above,
 * which already spent the obvious `diveSampleRowsQuery(db)` name on the one-dive read; see
 * that function's own docblock.
 *
 * `listDiveSamples` is a thin wrapper over this same query — `listGearPresets`'s own
 * relationship to `gearPresetRowsQuery` — so the async export path (§8) and this reactive one
 * cannot read two different sets of rows.
 */
it('reads every live series across dives, and nothing a diver has deleted', async () => {
  await putDiveSamples(db, 'dive-1', [[0, 1.27, 27.7, 188.9]]);
  await putDiveSamples(db, 'dive-2', [[0, 5.5, 21, 200]]);
  await putDiveSamples(db, 'dive-3', [[0, 9, null, null]]);
  await tombstoneDiveSamples(db, 'dive-3');

  const rows = await everyDiveSampleRowsQuery(db);
  expect(rows.map((row) => row.id).sort()).toEqual(['dive-1', 'dive-2']);

  // The same rows, through the wrapper §8's export actually calls — one query, not two.
  expect((await listDiveSamples(db)).map((row) => row.id).sort()).toEqual(['dive-1', 'dive-2']);
});

/**
 * **A deleted dive's profile goes with it, whichever device deleted it** (#9, review round 2 of
 * PR #70). `softDeleteDive` tombstones the profile on the device that deletes. A profile that
 * reached this device another way (written here after the import's completion, or pulled) is
 * still live when the dive's tombstone arrives, and this is what catches it. The test marks the
 * dive deleted directly, as a pulled tombstone leaves it.
 */
describe('tombstoneSamplesOfDeletedDives', () => {
  const deleteDiveRow = async (id: string) => {
    await db.update(dives).set({ deletedAt: '2026-09-02T09:00:00.000Z' }).where(eq(dives.id, id));
  };

  it('tombstones a live series whose dive is deleted, and owes that deletion to the server', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    await putDiveSamples(db, dive.id, [[0, 1.27, 27.7, 188.9]]);
    await clearDiveSampleDirtyFlags(db, await pendingDiveSamples(db));
    await deleteDiveRow(dive.id);

    expect(await tombstoneSamplesOfDeletedDives(db)).toEqual([dive.id]);

    expect(await getDiveSamples(db, dive.id)).toBeNull();
    expect((await pendingDiveSamples(db)).map((row) => row.id)).toEqual([dive.id]);
  });

  it('leaves every other series alone, and writes and announces nothing when nothing matches', async () => {
    const live = await createDive(db, { date: '2026-08-16' });
    await putDiveSamples(db, live.id, [[0, 1, null, null]]);
    // A series with no dive on this device: never assumed deleted, since a pull may yet bring it.
    await putDiveSamples(db, 'no-dive-here', [[0, 2, null, null]]);
    // A deleted dive whose series is already tombstoned: nothing left to do.
    const gone = await createDive(db, { date: '2026-08-17' });
    await putDiveSamples(db, gone.id, [[0, 3, null, null]]);
    await softDeleteDive(db, gone.id);
    await clearDiveSampleDirtyFlags(db, await pendingDiveSamples(db));
    const heard: number[] = [];
    const stop = onLocalWrite(() => heard.push(1));

    try {
      expect(await tombstoneSamplesOfDeletedDives(db)).toEqual([]);
      // No stamp: a sweep that announced on every pull would schedule a sync after every sync.
      expect(heard).toEqual([]);
    } finally {
      stop();
    }
    expect(await pendingDiveSamples(db)).toEqual([]);
    expect((await listDiveSamples(db)).map((row) => row.id).sort()).toEqual([live.id, 'no-dive-here'].sort());
  });
});

/**
 * **`toDiveSampleShapes`, the per-dive counterpart of `toDiveSamples`** — same "missing and
 * empty are one answer" rule (this file's own top docblock), expressed as the Map idiom
 * `useDives()`'s own `numbers` already uses: a dive with no entry has no number, and here a
 * dive with no entry has no drawable series. `.get(id)` on the result is `DiveRow`'s own
 * `points` prop exactly.
 *
 * **Task 6 review, Finding 0: this now holds downsampled `ProfilePoint[]`, not the raw
 * `DiveSample[]` a row is stored with** — the ruling that fixed a real memory cost
 * (`toDiveSampleShapes`'s own docblock has the numbers). The two-sample series below are the
 * smallest input `sparklinePoints` (domain/profile.ts) turns into points at all — one sample
 * produces none, which the "too short to draw" test further down pins directly.
 */
describe('toDiveSampleShapes', () => {
  it('maps each row to its downsampled points, by the dive id', () => {
    const rows = [
      { id: 'dive-1', series: [[0, 1.27, 27.7, 188.9], [10, 2.5, 27.7, 188.0]] },
      { id: 'dive-2', series: [[0, 5.5, 21, 200], [10, 6.2, 21, 195]] },
    ];
    const shapes = toDiveSampleShapes(rows);
    expect(shapes.get('dive-1')).toEqual([
      { t: 0, v: 1.27 },
      { t: 10, v: 2.5 },
    ]);
    expect(shapes.get('dive-2')).toEqual([
      { t: 0, v: 5.5 },
      { t: 10, v: 6.2 },
    ]);
    expect(shapes.size).toBe(2);
  });

  // Not a `''` — a dive with an empty series simply gets no entry, the same equivalence
  // `toDiveSamples` (above) draws for the single-dive read.
  it('gives a stored-but-empty series no entry, rather than an empty array', () => {
    const shapes = toDiveSampleShapes([{ id: 'dive-1', series: [] }]);
    expect(shapes.has('dive-1')).toBe(false);
    expect(shapes.get('dive-1')).toBeUndefined();
  });

  // Task 6 review, Finding 2: a single sample is a series `sparklinePoints` can draw nothing
  // from (its own "fewer than two samples" floor), so it used to survive into this map as a
  // one-element `DiveSample[]` entry — `ProfileSparkline` would then compute zero points from
  // it and draw nothing, but `DiveRow`'s bottom row had already been reserved for a shape that
  // could never appear. Filtering on the COMPUTED points, not on the raw series length, is
  // what keeps a dive like this out of the map entirely.
  it('gives a one-sample series no entry either, since there is nothing to downsample', () => {
    const shapes = toDiveSampleShapes([{ id: 'dive-1', series: [[0, 12, null, null]] }]);
    expect(shapes.has('dive-1')).toBe(false);
  });

  // Review, Finding 6: this filter used to read `points.length > 0`, its own hand-rolled
  // half of a question `isSparkDrawable` (domain/profile.ts) already owns in full — the same
  // function DiveRow's `showBottomRow` asks so a row never reserves space this component then
  // declines to draw into. `isSparkDrawable` additionally requires `last.t > first.t`, which
  // `points.length > 0` cannot express: a stored two-sample series whose samples share one
  // timestamp downsamples to two points that still share it, `points.length > 0` lets the
  // entry through, and the row's own guard then quietly draws nothing behind it.
  it('gives a same-timestamp pair no entry either, since isSparkDrawable would refuse to draw it', () => {
    const shapes = toDiveSampleShapes([
      { id: 'dive-1', series: [[5, 12, null, null], [5, 18, null, null]] },
    ]);
    expect(shapes.has('dive-1')).toBe(false);
  });

  it('maps nothing at all for no rows', () => {
    expect(toDiveSampleShapes([]).size).toBe(0);
  });
});
