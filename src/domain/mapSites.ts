import { diveSiteLabel } from '../format/display';
import { foldForMatching } from './search';
import { type Dive, type DiveSite } from './types';

/**
 * **What the Map tab knows about places** (DESIGN.md §3: *"clustered pins of your dives (badge
 * = count per site); tapping a site shows your dives there with a depth/temp summary; toggle to
 * explore all community sites"*).
 *
 * Everything here is pure and takes no renderer, no database and no `MapView` — which is the
 * point of the split. `react-native-maps` cannot be exercised under Jest in any way that means
 * anything (`components/DiveMap.tsx` records exactly what a mocked map can and cannot prove),
 * so every rule the map obeys that is *ours* lives here instead: which dives can be pinned,
 * which of them share a pin, where that pin sits, and what rectangle frames the lot.
 *
 * ── Where a pin comes from, which is the fact that shapes this whole screen ────────────────
 *
 * Two sources, and only one of them has anything in it today:
 *
 *  · **A dive's own `latitude`/`longitude`** (§6's optional exact point). Settable since M2l's
 *    *use my location*, and **null on every dive logged before it** — M1i took the coordinate
 *    keypads off the form and §10 records the consequence in as many words: *"no dive logged in
 *    M1 can carry a GPS point"*. So a real logbook arrives here with a handful of pinned dives
 *    at most, and the honest common case for a while is *"you have dives, none with a pin"*.
 *  · **`dive_sites.location`**, which reaches the device only through a pull and is empty today
 *    because nothing creates a site yet. That is the community layer, and it is why the toggle
 *    §3 asks for has an empty-handed branch that is a real sentence rather than a blank map.
 *
 * §5 already settled which wins where both exist: *"a dive can carry its own optional GPS
 * point, and the personal map prefers it"*. So the personal layer never consults a site's
 * surveyed pin, and the community layer never consults a dive.
 */

/** A point on the earth, in the two numbers §6 stores. Named rather than reusing
 * `react-native-maps`' `LatLng` so that nothing in `src/domain/` imports a native module. */
export interface MapPoint {
  latitude: number;
  longitude: number;
}

/**
 * A place with at least one pin behind it: one marker on the map, and one sheet when it is
 * tapped.
 *
 * `dives` is **every logged dive at that place**, not only the ones carrying a point — §3 says
 * tapping a site shows *"your dives there"*, and a diver with four dives at Blue Hole of which
 * one was logged after M2l has four dives there. The badge therefore counts more than the app
 * has coordinates for, which is correct and is the reason `point` is a separate field rather
 * than something a caller could derive from the list.
 */
export interface MapSite {
  /** Stable across renders and unique within one grouping — see `placeKeyOf`. */
  key: string;
  /** What the marker announces and the sheet is titled: `diveSiteLabel`'s answer for the
   * group's first dive, so a place is called on this screen exactly what it is called in a
   * dive row and on the dive detail. */
  label: string;
  /** Where the marker goes: the first pinned dive in the order this was handed. */
  point: MapPoint;
  /** Every logged dive at this place, in the order it arrived (newest first, from `useDives`). */
  dives: Dive[];
}

/** The coldest and warmest water recorded at a place, in °C. Both fields are real readings
 * from real dives; a place with one temperature reading has them equal. */
export interface WaterTempRange {
  coldestC: number;
  warmestC: number;
}

/** What a `MapView` is handed as its `initialRegion` — the shape react-native-maps calls
 * `Region`, restated here for the same reason `MapPoint` is. */
export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/**
 * **How tightly a region hugs its pins, and the floor under it.**
 *
 * `REGION_PADDING` is a multiplier rather than a margin in degrees, because a degree is a
 * different distance at every zoom: a trip's four pins 300 m apart and a lifetime's pins across
 * two oceans both want the same *proportional* air around them.
 *
 * `MIN_REGION_DELTA` is what a single pin gets, since its bounding box is a point and any
 * multiple of zero is zero — a map handed `latitudeDelta: 0` renders at maximum zoom, which is
 * a view of the sea floor from six inches. 0.02° of latitude is about 2.2 km, which frames a
 * dive site with its shoreline. It is a floor on both axes rather than only on the degenerate
 * case, so two pins 50 m apart are also framed rather than filling the screen.
 */
const REGION_PADDING = 1.4;
const MIN_REGION_DELTA = 0.02;

/**
 * Whether a stored pair is a point that can be drawn — finite, and on the earth.
 *
 * The range check is not decoration. §1's write boundary stores what it is given and §7 will
 * apply rows this build never composed, so a latitude of 200 can arrive; handed to a map it is
 * either clamped somewhere arbitrary or it drags the whole region with it, and either way the
 * screen shows a place nobody dived. This is the same shape as `isDisplayableDepth`
 * (format/display.ts): one predicate deciding what may be shown, so the thing that draws and
 * the thing that frames cannot disagree about which dives are on the map.
 *
 * `0, 0` is accepted. It is in the Gulf of Guinea, it is a legal fix, and refusing it would be
 * this module inventing a rule about what a plausible dive is — §1's "never shame the form",
 * one layer down. `platform/location.ts` already refuses a fix too rough to be a claim (§10).
 */
export function pointOf(source: { latitude: number | null; longitude: number | null }): MapPoint | null {
  const { latitude, longitude } = source;
  if (latitude === null || longitude === null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/**
 * **Which dives share a pin** — §3's clustering, and the reason it needs no library.
 *
 * §3 asks for a *"badge = count per site"*, and dives at one site already carry the thing that
 * says so: §6's `site_id` + `site_name` snapshot pair. So the grouping is by identity rather
 * than by geometry, which is both cheaper and more truthful — two dives 40 m apart at the same
 * site are one place whatever the zoom, and geometric clustering would merge or split them as
 * the diver pinched. §4 rejected FlashList partly to avoid another New-Architecture dependency
 * and the same instinct applies here: a personal logbook is hundreds of pins, not thousands.
 *
 * **This is the fourth reader of a dive's place and §4.1 requires it to name the other three.**
 * `tripKeyOf` (domain/trips.ts) groups a TRIP — centre first, and nullable, because a trip is
 * "the same shop over a few days" and "no place recorded" has to stay distinguishable.
 * `diveSiteLabel` (format/display.ts) DISPLAYS — site first, never null. `ReorderControls`'
 * `rowLabel` SPEAKS. This one groups a MAP, and it differs from `tripKeyOf` on the one axis
 * that matters here: **it never falls back to the centre.** A dive centre is a shop, not a
 * place you dived; grouping by it would put four dives at four different sites under one shop's
 * marker, at whichever of their coordinates happened to come first. Do not unify these.
 *
 * The three tiers, in order:
 *
 *  1. **`siteId`** — the catalogue's own identity (§6). Two dives pointing at one site are one
 *     place even if their `site_name` snapshots differ, which they will once an admin renames a
 *     site (§5) and old dives keep the name they were logged with.
 *  2. **The folded `siteName`** — for a site typed by hand and never picked from the catalogue,
 *     which is every site in a logbook that has never synced. Folded through `foldForMatching`
 *     (domain/search.ts, §4.1's owner of "how text is read before it is compared"), so
 *     `Blue hole` and `Blue Hole` are one marker rather than two on the same rock. The fold is
 *     for MATCHING only; the label comes back from `diveSiteLabel` in the diver's own spelling.
 *  3. **The dive's own id** — a pinned dive with no site at all. It stands alone, badged `1`,
 *     and labelled by `diveSiteLabel`, which gives its centre's name or `Unnamed site`. That is
 *     the honest answer: the app knows where the diver was and does not know what it is called,
 *     and merging such dives together would be inventing a place out of a shared absence.
 *
 * **Planned dives never reach the map** (§2.4: *"excluded from stats and dive numbering"*). A
 * plan is somewhere you intend to go; a map of where you have dived that counted them would put
 * a badge of 4 over a sheet whose depth summary describes 3 — the two-populations-in-one-line
 * defect §0.6 names for the header. It also keeps the badge and the sheet's `logbookStats` count
 * equal by construction rather than by two filters that happen to agree.
 *
 * **Order in, order out.** Groups come back in the order their first dive appeared and each
 * group holds its dives in that order too, exactly as `groupIntoTrips` operates on the order
 * `useDives()` already hands back rather than re-deriving one. That is what makes `point` the
 * NEWEST pinned dive's point on a real screen, and it is stated rather than assumed: hand this
 * a differently-ordered array and you get a different, equally-defensible pin.
 */
export function groupDivesByPlace(dives: readonly Dive[]): MapSite[] {
  const groups = new Map<string, Dive[]>();
  for (const dive of dives) {
    if (!dive || dive.status !== 'logged') continue;
    const key = placeKeyOf(dive);
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [dive]);
    else existing.push(dive);
  }

  const sites: MapSite[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    // Unreachable — a key exists only because a dive was pushed under it — but typed rather
    // than asserted past, the same choice `toListEntries` (DivesScreen.tsx) makes for the same
    // shape of gap under `noUncheckedIndexedAccess`.
    if (first === undefined) continue;
    const point = firstPoint(group);
    // **A place with no coordinates anywhere is not on the map**, and it is not an error
    // either: it is every site in a logbook older than M2l. The screen counts what it dropped
    // rather than this module reporting it, because "how many of your dives are pinned" is a
    // sentence and this is a grouping.
    if (point === null) continue;
    sites.push({ key, label: diveSiteLabel(first), point, dives: group });
  }
  return sites;
}

/** The first dive in the group that actually carries a point — see `groupDivesByPlace` on why
 * "first" is the caller's order and therefore the most recent dive. */
function firstPoint(dives: readonly Dive[]): MapPoint | null {
  for (const dive of dives) {
    const point = pointOf(dive);
    if (point !== null) return point;
  }
  return null;
}

/**
 * The three-tier key `groupDivesByPlace` documents. Prefixed per tier so a site whose id is
 * `blue hole` cannot collide with a site *named* "Blue Hole".
 */
function placeKeyOf(dive: Dive): string {
  if (dive.siteId !== null && dive.siteId !== '') return `site:${dive.siteId}`;
  const folded = dive.siteName === null ? '' : foldForMatching(dive.siteName);
  if (folded !== '') return `name:${folded}`;
  return `dive:${dive.id}`;
}

/**
 * **The community layer's markers** — §3's *"toggle to explore all community sites"*.
 *
 * A different question from the personal layer's, and deliberately a different function rather
 * than one that takes both: a catalogue site has a surveyed position and no dives of yours, a
 * personal place has your dives and one of their positions. §5 settles which wins where both
 * exist — the dive's own point — and the two never mix on screen because the toggle shows one
 * layer at a time.
 *
 * `db/catalogue.ts` has already filtered to what may be offered (live, and `status = 'active'`,
 * so a merged duplicate is not drawn twice); what is left to decide here is only whether a row
 * has a position at all, which most will not until §5's PostGIS column is being pulled.
 */
export function sitesWithPoints(sites: readonly DiveSite[]): { site: DiveSite; point: MapPoint }[] {
  const placed: { site: DiveSite; point: MapPoint }[] = [];
  for (const site of sites) {
    if (!site) continue;
    const point = pointOf(site);
    if (point !== null) placed.push({ site, point });
  }
  return placed;
}

/**
 * The coldest and warmest water recorded at a set of dives, or `null` when none recorded one —
 * the *temp* half of §3's *"depth/temp summary"*. (The depth half is `logbookStats`, which
 * already owns "deepest dive" and is called rather than re-derived.)
 *
 * A **range** rather than a mean, because a mean is a number no dive recorded: a site dived in
 * February and August is 9 °C and 24 °C, and "16 °C" describes neither visit. It is also the
 * figure a diver is actually asking the map for, which is what to wear.
 *
 * `Number.isFinite` for the reason `logbookStats` gives about durations: a corrupt reading
 * collapses into "no reading here" rather than poisoning the pair. Sub-zero is kept — sea water
 * freezes below zero and `formatTemperature` prints the sign for exactly this.
 */
export function waterTempRange(dives: readonly Dive[]): WaterTempRange | null {
  let coldestC: number | null = null;
  let warmestC: number | null = null;
  for (const dive of dives) {
    if (!dive || dive.status !== 'logged') continue;
    const value = dive.waterTempC;
    if (value === null || !Number.isFinite(value)) continue;
    if (coldestC === null || value < coldestC) coldestC = value;
    if (warmestC === null || value > warmestC) warmestC = value;
  }
  if (coldestC === null || warmestC === null) return null;
  return { coldestC, warmestC };
}

/**
 * **The rectangle that frames a set of pins**, or `null` when there are none to frame.
 *
 * Null rather than a default region, and that is §1 rather than tidiness: a map opened at some
 * invented centre is a screen showing a place the diver has never been, presented exactly like
 * a screen showing places they have. The caller draws its empty state instead.
 *
 * **Longitude is wrapped and latitude is not**, which is the only interesting line in here. A
 * logbook spanning Fiji and Hawaii holds −179 and +179, and the naive `max − min` reads that as
 * a 358° span — the whole earth, the long way round, framed on the Atlantic. So the longitudes
 * are sorted, the LARGEST GAP between neighbours (wrapping past the antimeridian) is found, and
 * the region is the complementary arc: the shortest arc containing every pin. For a logbook
 * that does not cross the line this is arithmetically identical to `max − min`, so there is no
 * second code path for the ordinary case to drift away from. Latitude has no wrap — the poles
 * are not adjacent — and is a plain span.
 *
 * The result is a `Region` and not a fitted camera on purpose: `fitToCoordinates` is an
 * imperative call on a ref after layout, which means a frame of some other region first and a
 * ref this screen would otherwise not need. A computed `initialRegion` is a pure function of
 * the pins, which is also the half of this screen a test can actually check.
 */
export function regionFor(points: readonly MapPoint[]): MapRegion | null {
  if (points.length === 0) return null;

  const latitudes = points.map((p) => p.latitude);
  const north = Math.max(...latitudes);
  const south = Math.min(...latitudes);

  const { center: longitude, span: longitudeSpan } = longitudeArc(points.map((p) => p.longitude));

  return {
    latitude: (north + south) / 2,
    longitude,
    latitudeDelta: Math.min(Math.max((north - south) * REGION_PADDING, MIN_REGION_DELTA), 180),
    longitudeDelta: Math.min(Math.max(longitudeSpan * REGION_PADDING, MIN_REGION_DELTA), 360),
  };
}

/**
 * The shortest arc of longitude containing every value, as its centre and its width.
 *
 * The arc is the complement of the widest empty gap between two neighbouring longitudes, taken
 * cyclically — so a single value yields a 360° gap and a 0° span centred on itself, and a pair
 * straddling the antimeridian yields the two-degree arc across it rather than the 358° arc the
 * other way. `normaliseLongitude` brings the centre back into the [−180, 180) a map expects.
 */
function longitudeArc(longitudes: readonly number[]): { center: number; span: number } {
  const sorted = [...longitudes].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  // Unreachable: `regionFor` has already refused an empty set of points, and a non-empty array
  // has both ends. Typed rather than asserted past (`noUncheckedIndexedAccess`).
  if (first === undefined || last === undefined) return { center: 0, span: 0 };

  // The gap that wraps past the antimeridian, from the easternmost value round to the
  // westernmost. Every other candidate below is an ordinary interior gap.
  let widestGap = first + 360 - last;
  let gapStart = last;
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous === undefined || current === undefined) continue;
    const gap = current - previous;
    if (gap > widestGap) {
      widestGap = gap;
      gapStart = previous;
    }
  }

  // The arc runs from the far side of that gap all the way round to its near side, so its
  // centre is half a turn from the gap's own centre.
  return { center: normaliseLongitude(gapStart + widestGap / 2 + 180), span: 360 - widestGap };
}

/** A longitude brought into [−180, 180), which is what a map region wants and what adding 180
 * to a gap's centre above can leave. */
function normaliseLongitude(longitude: number): number {
  return (((longitude + 180) % 360) + 360) % 360 - 180;
}
