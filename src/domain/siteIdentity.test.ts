import { dive } from './diveFixture';
import { siteIdentityOf } from './siteIdentity';

/**
 * **Which dives are at one site** — the rule §3's map groups markers by and §3's Stats tab
 * counts sites by, and the reason it is one function rather than two implementations that
 * happen to agree today (§4.1).
 *
 * What these tests are about is the four ways a place count can be wrong while looking
 * perfectly plausible: a spelling difference splitting one site in two, a renamed catalogue row
 * doing the same, a dive that names nothing being counted as somewhere, and several such dives
 * being merged into one place out of a shared absence.
 */

describe('siteIdentityOf', () => {
  // §2.3's fold, which is the whole reason this reads `foldForMatching` rather than the raw
  // string: `Kotelna` and `kotelna` are one site to a diver, and a diver types on whatever
  // keyboard is in front of them. Diacritics included — `Divoka Sarka` typed without them is
  // the case §2.3 names by name.
  it.each([
    ['case', 'Kotelna', 'kotelna'],
    ['surrounding space', 'Kotelna', '  Kotelna '],
    ['diacritics', 'Divoká Šárka', 'Divoka Sarka'],
  ])('reads two spellings that differ only in %s as one site', (_label, a, b) => {
    expect(siteIdentityOf(dive({ siteName: a }))).toBe(siteIdentityOf(dive({ siteName: b })));
  });

  // ...and the other side of it, or the fold would be free to collapse everything: two genuinely
  // different names are two sites.
  it('keeps two different names apart', () => {
    expect(siteIdentityOf(dive({ siteName: 'Kotelna' }))).not.toBe(
      siteIdentityOf(dive({ siteName: 'Kotelna II' })),
    );
  });

  // **The id wins, and this is what it buys.** A catalogue row can be renamed by an admin (§5)
  // or folded into another (M2r rewrites the dives' `site_id` and leaves every snapshot alone),
  // so two dives at one site can hold two different names. Keyed on the snapshot they would be
  // two markers and two sites; keyed on the id they are one.
  it('reads two dives at one catalogue site as one place however their snapshots are spelled', () => {
    expect(siteIdentityOf(dive({ siteId: 'site-1', siteName: 'Shark Point' }))).toBe(
      siteIdentityOf(dive({ siteId: 'site-1', siteName: 'Sharks Point' })),
    );
  });

  // ...and the cost of that order, pinned so it is a known trade rather than a surprise: two
  // sites the catalogue says are different stay different even when they share a name, which is
  // the direction that must never merge — `Blue Hole` is in Egypt, Malta and Belize.
  it('keeps two catalogue sites apart when they share a name', () => {
    expect(siteIdentityOf(dive({ siteId: 'site-eg', siteName: 'Blue Hole' }))).not.toBe(
      siteIdentityOf(dive({ siteId: 'site-mt', siteName: 'Blue Hole' })),
    );
  });

  // **A dive that names no place at all is nowhere, not somewhere.** Counting it would invent a
  // site out of an absence — and counting two of them as ONE would invent a shared place out of
  // a shared absence, which is the mistake a sentinel string like `''` or `'unknown'` would
  // make silently. `null` is what forces each caller to decide, and the map's own third tier
  // (`placeKeyOf`) is what a caller deciding differently looks like.
  it('answers nothing for a dive that names no place', () => {
    expect(siteIdentityOf(dive())).toBeNull();
    expect(siteIdentityOf(dive({ siteName: '   ' }))).toBeNull();
    expect(siteIdentityOf(dive({ siteId: '' }))).toBeNull();
  });

  // A dive centre is a shop, not a place you dived — `tripKeyOf` (domain/trips.ts) falls back to
  // it and this deliberately does not (that function's own docblock, and `groupDivesByPlace`'s).
  // Without this, four dives at four sites booked through one shop would be one place.
  it('never falls back to the dive centre', () => {
    expect(siteIdentityOf(dive({ centerName: 'Blue Planet' }))).toBeNull();
  });

  // Prefixed per tier, so a site whose id happens to be the folded form of another site's name
  // cannot collide with it. Two dives, one naming a site and one pointing at a row whose id is
  // that same string, are two places.
  it('cannot confuse a site id with a site name', () => {
    expect(siteIdentityOf(dive({ siteId: 'kotelna' }))).not.toBe(
      siteIdentityOf(dive({ siteName: 'Kotelna' })),
    );
  });

  // Called during render, on a list a bad join can put holes in — the same stance
  // `logbookStats` and `assignDiveNumbers` take, and for the same reason: nothing here may
  // throw. A corrupt row can hand back a shape neither type says it can.
  it('survives what a corrupt read can hand it', () => {
    expect(siteIdentityOf(null)).toBeNull();
    expect(siteIdentityOf(undefined)).toBeNull();
    expect(siteIdentityOf({ siteId: 7, siteName: 12 } as unknown as ReturnType<typeof dive>)).toBeNull();
  });
});
