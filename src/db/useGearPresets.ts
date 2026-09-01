import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import { type GearPreset } from '../domain/types';
import { db } from './client';
import { gearPresetRowsQuery, toGearPresets } from './gearPresets';

export interface GearPresetListState {
  /** Every live preset, by name (`toGearPresets`' own order — see `comparePresets`). */
  presets: GearPreset[];
  /**
   * Set when the presets could not be read at all.
   *
   * **The dive form deliberately ignores it**, and that is not an oversight. Its chip row is
   * absent when there are no presets, so a failed read draws exactly what a diver who has
   * never saved one sees — and a banner over a dive form, about a shortcut for filling in a
   * cylinder the diver can simply type, would be the failure `useUnitSystem`'s own docblock
   * describes from the other side: a display convenience blanking or shouting over the thing
   * it merely assists.
   *
   * §3's Settings list (Task 3) is where it does matter, which is why it is here. "Couldn't
   * load your presets" and "you have none yet" are different sentences, and a diver who went
   * to that screen specifically to manage presets must not be shown the second when the
   * first is true.
   */
  error: Error | undefined;
}

/**
 * The diver's cylinder presets (DESIGN.md §2.1), live: save one in the dive form and every
 * screen holding this re-renders with it.
 *
 * **Deliberately its own hook rather than a field on `useDives()`.** That hook's own
 * docblock records what merging a second read into the dives read already cost once — "a
 * failed *settings* read... blanked the entire logbook the same way a failed *dives* read
 * does", two perfectly good dives rendered as a failure message over a display preference —
 * and `useUnitSystem` is the shape that fixed it. The same reasoning binds here in the
 * direction that matters most for this task: **a failed preset read must not blank the dive
 * form.** Separate hooks are the strongest form of that separation rather than merely a
 * stated one, because there is no shared object for the two failures to be conflated inside.
 *
 * Its whole pipeline is `toGearPresets(gearPresetRowsQuery(db))`, both of which
 * `db/gearPresets.test.ts` exercises against a real database — the same split `useDives`
 * documents, where the pure half is tested directly and `useLiveQuery` itself is left to the
 * app. There is nothing here beyond that call, the `?? []` for the first render before the
 * query resolves, and the memo below.
 *
 * `toGearPresets` is memoised on the raw row array for the reason `useDives` records: it is
 * `rows.map(...).sort(...)`, so without this every consumer would get a brand-new array on
 * every render whether or not a row had changed. It is worth having only because
 * `useLiveQuery` holds its `data` in `useState` and therefore hands back the SAME array
 * reference until the query genuinely re-runs. It is an optimisation, not a contract: no
 * consumer may assume `presets` is referentially stable.
 *
 * **Screens call this; components take the answer as a prop** — the same rule `useUnitSystem`
 * states, so every component below stays a pure function of its props that a test can render
 * without a database.
 */
export function useGearPresets(): GearPresetListState {
  const rows = useLiveQuery(gearPresetRowsQuery(db));
  const rowData = rows.data;
  const presets = useMemo(() => toGearPresets(rowData ?? []), [rowData]);
  return { presets, error: rows.error };
}
