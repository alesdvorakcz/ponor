import { foldForMatching } from './search';
import { type Dive, type DiveCenter } from './types';

/**
 * **Which of my dives were with this centre** — the rule behind everything a centre's own page
 * says about a diver's logbook (DESIGN.md §4.1).
 *
 * ── Why this is not `siteIdentityOf`, which is the question the brief asked ────────────────
 *
 * `domain/siteIdentity.ts` answers **"are these two dives at one place?"** — a grouping key,
 * computed from a dive alone, and two dives belong together when their keys are equal. That is
 * the right shape for the Map's markers and for Stats' *sites visited*, both of which partition
 * a logbook with no catalogue row in front of them.
 *
 * This answers **"does this dive belong to that catalogue row?"** — a predicate over a *pair*,
 * one side of which is a `dive_centers` row rather than another dive. Written as a key it would
 * be wrong in a way that is easy to miss: a catalogue row always has an id, so its key would be
 * `center:<id>`; a dive that names the shop by hand has no id, so its key would be
 * `name:<folded>`; the two would never be equal, and the page of the centre a diver has been to
 * forty times would say they had never been. **Key equality is the wrong relation here**, and
 * that is the whole reason this is a second, named rule rather than a generalisation of that
 * one. Generalising the *shape* — a `siteOrCenterIdentityOf(dive, field)` — would produce a
 * function that answers this screen's question incorrectly while looking like it answers it.
 *
 * ── The rule, in the order that decides it ────────────────────────────────────────────────
 *
 *  1. **A dive that carries a `center_id` is decided by that id alone**, matching or not
 *     matching. §6 pairs the id with a `center_name` snapshot, and the id is the identity half
 *     — so a dive pointing at *Aqua Split* stays that dive's centre even when another row in
 *     the catalogue is also called `Aqua`. Reading the name as well would let one dive belong
 *     to two centres' pages at once, which is not a display quirk: it would double-count the
 *     same dive in two summaries.
 *  2. **A dive with no id belongs by its folded name**, which is what nearly every dive in a
 *     real logbook has: §2.3 only started publishing centres in M2o, and a centre typed by hand
 *     is never paired. Folded through `foldForMatching` (domain/search.ts, §4.1's owner of how
 *     text is read before it is compared), so `aqua` and `Aqua` are one shop and `Ponorka` finds
 *     itself under either spelling (M2j).
 *
 * Those two together give the property worth having, and it is asserted rather than assumed:
 * **a dive belongs to at most one centre**, so no dive can appear on two centres' pages.
 *
 * ── What a merge leaves for this to do, which is nothing (§5, M2r) ────────────────────────
 *
 * When an admin folds one centre into another, the last step of the next pull rewrites every
 * dive's `center_id` to the survivor and leaves the `center_name` snapshot alone
 * (`domain/merges.ts`). By the time anything here runs, the dives already point at the survivor
 * — so this function never reads `merged_into`, and a merged centre's page is unreachable
 * because `db/catalogue.ts`'s `pickable` refuses to hand a non-`active` row back at all. The
 * one visible consequence is the right one: a repointed dive keeps the spelling it was recorded
 * with and still lists under the surviving centre.
 *
 * ── Planned dives are excluded, and the count and the list are the same population ─────────
 *
 * §2.4 excludes a plan from stats and numbering, and `groupDivesByPlace` (domain/mapSites.ts)
 * already keeps them off the map for the same reason. The filter is **inside** this function
 * rather than at the call site so that a centre's summary line and the rows underneath it
 * cannot be computed from two different lists — the two-populations-in-one-block defect §0.6
 * names for the Dives header.
 *
 * ── Its deliberate near-duplicates, which §4.1 requires it to name ────────────────────────
 *
 * `siteIdentityOf` (domain/siteIdentity.ts) asks the dive-to-dive question above; `placeKeyOf`
 * (domain/mapSites.ts) adds the map's own third tier to it; `tripKeyOf` (domain/trips.ts) groups
 * a TRIP and is the one that *does* read the centre — centre first, nullable, because a trip is
 * "the same shop over a few days". That last one is the near-miss worth stating: it reads the
 * same column for a different purpose and, unlike this, has no catalogue row to compare against,
 * so it can and must treat "no centre recorded" as a group of its own. `diveSiteLabel`
 * (format/display.ts) DISPLAYS. Do not unify any of them.
 *
 * Called during render over rows a bad join can put holes in, so it never dereferences what it
 * was not given — the stance `siteIdentityOf`, `logbookStats` and `assignDiveNumbers` all take.
 */

/** The catalogue row's half of the question — §6's `dive_centers` identity and its name. */
export type CenterIdentity = Pick<DiveCenter, 'id' | 'name'>;

/** The dive's half: §6's `center_id` + `center_name` pair, and the status §2.4 filters on. */
export type DiveCenterPair = Pick<Dive, 'centerId' | 'centerName' | 'status'>;

/**
 * Whether one dive was with one centre — the rule above, for a single row.
 *
 * Exported because "how many of my dives were with them" is asked of a whole catalogue at once
 * by the centres directory, where calling `divesWithCenter` per centre would walk the logbook
 * once per shop.
 */
export function isDiveWithCenter(dive: DiveCenterPair | null | undefined, center: CenterIdentity): boolean {
  if (!dive || dive.status !== 'logged') return false;
  const centerId = typeof center.id === 'string' ? center.id : '';
  if (centerId === '') return false;

  const paired = typeof dive.centerId === 'string' ? dive.centerId : '';
  // Tier 1: an id decides on its own, in both directions. A dive that names a different row is
  // not this centre's, however its snapshot happens to be spelled.
  if (paired !== '') return paired === centerId;

  // Tier 2: no id, so the snapshot is all there is. Both sides folded, and **one condition
  // covers both** — an absent name on either side folds to `''`, so requiring the dive's to be
  // non-empty already refuses a nameless centre as well. A second `if (wanted === '') return
  // false` was written here first and measured: it could not fail, because the expression below
  // answers `false` in exactly the cases it was guarding. §10 declines a guard nothing could
  // catch failing, so it is one line rather than two.
  const wanted = typeof center.name === 'string' ? foldForMatching(center.name) : '';
  const recorded = typeof dive.centerName === 'string' ? foldForMatching(dive.centerName) : '';
  return recorded !== '' && recorded === wanted;
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
