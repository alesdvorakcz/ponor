import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { type DiveSite } from '../domain/types';
import { diveSiteRowQuery } from './catalogue';
import { db } from './client';

/**
 * **One catalogue site, live, by id** — for a screen that needs a single row rather than the
 * catalogue (#27's second review: a planned dive's *Show on map*).
 *
 * Live rather than read at the press, so the decision a press makes is already in hand when it
 * happens: a press that awaited a read left a window in which the diver could go back and the map
 * then open over the wrong page. (It does not make a double tap safe — two quick taps still push
 * twice, as every link in the app does; it only stops the read from widening that window.) One row
 * by id is what the dive detail can afford on every render, where `useDiveSites` — the whole
 * catalogue — is not.
 *
 * `null` for no id, a row this device does not hold (not yet pulled, deleted, merged away, outside
 * the catalogue's own `pickable` filter), a read that has not answered yet — and **a row that
 * answers a different id** (#27's third review). `useLiveQuery` keeps its last `data` when its deps
 * change and replaces it only once the new query returns (drizzle-orm/expo-sqlite/query.js), so for
 * a moment after a plan's site is edited it still holds the *old* site's row; handing that over
 * would point the map at the place the plan no longer goes. A row is this id's answer only if it
 * says so.
 *
 * No `resolved` beside it, unlike the other live reads: the one caller treats "not read yet" and
 * "not there" alike (the device's maps), and keeping such a flag true after an id change would need
 * bookkeeping of its own — `updatedAt` is just as stale as `data` until the new query returns, and
 * an empty answer carries no id to check.
 *
 * `null` reads no row (an id that cannot match), so a caller can pass "no site" without a hook
 * that comes and goes. **Keyed on the id** (`useLiveQuery`'s deps), for the reason
 * `useDiveSamples` records: its deps default to `[]`, so a query rebuilt for a different id would
 * never run and a reused screen would go on holding the first row.
 */
export function useDiveSite(id: string | null): DiveSite | null {
  const rows = useLiveQuery(diveSiteRowQuery(db, id ?? ''), [id]);
  const row = rows.data.at(0);
  return row?.id === id ? row : null;
}
