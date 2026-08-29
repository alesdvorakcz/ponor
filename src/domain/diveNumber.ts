import type { Dive } from './types';

/** The only fields numbering depends on. */
export type DiveOrdering = Pick<Dive, 'id' | 'status' | 'date' | 'timeIn' | 'createdAt'>;

/**
 * Dive numbers are position, not data — see DESIGN.md §2.5. Nothing is stored,
 * so backfilling an old dive renumbers every later dive for free, identically on
 * every device, with no sync writes at all.
 *
 * Ordering is date, then entry time, then creation order. A dive with a recorded
 * time sorts before one without on the same day, on the assumption that the
 * untimed dive is the one being added after the fact.
 *
 * Planned dives are absent from the result: they have no number until completed.
 */
export function assignDiveNumbers(
  dives: DiveOrdering[],
  divesBefore: number,
): Map<string, number> {
  const logged = dives
    .filter((d) => d.status === 'logged')
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.timeIn !== b.timeIn) {
        if (a.timeIn === null) return 1;
        if (b.timeIn === null) return -1;
        return a.timeIn < b.timeIn ? -1 : 1;
      }
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

  const numbers = new Map<string, number>();
  logged.forEach((d, index) => numbers.set(d.id, divesBefore + index + 1));
  return numbers;
}
