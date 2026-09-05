import { diveBelongsToCatalogueRow } from './catalogueDives';
import { type Dive, type DiveCenter } from './types';

/**
 * **Which of my dives were with this centre** — the rule behind everything a centre's own page
 * says about a diver's logbook (DESIGN.md §4.1).
 *
 * ── What is here, and what moved (M3f) ────────────────────────────────────────────────────
 *
 * The two-tier rule itself — an id decides on its own, an unpaired dive belongs by its folded
 * name, a plan is not a visit — is `diveBelongsToCatalogueRow` (domain/catalogueDives.ts), which
 * carries the whole of it and the argument for why it is not `siteIdentityOf`. **It moved when a
 * second catalogue table asked the same question**: a dive site's page (M3f) asks it of
 * `site_id`/`site_name` exactly as this asks it of `center_id`/`center_name`, and two copies of
 * those eight lines would be §4.1's opening sentence written out.
 *
 * **What stays here is the pair of columns**, and that is the half that may not be shared. This
 * module's warning against a `siteOrCenterIdentityOf(dive, field)` was never about the rule being
 * one rule; it was about a *field selector at the call site*, which is one typo away from listing
 * a site's dives under a centre. So the projection happens once, here, against `Pick`ed types,
 * and no screen names a column at all.
 *
 * ── What a merge leaves for this to do, which is nothing (§5, M2r) ────────────────────────
 *
 * When an admin folds one centre into another, the last step of the next pull rewrites every
 * dive's `center_id` to the survivor and leaves the `center_name` snapshot alone
 * (`domain/merges.ts`). By the time anything here runs, the dives already point at the survivor
 * — so nothing reads `merged_into`, and a merged centre's page is unreachable because
 * `db/catalogue.ts`'s `pickable` refuses to hand a non-`active` row back at all. The one visible
 * consequence is the right one: a repointed dive keeps the spelling it was recorded with and
 * still lists under the surviving centre.
 *
 * ── Its deliberate near-duplicates, which §4.1 requires it to name ────────────────────────
 *
 * `isDiveAtSite` (domain/siteDives.ts) is the same question about the other table and shares this
 * one's rule; `siteIdentityOf` (domain/siteIdentity.ts) asks the dive-to-dive question;
 * `placeKeyOf` (domain/mapSites.ts) adds the map's own third tier to it; `tripKeyOf`
 * (domain/trips.ts) groups a TRIP and is the near-miss worth stating — it reads this same column
 * for a different purpose and, unlike this, has no catalogue row to compare against, so it can
 * and must treat "no centre recorded" as a group of its own. `diveSiteLabel` (format/display.ts)
 * DISPLAYS. Do not unify any of them.
 */

/** The catalogue row's half of the question — §6's `dive_centers` identity and its name. */
export type CenterIdentity = Pick<DiveCenter, 'id' | 'name'>;

/** The dive's half: §6's `center_id` + `center_name` pair, and the status §2.4 filters on. */
export type DiveCenterPair = Pick<Dive, 'centerId' | 'centerName' | 'status'>;

/**
 * Whether one dive was with one centre — `diveBelongsToCatalogueRow` asked of §6's centre pair.
 *
 * Exported because "how many of my dives were with them" is asked of a whole catalogue at once
 * by the centres directory, where calling `divesWithCenter` per centre would walk the logbook
 * once per shop.
 */
export function isDiveWithCenter(dive: DiveCenterPair | null | undefined, center: CenterIdentity): boolean {
  return diveBelongsToCatalogueRow(
    dive ? { pairedId: dive.centerId, snapshot: dive.centerName, status: dive.status } : null,
    center,
  );
}

/**
 * Every logged dive in `dives` that was with `center`, in the order it was handed over —
 * `useDives()`' newest-first, exactly as `groupDivesByPlace` preserves it, so a centre's page
 * lists dives in the same order the logbook does.
 */
export function divesWithCenter<T extends DiveCenterPair>(
  dives: readonly T[],
  center: CenterIdentity,
): T[] {
  return dives.filter((dive) => isDiveWithCenter(dive, center));
}
