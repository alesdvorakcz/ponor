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
 * here beyond that call.
 *
 * **The `?? []` that used to sit on `rows.data` is gone.** Two wrong accounts of it have now
 * been written: "for the first render, before the query resolves" (it never was — `useLiveQuery`
 * seeds `data` with `[]` itself for a `db.select()` builder, so the coalesce had never once
 * fired) and then "a type-level guard" (it was not that either — deleting it leaves typecheck
 * clean, which is what settled it). Removed rather than left as a no-op under a third guess.
 * See `isResolved` (db/liveQuery.ts) for the mechanism and for the question those lines looked
 * like they were answering.
 *
 * **This hook still needs no `resolved` of its own, and that is now an argued position rather
 * than an assumed one.** `readUnitSystem` degrades an absent row to metric deliberately: metric
 * is a CONVENTION standing in for a preference nobody has expressed, so a caller has nothing to
 * do differently while it waits and no false sentence to say, and the screens a late answer
 * could mislabel already reseed on the value itself changing (`SeedState.units`,
 * DiveFormScreen.tsx; `PresetDraft.units`, GearPresetScreen.tsx). `useDivesBefore` looks like
 * the same case and is not — its own `resolved` field says why, and the difference is that its
 * stand-in `0` displaces a number the DIVER entered rather than a convention.
 *
 * **Screens call this; components take the answer as a prop.** Exactly the shape `scheme`
 * already has in this codebase — `resolveScheme(useColorScheme())` at the top of each
 * screen, `scheme` threaded down through `DiveRow`/`DepthValue`/`FormField` — and for the
 * same two reasons: one place per screen decides, and every component below stays a pure
 * function of its props that a test can render in either system without a database.
 */
export function useUnitSystem(): UnitSystem {
  const rows = useLiveQuery(unitSystemQuery(db));
  return readUnitSystem(rows.data);
}
