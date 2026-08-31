import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { isDiveCount } from '../domain/diveNumber';
import { db } from './client';
import { divesBeforeQuery, readDivesBefore } from './settings';

/**
 * The diver's pre-Ponor dive count (DESIGN.md §2.5), live: change it in Settings and every
 * dive number in the logbook moves with it, because `useDives()` reads the same row through
 * the same `divesBeforeQuery` and `useLiveQuery` re-runs both.
 *
 * **Its own hook rather than a fourth field on `useDives()`**, for the reason
 * `useUnitSystem` records at length: that hook already had to be taught not to conflate a
 * failed settings read with a failed dives read, and the strongest form of that separation
 * is having no shared object to conflate them inside. Settings reads this and no dives at
 * all; the dives list reads dives and never this.
 *
 * **`null` means the stored value is there and cannot be read, and that is not the same as
 * absent.** `getDivesBefore` (db/settings.ts) states the difference and this hook keeps it:
 * an absent row is a diver who has never answered the onboarding question, whose honest
 * answer is 0, so this returns 0 for it. A row holding something that is not a
 * non-negative integer has been corrupted or hand-edited, and returning 0 for THAT would
 * misnumber the whole logbook by the diver's entire history with nothing on screen to give
 * it away — `getDivesBefore` throws rather than do that. A hook composed during a render
 * cannot throw without taking the screen down with it, so it reports the gap instead and
 * lets Settings say so in words. Settings is the one screen where that report is
 * actionable: it is where the value is typed.
 *
 * `isDiveCount` (domain/diveNumber.ts) is the only judge of what counts as a valid count,
 * exactly as `readDivesBefore`'s own docblock insists — this hook coerces nothing itself
 * and re-implements none of that rule.
 */
export function useDivesBefore(): number | null {
  const rows = useLiveQuery(divesBeforeQuery(db));
  const stored = readDivesBefore(rows.data ?? []);
  if (stored === null) return 0;
  return isDiveCount(stored) ? stored : null;
}
