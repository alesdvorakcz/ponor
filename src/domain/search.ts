import { type Dive } from './types';

/**
 * The fields `searchDives` matches against, and no others. DESIGN.md §3
 * calls this "search", not a filter: it covers the free text a diver might
 * recall a dive by — site, centre, buddy, guide, title, notes — and
 * deliberately skips numeric/enum fields (depth, water body, rating, ...),
 * which belong to a filter, not a search box.
 *
 * Every field named here is `string | null` on `Dive` (§6). Picking exactly
 * these keys, rather than typing this as `(keyof Dive)[]`, is what makes
 * adding a non-string field to this list a compile error instead of a
 * runtime crash the first time `value.toLowerCase()` below hits it.
 */
const SEARCHABLE_FIELDS: readonly (keyof Pick<
  Dive,
  'siteName' | 'centerName' | 'buddy' | 'guide' | 'title' | 'notes'
>)[] = ['siteName', 'centerName', 'buddy', 'guide', 'title', 'notes'];

/**
 * DESIGN.md §3: the Dives list has search. Pure filtering over an
 * already-loaded, in-memory list — a personal logbook is small enough that
 * there is no reason to push this into SQL, and staying in memory means it
 * composes for free with `groupIntoTrips`, which expects the same plain
 * `Dive[]` shape.
 *
 * `query` is trimmed first; an empty or whitespace-only query returns
 * `dives` itself, unfiltered — search is treated as inactive, not as a
 * needle that happens to be a substring of every string.
 *
 * A dive matches when the trimmed, lowercased query is a substring of any of
 * `SEARCHABLE_FIELDS`, compared with `toLowerCase()` rather than
 * `toLocaleLowerCase()` — matching must not depend on the viewing device's
 * OS locale, which is independent of the app's content languages (English
 * and Czech). Czech diacritics fold identically under both functions, so
 * nothing is lost by avoiding the locale-sensitive form.
 *
 * All six searchable fields are nullable, and `null` is skipped rather than
 * coerced to a string: `String(null)` is `"null"`, which would make an
 * otherwise-empty dive match a search for "ull" — the kind of bug that looks
 * like magic when a diver reports it. Skipping `null` is also what keeps
 * this from throwing on a dive whose fields are all `null`; it simply
 * matches nothing.
 *
 * Filters only — never sorts or groups — so the result is `dives` in its
 * original order, and a caller composing this with `groupIntoTrips` needs no
 * special-casing on either side.
 */
export function searchDives(dives: Dive[], query: string): Dive[] {
  const trimmed = query.trim();
  if (trimmed === '') return dives;

  const needle = trimmed.toLowerCase();
  return dives.filter((d) =>
    SEARCHABLE_FIELDS.some((field) => {
      const value = d[field];
      return value !== null && value.toLowerCase().includes(needle);
    }),
  );
}
