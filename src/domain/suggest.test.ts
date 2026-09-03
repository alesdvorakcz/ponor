import { dive } from './diveFixture';
import { SUGGESTED_FIELDS, SUGGESTION_LIMIT, suggestFrom, type Suggestion } from './suggest';
import { type Dive } from './types';

/** Just the text, for the many assertions that are about ORDER rather than about ids. */
const valuesOf = (suggestions: Suggestion[]): string[] => suggestions.map((s) => s.value);

// The four fields DESIGN.md §2.3 names, checked by READING each one off its own column
// rather than by comparing the exported array against a copy of itself written here. A list
// asserted against its own duplicate passes whatever it holds; this fails if `siteName` ever
// starts reading `centerName`, or if a member names a `Dive` field that does not exist.
const ONE_OF_EACH: Record<(typeof SUGGESTED_FIELDS)[number], string> = {
  siteName: 'Anemone Reef',
  centerName: 'Anemone Divers',
  buddy: 'Anna',
  guide: 'Antonín',
};

it('reads each of §2.3\'s four fields off its own column', () => {
  const d = dive({ date: '2026-08-10', ...ONE_OF_EACH });
  for (const field of SUGGESTED_FIELDS) {
    expect(valuesOf(suggestFrom([d], field, 'an'))).toEqual([ONE_OF_EACH[field]]);
  }
});

// §2.3 names site, centre, buddy and guide — and deliberately not title or notes, which are
// prose rather than names a diver reuses. Stated here because the list is the module's whole
// public contract about WHAT autocompletes.
it('covers exactly the four fields, and not the prose ones', () => {
  expect([...SUGGESTED_FIELDS]).toHaveLength(4);
  expect([...SUGGESTED_FIELDS]).not.toContain('title');
  expect([...SUGGESTED_FIELDS]).not.toContain('notes');
});

// --- Ranking, tier by tier ---

// Tier (a). A value the query STARTS a word of is what the diver is typing toward; one that
// merely contains it is a weaker guess. Given a lower count on the prefix match, this fails
// for any implementation that ranks by usage first — which is what makes the tier order
// itself the thing under test rather than the ordering of one lucky pair.
it('ranks a value the query starts above one that merely contains it', () => {
  const dives = [
    dive({ date: '2026-08-01', siteName: 'Deep Blue' }),
    dive({ date: '2026-08-02', siteName: 'Deep Blue' }),
    dive({ date: '2026-08-03', siteName: 'Deep Blue' }),
    dive({ date: '2026-08-04', siteName: 'Blue Hole' }),
  ];
  expect(valuesOf(suggestFrom(dives, 'siteName', 'blue'))).toEqual(['Blue Hole', 'Deep Blue']);
});

// Tier (b), inside one tier of (a): both start with the query, so the only thing separating
// them is how often the diver has dived there. The commoner one is older, so a naive
// newest-first list would get this backwards.
it('ranks by how many dives carry a value, before recency', () => {
  const dives = [
    dive({ date: '2026-08-01', siteName: 'Blue Hole' }),
    dive({ date: '2026-08-02', siteName: 'Blue Hole' }),
    dive({ date: '2026-08-30', siteName: 'Blue Lagoon' }),
  ];
  expect(valuesOf(suggestFrom(dives, 'siteName', 'blue'))).toEqual(['Blue Hole', 'Blue Lagoon']);
});

// Tier (c). Equal on both tiers above, so the most recent dive's value comes first — the
// same "your last dive is the one you are probably still on" reasoning §2.1 gives carry-over.
it('breaks a tie by recency, most recent dive first', () => {
  const dives = [
    dive({ date: '2026-08-05', siteName: 'Silfra' }),
    dive({ date: '2026-08-25', siteName: 'Sipadan' }),
  ];
  expect(valuesOf(suggestFrom(dives, 'siteName', 's'))).toEqual(['Sipadan', 'Silfra']);
});

// The order of the ARRAY handed in must not decide the order of the result: `useDives()`
// hands its list back newest-first, `listDives` the same, and a caller composing a filtered
// view could hand back anything. Both orders of the same two dives, same answer.
it('does not depend on the order the dives arrive in', () => {
  const older = dive({ date: '2026-08-05', siteName: 'Silfra' });
  const newer = dive({ date: '2026-08-25', siteName: 'Sipadan' });
  expect(valuesOf(suggestFrom([older, newer], 'siteName', 's'))).toEqual(['Sipadan', 'Silfra']);
  expect(valuesOf(suggestFrom([newer, older], 'siteName', 's'))).toEqual(['Sipadan', 'Silfra']);
});

// --- The empty query is not "no suggestions" ---

// §2.1's "the app learns: pickers order options by your usage frequency", applied to a text
// field. A focused empty site field means the diver is CHANGING the site, which is the one
// moment they most want the list.
it('offers the most-used values for an empty query, most recent breaking the tie', () => {
  const dives = [
    dive({ date: '2026-08-01', siteName: 'Blue Hole' }),
    dive({ date: '2026-08-02', siteName: 'Blue Hole' }),
    dive({ date: '2026-08-03', siteName: 'Silfra' }),
    dive({ date: '2026-08-20', siteName: 'Sipadan' }),
  ];
  expect(valuesOf(suggestFrom(dives, 'siteName', ''))).toEqual(['Blue Hole', 'Sipadan', 'Silfra']);
});

// Whitespace is not a query. A field holding only spaces is an empty field, and treating it
// as a needle would match every value that happens to contain a space.
it('treats a whitespace-only query as an empty one', () => {
  const dives = [dive({ date: '2026-08-01', siteName: 'Blue Hole' })];
  expect(valuesOf(suggestFrom(dives, 'siteName', '   '))).toEqual(['Blue Hole']);
});

// --- Distinct values, and which spelling wins ---

it('folds two spellings into one suggestion, showing the most recent dive\'s', () => {
  const dives = [
    dive({ date: '2026-08-01', siteName: 'blue hole' }),
    dive({ date: '2026-08-20', siteName: 'Blue Hole' }),
  ];
  expect(valuesOf(suggestFrom(dives, 'siteName', 'blue'))).toEqual(['Blue Hole']);
});

// ...and both spellings still COUNT toward it. Without that, the folded value would drop
// below a rival with one dive of its own, and the site the diver visits most would sink.
it('counts every spelling of a folded value toward its usage', () => {
  const dives = [
    dive({ date: '2026-08-01', siteName: 'blue hole' }),
    dive({ date: '2026-08-02', siteName: 'Blue Hole' }),
    dive({ date: '2026-08-30', siteName: 'Blue Lagoon' }),
  ];
  expect(valuesOf(suggestFrom(dives, 'siteName', 'blue'))).toEqual(['Blue Hole', 'Blue Lagoon']);
});

// --- §10's diacritic fold, reaching autocomplete because it is one function (M2j) ---
//
// This is here rather than only in `search.test.ts` because it guards a DIFFERENT thing.
// `search.test.ts` proves `foldForMatching` folds accents; this proves `suggestFrom` still
// reads THAT function. Replace the two calls below with an inlined `trim().toLowerCase()` —
// the change §4.1's owner table exists to forbid, and the one that looks harmless — and every
// assertion in search.test.ts stays green while these go red.
it('offers a Czech name to a diver who typed it without the accents (§2.3, §10)', () => {
  const dives = [dive({ date: '2026-08-01', siteName: 'Železná' })];
  expect(valuesOf(suggestFrom(dives, 'siteName', 'zelezn'))).toEqual(['Železná']);
});

// **The other side of the same fold, and the reason it is a separate `it`.** The line above
// folds the stored VALUE; this one folds the QUERY, and the two are different calls in
// `suggestFrom`. Mutating only the query's — `foldForMatching(query)` back to
// `query.trim().toLowerCase()` — leaves the line above green, because a needle that was
// already unaccented never needed folding. Found by mutation, not by reading.
it('offers an unaccented name to a diver who typed the accents', () => {
  const dives = [dive({ date: '2026-08-01', siteName: 'Zelezna' })];
  expect(valuesOf(suggestFrom(dives, 'siteName', 'Železn'))).toEqual(['Zelezna']);
});

// --- What "the value the field already holds" means: the RAW spelling (§2.3, M2k) ---
//
// **A query that FOLDS to the whole stored value is still a query.** M2j suppressed this as
// "the value the field already holds", which the folded comparison made it look like; §2.3
// answers that a suggestion is offered when picking it would DO something, and picking this
// one does two things — it writes the catalogue's own spelling, and it sets the paired
// `site_id` (§6) that typing cleared on the first keystroke. The id is asserted rather than
// the text alone precisely because it is the half that has no row on screen.
//
// **The query is capitalised, and that is the whole point of the fixture.** `Zelezna` against
// `Železná` differs from the stored spelling by ACCENTS ALONE — the case matches — so this
// test fails on its own for a suppression that folds accents (and only that one), leaving the
// casing test below green. The pair is what makes the two independent rather than one test
// written twice; M2j's report is explicit that a fix covering one is half a change.
it('offers a name the diver typed without its accents, id and all (§2.3, §6)', () => {
  const dives = [dive({ date: '2026-08-01', siteName: 'Železná', siteId: 'site-zelezna' })];
  expect(suggestFrom(dives, 'siteName', 'Zelezna')).toEqual([{ value: 'Železná', id: 'site-zelezna' }]);
  // ...and in §2.3's own spelling of it, all lower case.
  expect(suggestFrom(dives, 'siteName', 'zelezna')).toEqual([{ value: 'Železná', id: 'site-zelezna' }]);
});

// **The casing half of the same one rule**, which has been suppressed since long before the
// fold existed and is the half M2j's report says a diacritics-only fix would leave behind.
// `blue hole` against `Blue Hole` differs by CASE ALONE, so a suppression that trims and
// lowercases — the shape this comparison had for its whole life — fails here while the accent
// test above stays green. Checked by mutation in both directions, not by reading.
it('offers a spelling that differs from the typed one only by case', () => {
  const dives = [dive({ date: '2026-08-01', siteName: 'Blue Hole', siteId: 'site-blue' })];
  expect(suggestFrom(dives, 'siteName', 'blue hole')).toEqual([{ value: 'Blue Hole', id: 'site-blue' }]);
});

// The other direction of the same rule, and the one that has a visible consequence: two
// spellings of one site are now ONE offer, so a diver who has typed it both ways is not
// asked to choose between two rows that read the same to them. The most recent spelling
// wins, exactly as it does for case.
it('treats an accented and an unaccented spelling as one value, newest spelling winning', () => {
  const dives = [
    dive({ date: '2026-08-01', siteName: 'Zelezna' }),
    dive({ date: '2026-08-20', siteName: 'Železná' }),
  ];
  expect(suggestFrom(dives, 'siteName', 'zel')).toEqual([{ value: 'Železná', id: null }]);
});

// The mirror direction, which is the same rule and not a second one: a diver who typed the
// accents is still offered their own past unaccented spelling, because picking it is still
// what sets the pair. Stated separately because the two sides are two different calls —
// `foldForMatching` runs over the stored value and over the query — and a suppression written
// against one of them would leave the other alone.
it('offers an unaccented past spelling to a diver who typed the whole name accented', () => {
  const dives = [dive({ date: '2026-08-01', siteName: 'Zelezna', siteId: 'site-zelezna' })];
  expect(suggestFrom(dives, 'siteName', 'Železná')).toEqual([{ value: 'Zelezna', id: 'site-zelezna' }]);
});

// --- The id/name pair (§6, and §10's own note on this task) ---

it('pairs a site suggestion with the id from the dive whose spelling won', () => {
  const dives = [
    dive({ date: '2026-08-01', siteName: 'blue hole', siteId: 'site-old' }),
    dive({ date: '2026-08-20', siteName: 'Blue Hole', siteId: 'site-new' }),
  ];
  expect(suggestFrom(dives, 'siteName', 'blue')).toEqual([{ value: 'Blue Hole', id: 'site-new' }]);
});

// The sharp end of "the pair is a snapshot of ONE dive's site". An implementation that took
// the name from the winning dive and then went looking for the first non-null id would pass
// every test above and fail this one — and it is exactly the mismatch that becomes wrong the
// day M2 starts filling ids in: one site's id stored under another site's name.
it('yields a null id when the winning dive has none, never an older dive\'s', () => {
  const dives = [
    dive({ date: '2026-08-01', siteName: 'Silfra', siteId: 'site-silfra' }),
    dive({ date: '2026-08-20', siteName: 'Silfra', siteId: null }),
  ];
  expect(suggestFrom(dives, 'siteName', 'sil')).toEqual([{ value: 'Silfra', id: null }]);
});

it('pairs a centre suggestion with its own id, not the site\'s', () => {
  const dives = [
    dive({ date: '2026-08-01', siteName: 'Blue Hole', siteId: 'site-blue', centerName: 'Aqua', centerId: 'centre-aqua' }),
  ];
  expect(suggestFrom(dives, 'centerName', 'aq')).toEqual([{ value: 'Aqua', id: 'centre-aqua' }]);
});

// §2.3: "Buddies and guides autocomplete from your own past entries only — they stay private
// text, not user accounts." There is no id to pair, so the field must never borrow one.
it('gives a buddy or guide a null id, whatever ids the dive carries', () => {
  const dives = [dive({ date: '2026-08-01', buddy: 'Petr', guide: 'Jana', siteId: 'site-blue', centerId: 'centre-aqua' })];
  expect(suggestFrom(dives, 'buddy', 'p')).toEqual([{ value: 'Petr', id: null }]);
  expect(suggestFrom(dives, 'guide', 'j')).toEqual([{ value: 'Jana', id: null }]);
});

// --- What is never a suggestion ---

// `String(null)` is `"null"` — the exact trap `domain/search.ts` documents, one module over:
// a coerced null would offer the word "null" as a site, and match a diver typing "ull".
it('skips a null value rather than coercing it to the word null', () => {
  const dives = [dive({ date: '2026-08-01', siteName: null })];
  expect(suggestFrom(dives, 'siteName', 'ull')).toEqual([]);
  expect(suggestFrom(dives, 'siteName', '')).toEqual([]);
});

it('skips a value that is nothing but whitespace', () => {
  const dives = [dive({ date: '2026-08-01', siteName: '   ' })];
  expect(suggestFrom(dives, 'siteName', '')).toEqual([]);
});

// §0.6-adjacent, and the reason this rule exists at all: a carried "Blue Hole" offering
// "Blue Hole" back is a row of nothing under a field that already says it. What survives M2k
// is exactly this — the EXACT text, and nothing that merely folds to it.
it('never offers back the exact text the field already holds', () => {
  // Dated so the recency tier below is not the thing under test: "Blue Hole" is the more
  // recent dive, so the later assertions' order is settled before the exclusion is.
  const dives = [
    dive({ date: '2026-08-02', siteName: 'Blue Hole' }),
    dive({ date: '2026-08-01', siteName: 'Blue Hole Deep' }),
  ];
  // This first assertion is also what holds the two sides of the comparison to the same
  // reading: compare the stored spelling against the FOLDED needle — one side folded and the
  // other not, the mistake M2j found twice elsewhere — and `Blue Hole` differs from
  // `blue hole`, so the held value is offered straight back.
  //
  // A trailing space is not a different spelling, and trimming is the one thing the raw
  // comparison still does: the stored side is trimmed, so this side is too.
  expect(valuesOf(suggestFrom(dives, 'siteName', '  Blue Hole  '))).toEqual(['Blue Hole Deep']);
  // ...and a genuine prefix of it is still a query, not a held value.
  expect(valuesOf(suggestFrom(dives, 'siteName', 'Blue'))).toEqual(['Blue Hole', 'Blue Hole Deep']);
  // Where the old rule reached and this one does not: a differently-cased spelling of the
  // held value is offered now, because picking it rewrites the field to the stored spelling
  // and sets the paired id.
  expect(valuesOf(suggestFrom(dives, 'siteName', 'BLUE HOLE'))).toEqual(['Blue Hole', 'Blue Hole Deep']);
});

// --- The limit ---

const manySites = (): Dive[] =>
  ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'].map((siteName, index) =>
    dive({ date: `2026-08-0${index + 1}`, siteName }),
  );

it('stops at the limit, defaulting to the named constant', () => {
  expect(suggestFrom(manySites(), 'siteName', '')).toHaveLength(SUGGESTION_LIMIT);
  expect(SUGGESTION_LIMIT).toBe(5);
});

it('takes a caller\'s own limit, keeping the top of the ranking', () => {
  const dives = [
    dive({ date: '2026-08-01', siteName: 'Silfra' }),
    dive({ date: '2026-08-02', siteName: 'Silfra' }),
    dive({ date: '2026-08-30', siteName: 'Sipadan' }),
  ];
  expect(valuesOf(suggestFrom(dives, 'siteName', 's', 1))).toEqual(['Silfra']);
});

// --- Called during render, over whatever the database handed back ---

// The same array `assignDiveNumbers` is handed, and that function tolerates a null entry
// (a bad join, a partially-hydrated row) rather than dereferencing it. This reads the same
// array in the same render, so a row it cannot read must cost the diver a suggestion, never
// the whole form.
it('survives a hole in the list rather than throwing during a render', () => {
  const dives = [null, dive({ date: '2026-08-01', siteName: 'Silfra' })] as unknown as Dive[];
  expect(valuesOf(suggestFrom(dives, 'siteName', 's'))).toEqual(['Silfra']);
});

// --- What an empty id means is not this module's question (§4.1) ---
//
// `carryOverFrom` copies `siteId` straight across, so a dive storing `''` carries `''` into
// the form. A suggestion for that same dive normalising it to `null` would be a second answer
// to one question, sitting one row beneath the first. The owner that does decide is
// `diveFormSchema.ts`'s `optionalText`, at the write boundary, where "empty means absent"
// covers the id, the name and every other text column together.
it('hands back the id the dive stores, verbatim, empty string and all', () => {
  const dives = [dive({ date: '2026-08-01', siteName: 'Silfra', siteId: '' })];
  expect(suggestFrom(dives, 'siteName', 'sil')).toEqual([{ value: 'Silfra', id: '' }]);
});

// The one thing that IS rejected, and it is a type guard rather than a rule about emptiness:
// `Suggestion.id` is typed `string | null`, this runs during render over whatever the
// database handed back, and a column holding a number would make that type a lie.
it('refuses an id that is not a string at all', () => {
  const dives = [dive({ date: '2026-08-01', siteName: 'Silfra', siteId: 42 as unknown as string })];
  expect(suggestFrom(dives, 'siteName', 'sil')).toEqual([{ value: 'Silfra', id: null }]);
});
