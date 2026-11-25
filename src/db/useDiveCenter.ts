import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { type DiveCenter } from '../domain/types';
import { diveCenterRowQuery } from './catalogue';
import { db } from './client';

/**
 * **One catalogue centre, live, by id** (#36) — `useDiveSite`'s twin for the other table, for a
 * screen that needs a single row rather than the catalogue: the dive form's *Centre* row, which
 * captions the centre it holds with its country or *on this phone only*.
 *
 * Reading `useDiveCenters` for that, as the row did until #36, handed the form the whole table on
 * every write to it, to find one row. A write still re-runs this read — `useLiveQuery` re-queries
 * on any change to its table — but each re-run is one row by its key. Live rather than fetched
 * once, so the caption follows a push (a guest's row loses *on this phone only* the moment it goes
 * up) and a new pick.
 *
 * Everything `useDiveSite` says about its answer holds here, for the same reasons: `null` for no
 * id, a row this device does not hold (not pulled, deleted, merged away, outside `pickable`), a
 * read that has not answered — and **a row that answers a different id**, since `useLiveQuery`
 * keeps the previous id's rows until the new query returns, and a caption from the shop the dive
 * is no longer with is the wrong one. **Keyed on the id** (`useLiveQuery`'s deps), so a new pick
 * re-subscribes.
 */
export function useDiveCenter(id: string | null): DiveCenter | null {
  const rows = useLiveQuery(diveCenterRowQuery(db, id ?? ''), [id]);
  const row = rows.data.at(0);
  return row?.id === id ? row : null;
}
