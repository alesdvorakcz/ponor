import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { type DiveSite } from '../domain/types';
import { diveSiteRowQuery } from './catalogue';
import { db } from './client';
import { isResolved } from './liveQuery';

export interface DiveSiteState {
  /** The row, under the catalogue's own `pickable` filter — `null` for no id, or a row this device
   * does not hold (not yet pulled, deleted, merged away). */
  site: DiveSite | null;
  /** Whether the read has answered (`isResolved`, db/liveQuery.ts). No id has nothing to wait for. */
  resolved: boolean;
}

/**
 * **One catalogue site, live, by id** — for a screen that needs a single row rather than the
 * catalogue (#27's second review: a planned dive's *Show on map*).
 *
 * Live rather than read at the press, so the decision a press makes is already in hand when it
 * happens: a press that awaited a read could be pressed twice and open two maps, or land after the
 * diver had already gone back and open the map over the wrong page. One row by id is what the dive
 * detail can afford on every render, where `useDiveSites` — the whole catalogue — is not.
 *
 * `null` reads no row (an id that cannot match), so a caller can pass "no site" without a hook
 * that comes and goes. **Keyed on the id** (`useLiveQuery`'s deps), for the reason
 * `useDiveSamples` records: its deps default to `[]`, so a query rebuilt for a different id would
 * never run and a reused screen would go on holding the first row.
 */
export function useDiveSite(id: string | null): DiveSiteState {
  const rows = useLiveQuery(diveSiteRowQuery(db, id ?? ''), [id]);
  if (id === null) return { site: null, resolved: true };
  return { site: rows.data.at(0) ?? null, resolved: isResolved(rows) };
}
