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
 * **Then the accents come off** (M2j), which is §10's queued rule — `zelezna` finds `Železná` —
 * and the reason it is queued rather than obvious: a Czech diver types on whatever keyboard is
 * in front of them, and *Divoká Šárka* typed as *Divoka Sarka* was two accents away from
 * matching nothing at all.
 *
 * `normalize('NFD')` splits every precomposed letter into a base and its combining marks, and
 * the marks are then dropped. **The range is `U+0300–U+036F` — Combining Diacritical Marks —
 * and not `\p{Mn}`, which is the wider set and the wrong one.** `\p{Mn}` would also strip
 * Arabic harakat and Indic vowel signs, where a mark is not an accent on a letter but part of
 * what the letter says; Postgres' `unaccent` leaves those alone, so the wider regex would
 * *manufacture* the disagreement between the two sides that this change exists to remove.
 * Normalising first is also what makes the fold indifferent to how the text arrived: an iOS
 * keyboard gives `Železná` precomposed and a paste from macOS gives it decomposed, and those
 * are two different strings until this line runs on both.
 *
 * **The two folds are not the same function, and the gap is recorded rather than papered over.**
 * `public.name_fold` (supabase/migrations/20260902090500_catalogue_rpcs.sql) is the server's
 * half, and it is Postgres' `unaccent` dictionary, which folds things this does not: `ø`→`o`,
 * `ß`→`ss`, `æ`→`ae`, `ł`→`l` have no canonical decomposition, so NFD leaves them exactly as
 * they were. They agree on Czech, which is what §10 asked for, and on every accented Latin-1
 * vowel. `search.test.ts` pins each known divergence by name — copying `unaccent`'s rule table
 * into JavaScript would be a second copy of a dictionary Postgres itself calls mutable, which
 * is why the gap is documented instead of closed.
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
 * anything is one question. That is not hypothetical any more: M2j added the diacritic
 * fold *here*, and both features got it in the same edit. Written twice, it would have
 * landed in one and quietly left the other behind.
 *
 * **Its deliberate near-duplicate is `presetNameKey` (domain/presets.ts)**, which was the same
 * expression until this line changed and must still not be merged with it (§4.1: "a deliberate
 * near-duplicate names its siblings"). That one is an *identity key* — whether two presets are
 * the same preset — and it must never move. This one is a *match fold*, and §10 had it moving
 * in M2. **They have now genuinely parted**, which is the whole reason the note was there:
 * folding preset names too would make `Zelezna` and `Železná` one preset, so a diver renaming
 * one would silently collide with a preset spelled differently. `presets.test.ts` holds that
 * apart by name.
 */
export function foldForMatching(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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

/**
 * **A catalogue directory, as a list** — every row the device holds that the query names, in the
 * order they are shown. §3's centres directory (M3c) and its sites directory (M3f) are both this
 * function; it was `browseCenters` while there was only one.
 *
 * **One function rather than two**, on `withPoints`' own reasoning (domain/mapSites.ts):
 * `dive_sites` and `dive_centers` are the same table under two names (file 2 of the migrations
 * gives them the same shape, §5 covers them in one sentence), and "which of these rows does this
 * query name, and in what order" has exactly one answer for both. A `browseSites` beside it would
 * not be a deliberate near-duplicate answering a different question — it would be the same
 * fifteen lines twice, which is the defect §4.1 opens with. It was already generic over the row
 * before the second caller existed; only the name and this paragraph changed.
 *
 * ── Its sibling above, and the two axes it differs on (§4.1 asks a near-duplicate to say) ──
 *
 * `searchDives` filters the diver's own logbook across six columns and **never sorts**, because
 * a logbook already has an order (§2.5) and a filtered logbook keeps it. This reads community
 * rows with one column worth matching, and it **does** order them: a directory has no order of
 * its own to preserve, so something has to choose one, and leaving it to whatever SQLite happened
 * to return would make the same list read differently on two devices.
 *
 * Both go through `foldForMatching`, on both sides, which is the point of that function having
 * one owner: `zelezna` finds `Železná` here for exactly the reason it does in the logbook and on
 * the server (§2.3, M2j), without this file deciding anything about accents.
 *
 * ── Alphabetical, and the rejected alternative ────────────────────────────────────────────
 *
 * By folded name, then by id so two rows spelled the same way cannot swap places between
 * renders. Folded rather than `localeCompare`d deliberately: this repo keeps comparisons off the
 * device's locale and ICU build wherever it can (`foldForMatching`'s own note on
 * `toLocaleLowerCase`), and folding puts `Železná` next to `Zelena` rather than after `Z…`
 * everything, which is where a Czech diver looks for it.
 *
 * **Rejected: the diver's own places first.** It is §2.1's "the app learns" and it is the wrong
 * rule here — this list's job is to let a diver *find* a shop or a rock, including one they have
 * never been to, and a list whose top changes as the logbook grows is one a diver cannot learn
 * the shape of. The dives they have at each row are on the row itself (`formatCenterRow`,
 * `formatSiteRow`), which is where that fact belongs.
 *
 * An empty query is the whole catalogue rather than nothing at all: this is a directory first
 * and a search second, which is the difference between it and `SearchScreen` (that one clears
 * its list on arrival, because the list it would otherwise show is the one the diver just left).
 *
 * A row it cannot read costs that row rather than the screen — the stance every list rule in
 * `domain/` takes, because this runs during render over whatever the database handed back.
 */
export function browseCatalogue<T extends { id: string; name: string | null }>(
  centers: readonly T[],
  query: string,
): T[] {
  const needle = foldForMatching(query);
  // **An empty query needs no branch of its own**: it folds to `''`, and every string contains
  // `''`, so the whole catalogue comes through by construction rather than by a condition. An
  // explicit `if (needle === '') return true` was written here first and measured — it could not
  // fail, which §10 declines. (`searchDives` above keeps its early return for a different
  // reason: it hands back the caller's own array, unfiltered, so a caller composing it with
  // `groupIntoTrips` gets the same reference.)
  const matching = centers.filter((center) => {
    if (center === null || center === undefined) return false;
    const name = typeof center.name === 'string' ? center.name : '';
    return foldForMatching(name).includes(needle);
  });

  return matching.sort((a, b) => {
    const left = foldForMatching(typeof a.name === 'string' ? a.name : '');
    const right = foldForMatching(typeof b.name === 'string' ? b.name : '');
    if (left !== right) return left < right ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
