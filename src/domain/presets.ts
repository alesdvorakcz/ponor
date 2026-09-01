import type { GearPreset } from './types';

/**
 * The rules a cylinder preset (DESIGN.md §2.1) obeys that are not about storing one: what
 * order presets are read in, and when two of them are the same preset by name.
 *
 * **Here rather than in `db/gearPresets.ts`, on this project's own precedent.** `db/` is the
 * repository layer; `compareDiveOrder` lives in `domain/diveNumber.ts` and `db/dives.ts`
 * imports it to sort inside `toDives`, which is exactly the shape below — `toGearPresets`
 * imports `comparePresets` from here. The rule that made it matter is `presetNamed`: it is
 * asked by SCREENS (the dive form now, §3's preset editor next), and a screen reaching into
 * the database layer for a pure comparison inverts the dependency for a function that never
 * touches a row.
 */

/**
 * The name two presets are the same preset by: trimmed, and case-folded.
 *
 * One normaliser for both questions that ask it — the order presets are listed in
 * (`comparePresets`) and whether a name is already taken (`presetNamed`) — because a list
 * that sorted "Alu 80" and "alu 80" apart while the duplicate check called them the same
 * would be two answers to one question. `toLowerCase`, not `toLocaleLowerCase`: this is an
 * identity key rather than something a diver reads, and a key that changed meaning with the
 * device's locale would make the same two presets duplicates on one phone and not on
 * another.
 */
function presetNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * **Presets sort by name, case-insensitively**, and that is a decision with two rejected
 * alternatives worth recording.
 *
 * *Most-recently-used* is the tempting one, and it is wrong twice over. It needs a column §6
 * does not have, so it would cost a second migration; and it would write on every *apply*,
 * which under §7's whole-row last-write-wins means the device that merely used a preset
 * beats the device that edited it. It is also worse where it is read: the row of chips at
 * the top of the form's cylinder group is a wet-thumb target (§0.5), and a row that
 * reorders itself after every tap moves the next preset out from under the finger that just
 * pressed one.
 *
 * *Creation order* is what the rows happen to come back in, so it is what a missing
 * comparator silently produces — which is the reason this is asserted directly rather than
 * only in passing. It puts the preset a diver made first at the top for ever, which is a
 * fact about the past rather than about what they are looking for.
 *
 * A name is what the diver reads the chip by, so a name is what they look for. `localeCompare`
 * rather than `<`, so a Czech diver's `Č` sorts where Czech puts it rather than after `Z`;
 * the device's own locale is the right one here precisely because this order is *displayed*
 * and never stored, so two devices disagreeing about it is not a conflict.
 *
 * `createdAt` breaks a tie, so a list holding two presets with the same name (which
 * `presetNamed` below exists to stop the app from creating, but M2 sync can still deliver
 * from another device) has one stable order rather than whichever the sort happened to
 * settle on.
 */
export function comparePresets(a: GearPreset, b: GearPreset): number {
  const byName = presetNameKey(a.name).localeCompare(presetNameKey(b.name));
  return byName !== 0 ? byName : a.createdAt.localeCompare(b.createdAt);
}

/**
 * The preset already called `name`, or `null` — the app's answer to "is this name taken".
 *
 * **A duplicate name is refused, and this is where that is decided.** Two chips both reading
 * "alu 80 nitrox", holding different cylinders, is a row the diver cannot tell apart and
 * cannot fix by looking; §1's "never block a save" is about a *dive*, and a preset the diver
 * is naming is the same kind of thing `setDivesBefore` already refuses an impossible value
 * for. So the form says so in muted text instead of writing it.
 *
 * A **pure function over a list the caller already holds**, rather than a query of its own,
 * and that is what makes it one rule rather than two. Both callers — the dive form's *Save
 * as preset* and §3's preset editor — are already rendering `useGearPresets()`'s live list,
 * so asking it here needs no second read, cannot race its own render, and gives the same
 * answer the diver is looking at. A check inside `createGearPreset` would need a query, would
 * race it, and would still leave the screen with nothing to *say*.
 *
 * `exceptId` is the preset being edited: renaming a preset to the name it already has is not
 * a collision with anything, and without this exception the editor would refuse every save
 * that did not change the name.
 */
export function presetNamed(
  presets: readonly GearPreset[],
  name: string,
  exceptId?: string,
): GearPreset | null {
  const key = presetNameKey(name);
  return presets.find((preset) => preset.id !== exceptId && presetNameKey(preset.name) === key) ?? null;
}
