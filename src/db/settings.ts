import { eq } from 'drizzle-orm';
import { isDiveCount } from '../domain/diveNumber';
import { DEFAULT_UNIT_SYSTEM, isUnitSystem, type UnitSystem } from '../format/units';
import { settings } from './schema';
import type { Db } from './types';

/**
 * Local-only key/value settings (DESIGN.md §6). The table is deliberately
 * `text`/`text`, so every value comes back a string and every read has to
 * decide what that string means. Typed accessors live here so no caller ever
 * holds the raw one.
 *
 * That is not a stylistic preference. `dives_before` is the diver's pre-Ponor
 * dive count and it offsets *every dive number in the app* (§2.5). Handed
 * straight to `assignDiveNumbers`, the string `'247'` is silently rejected by
 * that function's own hardening guard — `Number.isInteger('247')` is false —
 * and falls back to 0, so a diver with 247 prior dives sees dive #1 instead of
 * #248, with no error, no warning and no failing test. The guard is right (a
 * raw string would otherwise turn every number into `'24701'` via `+`); it
 * just turns the most likely real mistake into silence. Reproduced against a
 * real database before this file existed: raw → 1, `Number(value)` → 248.
 *
 * So the coercion happens here, once, at the boundary where the string is
 * born — and a value that cannot be interpreted throws rather than quietly
 * becoming zero.
 */
const DIVES_BEFORE_KEY = 'dives_before';

/**
 * The `dives_before` row as a builder, for `useLiveQuery`. `getDivesBefore`
 * remains the one place that *rejects* a stored value it cannot read; this
 * only fetches the row.
 */
export function divesBeforeQuery(db: Db) {
  return db.select().from(settings).where(eq(settings.key, DIVES_BEFORE_KEY));
}

/**
 * The column's text, coerced toward a number wherever it plausibly could be
 * one. Never throws and never applies any policy about what counts as a
 * *valid* dive count (negative, fractional, ...) — that judgment belongs to
 * `isDiveCount` alone.
 *
 * Decimal digits only, checked before coercing. `Number` is far more
 * permissive than "an integer written out": Number('') is 0, and
 * Number('0x10') is 16, Number('1e3') is 1000, Number('0b101') is 5 and
 * Number('+5') is 5 — every one of which passes an isInteger check
 * afterwards, so a hand-edited or corrupted '0x10' would silently become a
 * pre-Ponor count of 16. Nothing the app writes can take those forms
 * (setDivesBefore writes String(count)), which is exactly why anything that
 * does is corruption and must come back NaN rather than a plausible-looking
 * wrong number.
 *
 * Shared by `getDivesBefore` (which turns a NaN/negative/fractional result
 * into a thrown error), `readDivesBefore` (which leaves it for `isDiveCount`
 * to reject during a render) and the Settings screen (which leaves it for
 * `isDiveCount` too, and declines to write anything the diver has half-typed)
 * — one copy of the coercion rule for all three, rather than a second
 * hand-written regex behind the one `getDivesBefore` already had.
 *
 * **Exported for that third caller, and the reasoning above is why it may be
 * shared rather than re-derived.** A number typed into Settings and a number
 * read back out of this column are the same question asked at two moments:
 * both are text that either spells a dive count or does not. Web makes that
 * concrete — `number-pad` restricts a phone keyboard but a browser `<input>`
 * takes anything at all, so "0x10" is genuinely typeable there, and it must
 * come back NaN in a text field for exactly the reason it must come back NaN
 * out of the database. What each caller then DOES with a NaN still differs,
 * which is the split `isDiveCount`'s own docblock draws between owning a
 * predicate and owning an action.
 */
export function parseDiveCount(value: string): number {
  const raw = value.trim();
  return /^\d+$/.test(raw) ? Number(raw) : NaN;
}

/**
 * The diver's pre-Ponor dive count, as a real number.
 *
 * Absent means 0 — a diver who has never answered the onboarding question has
 * no prior dives, which is a genuine answer rather than a missing one. A
 * *present but uninterpretable* value is different: it means the stored count
 * has been corrupted or hand-edited, and returning 0 for it would misnumber
 * every dive in the logbook by the diver's entire history without saying so.
 * This throws instead, following the same "nothing may silently do nothing"
 * rule `updateDive` and `softDeleteDive` already apply to a missing row.
 */
export async function getDivesBefore(db: Db): Promise<number> {
  const rows = await divesBeforeQuery(db);
  const row = rows.at(0);
  if (row === undefined) return 0;

  const parsed = parseDiveCount(row.value);
  if (!isDiveCount(parsed)) {
    throw new Error(
      `settings.${DIVES_BEFORE_KEY} is not a non-negative integer: ${JSON.stringify(row.value)}`,
    );
  }
  return parsed;
}

/**
 * The raw `dives_before` value out of `divesBeforeQuery`'s rows: `null` when
 * the row is absent or unreadable, otherwise the stored text coerced toward
 * a number the same way `getDivesBefore` is (see `parseDiveCount`).
 *
 * "Coerced" and "interpreted" are deliberately different steps. This only
 * turns the column's *text* representation into a candidate number — it does
 * not decide whether that candidate is an acceptable count, which is
 * `isDiveCount`'s job alone. Skipping this step and handing the raw string
 * straight to `isDiveCount` would make it reject every real stored value:
 * `isDiveCount` requires `typeof value === 'number'`, and the `settings`
 * table is `text`/`text`, so a genuinely-valid `'247'` would silently read as
 * "no offset" on every render — the exact bug `getDivesBefore`'s own
 * doc-comment describes, reappearing one function over. Never throws,
 * because a hook composing this during a render must degrade a corrupt row,
 * not crash the screen.
 *
 * `rows` is `unknown[]`, not `divesBeforeQuery`'s real return type, because
 * `useLiveQuery`'s `.data` is typed that loosely — see `useDives`.
 */
export function readDivesBefore(rows: unknown[]): unknown {
  const row = Array.isArray(rows) ? rows.at(0) : undefined;
  const value =
    row !== null && typeof row === 'object' ? (row as { value?: unknown }).value : undefined;
  return typeof value === 'string' ? parseDiveCount(value) : null;
}

/**
 * Records the diver's pre-Ponor dive count.
 *
 * Rejects anything that is not a non-negative integer, so the unreadable-value
 * path in `getDivesBefore` stays unreachable through the app's own writes.
 * §1's "never block a save" is about the diver's dives; this is a settings
 * value whose only legal shape is a count, and storing a fractional or
 * negative one would produce dive numbers that cannot exist.
 */
export async function setDivesBefore(db: Db, count: number): Promise<void> {
  if (!isDiveCount(count)) {
    throw new Error(`setDivesBefore: expected a non-negative integer, got ${String(count)}`);
  }
  const value = String(count);
  await db
    .insert(settings)
    .values({ key: DIVES_BEFORE_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

/**
 * The diver's chosen unit system (DESIGN.md §3: m/ft · bar/psi · °C/°F · kg/lb), the
 * second key this local-only table holds — and named here, once, so the Settings screen
 * that will write it and the hook that reads it cannot spell it two ways. `settings`'s own
 * column comment already listed "units" as one of its intended keys; this is that key.
 */
const UNITS_KEY = 'units';

/**
 * The `units` row as a builder, for `useLiveQuery` — the same shape `divesBeforeQuery`
 * above takes, and for the same reason: a live query needs the builder, not the awaited
 * rows, so that changing the preference re-renders every screen showing a figure.
 */
export function unitSystemQuery(db: Db) {
  return db.select().from(settings).where(eq(settings.key, UNITS_KEY));
}

/**
 * The unit system out of `unitSystemQuery`'s rows: the stored value when it names one this
 * build knows, and `DEFAULT_UNIT_SYSTEM` (metric) otherwise — an absent row, an
 * uninterpretable one, or a system a future build offers and this one does not.
 *
 * **It never throws and never reports a failure, where `getDivesBefore` does both**, and
 * the asymmetry is deliberate. A wrong `dives_before` misnumbers the whole logbook with
 * nothing on screen to give it away, which is why that read refuses a value it cannot
 * interpret. A unit system that failed to load is not that kind of lie: every figure the
 * app prints carries its own unit word beside it (`format/units.ts`'s `displayFigure`), so
 * a diver who should be seeing feet sees `24.6 m` — the right number under the right
 * label, merely not the one they asked for — and a switch in Settings fixes it. Degrading
 * silently to a self-labelling default is the honest behaviour here; a banner over the
 * logbook would not be.
 *
 * `rows` is `unknown[]`, not this query's real return type, because `useLiveQuery`'s
 * `.data` is typed that loosely — the same reason `readDivesBefore` above takes it.
 */
export function readUnitSystem(rows: unknown[]): UnitSystem {
  const row = Array.isArray(rows) ? rows.at(0) : undefined;
  const value =
    row !== null && typeof row === 'object' ? (row as { value?: unknown }).value : undefined;
  return isUnitSystem(value) ? value : DEFAULT_UNIT_SYSTEM;
}

/**
 * Records the diver's unit system. Written for the Settings screen (§3), which is the only
 * thing that ever changes it — the value has no other producer, and putting the key and
 * the upsert here rather than in that screen is what keeps `readUnitSystem` above the only
 * reader of a string only this function writes.
 *
 * Takes a `UnitSystem`, so there is nothing to validate: an unknown value cannot be
 * constructed to pass in. `setDivesBefore` has to check because a `number` can be
 * fractional or negative; a two-member union cannot be either.
 */
export async function setUnitSystem(db: Db, system: UnitSystem): Promise<void> {
  await db
    .insert(settings)
    .values({ key: UNITS_KEY, value: system })
    .onConflictDoUpdate({ target: settings.key, set: { value: system } });
}
