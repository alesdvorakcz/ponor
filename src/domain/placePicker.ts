import { divesOfRow, type CatalogueDiveLookup } from './catalogueDives';
import { centerDiveLookup } from './centerDives';
import { compareDiveOrder } from './diveNumber';
import { distanceKm } from './geo';
import { pointOf, type MapPoint } from './mapSites';
import { alsoCalled, browseCatalogue, foldForMatching } from './search';
import { siteDiveLookup } from './siteDives';
import { historyOf, type SuggestionHistory } from './suggest';
import { type Dive, type DiveSite } from './types';

/**
 * **What the site and centre picker lists, and under which heading** (the site-picker design,
 * "The picker page"; issue #19). The screen renders this and decides nothing: which rows appear,
 * in which group, in what order, marked how — all of it is here, so it can be tested without a
 * screen and so the site picker and the centre picker cannot drift apart.
 *
 * ── One list, grouped by one question: *have you dived here?* ─────────────────────────────
 *
 * `'dived'` is the diver's own history ("Dived here" / "Dived with"), `'other'` is everything
 * else the catalogue holds that the query names. **That second group is what makes typing find
 * things**: the form used to search only what the diver had already typed into a dive, so a
 * community site nobody on this phone had dived was unreachable by name, and a site created a
 * moment ago was unfindable (the design's defects 1, 3, 4 and 5). Typing is never limited by
 * distance either — a diver at home back-fills a dive from another country.
 *
 * `'near'` is Near me and `'nearSite'` is the centre picker's "near the site this dive is at";
 * both are groups of their own because each answers a different question than history does, and
 * each *replaces* the history groups rather than sitting beside them (Near me is one list, the
 * design says; a row then needs no second appearance).
 *
 * ── Which dives count, and why this does not match ids itself ─────────────────────────────
 *
 * A row is *dived* when the rule `divesAtSite` / `divesWithCenter` apply pairs at least one
 * **logged** dive to it — read through `siteDiveLookup` / `centerDiveLookup` (#36), which sort the
 * logbook once rather than walking it per row. That rule is the one the site and centre pages
 * use — an id decides on its own, a dive without an id belongs by its folded name, a plan is not a
 * visit, and a merge's repointed dives already point at the survivor — so the picker shows a diver
 * the same history the row's own page would. A hand-rolled `siteId === id` here would list a site
 * the diver has dived forty times, from before the catalogue, as never visited. The counts are
 * `historyOf`'s (domain/suggest.ts), the recipe the form's buddy and guide suggestions count with
 * too: `logbookStats` for the number and the deepest, the latest logged date, `sitesVisited` for
 * the distinct places.
 *
 * Nothing here throws on a malformed row. The picker is built during render over whatever the
 * database handed back, and the stance everywhere in `domain/` is that a row it cannot read
 * costs that row, not the list.
 */

/** Which table the picker is choosing from. */
export type PlaceKind = 'site' | 'center';

/**
 * Where a row came from, in the terms the diver reads on its meta line: `'community'` (the
 * shared catalogue), `'yours'` (this diver contributed it — pushed or still waiting), or
 * `'phoneOnly'` (a guest's row, which nothing pushes until they sign in).
 */
export type Provenance = 'community' | 'yours' | 'phoneOnly';

/** Near me's radius (the design: **NEAR YOU · WITHIN 50 KM**). */
export const NEAR_ME_RADIUS_KM = 50;

/** How close a centre must be to the dive's site to be offered under **NEAR [SITE]**. */
export const NEAR_SITE_RADIUS_KM = 10;

/**
 * The columns the picker reads. Sites and centres share them (§5 covers "a site or center" in
 * one sentence), and the `Pick` of `DiveSite` is what a `DiveCenter` row satisfies structurally.
 * `altNames` is a site's alone (#31) — a centre goes by one name — so it is optional, and a row
 * without it is matched by its name as before.
 */
export type PickerPlace = Pick<
  DiveSite,
  'id' | 'name' | 'country' | 'latitude' | 'longitude' | 'createdBy' | 'dirty'
> & { altNames?: readonly string[] };

/** One line of the list, as far as the rules go; wording and formatting belong to the screen. */
export interface PickerRow {
  id: string;
  /** As stored. A place without a name stays `null` here; how that reads is the screen's. */
  name: string | null;
  country: string | null;
  provenance: Provenance;
  /** What the logged dives paired to this row add up to (`historyOf`); null when there are none. */
  dived: SuggestionHistory | null;
  /** Only in the `'near'` and `'nearSite'` groups. */
  distanceKm: number | null;
  /** Whether this is the place the field already holds. */
  selected: boolean;
  /**
   * The other name the typed query found this row by (`alsoCalled`, #31), so the row can say
   * *also called Stone Gate*; null when nothing is typed or the row's own name matched.
   */
  alsoCalled: string | null;
}

export type PickerGroupKey = 'dived' | 'other' | 'near' | 'nearSite';
export interface PickerGroup {
  key: PickerGroupKey;
  rows: PickerRow[];
}

export interface PickerInput {
  kind: PlaceKind;
  /** The device's catalogue, live — including rows created here and not yet pushed. */
  places: readonly PickerPlace[];
  /**
   * The logbook, **treated as immutable** (#36): `pickerGroups` keeps its pairing lookup against
   * this array, so a changed logbook must arrive as a new array — as every live read hands one
   * over — and never as this one edited in place, or *Dived here* would answer for the old one.
   */
  dives: readonly Dive[];
  query: string;
  selectedId: string | null;
  /** The Near me fix; null = off. */
  near: MapPoint | null;
  /** Centre picker only: the position of the site the dive is paired to. */
  nearSite: MapPoint | null;
  viewer: { signedIn: boolean; userId: string | null };
}

/**
 * Where a row came from, for the viewer looking at it.
 *
 * A pending row (`dirty`) is the viewer's own in both cases — a signed-in diver's will be
 * pushed, a guest's will not until they sign in, and that difference is the only reason the
 * third word exists. Otherwise it is *yours* only when the creator is the viewer; a null
 * `createdBy` (an account since deleted, §5) never equals a viewer without a user id.
 */
export function provenanceOf(
  place: PickerPlace,
  viewer: PickerInput['viewer'],
): Provenance {
  if (place.dirty) return viewer.signedIn ? 'yours' : 'phoneOnly';
  if (
    viewer.signedIn &&
    viewer.userId !== null &&
    place.createdBy === viewer.userId
  )
    return 'yours';
  return 'community';
}

/** A catalogue row we can read: an object with a string id. Anything else is skipped. */
function isReadable(
  place: PickerPlace | null | undefined,
): place is PickerPlace {
  return !!place && typeof place.id === 'string' && place.id !== '';
}

/**
 * **The logbook sorted once per logbook, not once per keystroke** (#36). The screen hands
 * `pickerGroups` the same dives array until the logbook changes (`PlacePickerScreen`'s `history`,
 * memoised on the live read), so the lookup is kept against that array: typing reuses it, and a
 * dive saved while the picker is open arrives as a new array and gets a new lookup. One cache per
 * kind, because a site's lookup and a centre's read different columns of the same dives. A
 * `WeakMap`, so a logbook nobody holds any more takes its lookup with it.
 */
const lookups: Record<PlaceKind, WeakMap<readonly Dive[], CatalogueDiveLookup<Dive>>> = {
  site: new WeakMap(),
  center: new WeakMap(),
};

/** What a logbook the picker cannot read is paired against: one shared array, so one lookup. */
const NO_DIVES: readonly Dive[] = [];

function lookupFor(kind: PlaceKind, dives: readonly Dive[]): CatalogueDiveLookup<Dive> {
  const cached = lookups[kind].get(dives);
  if (cached !== undefined) return cached;
  const built = kind === 'site' ? siteDiveLookup(dives) : centerDiveLookup(dives);
  lookups[kind].set(dives, built);
  return built;
}

/** The counts a dived row shows, or null when no logged dive is paired to it. */
function divedOf(paired: readonly Dive[]): PickerRow['dived'] {
  const history = historyOf(paired);
  return history.dives === 0 ? null : history;
}

/**
 * A row's latest logged dive in the logbook's own order — `compareDiveOrder`, §2.5's one owner:
 * date, then time in, then hand order, then the order they were logged. What *most recently
 * dived* sorts on, so two sites dived on one boat day stand in the order the dive numbers put
 * them rather than in the alphabet's.
 */
function latestOf(paired: readonly Dive[]): Dive | null {
  let latest: Dive | null = null;
  for (const d of paired) {
    if (latest === null || compareDiveOrder(d, latest) > 0) latest = d;
  }
  return latest;
}

/**
 * The picker's groups, empty ones omitted.
 *
 * - **Near me on** → one `'near'` group: every row with a position within 50 km of the fix,
 *   dived or not, nearest first, and the query still filters. A row with no usable position
 *   cannot be placed on a distance list and is left out; it is still found by typing.
 * - **Something typed** → `'dived'` (dived rows whose name matches, most recent first — by each
 *   row's latest dive in the logbook's order, so a same-day tie goes to the later dive), then
 *   `'other'` (every other matching row at any distance: name-prefix matches first, then the
 *   catalogue's own alphabetical order from `browseCatalogue`).
 * - **Nothing typed** → `'dived'` alone — and, for the centre picker with the dive's site
 *   positioned, `'nearSite'`: every catalogue centre with a usable position within 10 km of it, nearest first, minus
 *   any already in `'dived'` so no row appears twice. Whatever its provenance: a centre the diver
 *   added and never dived with is as near as any other.
 *
 * `selected` is a mark on whichever row is the field's value wherever it already qualifies. The
 * selected place is never added to a group it does not belong to — a site created a moment ago
 * has no dives, so with nothing typed it is in no group, and the screen's *Selected* line shows it.
 *
 * A row *matches* by its name or by any other name it goes by (`browseCatalogue`, #31), and one
 * found only by another name carries that name in `alsoCalled` for its meta line to say. It is
 * never a name-prefix match, since the row shows its own name, so it follows those under `'other'`.
 */
export function pickerGroups(input: PickerInput): PickerGroup[] {
  const { kind, query, selectedId, viewer } = input;
  const places = Array.isArray(input.places)
    ? input.places.filter(isReadable)
    : [];
  // The lookup files only logged dives, so plans need no filter of their own here.
  const lookup = lookupFor(kind, Array.isArray(input.dives) ? input.dives : NO_DIVES);
  const text = typeof query === 'string' ? query : '';
  const needle = foldForMatching(text);
  const typed = needle !== '';
  const near = input.near ? pointOf(input.near) : null;
  const nearSite = input.nearSite ? pointOf(input.nearSite) : null;

  const row = (
    place: PickerPlace,
    paired: readonly Dive[],
    distance: number | null,
  ): PickerRow => ({
    id: place.id,
    name: typeof place.name === 'string' ? place.name : null,
    country: typeof place.country === 'string' ? place.country : null,
    provenance: provenanceOf(place, viewer),
    dived: divedOf(paired),
    distanceKm: distance,
    selected: selectedId !== null && place.id === selectedId,
    alsoCalled: alsoCalled(place, text),
  });

  const matching = browseCatalogue(places, text);
  const pairedOf = new Map<string, Dive[]>();
  for (const place of matching)
    pairedOf.set(place.id, divesOfRow(lookup, place));

  const distanceTo = (from: MapPoint, place: PickerPlace): number | null => {
    const at = pointOf(place);
    return at === null ? null : distanceKm(from, at);
  };

  if (near !== null) {
    const rows: { row: PickerRow; km: number }[] = [];
    for (const place of matching) {
      const km = distanceTo(near, place);
      if (km === null || km > NEAR_ME_RADIUS_KM) continue;
      rows.push({ row: row(place, pairedOf.get(place.id) ?? [], km), km });
    }
    rows.sort((a, b) => a.km - b.km);
    return rows.length > 0
      ? [{ key: 'near', rows: rows.map((r) => r.row) }]
      : [];
  }

  const groups: PickerGroup[] = [];

  // Latest dive first (`latestOf`). Two rows tie only when their latest dive is the same dive —
  // one with no id belongs to every row its name matches — and then `matching`'s own order, the
  // catalogue's alphabet, decides: by position, so it never rests on `sort` being stable.
  const dived = matching
    .flatMap((place, index) => {
      const paired = pairedOf.get(place.id) ?? [];
      const latest = latestOf(paired);
      const r = row(place, paired, null);
      return r.dived === null || latest === null ? [] : [{ row: r, latest, index }];
    })
    .sort((a, b) => {
      const order = compareDiveOrder(b.latest, a.latest);
      return order !== 0 ? order : a.index - b.index;
    })
    .map((entry) => entry.row);
  if (dived.length > 0) groups.push({ key: 'dived', rows: dived });
  const divedIds = new Set(dived.map((r) => r.id));

  if (typed) {
    const others = matching.filter((place) => !divedIds.has(place.id));
    const prefix = (place: PickerPlace) =>
      typeof place.name === 'string' &&
      foldForMatching(place.name).startsWith(needle);
    const ordered = [
      ...others.filter(prefix),
      ...others.filter((place) => !prefix(place)),
    ];
    if (ordered.length > 0) {
      groups.push({
        key: 'other',
        rows: ordered.map((place) => row(place, [], null)),
      });
    }
    return groups;
  }

  if (kind === 'center' && nearSite !== null) {
    const rows: { row: PickerRow; km: number }[] = [];
    for (const place of matching) {
      if (divedIds.has(place.id)) continue;
      const km = distanceTo(nearSite, place);
      if (km === null || km > NEAR_SITE_RADIUS_KM) continue;
      rows.push({ row: row(place, [], km), km });
    }
    rows.sort((a, b) => a.km - b.km);
    if (rows.length > 0)
      groups.push({ key: 'nearSite', rows: rows.map((r) => r.row) });
  }

  return groups;
}
