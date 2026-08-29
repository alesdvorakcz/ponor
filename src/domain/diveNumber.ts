import type { Dive } from './types';

/** The only fields numbering depends on. */
export type DiveOrdering = Pick<Dive, 'id' | 'status' | 'date' | 'timeIn' | 'createdAt'>;

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
 * Dive numbers are position, not data — see DESIGN.md §2.5. Nothing is stored,
 * so backfilling an old dive renumbers every later dive for free, identically on
 * every device, with no sync writes at all.
 *
 * Ordering is date, then entry time, then creation order, then id. A dive with
 * a recorded time sorts before one without on the same day, on the assumption
 * that the untimed dive is the one being added after the fact.
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
 */
export function assignDiveNumbers(
  dives: DiveOrdering[],
  divesBefore: number,
): Map<string, number> {
  if (!Array.isArray(dives)) return new Map();
  const offset = Number.isInteger(divesBefore) && divesBefore >= 0 ? divesBefore : 0;

  const logged = dives
    .filter((d) => d && d.status === 'logged')
    .sort((a, b) => {
      const aDate = toComparable(a.date);
      const bDate = toComparable(b.date);
      if (aDate !== bDate) return aDate < bDate ? -1 : 1;

      if (a.timeIn !== b.timeIn) {
        if (a.timeIn === null) return 1;
        if (b.timeIn === null) return -1;
        const aTime = toComparable(a.timeIn);
        const bTime = toComparable(b.timeIn);
        if (aTime !== bTime) return aTime < bTime ? -1 : 1;
      }

      const aCreated = toComparable(a.createdAt);
      const bCreated = toComparable(b.createdAt);
      if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;

      const aId = toComparable(a.id);
      const bId = toComparable(b.id);
      return aId < bId ? -1 : 1;
    });

  const numbers = new Map<string, number>();
  logged.forEach((d, index) => numbers.set(d.id, offset + index + 1));
  return numbers;
}
