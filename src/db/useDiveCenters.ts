import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { type DiveCenter } from '../domain/types';
import { diveCenterRowsQuery } from './catalogue';
import { db } from './client';
import { isResolved, useCurrentError } from './liveQuery';

export interface DiveCenterListState {
  /** Every centre the device holds that may be offered — `diveCenterRowsQuery`'s own filter:
   * live, and `status = 'active'`, so a duplicate an admin merged away is not listed beside the
   * centre it was merged into (db/catalogue.ts). Unsorted, because ordering a directory is the
   * directory's decision and not this read's. */
  centers: DiveCenter[];
  /**
   * Whether the read has produced an answer yet — rows, or a failure (`isResolved`,
   * db/liveQuery.ts). The same name and the same meaning as `useDives`', `useGearPresets`' and
   * `useDiveSites`' own `resolved`, which is the requirement rather than a coincidence.
   *
   * It matters here for `useDiveSites`' reason twice over: a centre reaches this table either
   * from a pull or from §2.3's *add a centre* on the dive form, and on a device that has never
   * done either, "the catalogue holds no centres" and "the catalogue has not been read" are the
   * same `[]`.
   */
  resolved: boolean;
  /**
   * Set when the catalogue could not be read at all, and **only while that failure is still what
   * the read last said** (`useCurrentError`, db/liveQuery.ts — `useLiveQuery` never clears its
   * own `error`).
   *
   * Reported rather than ignored for the reason `useDiveSites` gives: "couldn't read the
   * catalogue" and "you have no centres yet" are different sentences that would look identical
   * on a device where the empty answer is the expected one.
   */
  error: Error | undefined;
}

/**
 * **The device's copy of the community centres, live** — the read that had never existed.
 *
 * `dive_centers` has been written since M2o (§2.3's *add a centre* on the dive form), pushed
 * since M2a and pulled since M2b, and **nothing in `src/` has ever read it on screen**: a diver
 * could create a centre, watch it sync, and never see it again anywhere in the app. That is
 * closer to a defect than to a missing feature, and this hook is the half of the fix that gives
 * the table a reader at all — §3's Map tab, the centres directory and a centre's own page all
 * come through here.
 *
 * `useDiveSites`' twin in every respect, deliberately: same shape, same three fields, same
 * absence of a memo (the rows are handed on exactly as `useLiveQuery` holds them, so the array
 * reference is already stable until the query genuinely re-runs).
 *
 * **Its own hook rather than a field on `useDiveSites()`.** They are two tables and two
 * questions, and the direction that matters is the one `useGearPresets` records at length: a
 * failed centres read must not take the diver's sites off the map, and a failed sites read must
 * not empty the centres directory.
 *
 * **Screens call this; components take the answer as a prop** — `useUnitSystem`'s rule, so
 * nothing that draws a centre needs a database to be rendered in a test.
 */
export function useDiveCenters(): DiveCenterListState {
  const rows = useLiveQuery(diveCenterRowsQuery(db));
  return { centers: rows.data, resolved: isResolved(rows), error: useCurrentError(rows) };
}
