import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import { assignDiveNumbers } from '../domain/diveNumber';
import { type Dive } from '../domain/types';
import { db } from './client';
import { diveRowsQuery, toDives } from './dives';
import { isResolved } from './liveQuery';
import { divesBeforeQuery, readDivesBefore } from './settings';

export interface DiveListState {
  dives: Dive[];
  numbers: Map<string, number>;
  /**
   * Whether the DIVES read has produced an answer yet — rows, or a failure (`isResolved`,
   * db/liveQuery.ts, which is also where the mechanism and the two words' exact meaning live).
   * `false` only on the renders before the query first returns; `useGearPresets` carries the
   * same field, under the same name, meaning the same thing.
   *
   * **`dives` alone cannot say this**, which is the defect it exists to close: `[]` means "no
   * dives" and "not looked yet" at once, and three screens asserted the first while the second
   * was true — "Dive not found." over a dive that was there (DiveDetailScreen), and a blank
   * edit form over a real dive (DiveFormScreen). A screen with no answer must not state one.
   *
   * **It reports on the dives query alone, and deliberately does NOT follow the two-field
   * split below.** Two separate claims, both worth stating:
   *
   * One field rather than two, because no caller has anything to do with "the settings read
   * has not answered yet". What that read produces is a numbering OFFSET; a dive list that has
   * arrived is a complete answer to "which dives are there" whether or not the offset has
   * landed, and until it does the numbers simply start from 1 — `assignDiveNumbers`' own
   * documented degradation for an offset it cannot use, and exactly what `settingsError`
   * degrades to permanently. There is no false sentence for a screen to say from it, so there
   * is nothing for a second field to gate.
   *
   * And this one field ignores the settings query rather than waiting on both, because waiting
   * on both is the mirror image of the defect the hook's own docblock records below. Merging
   * the two ERRORS let a failed settings read blank the entire logbook; merging the two
   * LOADING states would let a slow settings read hold the entire logbook back. Same shape,
   * same wrongness, one render earlier — a display preference deciding whether the dives are
   * shown at all.
   *
   * The cost, stated rather than hidden: a logbook whose settings read lands after its dives
   * read numbers from offset 0 for those renders and then renumbers. That flash is real, and
   * it is the smaller of the two — a number that corrects itself, against a list that is not
   * shown.
   */
  resolved: boolean;
  /**
   * Set when the dives themselves could not be read. Fatal — DivesScreen.tsx blanks the
   * whole screen for this one, because there is nothing honest to show in its place.
   */
  error: Error | undefined;
  /**
   * Set when only the `dives_before` settings read failed — the dives themselves are still
   * shown, numbered from offset 0 rather than the diver's real pre-Ponor count
   * (`composeDives`/`assignDiveNumbers`'s own fallback for exactly this case: see
   * `isDiveCount`'s docblock in domain/diveNumber.ts). A *display preference* failing to
   * load must not hide the dives it merely numbers — see this module's own history below —
   * but it also must not fail silently: a diver whose numbers just quietly reset to 1 has
   * been shown a plausible lie as surely as an empty screen would be one. DivesScreen.tsx
   * surfaces this as a non-dismissible notice alongside the (otherwise unaffected) list.
   */
  settingsError: Error | undefined;
}

/**
 * The pure half, extracted so it can be tested without a renderer.
 *
 * Applies no policy of its own about what counts as a valid `divesBefore` — that judgement
 * belongs to `isDiveCount` alone (its own docblock names `assignDiveNumbers` as the one
 * legitimate site that falls back to 0 rather than throwing), and `divesBefore` is
 * forwarded to it unchanged. An earlier version re-checked `isDiveCount` here first, ahead
 * of `assignDiveNumbers` checking it again internally — a fourth copy of a rule
 * `diveNumber.ts` already owns, and a dead one: mutating this guard to a bare cast changed
 * nothing, because `assignDiveNumbers` already re-derives the identical answer. Removed
 * rather than kept as a defensive-but-redundant copy, per this file's own "make reuse
 * easier than re-deriving" stance below.
 */
export function composeDives(
  rows: unknown[],
  divesBefore: unknown,
): Omit<DiveListState, 'resolved' | 'error' | 'settingsError'> {
  const dives = toDives(rows);
  return { dives, numbers: assignDiveNumbers(dives, divesBefore) };
}

/**
 * The one read every screen uses.
 *
 * Deliberately offers no way to pass a different query or comparator. §2.5's
 * ordering tiers and the tombstone filter each have exactly one owner, and the
 * only reliable way to keep it that way is to make reuse easier than
 * re-deriving — advice in a comment has already failed to prevent this three
 * times in this codebase.
 *
 * `error` and `settingsError` are deliberately two independent fields, not one combined
 * `rows.error ?? settingsRows.error`. An earlier version merged them, which meant a failed
 * *settings* read — an offset on a displayed number — blanked the entire logbook the same
 * way a failed *dives* read does: DivesScreen.tsx treats any truthy `error` as fatal, so two
 * perfectly good dives in the database rendered as nothing but a failure message. That
 * directly contradicted `composeDives`'s own predecessor, which went to real trouble to
 * degrade a corrupt `dives_before` *value* gracefully, only for a failed settings *query* to
 * blank the screen anyway. The dives and the numbering preference now fail independently,
 * matching how differently wrong they actually are.
 *
 * `composeDives` is memoised on the two raw row arrays. `toDives` is `rows.map(toDive)
 * .sort(...)`, so without this every consumer got a brand-new `dives` array on every render
 * whether or not a single row had changed — `DivesScreen` re-derived all of its trip
 * grouping each time, and `DiveFormScreen` looped infinitely on a gate that compared that
 * array's identity. The memo is worth having only because `useLiveQuery` holds its `data` in
 * `useState` and therefore hands back the SAME array reference until the query genuinely
 * re-runs (verified against drizzle-orm/expo-sqlite/query.js); against a hook that rebuilt
 * `data` on every render it would buy nothing. It is an optimisation, not a contract: no
 * consumer may assume `dives` is referentially stable, and the one that did has been fixed
 * to compare a dive id instead.
 */
export function useDives(): DiveListState {
  const rows = useLiveQuery(diveRowsQuery(db));
  const settingsRows = useLiveQuery(divesBeforeQuery(db));

  const rowData = rows.data;
  const settingsData = settingsRows.data;
  const { dives, numbers } = useMemo(
    () => composeDives(rowData ?? [], readDivesBefore(settingsData ?? [])),
    [rowData, settingsData],
  );

  // `isResolved(rows)`, not `isResolved(settingsRows)` and not both — see `DiveListState`'s
  // own field for why the loading signal deliberately parts company with the error split.
  return { dives, numbers, resolved: isResolved(rows), error: rows.error, settingsError: settingsRows.error };
}
