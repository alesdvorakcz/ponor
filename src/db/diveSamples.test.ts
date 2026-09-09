import { getDiveSamples, putDiveSamples, tombstoneDiveSamples } from './diveSamples';
import type { DiveSample } from './schema';
import { createTestDb, type TestDb } from './testDb';

/**
 * **`dive_samples`, at the repository (DESIGN.md §6, and the import spec).**
 *
 * One row per dive, keyed on the dive's own id (see that table's docblock in `schema.ts` for
 * why it is a 1:1 extension rather than a child table). What matters here is not the columns
 * — there are only five — but three things a review cannot see:
 *
 * · **A round trip is exact.** The series is opaque tuples to this layer; nothing here may
 *   reorder, coerce or drop a sample, because §0.4 draws a profile from exactly what a dive
 *   computer recorded.
 * · **Absence and "no series yet" are the same answer, `null`** — not `[]`, which would make a
 *   chart try to draw zero points instead of not drawing at all (§0.4: no curve for a dive
 *   without a real sample series).
 * · **A re-import replaces rather than appends**, because `putDiveSamples` is the one write
 *   path an importer calls on every run, including a second run over the same file.
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
