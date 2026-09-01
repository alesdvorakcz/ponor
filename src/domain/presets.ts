import { withoutPressures } from './carryOver';
import { isRecordedTank } from './diveFormSchema';
import type { GearPreset, Tank } from './types';

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
 *
 * **A deliberate near-duplicate, and this is the note §4.1 asks for.** `foldForMatching`
 * (domain/search.ts) is character-for-character the same expression — `trim().toLowerCase()`
 * — and unifying the two would be a bug rather than a tidy-up, because they answer different
 * questions. That one folds text **for matching**: it decides whether a query finds a dive
 * and whether an autocomplete row is offered, and §10 has a change queued for it, since M2
 * adds diacritic folding so `zelezna` finds `Železná`. This one is an **identity key**: it
 * decides whether two presets are the same preset, and it must never move — the day
 * `foldForMatching` folds diacritics, `Zelezna` and `Železná` become one match and must still
 * be two presets, or a diver's rename would silently collide with a preset spelled
 * differently. Same three characters today, opposite obligations about tomorrow. See
 * `diveSiteLabel`/`tripKeyOf`/`rowLabel` for the same pattern stated three ways.
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

/**
 * **The three things that stop a preset being saved, and the one place that decides them.**
 *
 * They arrived as literals on two screens — the dive form's *Save as preset* and §3's editor —
 * and two of the three were byte-identical copies, one of them a copied message *formatter*.
 * §4.1's "one deliberate exception, until i18next" is scoped to **field labels** (DESIGN.md:
 * "roughly twenty-five field labels are duplicated as literals"), and a sentence stating a
 * rule's verdict is not a field label: the two copies were one edit from disagreeing about
 * what the same refusal says.
 *
 * Here, beside `presetNamed`, because this is where the identity half already lives — §4.1's
 * owner table names this module as owning "preset ordering, preset name identity, and **what
 * refuses a preset save**". The empty-cylinder half joins the other two for the same reason:
 * an invariant defended in two places is defended twice and agreed once.
 *
 * **What the invariant is, and what it deliberately is not.** A preset with nothing in it is a
 * chip that blanks a diver's cylinder block, which is worse than no chip at all — so the app
 * will not let a diver *author* one, in the form or in the editor. That is not the same claim
 * as "such a row cannot exist": `createGearPreset` stores whatever it is handed and M2's
 * `pull_changes` writes rows this client never composed, so one can arrive, and everything
 * that reads a preset already tolerates it (§3's list omits the summary rather than drawing a
 * dash, and the dive form's apply blanks the block rather than throwing). Tolerating what
 * arrives and refusing what a diver is offered to make are different questions; this answers
 * only the second.
 *
 * §1's "never block a save" is about a **dive** and does not reach here — the same line
 * `presetNamed` above already draws for the duplicate refusal.
 */
export const UNNAMED_PRESET_MESSAGE = 'Give this preset a name, so you can find it again.';
/** One sentence for both screens, deliberately. The two started as different wordings — the
 * form's "fill some in first", the editor's "add one, or delete this preset" — and the second
 * named a way out the form does not have. Same verdict, same words; the editor's *Delete
 * preset* control is visible on its own screen and does not need the sentence to point at it. */
export const EMPTY_PRESET_MESSAGE =
  'A preset with no cylinders fills nothing in — fill the cylinder fields first.';
/** Quotes the spelling the EXISTING preset has, never the one the diver just typed: sending
 * them to look for a chip that says no such thing would be its own small lie. */
export const duplicatePresetMessage = (name: string) => `You already have a preset called “${name}”.`;

/**
 * **What the app says when a preset write or read fails**, for the two screens that each say
 * it about the same object.
 *
 * These are not rule verdicts like the three above — they are what a screen shows when the
 * repository rejects or the live read comes back empty-handed — so the question of where they
 * belong is not settled by §4.1's owner table but by whether they are duplicated. They were:
 * both sentences existed **byte-identically** on two screens (`GearPresetScreen` and, in turn,
 * `DiveFormScreen`'s capture and Settings' preset list), one edit from disagreeing about the
 * same event.
 *
 * **Where the line falls, since this milestone has now moved it twice.** A failure sentence
 * belongs to the screen that says it, and the app's existing ones prove why they may look
 * alike without being copies: Settings' `SAVE_FAILED`, the dive form's `SAVE_ERROR_MESSAGE`
 * and the dive detail's `DELETE_ERROR_MESSAGE` all differ, because each names a different
 * object. A single implementation is already one owner and needs no module. These two are
 * different: two screens naming the SAME object arrive at the same words, and at that point
 * there is a rule to own. `GearPresetScreen`'s "Couldn't delete that preset" stays where it
 * is for exactly that reason — it has no twin.
 *
 * §10: "A local save failure is shown to the diver." A preset that silently failed to save is
 * one the diver goes looking for on the next dive and does not find; a read that failed is not
 * the same event as having none, which is what `useGearPresets`' `error` field exists to tell
 * apart.
 */
export const PRESET_SAVE_FAILED = "Couldn't save that preset. Try again.";
export const PRESETS_UNREADABLE = "Couldn't load your presets. Try again.";

export interface PresetRefusal {
  /** The name as it will be stored — trimmed here, so the string that was judged is the string
   * that gets written. Both writers used to trim separately, which is one `trim()` away from a
   * preset stored under a name the duplicate check never saw. */
  storedName: string;
  /** What to say about the name, or `null`. */
  name: string | null;
  /** What to say about the cylinders, or `null`. */
  cylinders: string | null;
  /** Whether anything at all refuses the save — derived here rather than recomputed by each
   * caller (§4.1's "derive, or tie at compile time"). */
  refused: boolean;
}

/**
 * Everything wrong with a preset a diver is trying to save, both halves at once.
 *
 * **Two fields rather than one message, because the two screens that ask differ in where they
 * can say it, not in what is wrong.** The dive form's capture has a single `FieldNote` under
 * its one row, so it shows the cylinder sentence first ("with nothing to store, what the
 * preset is called is not the diver's problem yet"); §3's editor has the name and the cylinders
 * as two places on screen, so it shows both and does not make a diver who broke both fix them
 * one at a time. That choice belongs to each screen; deciding *what is wrong* does not.
 *
 * **The pressures are stripped here, not by the caller.** A cylinder holding nothing but a
 * gauge reading looks completely full on a form and stores nothing at all — a preset keeps no
 * pressures (§10) — so the question has to be asked of the cylinders as they will BE, not as
 * they arrived. Leaving that to the caller made it a rule stated in a docblock and obeyed at
 * two call sites, which is the shape this function exists to end; `withoutPressures`
 * (domain/carryOver.ts) is the same owner both writers already call, so this is a second
 * caller of it and not a second copy. Idempotent, so a caller that has already stripped for
 * its own write loses nothing. `isRecordedTank` (domain/diveFormSchema.ts) is likewise the
 * existing predicate: what is new here is the verdict, not the check.
 *
 * `exceptId` is the preset being edited — see `presetNamed` above.
 */
export function presetRefusal(
  presets: readonly GearPreset[],
  name: string,
  tanks: readonly Tank[],
  exceptId?: string,
): PresetRefusal {
  const storedName = name.trim();
  const clash = storedName === '' ? null : presetNamed(presets, storedName, exceptId);
  const onName =
    storedName === '' ? UNNAMED_PRESET_MESSAGE : clash === null ? null : duplicatePresetMessage(clash.name);
  const onCylinders = tanks.map(withoutPressures).some(isRecordedTank) ? null : EMPTY_PRESET_MESSAGE;
  return {
    storedName,
    name: onName,
    cylinders: onCylinders,
    refused: onName !== null || onCylinders !== null,
  };
}
