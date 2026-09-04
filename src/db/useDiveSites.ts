import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { type DiveSite } from '../domain/types';
import { diveSiteRowsQuery } from './catalogue';
import { db } from './client';
import { isResolved, useCurrentError } from './liveQuery';

export interface DiveSiteListState {
  /** Every site the device holds that may be offered — `diveSiteRowsQuery`'s own filter: live,
   * and `status = 'active'`, so a duplicate an admin merged away is not drawn on the map beside
   * the site it was merged into (db/catalogue.ts). Unsorted, because a map has no order. */
  sites: DiveSite[];
  /**
   * Whether the read has produced an answer yet — rows, or a failure (`isResolved`,
   * db/liveQuery.ts). The same name and the same meaning as `useDives`' and `useGearPresets`'
   * own `resolved`, which is the requirement rather than a coincidence: three hooks growing
   * three vocabularies for one fact is §4.1's defining defect.
   *
   * **It matters more here than on either of those**, because the honest empty case is the
   * common one. `dive_sites` reaches a device only through a pull (§5, §7), and nothing creates
   * a site yet — so this table is empty on every device today, and "the catalogue holds no
   * sites" and "the catalogue has not been read" are the same `[]`. A community layer that said
   * "no sites yet" before it had looked would be the false statement `resolved` exists to stop,
   * on the one layer where it is indistinguishable from the truth.
   */
  resolved: boolean;
  /**
   * Set when the catalogue could not be read at all, and **only while that failure is still what
   * the read last said** (`useCurrentError`, db/liveQuery.ts — `useLiveQuery` never clears its
   * own `error`).
   *
   * The Map tab reports it rather than ignoring it, for the reason §3's Settings list reports a
   * failed preset read: "couldn't read the catalogue" and "there are no community sites yet" are
   * different sentences, and today they would look identical — an empty layer is the expected
   * state, which is exactly what would let a failure hide inside it for ever.
   */
  error: Error | undefined;
}

/**
 * **The device's copy of the community catalogue, live** — §5's *"the compact site/center
 * catalogue syncs to every device"*, read for the first time by anything on screen.
 *
 * `db/catalogue.ts` has owned this table since M2d and nothing has drawn from it: §2.3's
 * autocomplete still suggests from the diver's own history alone, so the Map tab's community
 * layer (§3: *"toggle to explore all community sites"*) is the catalogue's first reader. That
 * is worth saying plainly because of what it implies about the empty state — the layer is not a
 * placeholder waiting on code, it is a real read of a real table that has nothing in it yet, and
 * it fills the day a pull brings sites down.
 *
 * **Its own hook rather than a field on `useDives()`**, for the reason `useGearPresets` records
 * at length: merging a second read into the dives read once let a failed *settings* read blank
 * the whole logbook. Here the direction that matters is that a failed catalogue read must not
 * take the diver's own pins off the map — they are two layers, and only one of them is being
 * read by this.
 *
 * There is nothing here beyond the query, `isResolved` and `useCurrentError`. No memo, unlike
 * the two hooks it is modelled on: neither `toDives` nor `toGearPresets` has an equivalent here
 * — the rows are handed on exactly as `useLiveQuery` holds them, so the array reference is
 * already stable until the query genuinely re-runs and a `useMemo` over an identity function
 * would buy nothing. **Ordering is deliberately absent too**: a map has no first site.
 *
 * **Screens call this; components take the answer as a prop** — the rule `useUnitSystem` states,
 * so `DiveMap` stays a pure function of its props that a test can render without a database.
 */
export function useDiveSites(): DiveSiteListState {
  const rows = useLiveQuery(diveSiteRowsQuery(db));
  return { sites: rows.data, resolved: isResolved(rows), error: useCurrentError(rows) };
}
