import { dive } from './diveFixture';
import { divesAtSite, isDiveAtSite } from './siteDives';

/**
 * `domain/siteDives.ts` — "which of my dives were at this site" (DESIGN.md §4.1, M3f).
 *
 * The rule itself is `diveBelongsToCatalogueRow`'s and is pinned in `catalogueDives.test.ts`;
 * what is asserted here is **the half this module owns — that it reads §6's site pair and only
 * that pair** — plus the two consequences a site's page turns on: the ordinary unpaired dive
 * belongs, and a plan does not.
 *
 * The fixtures use the shape a real logbook holds: a dive that carries a `site_name` snapshot with
 * no `site_id`, which is every dive logged before M2o (§2.3).
 */
const rock = (over: Partial<{ id: string; name: string | null }> = {}) => ({
  id: 's1',
  name: 'Kotelna',
  ...over,
});

describe('isDiveAtSite', () => {
  it('matches on the paired id, whatever the snapshot says', () => {
    expect(isDiveAtSite(dive({ siteId: 's1', siteName: 'Blue Hole' }), rock())).toBe(true);
  });

  it('refuses a dive whose id names a different site, even when the names agree', () => {
    expect(isDiveAtSite(dive({ siteId: 's2', siteName: 'Kotelna' }), rock())).toBe(false);
  });

  /**
   * **The tier that makes the page worth opening**, and the reason this is not
   * `catalogueSiteIdentity`. §2.3 started publishing sites in M2o, so a diver who has dived
   * Kotelna forty times and then added it from dive forty-one has ONE paired dive; an id-only
   * page would open on `1 dive` beside a logbook that plainly says otherwise.
   */
  it('matches an unpaired dive on the folded name', () => {
    expect(isDiveAtSite(dive({ siteName: 'kotelna' }), rock())).toBe(true);
    expect(isDiveAtSite(dive({ siteName: 'Zelezna' }), rock({ name: 'Železná' }))).toBe(true);
  });

  /**
   * **It reads the site pair and never the centre's**, which is the whole of what this module
   * owns over the shared rule. A dive with a centre called *Kotelna* and no site of that name is
   * the projection swapped, and it is the failure a shared rule makes cheap to introduce and
   * invisible to a fixture where both columns agree.
   */
  it('reads §6’s site columns and not the centre’s', () => {
    expect(isDiveAtSite(dive({ centerName: 'Kotelna', siteName: null }), rock())).toBe(false);
    expect(isDiveAtSite(dive({ centerId: 's1', siteId: null, siteName: null }), rock())).toBe(false);
    // ...and a dive whose centre is something else entirely still belongs by its site.
    expect(isDiveAtSite(dive({ siteName: 'Kotelna', centerName: 'Ponorka' }), rock())).toBe(true);
  });

  // §2.4: a plan is somewhere you intend to go. `groupDivesByPlace` already keeps one off the map
  // for the same reason, so a page opened from a plan reads `0 dives`.
  it('excludes a planned dive', () => {
    expect(isDiveAtSite(dive({ status: 'planned', siteId: 's1' }), rock())).toBe(false);
    expect(isDiveAtSite(dive({ status: 'planned', siteName: 'Kotelna' }), rock())).toBe(false);
  });

  it('survives a row it cannot read', () => {
    expect(isDiveAtSite(null, rock())).toBe(false);
    expect(isDiveAtSite(undefined, rock())).toBe(false);
  });
});

describe('divesAtSite', () => {
  it('keeps the dives that belong and the order they arrived in', () => {
    const paired = dive({ siteId: 's1', siteName: 'Kotelna' });
    const named = dive({ siteName: 'kotelna' });
    const other = dive({ siteName: 'Divoká Šárka' });
    const plan = dive({ status: 'planned', siteId: 's1' });
    expect(divesAtSite([paired, other, named, plan], rock())).toEqual([paired, named]);
  });

  it('has nothing to say about an empty logbook', () => {
    expect(divesAtSite([], rock())).toEqual([]);
  });
});
