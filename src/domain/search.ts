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
 * How text is read before it is matched — the query and the value alike, and the one
 * owner of that rule (§4.1).
 *
 * Trimmed, then lowercased with `toLowerCase()` rather than `toLocaleLowerCase()`:
 * matching must not depend on the viewing device's OS locale, which is independent of
 * the app's content languages (English and Czech). Czech diacritics fold identically
 * under both functions, so nothing is lost by avoiding the locale-sensitive form.
 *
 * **Both sides go through it**, which is what makes this a rule rather than a
 * convenience: a query folded one way and a value folded another is a matcher that
 * disagrees with itself. Trimming the value changes no `includes` result — a needle
 * cannot carry the outer whitespace a trim would remove, because it was trimmed too —
 * so this is exactly the same search it was before the fold was extracted.
 *
 * `domain/suggest.ts` reads the same function for autocomplete (§2.3), deliberately
 * rather than writing the same two calls out again. They answer different questions —
 * `searchDives` below asks which DIVES match, `suggestFrom` asks which VALUES of one
 * field to offer — but what a typed string *means* before either of them compares
 * anything is one question, and M2 has a change queued for it: §10 puts diacritic
 * folding (so `zelezna` finds `Železná`) in M2 alongside `pg_trgm`. Written twice, that
 * change lands in one place and quietly leaves the other behind.
 *
 * **Its deliberate near-duplicate is `presetNameKey` (domain/presets.ts)**, which is the same
 * expression and must not be merged with it (§4.1: "a deliberate near-duplicate names its
 * siblings"). That one is an *identity key* — whether two presets are the same preset — and it
 * must never move. This one is a *match fold*, and §10 has it moving in M2. The commit that
 * adds diacritic folding here belongs here alone: doing it to preset names as well would make
 * `Zelezna` and `Železná` one preset, silently colliding a rename with a name spelled
 * differently.
 */
export function foldForMatching(text: string): string {
  return text.trim().toLowerCase();
}

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
 * A dive matches when the folded query is a substring of any of
 * `SEARCHABLE_FIELDS`, both sides read through `foldForMatching` above — see
 * it for why the fold is `toLowerCase()` and why it is one function rather
 * than a pair of calls repeated per matcher.
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
  const needle = foldForMatching(query);
  if (needle === '') return dives;

  return dives.filter((d) =>
    SEARCHABLE_FIELDS.some((field) => {
      const value = d[field];
      return value !== null && foldForMatching(value).includes(needle);
    }),
  );
}
