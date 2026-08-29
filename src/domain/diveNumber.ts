import type { Dive } from './types';

/** The only fields numbering depends on. */
export type DiveOrdering = Pick<Dive, 'id' | 'status' | 'date' | 'timeIn' | 'createdAt'>;

/**
 * Coerces an ordering field to a string safe to compare with `<`. A value that
 * isn't actually a string — missing entirely, or the wrong type — becomes '',
 * sorting lowest rather than corrupting the comparison: relational `<` between
 * a non-string and a string evaluates false in BOTH directions (each side
 * converts toward NaN), which makes a `x !== y ? x < y ? -1 : 1` tiebreak
 * return the same sign for both (a, b) and (b, a) — an asymmetric comparator
 * whose result depends on which order the sort happens to compare them in,
 * not on the data. Real strings pass through unchanged, so this changes
 * nothing for well-formed input.
 */
function toComparable(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
