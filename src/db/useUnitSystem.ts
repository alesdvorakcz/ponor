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
 * Its whole pipeline is `readUnitSystem(unitSystemQuery(db))`, which `db/settings.test.ts`
 * exercises against a real database — the same split `useDives` documents, where the pure
 * half is tested directly and `useLiveQuery` itself is left to the app. There is nothing
 * here beyond that call and the `?? []`, which is a type-level guard and nothing more —
 * a correction, since this line used to call it "for the first render, before the query
 * resolves". It never was: `useLiveQuery` seeds `data` with `[]` itself for a `db.select()`
 * builder (`isResolved`, db/liveQuery.ts), so the coalesce has never once fired. This hook
 * needs no `resolved` of its own for that gap all the same — `readUnitSystem` degrades an
 * absent row to metric on purpose, so a caller has nothing to do differently while it waits
 * and no false sentence to say; the two screens that would be mislabelled by a late answer
 * already reseed on the value itself changing (`SeedState.units`, DiveFormScreen.tsx).
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
