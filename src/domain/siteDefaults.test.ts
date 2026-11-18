import { siteDefaultFills, siteDefaultValue, SITE_DEFAULT_FIELDS, type SiteDefaults } from './siteDefaults';
import { type Entry } from './types';

/**
 * DESIGN.md §2.1's site defaults, as the rule rather than as the screen that applies it:
 * *"picking a site prefills entry, salinity, and water body from the site's own defaults — and
 * those win over carry-over when you switch sites"*.
 *
 * What is here is the precedence and what a `null` column means. What the SCREEN does with the
 * answer — when it runs, which row it reads, and what happens to §0.6's marks — is
 * `DiveFormScreen.test.tsx`'s.
 */

/** A catalogue row's three columns, all silent unless a test says otherwise — which is the
 * ordinary state of `dive_sites` (§6: every column nullable, and the entry set empty) and the
 * state this rule has the most to say about. */
const says = (columns: Partial<SiteDefaults> = {}): SiteDefaults => ({
  entry: [],
  salinity: null,
  waterBody: null,
  ...columns,
});

const NOTHING_TYPED: ReadonlySet<string> = new Set<string>();

/** The answer as a plain object, for the assertions that are about values rather than about
 * provenance. */
const valuesOf = (fills: ReturnType<typeof siteDefaultFills>) =>
  Object.fromEntries(fills.map((fill) => [fill.field, fill.value]));

/** Which rows the site is answering for — `SiteDefaultFill.fromSite`, as a sorted list so an
 * assertion says which fields rather than how many. */
const suppliedBySite = (fills: ReturnType<typeof siteDefaultFills>) =>
  fills.filter((fill) => fill.fromSite).map((fill) => fill.field).sort();

/**
 * **The list itself, written out rather than read off the module** — §2.2's *"entry, salinity
 * and water body… are properties of the place"*, and the same independent-witness discipline
 * `DiveFormScreen.test.tsx`'s label table follows. Read back off `SITE_DEFAULT_FIELDS` this
 * would agree with any list at all.
 *
 * The pin is the interesting absence and is asserted rather than merely omitted: it travels UP
 * to a site the dive creates (§2.3) and must never come back DOWN, because §2.1 puts the exact
 * GPS point in the fresh half. `maxDepthM` likewise — §6 calls that the site's own depth.
 */
it('speaks for exactly the three columns §2.2 calls properties of the place', () => {
  expect([...SITE_DEFAULT_FIELDS]).toEqual(['entry', 'salinity', 'waterBody']);
  expect([...SITE_DEFAULT_FIELDS]).not.toContain('latitude');
  expect([...SITE_DEFAULT_FIELDS]).not.toContain('longitude');
  expect([...SITE_DEFAULT_FIELDS]).not.toContain('maxDepthM');
});

// --- The three tiers, and the one arrangement that can tell them apart ---

/**
 * **Every tier answers with a value no other tier holds**, which is the whole point of this
 * test and the reason it is written with nine distinct values rather than with a convenient
 * fixture. A case where the diver's value and the site's happen to agree proves the ordering
 * for neither of them and looks identical on the page; this one fails differently for every
 * wrong precedence:
 *
 * · a rule that let the site win over the diver returns `boat` for `entry`;
 * · one that let carry-over win over the site returns `fresh` for `salinity`;
 * · one that let a silent column clear the row returns `null` for `waterBody`.
 */
it('puts the diver above the site, the site above carry-over, and carry-over above nothing', () => {
  const fills = siteDefaultFills(
    says({ entry: ['boat'], salinity: 'salt' }),
    { entry: 'shore', salinity: 'fresh', waterBody: 'lake' },
    new Set(['entry']),
  );

  // The diver's row is ABSENT rather than present and unchanged: "leave this alone" and "write
  // this same value again" are different instructions to a form, and only the first is true of
  // a field somebody typed.
  expect(fills.map((fill) => fill.field)).toEqual(['salinity', 'waterBody']);
  expect(valuesOf(fills)).toEqual({ salinity: 'salt', waterBody: 'lake' });
  expect(suppliedBySite(fills)).toEqual(['salinity']);
});

// §0.6's third state is a diver's gesture too, and `SeedState.typed` counts it as one — so a
// water body somebody deliberately threw away is not something a site may put back. This is
// the tier-1 case that reads as a bug if the rule is stated as "the site fills empty rows".
it('does not refill a row the diver emptied on purpose', () => {
  const fills = siteDefaultFills(says({ waterBody: 'ocean' }), { waterBody: 'lake' }, new Set(['waterBody']));

  expect(fills.map((fill) => fill.field)).toEqual(['entry', 'salinity']);
});

// --- "A site that says nothing must not say something" ---

/**
 * A `null` column means *the catalogue does not know*, not *the answer is empty*. The
 * distinction is invisible on a site that knows nothing about a row carrying nothing, so this
 * asks it of a site that knows one thing and a carry-over that knows three — where reading
 * silence as an answer would blank two rows the diver would then have to fill in again.
 */
it('leaves carry-over standing where the site has nothing to say', () => {
  const fills = siteDefaultFills(
    says({ salinity: 'salt' }),
    { entry: 'shore', salinity: 'fresh', waterBody: 'quarry' },
    NOTHING_TYPED,
  );

  expect(valuesOf(fills)).toEqual({ entry: 'shore', salinity: 'salt', waterBody: 'quarry' });
  expect(suppliedBySite(fills)).toEqual(['salinity']);
});

// The same silence written differently. `''` reaches these columns from a client that stored a
// blank rather than a null, and a row is a row the database handed back — so neither may be
// read as a site saying "none".
it.each([
  ['a blank', ''],
  ['whitespace', '   '],
])('reads %s column as the catalogue not knowing, not as an answer', (_what, stored) => {
  const fills = siteDefaultFills(
    says({ waterBody: stored as SiteDefaults['waterBody'], entry: [stored as Entry] }),
    { entry: 'shore', waterBody: 'lake' },
    NOTHING_TYPED,
  );

  expect(valuesOf(fills)).toMatchObject({ entry: 'shore', waterBody: 'lake' });
  expect(suppliedBySite(fills)).toEqual([]);
});

// A column holding something this build cannot read costs that one column's opinion rather
// than the gesture — the rule `nearMatches` and `suggestFrom` already follow over the same
// tables, applied here because a pulled row is whatever the server sent.
it('costs one column rather than the fill when a row holds something unreadable', () => {
  const fills = siteDefaultFills(
    { entry: [], salinity: 'salt', waterBody: 7 as unknown as SiteDefaults['waterBody'] },
    { entry: 'shore', waterBody: 'lake' },
    NOTHING_TYPED,
  );

  expect(valuesOf(fills)).toEqual({ entry: 'shore', salinity: 'salt', waterBody: 'lake' });
});

// The same for the set: a pulled row is whatever the server sent, and an entry that is not a
// list at all, or a list whose one member is not a word, says nothing about the dive.
it.each([
  ['a string where a set belongs', 'boat'],
  ['null', null],
  ['a set whose one member is not a word', [7]],
])('reads an entry that is %s as the catalogue not knowing', (_what, stored) => {
  const fills = siteDefaultFills(
    says({ entry: stored as unknown as SiteDefaults['entry'] }),
    { entry: 'shore' },
    NOTHING_TYPED,
  );

  expect(valuesOf(fills).entry).toBe('shore');
  expect(suppliedBySite(fills)).toEqual([]);
});

// PR #72's review, finding 1: the site's page draws its ways in through `wordsOf`, so one word
// among members that are not words is one tile there. Counting the raw members made the prefill
// see two ways in and say nothing, and the page and the prefill disagreed.
it.each([
  ['blanks', ['', 'shore', '  ']],
  ['a number and a null', ['shore', 3, null]],
  ['spaces around it', [' shore ']],
])('reads one way in among %s as the site’s one way in', (_what, stored) => {
  expect(siteDefaultValue(says({ entry: stored as unknown as SiteDefaults['entry'] }), 'entry')).toBe('shore');
});

it('still says nothing for two ways in, whatever else the set holds', () => {
  expect(siteDefaultValue(says({ entry: ['shore', '', 'boat'] as unknown as SiteDefaults['entry'] }), 'entry')).toBeNull();
});

// A value this build's vocabulary does not contain is NOT unreadable — §10 settles that such a
// value is stored and flagged rather than refused, and `optionNote` is what says so beside the
// chips. A site from a newer client naming an entry this one has never heard of therefore
// still answers for its own row.
it('passes on an option this build does not know, rather than dropping it', () => {
  const fills = siteDefaultFills(
    says({ entry: ['jetty' as Entry] }),
    { entry: 'shore' },
    NOTHING_TYPED,
  );

  expect(valuesOf(fills).entry).toBe('jetty');
  expect(suppliedBySite(fills)).toEqual(['entry']);
});

// --- A site's entry is a set, and a dive's is one value (#31) ---

/**
 * **The site answers for the dive's entry only when it offers exactly one way in.** A site
 * entered from the shore and from a boat says what is possible, not which one this dive did —
 * so with several it leaves the row to the diver and to carry-over, exactly as a site that
 * knows nothing does. Salinity and water body are untouched by it. (Picking the dive's entry
 * from the site's options is #63, not this rule.)
 */
it('prefills the entry from a site that offers exactly one way in', () => {
  const fills = siteDefaultFills(says({ entry: ['boat'] }), { entry: 'shore' }, NOTHING_TYPED);

  expect(valuesOf(fills).entry).toBe('boat');
  expect(suppliedBySite(fills)).toEqual(['entry']);
});

it.each([
  ['two ways in', ['shore', 'boat'] as Entry[]],
  ['none recorded', [] as Entry[]],
])('leaves the entry to carry-over when the site offers %s', (_what, offered) => {
  const fills = siteDefaultFills(
    says({ entry: offered, salinity: 'salt', waterBody: 'ocean' }),
    { entry: 'other', salinity: 'fresh', waterBody: 'lake' },
    NOTHING_TYPED,
  );

  expect(valuesOf(fills)).toEqual({ entry: 'other', salinity: 'salt', waterBody: 'ocean' });
  expect(suppliedBySite(fills)).toEqual(['salinity', 'waterBody']);
});

// The site page's note names the rows that fill in a new dive through this same reading
// (`DiveSiteScreen`), so the page and the prefill cannot disagree about what picking the site will write.
it('says what a site will write into each row, and nothing for an entry with several ways in', () => {
  const site = says({
    entry: ['shore', 'boat'],
    salinity: ' salt ' as SiteDefaults['salinity'],
    waterBody: '' as SiteDefaults['waterBody'],
  });
  expect(siteDefaultValue(site, 'entry')).toBeNull();
  expect(siteDefaultValue(site, 'salinity')).toBe('salt');
  expect(siteDefaultValue(site, 'waterBody')).toBeNull();
  expect(siteDefaultValue(says({ entry: ['boat'] }), 'entry')).toBe('boat');
  expect(siteDefaultValue(says(), 'entry')).toBeNull();
});

it('leaves a typed entry alone even when the site offers exactly one way in', () => {
  const fills = siteDefaultFills(says({ entry: ['boat'] }), { entry: 'shore' }, new Set(['entry']));

  expect(fills.map((fill) => fill.field)).toEqual(['salinity', 'waterBody']);
});

// The unpaired dive, which is the same rule with tier 2 empty rather than a case of its own —
// and the answer every unreadable row collapses into: never pulled, tombstoned, merged away or
// hidden all reach here as `null` (`pairedSite`, DiveFormScreen.tsx).
it('hands the whole question back to carry-over when there is no site at all', () => {
  const fills = siteDefaultFills(null, { entry: 'shore', salinity: 'fresh' }, NOTHING_TYPED);

  expect(valuesOf(fills)).toEqual({ entry: 'shore', salinity: 'fresh', waterBody: null });
  expect(suppliedBySite(fills)).toEqual([]);
});

// Neither tier says anything, and the row genuinely holds nothing — a real blank rather than an
// absence, so the form writes it and the row reads empty. The first-ever dive is this case.
it('answers with a blank where neither the site nor carry-over knows', () => {
  const fills = siteDefaultFills(says(), {}, NOTHING_TYPED);

  expect(valuesOf(fills)).toEqual({ entry: null, salinity: null, waterBody: null });
  expect(suppliedBySite(fills)).toEqual([]);
});

// --- Whose value the row is holding, which is not the same question as who supplied it ---

/**
 * **A site that merely agrees with carry-over has not replaced anything**, and this is the
 * distinction §0.6's return mark hangs on: the mark says *this came from your last dive*, and
 * it is dropped on *overwriting*. A site answering `boat` over a carried `boat` has overwritten
 * nothing, so the row is still right to say where the value came from.
 *
 * It is also what makes §2.3's *add a site* leave the form as it found it: `siteFactsFrom` seeds
 * the new row FROM this dive, so reading it back can only ever agree.
 */
it('does not claim a row whose value the site and carry-over both give', () => {
  const fills = siteDefaultFills(
    says({ entry: ['boat'], salinity: 'salt' }),
    { entry: 'boat', salinity: 'fresh' },
    NOTHING_TYPED,
  );

  expect(valuesOf(fills)).toEqual({ entry: 'boat', salinity: 'salt', waterBody: null });
  // Only the row it actually changed.
  expect(suppliedBySite(fills)).toEqual(['salinity']);
});

/* **The property the whole shape exists for has no test here, deliberately.** "The answer is a
 * function of the diver, the current site and carry-over, and of nothing else" is true of this
 * function *by its signature* — there is nowhere to put a history — so a test of it would be
 * one this file cannot fail, which is the vacuous guard this project has paid for eight times.
 * Where it can fail is the screen, which accumulates state across gestures, and
 * `DiveFormScreen.test.tsx`'s *falls back to carry-over, not to the site the diver has left*
 * is where it is checked. */
