import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { type UnitSystem } from '../format/units';
import { db } from './client';
import { readUnitSystem, unitSystemQuery } from './settings';

/**
 * The diver's chosen unit system (DESIGN.md §3), live: change it in Settings and every
 * screen holding this re-renders its figures in the other system.
 *
 * **Deliberately its own hook rather than a third field on `useDives()`.** That hook's own
 * docblock records what merging a settings read into a dives read already cost once — "a
 * failed *settings* read... blanked the entire logbook the same way a failed *dives* read
 * does", two perfectly good dives rendered as a failure message over a display preference.
 * Separate hooks are the strongest form of that separation, not merely a stated one: there
 * is no shared object for the two failures to be conflated inside, and a screen that wants
 * units but not dives (Settings itself, next) reads no dives to get them.
 *
 * It returns the system alone, with no error field, because there is nothing an error
 * would let a caller do differently — see `readUnitSystem` (db/settings.ts) for why a unit
 * preference that fails to load degrades honestly to metric where a dive count cannot.
 *
 * **Screens call this; components take the answer as a prop.** Exactly the shape `scheme`
 * already has in this codebase — `resolveScheme(useColorScheme())` at the top of each
 * screen, `scheme` threaded down through `DiveRow`/`DepthValue`/`FormField` — and for the
 * same two reasons: one place per screen decides, and every component below stays a pure
 * function of its props that a test can render in either system without a database.
 */
export function useUnitSystem(): UnitSystem {
  const rows = useLiveQuery(unitSystemQuery(db));
  return readUnitSystem(rows.data ?? []);
}
