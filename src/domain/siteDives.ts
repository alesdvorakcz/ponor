import { diveBelongsToCatalogueRow } from './catalogueDives';
import { type Dive, type DiveSite } from './types';

/**
 * **Which of my dives were at this site** — the rule behind everything a site's own page says
 * about a diver's logbook (DESIGN.md §4.1, M3f).
 *
 * ── Why this is not `siteIdentityOf`, which owns "which dives happened at one site" ────────
 *
 * It owns that question *between dives*. `siteIdentityOf` is a grouping key computed from a dive
 * alone: two dives are at one site when their keys are equal, which is what the Map's marks and
 * Stats' *sites visited* need. A page has a **catalogue row** in front of it, and key equality is
 * the wrong relation for that pair — `catalogueSiteIdentity` (the row's half of the map's
 * comparison) is deliberately **tier 1 only**, so a dive that named the site by hand carries
 * `name:<folded>` and would never equal the row's `site:<id>`.
 *
 * That is not a gap in either function; it is the same trade-off recorded from the other side.
 * `catalogueSiteIdentity`'s own docblock says so: taking a name fold there would let one *name*
 * remove a place from a map (a diver with a Croatian *Blue Hole* would silently lose Egypt's and
 * Malta's rows), *"`isDiveWithCenter` accepts precisely that fold for a page's list of dives,
 * where the cost is a dive listed under two shops the diver never told apart"*. A page pays that
 * cost and gets the answer worth having; a map cannot pay it and does not.
 *
 * **What it buys is the ordinary logbook.** §2.3 only started publishing sites in M2o, and a
 * `site_id` is written only where a diver picked the site from the catalogue or created it. A
 * diver who has dived Kotelna forty times and then added it from dive forty-one has **one** paired
 * dive; an id-only page would open on `1 dive` beside a logbook that plainly says otherwise. That
 * is M3c's centre finding arriving unchanged at the other table.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────────────────
 *
 * `diveBelongsToCatalogueRow` (domain/catalogueDives.ts) is the rule and carries all of it: the
 * paired id decides on its own in both directions, an unpaired dive belongs by its folded name,
 * and §2.4's plans are excluded inside the filter so a page's summary and its rows are one
 * population. **This module owns only the pair of columns** — §6's `site_id`/`site_name` — which
 * is the half that may not be shared: a field selector at the call site is one typo away from
 * listing a centre's dives under a site.
 *
 * ── What a merge leaves for this to do, which is nothing (§5, M2r) ────────────────────────
 *
 * When an admin folds one site into another, the pull that delivers the merge rewrites every
 * dive's `site_id` to the survivor and leaves the `site_name` snapshot alone (`domain/merges.ts`).
 * So nothing here reads `merged_into`, a repointed dive keeps the spelling it was recorded with
 * and lists under the survivor, and the merged row's own page is unreachable because
 * `db/catalogue.ts`'s `pickable` will not hand a non-`active` row back at all.
 *
 * ── Its deliberate near-duplicates, which §4.1 requires it to name ────────────────────────
 *
 * `isDiveWithCenter` (domain/centerDives.ts) is this question about the other table and shares
 * this one's rule. `siteIdentityOf` and `catalogueSiteIdentity` (domain/siteIdentity.ts) group
 * and compare by key, as above. `placeKeyOf` (domain/mapSites.ts) adds the map's third tier.
 * `tripKeyOf` (domain/trips.ts) groups a trip by centre. `diveSiteLabel` (format/display.ts)
 * DISPLAYS. Do not unify any of them.
 */

/** The catalogue row's half of the question — §6's `dive_sites` identity and its name. */
export type SiteIdentity = Pick<DiveSite, 'id' | 'name'>;

/** The dive's half: §6's `site_id` + `site_name` pair, and the status §2.4 filters on. */
export type DiveSitePair = Pick<Dive, 'siteId' | 'siteName' | 'status'>;

/**
 * Whether one dive was at one site — `diveBelongsToCatalogueRow` asked of §6's site pair.
 *
 * Exported for `isDiveWithCenter`'s reason: "how many of my dives are here" is asked of a whole
 * catalogue at once by the sites directory, where calling `divesAtSite` per site would walk the
 * logbook once per rock.
 */
export function isDiveAtSite(dive: DiveSitePair | null | undefined, site: SiteIdentity): boolean {
  return diveBelongsToCatalogueRow(
    dive ? { pairedId: dive.siteId, snapshot: dive.siteName, status: dive.status } : null,
    site,
  );
}

/**
 * Every logged dive in `dives` that was at `site`, in the order it was handed over —
 * `useDives()`' newest-first, exactly as `groupDivesByPlace` preserves it, so a site's page lists
 * dives in the same order the logbook does.
 */
export function divesAtSite<T extends DiveSitePair>(dives: readonly T[], site: SiteIdentity): T[] {
  return dives.filter((dive) => isDiveAtSite(dive, site));
}
