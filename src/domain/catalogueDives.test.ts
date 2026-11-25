import {
  catalogueDiveLookup,
  diveBelongsToCatalogueRow,
  divesOfRow,
  type CatalogueRowIdentity,
  type DiveCataloguePairing,
} from './catalogueDives';

/**
 * `domain/catalogueDives.ts` — "does this dive belong to that catalogue row" (DESIGN.md §4.1),
 * the rule a dive centre's page and a dive site's page both ask.
 *
 * **The pairings below are written as the projection rather than as dives**, deliberately: this
 * module never sees a `Dive` and has no opinion about which pair of columns it was handed. That
 * each screen hands it the right pair is `centerDives.test.ts`' and `siteDives.test.ts`' claim,
 * and each of those pins it against the *other* table's columns.
 */
const pairing = (over: Partial<DiveCataloguePairing> = {}): DiveCataloguePairing => ({
  pairedId: null,
  snapshot: 'Kotelna',
  status: 'logged',
  ...over,
});

const row = (over: Partial<{ id: string; name: string | null }> = {}) => ({
  id: 'r1',
  name: 'Kotelna',
  ...over,
});

// Tier 1. The id is the identity half of §6's pair and it decides on its own — in both
// directions, which is the half that stops one dive appearing on two pages.
it('matches on the paired id, whatever the snapshot says', () => {
  expect(diveBelongsToCatalogueRow(pairing({ pairedId: 'r1', snapshot: 'Something else' }), row())).toBe(true);
});

it('refuses a dive whose id names a different row, even when the names agree', () => {
  expect(diveBelongsToCatalogueRow(pairing({ pairedId: 'r2', snapshot: 'Kotelna' }), row())).toBe(false);
});

/**
 * **The property the two tiers exist to produce**: a paired dive belongs to at most one row, so
 * no dive is counted on two pages. This is what fails if the name tier is ever allowed to run for
 * a dive that already carries an id — the single most plausible "simplification" of this module,
 * and one whose damage is a double count rather than an error.
 */
it('never puts one paired dive under two rows of the same name', () => {
  const twins = [row({ id: 'r1' }), row({ id: 'r2' })];
  const paired = pairing({ pairedId: 'r2', snapshot: 'Kotelna' });
  expect(twins.filter((r) => diveBelongsToCatalogueRow(paired, r)).map((r) => r.id)).toEqual(['r2']);
  // An UNPAIRED dive genuinely names both, and that is the honest answer rather than a bug: the
  // diver never said which, and the catalogue holds two of that name. Stated here so the property
  // above reads as "a PAIRED dive belongs to one" rather than as something wider than the rule
  // can support — and it is the cost `catalogueSiteIdentity` names when it refuses the same fold
  // for a map.
  const unpaired = pairing({ snapshot: 'Kotelna' });
  expect(twins.filter((r) => diveBelongsToCatalogueRow(unpaired, r)).map((r) => r.id)).toEqual(['r1', 'r2']);
});

// Tier 2, and the common case by design: a place typed by hand has never been published, so the
// snapshot is all there is. Folded on both sides through `foldForMatching`, which is why
// `zelezna` finds `Železná` here for the reason it does everywhere else (§2.3, M2j).
it('matches an unpaired dive on the folded name', () => {
  expect(diveBelongsToCatalogueRow(pairing({ snapshot: 'kotelna' }), row())).toBe(true);
  expect(diveBelongsToCatalogueRow(pairing({ snapshot: '  KOTELNA ' }), row())).toBe(true);
  expect(diveBelongsToCatalogueRow(pairing({ snapshot: 'Zelezna' }), row({ name: 'Železná' }))).toBe(true);
});

it('refuses an unpaired dive whose name is a different place', () => {
  expect(diveBelongsToCatalogueRow(pairing({ snapshot: 'Divoká Šárka' }), row())).toBe(false);
});

// **Not a substring match**, which is the tempting middle and is wrong for the reason §2.3 gives
// about the offline duplicate check: it makes `Kotelna` a duplicate of `Kotelna II`.
it('does not match a name that merely contains the row’s', () => {
  expect(diveBelongsToCatalogueRow(pairing({ snapshot: 'Kotelna II' }), row())).toBe(false);
  expect(diveBelongsToCatalogueRow(pairing({ snapshot: 'Kotelna' }), row({ name: 'Kotelna II' }))).toBe(false);
});

// An empty name on either side matches nothing: folding it would equal every unnamed row in the
// catalogue, so one nameless row would claim every dive that never recorded a place.
it('matches nothing when either side has no name to compare', () => {
  expect(diveBelongsToCatalogueRow(pairing({ snapshot: null }), row())).toBe(false);
  expect(diveBelongsToCatalogueRow(pairing({ snapshot: '   ' }), row())).toBe(false);
  expect(diveBelongsToCatalogueRow(pairing({ snapshot: null }), row({ name: null }))).toBe(false);
  expect(diveBelongsToCatalogueRow(pairing({ snapshot: 'Kotelna' }), row({ name: null }))).toBe(false);
  expect(diveBelongsToCatalogueRow(pairing({ snapshot: '' }), row({ name: '' }))).toBe(false);
});

// A catalogue row always has an id; one that somehow does not is not something a dive can be
// paired to, and falling through to the name would put dives under a row with no page.
it('matches nothing for a row with no id', () => {
  expect(diveBelongsToCatalogueRow(pairing({ snapshot: 'Kotelna' }), row({ id: '' }))).toBe(false);
  expect(diveBelongsToCatalogueRow(pairing({ pairedId: '', snapshot: 'Kotelna' }), row({ id: '' }))).toBe(false);
});

/**
 * §2.4: a plan is excluded from stats and numbering, and `groupDivesByPlace` already keeps one off
 * the map for the same reason. **The filter is inside this rule rather than at the call site** so
 * that a page's summary line and the rows beneath it cannot be computed from two different lists.
 */
it('excludes a planned dive by either tier', () => {
  expect(diveBelongsToCatalogueRow(pairing({ status: 'planned', pairedId: 'r1' }), row())).toBe(false);
  expect(diveBelongsToCatalogueRow(pairing({ status: 'planned', snapshot: 'Kotelna' }), row())).toBe(false);
});

// Runs during render over rows a bad join can put holes in, so it never dereferences what it was
// not given — `siteIdentityOf`'s and `logbookStats`' stance.
it('survives a row it cannot read', () => {
  expect(diveBelongsToCatalogueRow(null, row())).toBe(false);
  expect(diveBelongsToCatalogueRow(undefined, row())).toBe(false);
  expect(
    diveBelongsToCatalogueRow({ pairedId: 7, snapshot: 12, status: 'logged' } as unknown as DiveCataloguePairing, row()),
  ).toBe(false);
  expect(
    diveBelongsToCatalogueRow(pairing({ snapshot: 'Kotelna' }), { id: 9, name: 4 } as unknown as { id: string; name: null }),
  ).toBe(false);
});

/**
 * **The lookup is a second reading of the rule above, so it is checked against the rule itself**
 * (#36). The picker asks "which dives are this row's?" of thousands of rows per keystroke; asked
 * through `diveBelongsToCatalogueRow` that is rows × dives, and the lookup sorts the logbook once
 * instead. What it must never do is answer differently — a dive missing from *Dived here*, or one
 * shown under a row the rule keeps it from — so every row below is asked both ways, on a logbook
 * built to hit each tier and each way a row or a dive can be unreadable.
 */
describe('catalogueDiveLookup', () => {
  type Entry = { label: string; pairing: unknown } | null | undefined;
  const entry = (label: string, over: Partial<Record<keyof DiveCataloguePairing, unknown>>): Entry => ({
    label,
    pairing: { pairedId: null, snapshot: null, status: 'logged', ...over },
  });
  const logbook: Entry[] = [
    entry('paired to r1', { pairedId: 'r1', snapshot: 'Something else' }),
    entry('paired to r2, named like r1', { pairedId: 'r2', snapshot: 'Železná' }),
    entry('paired to a row the catalogue lacks', { pairedId: 'gone', snapshot: 'Železná' }),
    entry('unpaired, accented', { snapshot: 'Železná' }),
    entry('unpaired, folded with spaces', { snapshot: '  zelezna ' }),
    entry('unpaired, shouted', { snapshot: 'ZELEZNA' }),
    entry('unpaired, a different place', { snapshot: 'Kotelna' }),
    entry('unpaired, a name containing another', { snapshot: 'Železná hora' }),
    entry('unpaired, blank', { snapshot: '   ' }),
    entry('unpaired, no name', { snapshot: null }),
    entry('empty id, named', { pairedId: '', snapshot: 'Kotelna' }),
    entry('numeric id, named', { pairedId: 7, snapshot: 'Kotelna' }),
    entry('numeric name', { snapshot: 42 }),
    entry('a plan paired to r1', { pairedId: 'r1', status: 'planned' }),
    entry('a plan by name', { snapshot: 'Železná', status: 'planned' }),
    entry('no status', { snapshot: 'Kotelna', status: undefined }),
    null,
    undefined,
    { label: 'no pairing at all', pairing: null },
  ];
  const pairingOf = (e: NonNullable<Entry>) => e.pairing as DiveCataloguePairing;
  const rows: CatalogueRowIdentity[] = [
    { id: 'r1', name: 'Železná' },
    { id: 'r2', name: 'Zelezna' },
    { id: 'r3', name: 'Kotelna' },
    { id: 'r4', name: null },
    { id: 'r5', name: '   ' },
    { id: '', name: 'Kotelna' },
    { id: 7 as unknown as string, name: 'Kotelna' },
    { id: 'r6', name: 42 as unknown as string },
  ];

  it.each(rows.map((r) => [JSON.stringify(r), r] as const))(
    'answers what the rule answers for the row %s, with the same dives in the same order',
    (_label, row) => {
      const lookup = catalogueDiveLookup(logbook, (e) => (e ? pairingOf(e) : (null as never)));
      const expected = logbook.filter((e) => diveBelongsToCatalogueRow(e ? pairingOf(e) : null, row));
      const answer = divesOfRow(lookup, row);
      expect(answer.map((e) => e?.label)).toEqual(expected.map((e) => e?.label));
      answer.forEach((e, i) => expect(e).toBe(expected[i]));
    },
  );

  it('gives r1 its paired dive and every unpaired dive of its folded name, and r2 the same names', () => {
    const lookup = catalogueDiveLookup(logbook, (e) => (e ? pairingOf(e) : (null as never)));
    expect(divesOfRow(lookup, rows[0]).map((e) => e?.label)).toEqual([
      'paired to r1',
      'unpaired, accented',
      'unpaired, folded with spaces',
      'unpaired, shouted',
    ]);
    expect(divesOfRow(lookup, rows[1]).map((e) => e?.label)).toEqual([
      'paired to r2, named like r1',
      'unpaired, accented',
      'unpaired, folded with spaces',
      'unpaired, shouted',
    ]);
  });

  it('has nothing to say about an empty logbook', () => {
    expect(divesOfRow(catalogueDiveLookup([], pairingOf), rows[0])).toEqual([]);
  });
});
