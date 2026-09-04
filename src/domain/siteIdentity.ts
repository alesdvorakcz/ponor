import { foldForMatching } from './search';
import { type Dive } from './types';

/**
 * **Which dives are at one site** — the single rule behind every figure that counts places
 * rather than dives (DESIGN.md §4.1).
 *
 * It exists because two features ask exactly this question and must not answer it differently:
 * §3's Map tab groups the diver's dives into markers (`placeKeyOf`, domain/mapSites.ts) and
 * §3's Stats tab counts *"sites visited"* (`sitesVisited`, domain/logbookStats.ts). A logbook
 * that draws three markers and reports four sites is §4.1's defining defect said out loud, and
 * it is the shape this repo has shipped before — a dive number reading #2, #1, #3.
 *
 * Extracted from `placeKeyOf` rather than copied out of it (M3a): that function was the first
 * reader and kept the rule private, so the second reader had nowhere to get it from.
 */

/** The only fields site identity depends on — §6's snapshot/id pair, and nothing else. */
export type DiveSiteIdentity = Pick<Dive, 'siteId' | 'siteName'>;

/**
 * What names the place this dive was at, or `null` when the dive names no place at all.
 *
 * Two tiers, and the order between them is the whole decision:
 *
 *  1. **`siteId`** — the catalogue's own identity (§6). Two dives pointing at one row are at
 *     one site even when their `site_name` snapshots differ, which they will the day an admin
 *     renames a site (§5) or folds one into another (M2r rewrites the dives' `site_id` to the
 *     survivor and leaves every snapshot alone, so the two collapse here for free).
 *  2. **The folded `siteName`** — §6's snapshot, which is what *every* dive has where the id is
 *     what few have: a site typed by hand and never picked from the catalogue has no id at all,
 *     and that is every site in a logbook that has never synced. Folded through
 *     `foldForMatching` (domain/search.ts, §4.1's owner of how text is read before it is
 *     compared), because `Kotelna` and `kotelna` are one site to a diver (§2.3) and counting
 *     them as two would make the figure depend on the shift key.
 *
 * **Id first, and the cost of that is named rather than hidden.** A diver who has logged forty
 * dives at a hand-typed `Kotelna` and then publishes it (§2.3's *Add "Kotelna" as a new site*)
 * has forty dives with a null id and one with an id, and this reports **two** sites until the
 * older dives are repointed. That is accepted for two reasons. It never merges two places the
 * catalogue says are different — a name-first rule would file Egypt's *Blue Hole* and Malta's
 * as one site the moment a diver had both, and would do it in the direction that *hides* a
 * place. And it is the same rule the map groups markers by, so "12 sites" on Stats and the
 * markers on the map are the same twelve; a cleverer count here would be a second answer, which
 * is the thing this module exists to prevent.
 *
 * **`null` is a real answer and not a failure.** A dive with neither an id nor a name is a dive
 * whose place was never recorded; counting it as a site would invent one out of an absence, and
 * counting *several* such dives as one site would invent a shared place out of a shared
 * absence. The map adds a third tier of its own for them (`placeKeyOf` keys them by the dive's
 * own id) because a pinned dive still has somewhere to draw a marker — that tier belongs to the
 * map's question, not to this one, and is deliberately not here.
 *
 * **Prefixed per tier** so a site whose id happens to be `blue hole` cannot collide with a site
 * *named* "Blue Hole".
 *
 * **Its deliberate near-duplicates, which §4.1 requires it to name.** `tripKeyOf`
 * (domain/trips.ts) groups a TRIP — centre first, and nullable, because a trip is the same shop
 * over a few days. `diveSiteLabel` (format/display.ts) DISPLAYS — site first, centre next,
 * never null, because a row with no heading is a blank line. `ReorderControls`' `rowLabel`
 * SPEAKS. And `presetNameKey` (domain/presets.ts) is the near-miss worth stating outright: it
 * looks like this expression and must never be given this fold — it decides whether two presets
 * are the *same preset*, so folding it would make `Zelezna` and `Železná` one preset and a
 * rename would silently collide. That one is an identity key that may not move; this one is a
 * match fold that already has (M2j).
 *
 * Called during render, on a list a bad join can put holes in, so it never dereferences what it
 * was not given — the same stance `logbookStats` and `assignDiveNumbers` take for the same
 * reason.
 */
export function siteIdentityOf(dive: DiveSiteIdentity | null | undefined): string | null {
  if (!dive) return null;
  const paired = catalogueSiteIdentity(dive.siteId);
  if (paired !== null) return paired;
  const folded = typeof dive.siteName === 'string' ? foldForMatching(dive.siteName) : '';
  return folded === '' ? null : `name:${folded}`;
}

/**
 * **The same identity, asked of a catalogue ROW rather than of a dive** — `site:<id>`, or `null`
 * for an id that names nothing.
 *
 * It exists because M3e put the diver's own dives and the community catalogue on the map *at the
 * same time*, and a site a diver has dived is then drawn twice at one coordinate — exactly once
 * where the app created that site from that dive (`siteFactsFrom`, domain/diveFormSchema.ts,
 * copies the dive's own pin into the new row and the dive is paired to it by id, so the two marks
 * are not near each other, they are the same pixel). `sitesWithoutYourMark` (domain/mapSites.ts)
 * settles that by identity, and this is the half of the comparison the catalogue side needs.
 *
 * **Tier 1 only, and that is the decision rather than an unfinished version of it.** A dive that
 * names its site by hand has a `name:<folded>` identity, and folding a catalogue row's name into
 * the same shape would let one *name* take a site off the map: a diver with a `Blue Hole` in
 * Croatia would silently lose Egypt's and Malta's rows, which are different rocks on different
 * continents. `isDiveWithCenter` (domain/centerDives.ts) accepts precisely that fold for a
 * *page's* list of dives, where the cost is a dive listed under two shops the diver never told
 * apart; here the cost would be a place missing from a map, which is the one thing a map may not
 * do. So an unpaired dive and its catalogue row draw two marks a few metres apart, which is
 * honest — the app genuinely does not know they are one place — and is the same trade-off this
 * module's own docblock already accepts for `sites visited`.
 *
 * Exported so the prefix is written once. It was inline in the tier above until this second
 * reader arrived, and a second `site:${id}` typed anywhere is the drift §4.1 is about.
 */
export function catalogueSiteIdentity(id: string | null | undefined): string | null {
  return typeof id === 'string' && id !== '' ? `site:${id}` : null;
}
