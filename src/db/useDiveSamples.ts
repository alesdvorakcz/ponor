import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import { db } from './client';
import { diveSampleRowsQuery, toDiveSamples } from './diveSamples';
import { isResolved, useCurrentError } from './liveQuery';
import { type DiveSample } from './schema';

export interface DiveSamplesState {
  /**
   * The dive's recorded profile, or `null` where there is none — which is most dives, and is
   * not an error. §0.4: no curve is drawn for a dive without a real sample series, so the
   * absent case is the ordinary one and `DepthProfile` renders nothing for it.
   *
   * Never `[]`. `toDiveSamples` (db/diveSamples.ts) owns that rule and its reasons.
   */
  samples: DiveSample[] | null;
  /**
   * Whether the read has produced an answer yet — rows, or a failure (`isResolved`,
   * db/liveQuery.ts, which owns the mechanism and both words' exact meaning).
   *
   * **The same name and the same meaning as `useDives`' and `useGearPresets`' own `resolved`,
   * and that is the requirement rather than a coincidence** (§4.1). `samples` alone cannot say
   * it: `null` means "this dive has no profile" and "nothing has been read yet" at once, and a
   * screen that wanted to tell them apart would have to invent its own way of asking.
   *
   * Nothing on the dive detail currently needs to: §0.4 draws nothing in both cases, so the
   * card simply appears when the series lands. It is here because the field is the shape every
   * live read in this app returns, and a hook that omitted it would be the one a later screen
   * has to work around.
   */
  resolved: boolean;
  /**
   * Set when the series could not be read at all.
   *
   * **The chart deliberately ignores it, and that is the same decision the dive form makes
   * about `useGearPresets`' own `error`.** A failed profile read draws exactly what a dive
   * without a profile draws — nothing — and a banner over a dive detail, about a chart the
   * diver may never have had, would be a display convenience shouting over the record it is
   * supposed to decorate. It is here for the same reason `resolved` is: the fact exists, and a
   * caller that ever does need to say "couldn't read this dive's profile" must not have to
   * reach past this hook for it.
   *
   * **Set only while that failure is still what the read last said** (`useCurrentError`,
   * db/liveQuery.ts). `useLiveQuery` never clears its own `error`.
   */
  error: Error | undefined;
}

/**
 * One dive's recorded profile, live: import a file, or delete the dive, and every screen
 * holding this re-renders with what the database now says.
 *
 * Its whole pipeline is `toDiveSamples(diveSampleRowsQuery(db, diveId))`, both of which
 * `db/diveSamples.test.ts` exercises against a real database — the same split `useDives` and
 * `useGearPresets` document, where the pure half is tested directly and `useLiveQuery` itself
 * is left to the app. There is nothing here beyond that call, `isResolved` and the memo below.
 *
 * **The dependency array is not decoration.** `useLiveQuery` subscribes inside a `useEffect`
 * whose deps default to `[]` (drizzle-orm/expo-sqlite/query.js), so a query rebuilt for a
 * different id on a later render would simply never run — the effect does not re-fire, and the
 * hook would go on delivering the first dive's rows. Every other live read in this app is
 * parameterless and cannot reach that state; this one takes an id, so the id is what the
 * subscription depends on. Without it, a screen reused across two dives (expo-router keeps a
 * route's component mounted) would draw the previous dive's profile under this dive's name,
 * which is §0.4's rule broken in the one way it cannot be seen: the curve is real, it is just
 * not this dive's.
 *
 * `toDiveSamples` is memoised on the raw row array for the reason `useGearPresets` records:
 * `useLiveQuery` holds its `data` in `useState` and hands back the SAME array reference until
 * the query genuinely re-runs, so this returns a stable `samples` across renders that changed
 * nothing. It is an optimisation, not a contract.
 *
 * **Screens call this; components take the answer as a prop** — the standing rule
 * (`useUnitSystem`'s own docblock), and what lets `DepthProfile` be a pure function of its
 * props that a test can render without a database.
 */
export function useDiveSamples(diveId: string): DiveSamplesState {
  const rows = useLiveQuery(diveSampleRowsQuery(db, diveId), [diveId]);
  const rowData = rows.data;
  const samples = useMemo(() => toDiveSamples(rowData), [rowData]);
  // `useCurrentError`, not `rows.error`: `useLiveQuery` sets `error` in its failure paths and
  // never clears it, so the raw field stands for the life of the component once it has fired.
  // `isResolved` still reads the raw result and cannot disagree — an error hidden there is one
  // a successful run has already landed on top of.
  return { samples, resolved: isResolved(rows), error: useCurrentError(rows) };
}
