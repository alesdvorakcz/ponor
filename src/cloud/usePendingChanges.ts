import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '../db/client';
import { pendingRowsQuery, type PushableTable } from '../db/dirty';
import { certifications, diveCenters, diveSites, dives, gearPresets } from '../db/schema';

/**
 * **How many rows this device still owes the server, live.**
 *
 * DESIGN.md §7.5's last sentence — "a quiet indicator shows pending changes" — needs a number
 * that changes when a dive is saved and again when the sync that carries it lands.
 * `countUnsyncedRows` (cloud/sync.ts) answers the same question once, for §7.4's wipe; this is
 * the same question asked continuously, and both are built on `db/dirty.ts`'s one condition so
 * the gate and the indicator can never disagree about what "still owed" means.
 *
 * ── One read per table, written out ───────────────────────────────────────────────────────
 *
 * `useLiveQuery` subscribes to exactly one table — it reads `query.config.table` and re-runs
 * only when `addDatabaseChangeListener` names that table
 * (drizzle-orm/expo-sqlite/query.js) — so five synced tables is five hooks. They are spelled
 * out rather than mapped over `SYNCED_TABLES` because a hook inside a loop is a hook whose
 * call order depends on a list, and React's rule is not negotiable for a list that "cannot"
 * change. What keeps this list honest instead is `usePendingChanges.test.tsx`, which compares
 * `PENDING_TABLES` against `cloud/sync.ts`'s own list: a table added to the protocol fails
 * that test rather than quietly being left out of the count. **It has now done exactly that
 * once** — M3b's `certifications` turned it red, which is the whole reason the tie is a test
 * and not a comment.
 *
 * ── Why there is no `resolved` field, which is not an oversight ───────────────────────────
 *
 * `db/liveQuery.ts` owns the distinction between "nothing there" and "nothing read yet", and
 * §10 records it costing a diver their whole list for a frame. It is deliberately **not**
 * applied here, and the reason is that this indicator makes no statement at zero: it draws
 * nothing. A read that has not answered yet counts 0 and draws nothing; a device with nothing
 * owed counts 0 and draws nothing. There is no sentence for an unresolved read to get wrong,
 * so a `resolved` gate on it would be a guard that could not fail — which this codebase has
 * twice found to be worse than no guard, because it reads as a defence and defends nothing.
 *
 * The one thing that *would* need it is an indicator that said something at zero — "all
 * synced", a tick, anything — and §7 does not ask for one: it asks for an indicator that shows
 * pending changes. If that ever changes, this is where `isResolved` comes in.
 *
 * ── Failure is silence, on purpose ────────────────────────────────────────────────────────
 *
 * A count read that rejects leaves `data` at its last value and the indicator says whatever it
 * said before. §1 is the rule: a sync-side failure never blocks logging and never takes over a
 * screen, and there is nothing a diver could do about a failed count of their own dirty flags.
 */

/**
 * Every table §7 pushes, in `cloud/sync.ts`'s own order. Exported for the test that ties this
 * list to `SYNCED_TABLES` — see the docblock above for why the tie is a test rather than a
 * loop.
 */
export const PENDING_TABLES: readonly PushableTable[] = [
  dives,
  gearPresets,
  certifications,
  diveSites,
  diveCenters,
];

/** How many rows across the whole device are waiting to go up. `0` is an ordinary answer and
 * is also what a device that has not read yet reports — see the docblock. */
export function usePendingChanges(): number {
  const pendingDives = useLiveQuery(pendingRowsQuery(db, dives));
  const pendingPresets = useLiveQuery(pendingRowsQuery(db, gearPresets));
  const pendingCards = useLiveQuery(pendingRowsQuery(db, certifications));
  const pendingSites = useLiveQuery(pendingRowsQuery(db, diveSites));
  const pendingCenters = useLiveQuery(pendingRowsQuery(db, diveCenters));

  return (
    pendingDives.data.length +
    pendingPresets.data.length +
    pendingCards.data.length +
    pendingSites.data.length +
    pendingCenters.data.length
  );
}
