import { divesWithCenter, isDiveWithCenter } from './centerDives';
import { dive } from './diveFixture';

/**
 * `domain/centerDives.ts` — "which of my dives were with this centre" (DESIGN.md §4.1).
 *
 * The fixtures below deliberately use the shape M2o actually writes: a centre that is **a name
 * and nothing else** (§2.3 — "a centre inherits its name alone"), and a dive that carries a
 * `center_name` snapshot with no `center_id`, which is every dive logged before M2o.
 */
const centre = (over: Partial<{ id: string; name: string | null }> = {}) => ({
  id: 'c1',
  name: 'Ponorka',
  ...over,
});

describe('isDiveWithCenter', () => {
  // Tier 1. The id is the identity half of §6's pair, and it decides on its own — in both
  // directions, which is the half that stops a dive appearing on two centres' pages.
  it('matches on the paired id, whatever the snapshot says', () => {
    expect(isDiveWithCenter(dive({ centerId: 'c1', centerName: 'Aqua Split' }), centre())).toBe(true);
  });

  it('refuses a dive whose id names a different centre, even when the names agree', () => {
    expect(isDiveWithCenter(dive({ centerId: 'c2', centerName: 'Ponorka' }), centre())).toBe(false);
  });

  // Tier 2, and the common case by design: a centre typed by hand has never been published, so
  // the snapshot is all there is. Folded on both sides — `foldForMatching`'s own fold, which is
  // why `zelezna` finds `Železná` here for the same reason it does everywhere else (§2.3, M2j).
  it('matches an unpaired dive on the folded name', () => {
    expect(isDiveWithCenter(dive({ centerName: 'ponorka' }), centre())).toBe(true);
    expect(isDiveWithCenter(dive({ centerName: '  PONORKA ' }), centre())).toBe(true);
    expect(isDiveWithCenter(dive({ centerName: 'Zelezna' }), centre({ name: 'Železná' }))).toBe(true);
  });

  it('refuses an unpaired dive whose name is a different centre', () => {
    expect(isDiveWithCenter(dive({ centerName: 'Aqua Split' }), centre())).toBe(false);
  });

  // An empty name on either side matches nothing: folding it would equal every unnamed row in
  // the catalogue, so one nameless centre would claim every dive that never recorded one.
  it('matches nothing when either side has no name to compare', () => {
    expect(isDiveWithCenter(dive({ centerName: null }), centre())).toBe(false);
    expect(isDiveWithCenter(dive({ centerName: '   ' }), centre())).toBe(false);
    expect(isDiveWithCenter(dive({ centerName: null }), centre({ name: null }))).toBe(false);
    expect(isDiveWithCenter(dive({ centerName: 'Ponorka' }), centre({ name: null }))).toBe(false);
    expect(isDiveWithCenter(dive({ centerName: '' }), centre({ name: '' }))).toBe(false);
  });

  // A catalogue row always has an id; a row that somehow does not is not something a dive can
  // be paired to, and matching on the name alone would put dives under a centre with no page.
  it('matches nothing for a centre with no id', () => {
    expect(isDiveWithCenter(dive({ centerName: 'Ponorka' }), centre({ id: '' }))).toBe(false);
  });

  // §2.4: a plan is excluded from stats and numbering, and `groupDivesByPlace` already keeps one
  // off the map for the same reason.
  it('excludes a planned dive', () => {
    expect(isDiveWithCenter(dive({ status: 'planned', centerId: 'c1' }), centre())).toBe(false);
    expect(isDiveWithCenter(dive({ status: 'planned', centerName: 'Ponorka' }), centre())).toBe(false);
  });

  // Runs during render over rows a bad join can put holes in.
  it('survives a row it cannot read', () => {
    expect(isDiveWithCenter(null, centre())).toBe(false);
    expect(isDiveWithCenter(undefined, centre())).toBe(false);
  });
});

describe('divesWithCenter', () => {
  it('keeps the dives that belong and the order they arrived in', () => {
    const paired = dive({ centerId: 'c1', centerName: 'Ponorka' });
    const named = dive({ centerName: 'ponorka' });
    const other = dive({ centerName: 'Aqua Split' });
    const plan = dive({ status: 'planned', centerId: 'c1' });
    expect(divesWithCenter([paired, other, named, plan], centre())).toEqual([paired, named]);
  });

  /**
   * **The property the two tiers exist to produce, asserted rather than assumed**: a dive belongs
   * to at most one centre, so no dive can be counted on two centres' pages.
   *
   * This is what fails if the name tier is ever allowed to run for a dive that already carries an
   * id — the single most plausible "simplification" of this module, and one whose damage is a
   * double count rather than an error.
   */
  it('never puts one dive under two centres', () => {
    const twins = [centre({ id: 'c1', name: 'Ponorka' }), centre({ id: 'c2', name: 'Ponorka' })];
    const paired = dive({ centerId: 'c2', centerName: 'Ponorka' });
    const unpaired = dive({ centerName: 'Ponorka' });
    const belongsTo = (d: typeof paired) => twins.filter((c) => isDiveWithCenter(d, c)).map((c) => c.id);
    expect(belongsTo(paired)).toEqual(['c2']);
    // An unpaired dive genuinely names both, and that is the honest answer rather than a bug:
    // the diver never told the app which shop it was, and the catalogue holds two of that name.
    // It is stated here so the property above reads as "a PAIRED dive belongs to one" rather
    // than as something wider than the rule can support.
    expect(belongsTo(unpaired)).toEqual(['c1', 'c2']);
  });

  it('has nothing to say about an empty logbook', () => {
    expect(divesWithCenter([], centre())).toEqual([]);
  });
});
