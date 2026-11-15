import { useEffect, useRef, useState } from 'react';

import { cloud, type Cloud } from '../cloud/supabase';
import { db } from '../db/client';
import { type Db } from '../db/types';
import { type MapPoint } from '../domain/mapSites';

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
  const wanted = query.trim();
  useSupplement(wanted === '' ? null : wanted, wanted, LIVE_SEARCH_DELAY_MS, search, apply);
}

/**
 * **The same supplement, asked around a point instead of for a name** — the site picker's *Near
 * me* list, whose "query" is the diver's fix. It differs from `useCatalogueSupplement` in exactly
 * two ways, both because a point is not a keystroke: **there is no delay** (a fix is a settled
 * value, so there is nothing to wait out), and **`null` means "no fix yet" and does nothing**
 * (the list is the device's own rows until one arrives).
 *
 * **It answers whether the server is still being asked about this point** — `true` from the fix
 * until the answer has been written or has failed, `false` with no point. Nothing waits on it; the
 * picker reads it so it never says *"Nothing within 50 km"* while the community's rows may be on
 * their way (an absent answer is not an empty one). A server that cannot be reached answers at
 * once (`searchCatalogue` turns every failure into `[]`), so out of signal the sentence still comes.
 *
 * The effect depends on the two coordinates rather than the `point` object, so a caller that
 * rebuilds an equal point on every render does not ask the server again.
 */
export function useNearbySupplement<T>(
  point: MapPoint | null,
  search: (cloud: Cloud, point: MapPoint) => Promise<T[]>,
  apply: (db: Db, rows: readonly T[]) => Promise<unknown>,
): boolean {
  const key = point === null ? null : `${point.latitude},${point.longitude}`;
  return useSupplement(key, point, 0, search, apply);
}

/**
 * **The one body behind both supplements** — the contract stated once: after `delayMs`, `search`
 * is asked `question` and any rows go to `apply`; nothing throws (the read cannot, a write that
 * refuses is swallowed — the same outcome as a server that never answered, the device's own rows
 * already on screen); and an answer that lands after `key` changed or the screen closed is
 * dropped, written or not.
 *
 * `key` is what identifies the question — the trimmed query, or the point's two coordinates — and
 * is the only thing the effect re-runs on, so a caller handing in an equal question rebuilt on
 * every render does not ask again; `null` asks nothing. `question` is read when the effect runs,
 * from a ref. Answers whether the question under the current `key` is still out.
 */
function useSupplement<Q, T>(
  key: string | null,
  question: Q,
  delayMs: number,
  search: (cloud: Cloud, question: NonNullable<Q>) => Promise<T[]>,
  apply: (db: Db, rows: readonly T[]) => Promise<unknown>,
): boolean {
  const asked = useRef(question);
  asked.current = question;
  // The key whose question has come back — written, empty, or refused.
  const [answered, setAnswered] = useState<string | null>(null);

  useEffect(() => {
    const wanted = asked.current;
    if (key === null || wanted === null || wanted === undefined) return;
    let cancelled = false;
    const ask = async () => {
      try {
        const rows = await search(cloud, wanted);
        if (cancelled || rows.length === 0) return;
        await apply(db, rows);
      } catch {
        // See the docblock: a refused write is the same outcome as no answer.
      } finally {
        if (!cancelled) setAnswered(key);
      }
    };
    const timer = setTimeout(() => void ask(), delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, delayMs, search, apply]);

  return key !== null && answered !== key;
}
