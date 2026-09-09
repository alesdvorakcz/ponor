import {
  applyPulledDiveSamples,
  clearDiveSampleDirtyFlags,
  countPendingDiveSamples,
  getDiveSamples,
  pendingDiveSamples,
  putDiveSamples,
  tombstoneDiveSamples,
} from './diveSamples';
import type { DiveSample } from './schema';
import { createTestDb, type TestDb } from './testDb';

/**
 * **`dive_samples`, at the repository (DESIGN.md §6, and the import spec).**
 *
 * One row per dive, keyed on the dive's own id (see that table's docblock in `schema.ts` for
 * why it is a 1:1 extension rather than a child table). What matters here is not the columns
 * — there are only five — but four things a review cannot see:
 *
 * · **A round trip is exact.** The series is opaque tuples to this layer; nothing here may
 *   reorder, coerce or drop a sample, because §0.4 draws a profile from exactly what a dive
 *   computer recorded.
 * · **Absence and "no series yet" are the same answer, `null`** — not `[]`, which would make a
 *   chart try to draw zero points instead of not drawing at all (§0.4: no curve for a dive
 *   without a real sample series).
 * · **A re-import replaces rather than appends**, because `putDiveSamples` is the one write
 *   path an importer calls on every run, including a second run over the same file.
 * · **A re-import after a delete restores the curve**, because that same write path un-tombstones
 *   on write — a diver who deleted a profile and then re-ran the same import must see it again,
 *   not a silently empty chart.
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
 * **A re-import after a delete restores the curve.** `putDiveSamples`'s own docblock says it
 * un-tombstones on write (`deletedAt: null` in the `onConflictDoUpdate` set) — this is that
 * behaviour exercised, which until now had no test of its own, unlike its sibling "replaces
 * rather than appends" a few lines up. Without it, a diver who deleted a dive's profile and
 * then re-imported the same file would see no curve at all, silently: `getDiveSamples` filters
 * through `liveSeries`, so a row still carrying its old `deletedAt` would read as absent even
 * though `putDiveSamples` had just written a fresh series into it.
 */
it('restores a tombstoned series on re-import, rather than leaving it hidden', async () => {
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
