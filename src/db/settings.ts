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
 * What the diver has decided about each of the dive form's collapsible groups (DESIGN.md §2.2:
 * "Groups remember themselves"), the third key this local-only table holds.
 *
 * **Display state, and local-only in the strong sense.** §6 gives this table no `updated_at`
 * and §7's sync protocol never mentions it: a diver's phone and their tablet are allowed to
 * disagree about which groups are open, and nothing about a dive depends on the answer.
 *
 * **One row holding the whole answer, not a row per group.** A key per group would put the
 * vocabulary of group names into the settings table's key space — where a group renamed in a
 * later build leaves an orphan row nothing will ever read or clean up — and would make one
 * gesture two writes. What the ids mean is the dive form's business.
 *
 * **Three states, not two, and that is M1i's correction rather than a change of format for its
 * own sake.** This started life as a set of open ids, which can say "open" and "not open" and
 * cannot tell *the diver closed this* from *nobody has ever touched it*. That was sound while
 * every group started closed — the two states were the same state — and became a defect the
 * moment §2.2 gave *Times & depth* and *Gas & cylinders* a starting state of OPEN: a diver who
 * collapsed one would find it open again on the next dive, because the row that was supposed to
 * remember the collapse looked exactly like a row that had never heard of the group. So the
 * value is a map from id to open/closed, and **an id that is absent is a group the diver has
 * never decided about** — which is the state the form's own defaults answer.
 *
 * The key keeps its old name. It is the row's identity: renaming it would silently discard
 * every diver's memory and leave the orphan row this docblock's own paragraph above warns about.
 */
const OPEN_FORM_GROUPS_KEY = 'form_groups_open';

/** The `form_groups_open` row as a builder, for `useLiveQuery` — the same shape the two
 * queries above take, and for the same reason. */
export function openFormGroupsQuery(db: Db) {
  return db.select().from(settings).where(eq(settings.key, OPEN_FORM_GROUPS_KEY));
}

/**
 * What the diver has decided about each group, out of `openFormGroupsQuery`'s rows: `true` for a
 * group they left open, `false` for one they collapsed, **and no entry at all for one they have
 * never touched** — which is the distinction this reader exists to preserve and the one an
 * absent row makes for every group at once.
 *
 * **It never throws and never reports a failure**, which puts it on `readUnitSystem`'s side of
 * the asymmetry that function documents rather than `getDivesBefore`'s. A wrong `dives_before`
 * misnumbers a whole logbook silently; a lost group memory means the diver taps a chevron. An
 * empty result is "nothing decided", so §2.2's own defaults are what an unreadable row degrades
 * to — not "every group closed", which is a decision, and which this reader must never invent on
 * a diver's behalf.
 *
 * **A stored array is read as the older build's memory and upgraded, not discarded.** Until M1i
 * the value was a list of the ids that were open, so `["gas"]` means *gas open, nothing else
 * decided* — every id in it `true`, and every group it does not name left for the defaults to
 * answer. That is the faithful reading: the old row could not express a collapse, so it must not
 * be read as containing one.
 *
 * **Unrecognised ids are kept, not dropped**, and that is the same "kept, not refused" policy
 * §10 records for option values and equipment tokens. A build that has never heard of a group
 * must not delete a newer build's memory of it merely by opening a form; this returns whatever
 * ids it finds and the form writes them back untouched. What it drops is anything that cannot be
 * a decision at all — a key whose value is not a boolean, an array member that is not a string —
 * since nothing could ever match one.
 *
 * `rows` is `unknown[]`, not this query's real return type, because `useLiveQuery`'s `.data` is
 * typed that loosely — the same reason the two readers above take it.
 */
export function readOpenFormGroups(rows: unknown[]): Record<string, boolean> {
  const row = Array.isArray(rows) ? rows.at(0) : undefined;
  const value =
    row !== null && typeof row === 'object' ? (row as { value?: unknown }).value : undefined;
  if (typeof value !== 'string') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // A row that is not JSON at all — corrupted, hand-edited, or written by something that is
    // not this app. Degrading to §2.2's defaults is the whole contract; there is nothing here
    // worth telling a diver about.
    return {};
  }
  const decided: Record<string, boolean> = {};
  // The M1h shape, upgraded per the paragraph above rather than thrown away: a list of ids, all
  // of them open. A duplicate (`["gas","gas"]` — only a hand-edited row or a future bug produces
  // one) sets the same key twice and means exactly what one entry means.
  if (Array.isArray(parsed)) {
    for (const id of parsed) if (typeof id === 'string') decided[id] = true;
    return decided;
  }
  if (parsed === null || typeof parsed !== 'object') return {};
  for (const [id, open] of Object.entries(parsed)) if (typeof open === 'boolean') decided[id] = open;
  return decided;
}

/**
 * Records what the diver has decided about each group — open, collapsed, or (by being absent
 * from the map handed in) still undecided.
 *
 * Takes the whole map rather than one group and a flag, so the row it writes is always the
 * complete answer. The alternative — a toggle that read, amended and wrote — would lose one of
 * two gestures made before the read came back, which on a form where a diver opens two groups
 * in a second is not a theoretical race.
 *
 * **Writing a `false` is the point of the map**, and the reason this no longer takes a list: an
 * id omitted and an id set to `false` mean different things to `readOpenFormGroups`, so a caller
 * that dropped a collapsed group instead of recording it would delete the very decision the
 * diver just made. The form hands over its whole memory with its toggles applied.
 *
 * Nothing validates the ids, deliberately, and it is the same line `setUnitSystem` above draws
 * from `setDivesBefore`: a dive count has exactly one legal shape and an illegal one produces
 * dive numbers that cannot exist, where an unrecognised group id costs nothing and may well be
 * a newer build's group that this one is faithfully writing back (`readOpenFormGroups`).
 */
export async function setOpenFormGroups(db: Db, groups: Readonly<Record<string, boolean>>): Promise<void> {
  const value = JSON.stringify({ ...groups });
  await db
    .insert(settings)
    .values({ key: OPEN_FORM_GROUPS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
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

/**
 * Forgets the pre-Ponor dive count — the **one** settings key §7.4's sign-out takes with it.
 *
 * §7.4: "`settings` **stays** — units, locale and the form-group memory are things this diver
 * set on this device and re-asking would be hostile — with `dives_before` the one exception,
 * because §6 syncs it to the profile and leaving it would hand the next account a wrong
 * pre-Ponor number that shifts every dive number after it."
 *
 * So this is a `where key = 'dives_before'` and never a `delete from settings`, and it lives
 * here because `DIVES_BEFORE_KEY` does: a sign-out that spelled the key itself would be the
 * second key/value path §4.1 names as this table's defining defect, and it would be spelled in
 * the one file that never reads it back.
 */
export async function forgetDivesBefore(db: Db): Promise<void> {
  await db.delete(settings).where(eq(settings.key, DIVES_BEFORE_KEY));
}
