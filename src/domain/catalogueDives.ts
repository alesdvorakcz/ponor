import { foldForMatching } from './search';
import { type Dive } from './types';

/**
 * **Does this dive belong to that catalogue row?** — one rule, asked by a dive centre's page and
 * by a dive site's page (DESIGN.md §4.1).
 *
 * ── Why this is not `siteIdentityOf`, which is the question it looks like ──────────────────
 *
 * `domain/siteIdentity.ts` answers **"are these two dives at one place?"** — a grouping key
 * computed from a dive alone, where two dives belong together when their keys are equal. That is
 * the right shape for the Map's marks and for Stats' *sites visited*, both of which partition a
 * logbook with no catalogue row in front of them.
 *
 * This answers **"does this dive belong to that catalogue row?"** — a predicate over a *pair*,
 * one side of which is a `dive_sites` or `dive_centers` row rather than another dive. Written as
 * a key it would be wrong in a way that is easy to miss: a catalogue row always has an id, so
 * its key would be `site:<id>`; a dive that named the place by hand has no id, so its key would
 * be `name:<folded>`; the two would never be equal, and the page of the site a diver has been to
 * forty times would say they had never been. **Key equality is the wrong relation here** (M3c
 * found it for centres, and it is why `catalogueSiteIdentity` says in as many words that
 * `isDiveWithCenter` "accepts precisely that fold for a *page's* list of dives").
 *
 * ── The rule, in the order that decides it ────────────────────────────────────────────────
 *
 *  1. **A dive that carries the paired id is decided by that id alone**, matching or not
 *     matching. §6 pairs each id with a name snapshot, and the id is the identity half — so a
 *     dive pointing at *Blue Hole (Croatia)* stays that dive's site even when another row in the
 *     catalogue is also called *Blue Hole*. Reading the name as well would let one dive belong to
 *     two pages at once, which is not a display quirk: it would double-count the same dive in two
 *     summaries.
 *  2. **A dive with no id belongs by its folded name**, which is what nearly every dive in a real
 *     logbook has: §2.3 only started publishing sites and centres in M2o, and a place typed by
 *     hand is never paired. Folded through `foldForMatching` (domain/search.ts, §4.1's owner of
 *     how text is read before it is compared), so `zelezna` finds `Železná` here for the reason
 *     it does everywhere else (M2j).
 *
 * Those two together give the property worth having, and both callers' suites assert it rather
 * than assume it: **a paired dive belongs to at most one row**, so no dive appears on two pages.
 *
 * ── Why the rule is here and the columns are not ──────────────────────────────────────────
 *
 * `domain/centerDives.ts` and `domain/siteDives.ts` name the pair of columns their screen asks
 * about (`center_id`/`center_name`, `site_id`/`site_name`) and call this. That split is
 * deliberate in both directions.
 *
 * **The rule is shared** because it is genuinely one rule: `dive_sites` and `dive_centers` are
 * the same table under two names (file 2 of the migrations gives them the same shape, §5 covers
 * them in one sentence), and "does this dive belong to that row" has the same two tiers, the same
 * fold and the same §2.4 filter for both. Written out twice it would be the same eight lines in
 * two files, which is the defect §4.1 opens with — and the shape of that defect here is a silent
 * one, since a tier added to a centre's copy and not to a site's fails no gate. `withPoints`
 * (domain/mapSites.ts) records the identical argument for the identical pair of tables.
 *
 * **The columns are not shared** because a caller that had to name them would be one typo away
 * from listing a site's dives under a centre — `centerDives.ts`'s own warning against a
 * `siteOrCenterIdentityOf(dive, field)`, which is that warning's real content: the hazard was
 * never the sharing, it was a *field selector at the call site*. Nothing outside those two
 * modules can reach this function's `pairedId`/`snapshot` pair, and each of them fixes it once,
 * against `Pick`ed types, so picking the wrong column does not compile.
 *
 * ── Its deliberate near-duplicates, which §4.1 requires it to name ────────────────────────
 *
 * `siteIdentityOf` (domain/siteIdentity.ts) asks the dive-to-dive question above; `placeKeyOf`
 * (domain/mapSites.ts) adds the map's own third tier to it; `tripKeyOf` (domain/trips.ts) groups
 * a TRIP and is the one that *does* read the centre — centre first, nullable, because a trip is
 * "the same shop over a few days" and, unlike this, it has no catalogue row to compare against,
 * so it can and must treat "no place recorded" as a group of its own. `diveSiteLabel`
 * (format/display.ts) DISPLAYS. Do not unify any of them.
 *
 * Called during render over rows a bad join can put holes in, so it never dereferences what it
 * was not given — the stance `siteIdentityOf`, `logbookStats` and `assignDiveNumbers` all take.
 */

/** The catalogue row's half of the question: §6's identity and the name beside it. Both
 * `dive_sites` and `dive_centers` satisfy it, which is the point — see the docblock above. */
export interface CatalogueRowIdentity {
  id: string;
  name: string | null;
}

/**
 * The dive's half, already projected onto the pair of columns being asked about.
 *
 * The field names are this module's rather than §6's precisely so that the projection is a
 * deliberate act at each of the two call sites: `pairedId` is `center_id` in one and `site_id` in
 * the other, and neither module can supply the other's by accident.
 */
export interface DiveCataloguePairing {
  /** §6's `*_id` — the identity half, and tier 1 on its own. */
  readonly pairedId: string | null;
  /** §6's `*_name` snapshot — tier 2, and what nearly every real dive has. */
  readonly snapshot: string | null;
  /** §2.4's status: a plan is not a visit. */
  readonly status: Dive['status'];
}

/**
 * Whether one dive belongs to one catalogue row — the rule above, for a single pair.
 *
 * **Planned dives are excluded here rather than at the call site**, so that a page's summary line
 * and the rows underneath it cannot be computed from two different lists — the
 * two-populations-in-one-block defect §0.6 names for the Dives header. §2.4 excludes a plan from
 * stats and numbering, and `groupDivesByPlace` (domain/mapSites.ts) already keeps one off the map
 * for the same reason.
 */
export function diveBelongsToCatalogueRow(
  pairing: DiveCataloguePairing | null | undefined,
  row: CatalogueRowIdentity,
): boolean {
  if (!pairing || pairing.status !== 'logged') return false;

  // A catalogue row always has an id; one that somehow does not is not something a dive can be
  // paired to, and falling through to the name alone would put dives under a row with no page.
  const rowId = typeof row.id === 'string' ? row.id : '';
  if (rowId === '') return false;

  // Tier 1: an id decides on its own, in both directions. A dive that names a different row is
  // not this row's, however its snapshot happens to be spelled.
  const paired = typeof pairing.pairedId === 'string' ? pairing.pairedId : '';
  if (paired !== '') return paired === rowId;

  // Tier 2: no id, so the snapshot is all there is. Both sides folded, and **one condition covers
  // both** — an absent name on either side folds to `''`, so requiring the dive's to be non-empty
  // already refuses a nameless row as well. A second `if (wanted === '') return false` was written
  // here first and measured: it could not fail, because the expression below answers `false` in
  // exactly the cases it was guarding. §10 declines a guard nothing could catch failing.
  const wanted = typeof row.name === 'string' ? foldForMatching(row.name) : '';
  const recorded = typeof pairing.snapshot === 'string' ? foldForMatching(pairing.snapshot) : '';
  return recorded !== '' && recorded === wanted;
}
