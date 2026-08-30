import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { assignDiveNumbers } from '../domain/diveNumber';
import { type Dive } from '../domain/types';
import { db } from './client';
import { diveRowsQuery, toDives } from './dives';
import { divesBeforeQuery, readDivesBefore } from './settings';

export interface DiveListState {
  dives: Dive[];
  numbers: Map<string, number>;
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
export function composeDives(rows: unknown[], divesBefore: unknown): Omit<DiveListState, 'error' | 'settingsError'> {
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
 */
export function useDives(): DiveListState {
  const rows = useLiveQuery(diveRowsQuery(db));
  const settingsRows = useLiveQuery(divesBeforeQuery(db));

  const { dives, numbers } = composeDives(
    rows.data ?? [],
    readDivesBefore(settingsRows.data ?? []),
  );

  return { dives, numbers, error: rows.error, settingsError: settingsRows.error };
}
