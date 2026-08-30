import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { assignDiveNumbers, isDiveCount } from '../domain/diveNumber';
import { type Dive } from '../domain/types';
import { db } from './client';
import { diveRowsQuery, toDives } from './dives';
import { divesBeforeQuery, readDivesBefore } from './settings';

export interface DiveListState {
  dives: Dive[];
  numbers: Map<string, number>;
  error: Error | undefined;
}

/**
 * The pure half, extracted so it can be tested without a renderer.
 */
export function composeDives(rows: unknown[], divesBefore: unknown): Omit<DiveListState, 'error'> {
  const dives = toDives(rows);
  // A corrupt settings row must not blank the screen: numbering from 0 is a
  // visibly wrong dive number, which the diver can correct in settings. A
  // thrown error inside a render is a white screen they cannot.
  const offset = isDiveCount(divesBefore) ? divesBefore : 0;
  return { dives, numbers: assignDiveNumbers(dives, offset) };
}

/**
 * The one read every screen uses.
 *
 * Deliberately offers no way to pass a different query or comparator. §2.5's
 * ordering tiers and the tombstone filter each have exactly one owner, and the
 * only reliable way to keep it that way is to make reuse easier than
 * re-deriving — advice in a comment has already failed to prevent this three
 * times in this codebase.
 */
export function useDives(): DiveListState {
  const rows = useLiveQuery(diveRowsQuery(db));
  const settingsRows = useLiveQuery(divesBeforeQuery(db));

  const { dives, numbers } = composeDives(
    rows.data ?? [],
    readDivesBefore(settingsRows.data ?? []),
  );

  return { dives, numbers, error: rows.error ?? settingsRows.error };
}
