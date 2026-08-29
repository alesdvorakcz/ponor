import { normaliseCalendarDate, normaliseTimeOfDay } from './datetime';
import type { Dive } from './types';

/** The only fields numbering depends on. */
export type DiveOrdering = Pick<
  Dive,
  'id' | 'status' | 'date' | 'timeIn' | 'manualOrder' | 'createdAt'
>;

/**
 * Coerces an ordering field to a string safe to compare with `<`, such that
 * two *different* values never collapse onto the same comparable
 * representation. An earlier version fell back to `''` for anything not
 * already a string, which gets this backwards: two distinct non-string
 * values both became `''`, so relational `<` was false in both directions
 * (each side converts toward NaN), which made a `x !== y ? x < y ? -1 : 1`
 * tiebreak return the same sign for both (a, b) and (b, a) — not a valid
 * comparator (it isn't antisymmetric), and the sort result depended on which
 * order values happened to get compared in, not on the data. That's safe
 * only when a strictly lower tier still breaks the tie — it isn't safe at
 * the `id` tier, the last one, where two distinct non-string ids colliding
 * on `''` is the whole bug again. `String(value)` keeps distinct values
 * distinct at every tier instead. Real strings pass through unchanged, so
 * this changes nothing for well-formed input.
 *
 * Symbols get their own branch. `String(aSymbol)` is actually safe — verified
 * by execution, not assumed: it's a documented special case of the `String`
 * function, unlike implicit coercion (a template literal or `aSymbol + ''`),
 * which really does throw — but nothing here should depend on which
 * coercion form is used, so the symbol case is made explicit rather than
 * resting on that carve-out.
 */
function toComparable(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'symbol') return value.toString();
  return String(value);
}

/**
 * True only for an actual finite number: false for null, undefined, NaN,
 * Infinity, and any other type (string, object, ...) alike, so every corrupt
 * shape a stored `manualOrder` could take collapses to one "not usable" case
 * rather than each behaving differently. `Number.isFinite` never coerces,
 * unlike the global `isFinite`, so a numeric-looking string is correctly
 * rejected too, and it never throws regardless of what `value` holds.
 */
function isUsableManualOrder(value: unknown): value is number {
  return Number.isFinite(value);
}

/**
 * Reduces a manualOrder value to a single number safe to compare with `<`:
 * the value itself when usable, `+Infinity` otherwise. `+Infinity` is a
 * real, self-equal number — unlike NaN, `Infinity === Infinity` is true —
 * so two unusable values compare equal by ordinary `<` without needing a
 * separate "is either side usable" branch, and any usable value sorts
 * before an unusable one, matching "a dive that has been ordered by hand
 * sorts before one that has not" (DESIGN.md §2.5). Using NaN or some other
 * non-self-equal sentinel here instead would reintroduce exactly the
 * antisymmetry failure `toComparable` above exists to avoid, with numbers
 * standing in for strings.
 */
function manualOrderKey(value: unknown): number {
  return isUsableManualOrder(value) ? value : Infinity;
}

/**
 * The storage half of the same field's rules, kept next to the ordering half
 * above so the two cannot drift.
 *
 * DESIGN.md §2.5 calls `manual_order` a nullable **integer**, and it needs to
 * be literally true rather than nearly true. SQLite's INTEGER is a type
 * *affinity*, not a constraint: it converts a REAL to INTEGER only when the
 * conversion is lossless, so `1.5` written through the repository reads back
 * as `1.5` with storage class `real` (verified against a real migrated
 * database — the earlier note that "the column is INTEGER so SQLite coerces"
 * is simply false). §6 says the same schema lives in Postgres, where an
 * `integer` column has no such laxity, so a fractional value would round or
 * error on its way through M2's `push_changes` — and under whole-row LWW that
 * means a diver's hand-ordering silently changing when it syncs.
 *
 * Rounds rather than rejects. §1 says logging is never blocked, and this is a
 * tie-break whose worst case is a cosmetically odd order, never a lost dive;
 * refusing the save would be a far worse trade than moving a value half a
 * place. A value that is not a real number at all cannot be rounded into one,
 * so it becomes null — which is not a discarded value but the truthful
 * reading of "this dive has no hand-set order", and exactly how
 * `manualOrderKey` above already treats it when sorting.
 *
 * Negative integers pass through untouched. They sort before 1, which is
 * coherent, and clamping them would invent a rule DESIGN.md does not state.
 */
export function storedManualOrder(value: unknown): number | null {
  return isUsableManualOrder(value) ? Math.round(value) : null;
}

/**
 * Dive numbers are position, not data — see DESIGN.md §2.5. Nothing is stored,
 * so backfilling an old dive renumbers every later dive for free, identically on
 * every device, with no sync writes at all.
 *
 * Ordering is date, then entry time, then hand-assigned order, then creation
 * order, then id. A dive with a recorded time sorts before one without on the
 * same day, on the assumption that the untimed dive is the one being added
 * after the fact; a dive the diver has placed by hand sorts before one they
 * haven't, on the same reasoning, one tier further down.
 *
 * Planned dives are absent from the result: they have no number until completed.
 *
 * Called during render, so nothing here may throw, and the result must be the
 * same regardless of input array order or which device computed it:
 *  - `dives` may not be an array, or may hold a null/undefined entry (a bad
 *    join, a partially-hydrated row) — either is treated as "no dive there"
 *    rather than dereferenced.
 *  - `divesBefore` comes from a settings field, not from this data, and may be
 *    anything a free-text or corrupt-storage value can be. Only a real
 *    non-negative integer is used as an offset; anything else falls back to 0
 *    instead of poisoning every dive number — NaN or ±Infinity propagate
 *    through the arithmetic, a negative or fractional value produces a dive
 *    number that can't exist, and a leftover string silently turns every
 *    number in the result into a concatenated string via `+`, breaking the
 *    `Map<string, number>` contract for whatever reads it next.
 *  - `date`, `timeIn`, `createdAt` and `id` are typed as strings (`timeIn`
 *    nullable), but a corrupt row can hand back something else. See
 *    `toComparable` for why that specifically threatens determinism, not just
 *    a wrong-but-stable order.
 *  - `manualOrder` is typed as a nullable number, but a corrupt row can hand
 *    back anything. See `manualOrderKey` for why an unusable value must map
 *    to a stable sentinel rather than being compared as-is.
 *  - `DiveOrdering` carries no `deletedAt`. A soft-deleted dive that reaches
 *    this function is numbered as if it were live and shifts every dive
 *    after it — filtering deleted rows out is the caller's job, before this
 *    function ever sees them, not something it can infer on its own.
 */
/**
 * The comparator `assignDiveNumbers` sorts by — date, then entry time, then
 * hand-assigned order, then creation order, then id, per DESIGN.md §2.5.
 *
 * Exported so any other place that needs live dives in the same order (a
 * dive list, notably) reuses these exact tiers instead of re-deriving them.
 * Before this export existed there were two independent implementations —
 * this sort and a hand-written SQL `ORDER BY` in `listDives` — and they had
 * already drifted: the SQL version was missing the `manualOrder` tier
 * entirely and got NULL placement backwards for `timeIn`. One implementation
 * cannot drift from itself.
 *
 * Takes raw `DiveOrdering` fields rather than pre-derived keys, so a caller
 * sorting `Dive` rows straight from the database — a wider type that
 * structurally satisfies `DiveOrdering` — can pass them in unchanged.
 */
export function compareDiveOrder(a: DiveOrdering, b: DiveOrdering): number {
  // Both string tiers below compare *normalised* values, from the one module
  // that owns what these strings look like (datetime.ts). Comparing the raw
  // strings is what let '2026-8-17' sort after '2026-08-18' and '7:30' after
  // '19:00': lexicographic order on an unpadded field is not chronological
  // order. Falling back to toComparable keeps a value datetime.ts cannot read
  // at all — a genuinely corrupt date — sorting where the diver typed it,
  // deterministically, rather than collapsing every unreadable date into one
  // bucket at the top tier.
  const aDate = normaliseCalendarDate(a.date) ?? toComparable(a.date);
  const bDate = normaliseCalendarDate(b.date) ?? toComparable(b.date);
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;

  // null, undefined, '' and anything else that names no real time all mean
  // "no time" and must tie with each other rather than one of them slipping
  // into the string compare below — this used to test only `=== null`, so an
  // undefined timeIn compared as toComparable('') = '', sorting *before*
  // every real time instead of after, unlike a null one. Collapsing distinct
  // unreadable values into one bucket is safe at this tier, unlike at the id
  // tier, because manualOrder, createdAt and id still break the tie beneath
  // it — see toComparable for why that distinction matters.
  const aTime = normaliseTimeOfDay(a.timeIn);
  const bTime = normaliseTimeOfDay(b.timeIn);
  if ((aTime === null) !== (bTime === null)) return aTime === null ? 1 : -1;
  if (aTime !== null && bTime !== null && aTime !== bTime) return aTime < bTime ? -1 : 1;

  // Hand order is the tier between timeIn and createdAt: a dive placed
  // by hand sorts before one that wasn't, on the same "the diver did
  // this on purpose" reasoning as timed-before-untimed just above. See
  // `manualOrderKey` for why reducing both sides to a number first,
  // rather than comparing `a.manualOrder`/`b.manualOrder` directly,
  // matters here.
  const aOrder = manualOrderKey(a.manualOrder);
  const bOrder = manualOrderKey(b.manualOrder);
  if (aOrder !== bOrder) return aOrder < bOrder ? -1 : 1;

  const aCreated = toComparable(a.createdAt);
  const bCreated = toComparable(b.createdAt);
  if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;

  // Returning 0 for a genuine tie is not cosmetic. Without it this comparator
  // is not a valid one: cmp(x, x) was 1, so it violated reflexivity on all 240
  // rows of a swept field grid and antisymmetry on 1008 pairs. Array.sort with
  // an inconsistent comparator is implementation-defined, and the app runs on
  // Hermes, not the V8 the tests run on — so "it happens to be stable today"
  // is not evidence that transfers. Tied pairs really do reach the sort:
  // assignDiveNumbers deliberately tolerates repeated ids (overlapping
  // paginated pages, a pre-dedupe import) and dedupes *after* sorting.
  const aId = toComparable(a.id);
  const bId = toComparable(b.id);
  if (aId === bId) return 0;
  return aId < bId ? -1 : 1;
}

export function assignDiveNumbers(
  dives: DiveOrdering[],
  divesBefore: number,
): Map<string, number> {
  if (!Array.isArray(dives)) return new Map();
  const offset = Number.isInteger(divesBefore) && divesBefore >= 0 ? divesBefore : 0;

  const logged = dives.filter((d) => d && d.status === 'logged').sort(compareDiveOrder);

  // A repeated id is a data-integrity bug — id is the primary key — but it IS
  // reachable from here: a paginated dive list that concatenates overlapping
  // pages (the routine infinite-scroll pattern), or a pre-dedupe import.
  // Letting a repeat consume a number leaves that number unassigned to
  // anything and shifts every later dive down by one, which corrupts the
  // numbering of dives that have nothing to do with the duplicate. Skip it
  // instead, so the result matches what numbering the same dives without the
  // repeat would produce.
  const seenIds = new Set<string>();
  const deduped = logged.filter((d) => {
    if (seenIds.has(d.id)) return false;
    seenIds.add(d.id);
    return true;
  });

  const numbers = new Map<string, number>();
  deduped.forEach((d, index) => numbers.set(d.id, offset + index + 1));
  return numbers;
}
