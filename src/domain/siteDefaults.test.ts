import { isOcean, salinityFor, siteDefaultFills, siteDefaultValue, SITE_DEFAULT_FIELDS, type SiteDefaults } from './siteDefaults';
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
const valuesOf = (answer: ReturnType<typeof siteDefaultFills>) =>
  Object.fromEntries(answer.fills.map((fill) => [fill.field, fill.value]));

/** Which rows the site is answering for — `SiteDefaultFill.fromSite`, as a sorted list so an
 * assertion says which fields rather than how many. */
const suppliedBySite = (answer: ReturnType<typeof siteDefaultFills>) =>
  answer.fills.filter((fill) => fill.fromSite).map((fill) => fill.field).sort();

/** The rows the answer writes at all — a row it leaves to the diver is absent, not unchanged. */
const filled = (answer: ReturnType<typeof siteDefaultFills>) => answer.fills.map((fill) => fill.field);

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

// --- The hierarchy, and the one arrangement that can tell its tiers apart ---

/**
 * **Site, water body and salinity are a hierarchy, and setting a parent sets its children**
 * (#53, the owner's call of 2026-11-23). A site sets what it knows over a value the diver set by
 * hand; the diver's value stands where the site says nothing; carry-over fills the rest; and
 * the salinity follows whatever water body that leaves.
 *
 * Every tier answers with a value no other tier holds, so this fails differently for every wrong
 * precedence:
 *
 * · a rule that still put the diver above the site returns no fill for `entry`;
 * · one that let the site's silence overwrite the diver returns carry-over's `lake`;
 * · one that let carry-over's salinity outlive its own water body returns `salt`.
 */
it('puts the site above the diver for what it knows, the diver above carry-over, and the water body above the salinity', () => {
  const answer = siteDefaultFills(
    says({ entry: ['boat'] }),
    { entry: 'shore', salinity: 'salt', waterBody: 'lake' },
    new Set(['entry', 'waterBody']),
    { entry: 'other', salinity: 'salt', waterBody: 'river' },
  );

  // The water body is ABSENT rather than present and unchanged: "leave this alone" and "write
  // this same value again" are different instructions to a form, and only the first is true of
  // a field the diver set and the site knows nothing about.
  expect(filled(answer)).toEqual(['entry', 'salinity']);
  expect(valuesOf(answer)).toEqual({ entry: 'boat', salinity: 'fresh' });
  expect(answer.released).toEqual(['entry']);
  expect(answer.fills.find((fill) => fill.field === 'salinity')?.fromWaterBody).toBe(true);
});

// §0.6's third state is a diver's gesture too, and `SeedState.typed` counts it as one. Under the
// hierarchy a site that knows the water body puts it back all the same: the diver who threw the
// lake away and then picked an ocean site has told the form where they are.
it('refills a row the diver emptied, when the site knows it', () => {
  const answer = siteDefaultFills(says({ waterBody: 'ocean' }), { waterBody: 'lake' }, new Set(['waterBody']), {
    waterBody: null,
  });

  expect(valuesOf(answer)).toEqual({ entry: null, salinity: 'salt', waterBody: 'ocean' });
  expect(answer.released).toEqual(['waterBody']);
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
  // A lake rather than an ocean: an ocean's salt is the water body's answer (#53), not the
  // site's, and this asks about the site's two columns.
  const fills = siteDefaultFills(
    says({ entry: offered, salinity: 'salt', waterBody: 'lake' }),
    { entry: 'other', salinity: 'fresh', waterBody: 'quarry' },
    NOTHING_TYPED,
  );

  expect(valuesOf(fills)).toEqual({ entry: 'other', salinity: 'salt', waterBody: 'lake' });
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

it('replaces a typed entry when the site offers exactly one way in', () => {
  const answer = siteDefaultFills(says({ entry: ['boat'] }), { entry: 'shore' }, new Set(['entry']), { entry: 'other' });

  expect(valuesOf(answer).entry).toBe('boat');
  expect(answer.released).toEqual(['entry']);
});

// #53's review focus: a set of several says nothing (#31), so it is not something the site
// knows, and a value the diver set stays.
it('keeps a typed entry when the site offers several ways in', () => {
  const answer = siteDefaultFills(says({ entry: ['shore', 'boat'] }), { entry: 'shore' }, new Set(['entry']), {
    entry: 'other',
  });

  expect(filled(answer)).not.toContain('entry');
  expect(answer.released).toEqual([]);
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

// --- The water body sets the salinity (#53) ---

/**
 * **Whatever sets the water body sets the salinity with it** — the diver tapping a water body,
 * a site, or carry-over — and a salinity set by hand lasts until the water body changes. Ocean
 * is salt and hides the row; any other water body takes the site's or the inherited salinity
 * when it was for that same water body, and otherwise fresh. No water body is today's rule.
 */
it('saves salt for an ocean and hides the row, whatever else says otherwise', () => {
  expect(
    salinityFor({
      waterBody: 'ocean',
      typed: 'fresh',
      site: says({ salinity: 'fresh', waterBody: 'ocean' }),
      inherited: { salinity: 'fresh', waterBody: 'ocean' },
    }),
  ).toEqual({ value: 'salt', source: 'waterBody', shown: false });
});

it.each(['lake', 'river', 'quarry', 'cave', 'pool'])('answers fresh for a %s nothing else speaks for', (waterBody) => {
  expect(salinityFor({ waterBody, typed: undefined, site: null, inherited: {} })).toEqual({
    value: 'fresh',
    source: 'waterBody',
    shown: true,
  });
});

it('takes a site’s salt for its own water body, and not for another', () => {
  const site = says({ salinity: 'salt', waterBody: 'lake' });
  expect(salinityFor({ waterBody: 'lake', typed: undefined, site, inherited: {} })).toMatchObject({ value: 'salt', source: 'site' });
  expect(salinityFor({ waterBody: 'river', typed: undefined, site, inherited: {} })).toMatchObject({
    value: 'fresh',
    source: 'waterBody',
  });
});

it('takes a site’s salinity when the site names no water body', () => {
  expect(
    salinityFor({
      waterBody: 'lake',
      typed: undefined,
      site: says({ salinity: 'salt' }),
      inherited: { salinity: 'fresh', waterBody: 'lake' },
    }),
  ).toMatchObject({ value: 'salt', source: 'site' });
});

it('keeps a carried salinity only with the water body it carried with', () => {
  const inherited = { salinity: 'salt', waterBody: 'lake' };
  expect(salinityFor({ waterBody: 'lake', typed: undefined, site: null, inherited })).toMatchObject({
    value: 'salt',
    source: 'inherited',
  });
  expect(salinityFor({ waterBody: 'river', typed: undefined, site: null, inherited })).toMatchObject({
    value: 'fresh',
    source: 'waterBody',
  });
});

it('keeps a hand-set salinity in force, a cleared one included', () => {
  expect(salinityFor({ waterBody: 'lake', typed: 'salt', site: null, inherited: {} })).toMatchObject({
    value: 'salt',
    source: 'typed',
  });
  expect(salinityFor({ waterBody: 'lake', typed: '', site: null, inherited: {} })).toMatchObject({ value: null, source: 'typed' });
});

it('works as before with no water body', () => {
  expect(
    salinityFor({ waterBody: null, typed: undefined, site: null, inherited: { salinity: 'salt', waterBody: 'ocean' } }),
  ).toMatchObject({ value: 'salt', source: 'inherited' });
  expect(salinityFor({ waterBody: null, typed: undefined, site: null, inherited: {} })).toEqual({
    value: null,
    source: null,
    shown: true,
  });
});

it('drops a hand-set salinity when the pick changes the water body, and keeps it when it does not', () => {
  const typed = new Set(['salinity']);
  const current = { salinity: 'salt', waterBody: 'lake' };

  const river = siteDefaultFills(says({ waterBody: 'river' }), {}, typed, current);
  expect(valuesOf(river)).toMatchObject({ waterBody: 'river', salinity: 'fresh' });
  expect(river.released).toEqual(['salinity']);

  const lake = siteDefaultFills(says({ waterBody: 'lake' }), {}, typed, current);
  expect(filled(lake)).not.toContain('salinity');
  expect(lake.released).toEqual([]);
});

it('fills fresh from the water body when a lake site replaces a carried ocean', () => {
  const answer = siteDefaultFills(says({ waterBody: 'lake' }), { salinity: 'salt', waterBody: 'ocean' }, NOTHING_TYPED);

  expect(valuesOf(answer)).toMatchObject({ waterBody: 'lake', salinity: 'fresh' });
  expect(answer.fills.find((fill) => fill.field === 'salinity')).toMatchObject({ fromWaterBody: true, fromSite: false });
});

// The latest gesture wins: a field the diver touched while the site read was out is theirs,
// whatever the site then answers (the form passes it as `keep`).
it('never overrides a field the diver touched while the read was out', () => {
  const touched = new Set(['waterBody']);
  const answer = siteDefaultFills(
    says({ salinity: 'salt', waterBody: 'lake' }),
    {},
    touched,
    { waterBody: 'river' },
    touched,
  );

  expect(filled(answer)).not.toContain('waterBody');
  expect(answer.released).toEqual([]);
  expect(valuesOf(answer).salinity).toBe('fresh');
});

// The ocean outranks even the latest gesture: a hidden row holding fresh would be a fact the
// diver can neither see nor change.
it('saves salt when the site answers ocean, even over a salinity tapped while the read was out', () => {
  const touched = new Set(['salinity']);
  const answer = siteDefaultFills(says({ waterBody: 'ocean' }), {}, touched, { salinity: 'fresh', waterBody: 'lake' }, touched);

  expect(valuesOf(answer)).toMatchObject({ waterBody: 'ocean', salinity: 'salt' });
  expect(answer.released).toEqual(['salinity']);
});

// The final review's finding 7: a row in `keep` is the diver's even before the form's own state
// has counted it as typed — the two are updated together, but the read can land in between.
it('treats a kept row as the diver’s even before it is counted as typed', () => {
  const answer = siteDefaultFills(says({ entry: ['boat'] }), { waterBody: 'lake' }, NOTHING_TYPED, { waterBody: 'river' }, new Set(['waterBody']));

  expect(filled(answer)).not.toContain('waterBody');
});

// PR #80's review: every screen asks "is this the ocean?" through one reading, trimmed as
// `salinityFor` reads it, so a row and the save cannot disagree about a stray space.
it('reads an ocean with stray spaces as the ocean, and nothing else as one', () => {
  expect(isOcean(' ocean ')).toBe(true);
  expect(isOcean('ocean')).toBe(true);
  expect(isOcean('lake')).toBe(false);
  expect(isOcean(null)).toBe(false);
  expect(isOcean(7)).toBe(false);
});
