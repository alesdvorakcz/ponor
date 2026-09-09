import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import { db } from './client';
import { everyDiveSampleRowsQuery, toDiveSampleShapes } from './diveSamples';
import { isResolved, useCurrentError } from './liveQuery';
import { type DiveSample } from './schema';

export interface DiveSampleShapesState {
  /** Every dive that has a real recorded profile, by id — Task 6's row sparkline reads
   * `shapes.get(dive.id)` for exactly the value `DiveRow`'s own `samples` prop wants, `undefined`
   * for the (still ordinary) case of a dive nothing was ever imported for. Never an entry
   * holding `[]`: `toDiveSampleShapes` (db/diveSamples.ts) owns that rule and its reasons. */
  shapes: Map<string, DiveSample[]>;
  /**
   * Whether the read has produced an answer yet — rows, or a failure (`isResolved`,
   * db/liveQuery.ts, which owns the mechanism and both words' exact meaning).
   *
   * **The same name and the same meaning as `useDives`' and `useGearPresets`' own `resolved`**
   * (§4.1) — nothing in this app currently gates on it (every caller reads `shapes` alone,
   * the way `DepthProfile`'s own caller ignores `useDiveSamples`' `resolved`), but the field is
   * here for the reason `useDiveSamples`' docblock gives for carrying it unused: it is the
   * shape every live read in this app returns, and a later caller that DOES need "has this
   * been read yet" must not have to reach past this hook for it.
   */
  resolved: boolean;
  /**
   * Set when the series could not be read at all.
   *
   * **Deliberately ignored by every current caller, and that is the whole point of this being
   * its own hook rather than a field on `useDives()`.** A failed sample-series read must not
   * blank the diver's logbook — the exact failure `useGearPresets`' own docblock records
   * `useDives()` once suffering from a *settings* read, one column over. A row with no
   * `samples` prop renders exactly as it always has, whether that absence means "never
   * imported" or "the read that would have said otherwise just failed" — so there is nothing
   * for this field to gate today. It is here for the same reason `resolved` is: the fact
   * exists, and a caller that ever needs to say "couldn't read your dive profiles" must not
   * have to reach past this hook for it.
   *
   * **Set only while that failure is still what the read last said** (`useCurrentError`,
   * db/liveQuery.ts). `useLiveQuery` never clears its own `error`.
   */
  error: Error | undefined;
}

/**
 * Every dive's recorded depth profile, live, as a map from dive id to series — Task 6's row
 * sparkline (`ProfileSparkline`, components/ProfileSparkline.tsx) is what this exists for:
 * import a file and every screen holding this re-renders with the new shape.
 *
 * **Deliberately its own hook rather than a field on `useDives()`.** `useGearPresets`' own
 * docblock records what merging a second read into the dives read already cost once — "a
 * failed *settings* read... blanked the entire logbook the same way a failed *dives* read
 * does" — and the same reasoning binds here in the direction that matters most for this hook:
 * **a failed sample-series read must not blank the diver's logbook.** Separate hooks are the
 * strongest form of that separation rather than merely a stated one, because there is no
 * shared object for the two failures to be conflated inside.
 *
 * Its whole pipeline is `toDiveSampleShapes(everyDiveSampleRowsQuery(db))`, both of which
 * `db/diveSamples.test.ts` exercises against a real database — the same split `useDives` and
 * `useGearPresets` document, where the pure half is tested directly and `useLiveQuery` itself
 * is left to the app. There is nothing here beyond that call, `isResolved` and the memo below.
 *
 * `toDiveSampleShapes` is memoised on the raw row array for the reason `useGearPresets`
 * records: it rebuilds a `Map` from `rows.filter(...).map(...)`, so without this every
 * consumer would get a brand-new `Map` on every render whether or not a row had changed — and
 * **these rows render in a list**, so a fresh reference on every parent render would defeat
 * `DiveRow`'s own `memo` for every row, on every render, whether or not that row's series
 * actually changed. It is worth having only because `useLiveQuery` holds its `data` in
 * `useState` and therefore hands back the SAME array reference until the query genuinely
 * re-runs. It is an optimisation, not a contract: no consumer may assume `shapes` is
 * referentially stable, and none needs to — every reader only ever calls `.get(id)` on it.
 *
 * **Screens call this; components take the answer as a prop** — the same rule `useUnitSystem`
 * states, so `DiveRow` and `ReorderControls` both stay a pure function of their props that a
 * test can render without a database.
 */
export function useDiveSampleShapes(): DiveSampleShapesState {
  const rows = useLiveQuery(everyDiveSampleRowsQuery(db));
  const rowData = rows.data;
  const shapes = useMemo(() => toDiveSampleShapes(rowData), [rowData]);
  // `useCurrentError`, not `rows.error`: `useLiveQuery` sets `error` in its failure paths and
  // never clears it, so the raw field stands for the life of the component once it has fired —
  // through every later read that succeeds. `isResolved` still reads the raw result, and cannot
  // disagree: an error hidden there is one a successful run has already landed on top of.
  return { shapes, resolved: isResolved(rows), error: useCurrentError(rows) };
}
