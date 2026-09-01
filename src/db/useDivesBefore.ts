import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { isDiveCount } from '../domain/diveNumber';
import { db } from './client';
import { isResolved } from './liveQuery';
import { divesBeforeQuery, readDivesBefore } from './settings';

export interface DivesBeforeState {
  /**
   * The stored count: a number, or `null` for the one case this hook will not degrade (see
   * below). **Meaningless until `resolved`** — it reads 0 there, which is the answer for an
   * absent row and not an answer about this diver at all.
   */
  count: number | null;
  /**
   * Whether the read has produced an answer yet — rows, or a failure (`isResolved`,
   * db/liveQuery.ts). The same field, the same name and the same meaning `useDives` and
   * `useGearPresets` carry; three hooks, one word for one fact (§4.1).
   *
   * **This is the one of the three where the missing signal destroyed data rather than merely
   * asserting something false.** `count` is 0 before the read answers, indistinguishable from
   * the genuine 0 of a diver who never answered the onboarding question — so Settings showed
   * a `0` nobody had entered, in a field the diver types into, and then overwrote whatever
   * they typed over it when the real value landed. Silently, with no error: the hazard
   * `withoutUndefinedFields` (db/dives.ts) exists for, arriving through a render instead of
   * through a patch.
   *
   * **`useUnitSystem` degrading to metric is deliberately NOT the same case**, and the two
   * were once argued as if they were. Metric is a convention standing in for an ABSENT
   * preference: nobody typed it, nothing is lost by showing it early, and the two screens a
   * late answer could mislabel already reseed on the value itself. `0` here stands in for a
   * number the diver ENTERED — and §2.5 makes this row the offset every dive number in the
   * logbook is computed from, so a wrong 0 is not a display detail, it renumbers the list.
   */
  resolved: boolean;
}

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
export function useDivesBefore(): DivesBeforeState {
  const rows = useLiveQuery(divesBeforeQuery(db));
  const stored = readDivesBefore(rows.data);
  // `count` is computed whether or not the read has answered, exactly as it always was — the
  // change is that a caller can now tell the 0 below from a diver's own 0, which is what
  // `resolved` is for. Nothing here decides what to DO about that; Settings does.
  const count = stored === null ? 0 : isDiveCount(stored) ? stored : null;
  return { count, resolved: isResolved(rows) };
}
