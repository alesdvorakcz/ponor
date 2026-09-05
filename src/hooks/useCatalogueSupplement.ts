import { useEffect } from 'react';

import { cloud, type Cloud } from '../cloud/supabase';
import { db } from '../db/client';
import { type Db } from '../db/types';

/**
 * **How long after the last keystroke the server is asked** (§2.3's *"live search adds anything
 * newer when online"*).
 *
 * A number rather than a call per keystroke, because a keystroke is not a question: a diver typing
 * `Ponorka` would otherwise send seven round trips, six of which are already stale when they land.
 * 400 ms is a pause rather than a delay — the device's own answer is already on screen the whole
 * time, so what this delays is a list getting *longer*, never a list appearing.
 */
export const LIVE_SEARCH_DELAY_MS = 400;

/**
 * **§2.3's online supplement, for a catalogue directory** — debounced, fire-and-forget, and the
 * same behaviour for sites (M3f) and centres (M3c), which is why it is a hook and not two effects.
 *
 * ── What it is, in §2.3's own shape ───────────────────────────────────────────────────────
 *
 * *"Typing a site or center searches your own history first, then the on-device copy of the
 * community catalogue… live search adds anything newer when online."* The list a diver reads is
 * always **one** live query over the device's own table. This asks the server after a pause and
 * hands what comes back to the catalogue's own writer; the live query then re-renders with the new
 * rows in it. That is the sentence taken literally — the device answers first and the server
 * supplements rather than replaces — and it is what keeps both screens free of a merge: no "local
 * or remote" state on any row, no second ordering, and a place found online is still there the
 * next time the diver is on a boat.
 *
 * ── Nothing on screen waits for it and nothing reports it ─────────────────────────────────
 *
 * `searchSites`/`searchCenters` answer `[]` for every way of failing (no backend in this build,
 * nobody signed in, no signal, a server that refused) and the device's own rows are what the diver
 * is reading meanwhile. §1 is the whole of that — a directory must work at sea — and §0.6 is the
 * rest: a notice under a search field that fired on every keystroke made out of signal is a
 * message with no gesture beneath it.
 *
 * The write is `applyPulledDiveSites`/`applyPulledDiveCenters`, which is `applyPulledRows`
 * (db/dirty.ts): rows land **clean**, only where they may safely replace what is here, and
 * `sync_state` is untouched — the migration is explicit that advancing the watermark on a filtered
 * answer would step it past everything the filter excluded.
 *
 * ── Why the two singletons are read here and the two functions are arguments ──────────────
 *
 * `cloud` and `db` are this app's one client and one database, so a caller passing them would be
 * passing the only value there is. `search` and `apply` are the pair that must differ, and they
 * travel together: handing this the sites RPC and the centres writer is the one mistake worth
 * making impossible, and the shared type variable is what stops it compiling.
 *
 * They are also **module-level functions and therefore stable**, which is why they can sit in the
 * dependency list without a ref: the effect re-runs when the query changes and at no other time,
 * exactly as the hand-written version on each screen did.
 */
export function useCatalogueSupplement<T>(
  query: string,
  search: (cloud: Cloud, query: string) => Promise<T[]>,
  apply: (db: Db, rows: readonly T[]) => Promise<unknown>,
): void {
  useEffect(() => {
    const wanted = query.trim();
    if (wanted === '') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const rows = await search(cloud, wanted);
          if (cancelled || rows.length === 0) return;
          await apply(db, rows);
        } catch {
          // The read cannot throw (those modules' own contract); the write can, and a catalogue
          // that refused a write is the same outcome as a server that never answered — the
          // device's own rows, already on screen.
        }
      })();
    }, LIVE_SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, search, apply]);
}
