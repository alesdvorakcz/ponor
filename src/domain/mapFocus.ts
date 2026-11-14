import {
  groupDivesByPlace,
  pointOf,
  regionFor,
  type MapPoint,
  type MapRegion,
} from './mapSites';
import { catalogueSiteIdentity } from './siteIdentity';
import { type Dive, type DiveCenter, type DiveSite } from './types';

/**
 * ── A map pointed at one place (issue #21) ──────────────────────────────────────────────────
 *
 * *Show on map* on a dive, a site's page or a centre's page opens Ponor's own map centred on that
 * place, with its mark selected. Until #21 it opened the device's maps, because the Map tab could
 * not be pointed at anything: it framed every mark it drew and had no way to be asked for one.
 *
 * **What this module owns is the answer to "which mark is that place, and where is it"** — the
 * part of the feature that is a rule rather than a screen. `MapScreen` owns the filter and the
 * selection and asks this module once per render; `navigation/mapFocusLink.ts` owns the route.
 *
 * **The question has three spellings and one subtle case.** A dive is drawn as the place it
 * belongs to (§3 groups by site identity), so a dive's mark is its *place's* mark, shared with
 * every other dive there. A centre is its own mark. A **site is either of two marks**, and which
 * one is not a choice made here: a site the diver has dived is drawn as *their* place and its
 * catalogue dot is taken off the map (`sitesWithoutYourMark`, M3e), so focusing on it must select
 * the diver's mark — the one actually standing there, whose sheet carries the site's facts and
 * the way back to its page. Focusing on the dot instead would point at a mark that is not drawn.
 */

/** What a focused map can be pointed at, as a list with the type derived from it (§4.1). */
export const MAP_FOCUS_KINDS = ['dive', 'site', 'center'] as const;
export type MapFocusKind = (typeof MAP_FOCUS_KINDS)[number];

/** The route's half of a focus: what kind of record, and which one. */
export interface MapFocus {
  kind: MapFocusKind;
  id: string;
}

/**
 * The three kinds of mark, restated because `domain/` does not import from `components/` —
 * `MapScreen` ties this to `DiveMap`'s `MapMarkKind` at compile time, so the two cannot drift.
 */
export type FocusMarkKind = 'mine' | 'community' | 'centers';

/**
 * A focus that has been found on the map: the record, where the camera goes, and which drawn
 * mark is that record.
 *
 * `point` is the **record's own** position, not its mark's. They differ for a dive that shares a
 * place with an earlier one — §3's place is positioned at its first pinned dive — and the done-when
 * for #21 is a map centred on *the dive's* position. The two are a few metres apart in practice
 * (the same site), so the mark is still on screen and still the one that is selected.
 */
export type FocusTarget = {
  point: MapPoint;
  mark: { kind: FocusMarkKind; key: string };
} & ({ kind: 'dive'; dive: Dive } | { kind: 'site'; site: DiveSite } | { kind: 'center'; center: DiveCenter });

/**
 * What the focus is read from. **`null` means that read has not answered yet**, which is a
 * different thing from an empty list — the same split `db/liveQuery.ts` makes with `resolved`,
 * for the same reason: "still looking" and "nothing there" are what an empty array cannot tell
 * apart. A read that *failed* has answered (with whatever it last held), so a focus on it simply
 * finds nothing and the screen's own failure notice says why.
 */
export interface FocusSources {
  dives: readonly Dive[] | null;
  sites: readonly DiveSite[] | null;
  centers: readonly DiveCenter[] | null;
}

/**
 * **Which mark a focus is, or why there is none.**
 *
 * - `'pending'` — a read this focus depends on has not answered. The screen draws no map yet,
 *   because a `MapView` reads its region once (M3l) and a map opened on the wrong place could not
 *   be moved to the right one without a visible jump.
 * - `null` — the record is gone (deleted, or merged away by a pull), has no position a map can
 *   draw (`pointOf`), or is not drawn at all: **a planned dive is never on the map** (§2.4), and
 *   `groupDivesByPlace` is the owner of that rule, so it is asked rather than restated here. The
 *   screen then opens the way the Map tab does, framing everything.
 * - a `FocusTarget` — found.
 *
 * **A site waits for the logbook as well as for the catalogue**, because whether its mark is the
 * diver's place or the community's dot depends on both; answering from the catalogue alone would
 * select the dot for one frame and then a mark that replaced it.
 *
 * **Independent of the filter, on purpose.** It reads every logged dive rather than the places the
 * filter currently draws, so switching *your dives* off does not make a focus disappear — the
 * Directions pill is about the place, not about what is switched on.
 *
 * **The point is always the selected mark's own** (#27's review). A place of the diver's own is
 * drawn where `groupDivesByPlace` puts it — one dive's pin standing for the group — and neither the
 * focused dive's own pin nor the catalogue's position for the site has to be that one: later dives
 * at a site drift by the GPS's own error, and an admin can move a catalogue row. Centring on any
 * other point could open with the selected mark at the edge of the screen or under its own sheet.
 */
export function focusTarget(focus: MapFocus, sources: FocusSources): FocusTarget | 'pending' | null {
  switch (focus.kind) {
    case 'dive': {
      if (sources.dives === null) return 'pending';
      const dive = sources.dives.find((row) => row?.id === focus.id);
      if (dive === undefined) return null;
      // A dive with no position, or a plan, is in no place — `groupDivesByPlace` owns both rules.
      const place = groupDivesByPlace(sources.dives).find((group) =>
        group.dives.some((member) => member.id === dive.id),
      );
      if (place === undefined) return null;
      return { kind: 'dive', dive, point: place.point, mark: { kind: 'mine', key: place.key } };
    }
    case 'site': {
      if (sources.sites === null || sources.dives === null) return 'pending';
      const site = sources.sites.find((row) => row?.id === focus.id);
      if (site === undefined) return null;
      // The same identity `sitesWithoutYourMark` drops the dot by (domain/mapSites.ts), asked of
      // the same places — so this selects the diver's mark exactly when the dot is not drawn, and
      // centres on that mark rather than on the catalogue's position for the row.
      const identity = catalogueSiteIdentity(site.id);
      const yours = groupDivesByPlace(sources.dives).find((group) => group.key === identity);
      if (yours !== undefined) return { kind: 'site', site, point: yours.point, mark: { kind: 'mine', key: yours.key } };
      const point = pointOf(site);
      if (point === null) return null;
      return { kind: 'site', site, point, mark: { kind: 'community', key: site.id } };
    }
    case 'center': {
      if (sources.centers === null) return 'pending';
      const center = sources.centers.find((row) => row?.id === focus.id);
      if (center === undefined) return null;
      const point = pointOf(center);
      if (point === null) return null;
      return { kind: 'center', center, point, mark: { kind: 'centers', key: center.id } };
    }
  }
}

/**
 * **How far south of the place the camera sits when a sheet will open over the map**, as a
 * fraction of the region's height.
 *
 * The place's sheet covers the bottom of the map (`mapSheet`, theme/styles.ts: up to half of the
 * area), so a place framed dead centre would be the one thing on the map the sheet hides — and a
 * place with five dives makes a sheet tall enough to do exactly that. Moving the camera's centre
 * south by a quarter of the span puts the place a quarter of the way down, the middle of the half
 * a sheet can never reach.
 *
 * MapKit fits a region to the view rather than stretching it, and a phone's map is taller than it
 * is wide, so it shows more latitude than was asked for and the place lands a little lower than
 * the quarter line — still above the half a sheet can cover, by arithmetic. Whether that holds on
 * a device, over the tallest sheet, is the simulator's question rather than this comment's.
 */
const SHEET_CLEARANCE = 0.25;

/**
 * **Where a focused map opens**: the place at the zoom the map already gives a single mark, and
 * clear of the sheet when one will open.
 *
 * The zoom is `regionFor`'s for one point rather than a constant of its own — about 2.2 km, "a
 * dive site with its shoreline" (`MIN_REGION_DELTA`). A second number for "a sensible zoom on one
 * place" would be the same judgement written twice, and the Map tab opening on a logbook of one
 * dive already makes it.
 *
 * `opensSheet` is the screen's answer rather than this module's, because which marks open a sheet
 * is `MapScreen`'s rule (a catalogue row goes to its page; your own dives open a sheet).
 */
export function focusRegion(point: MapPoint, opensSheet: boolean): MapRegion {
  // One point always frames: `regionFor` returns null only for none.
  const framed = regionFor([point]) as MapRegion;
  if (!opensSheet) return framed;
  // **Never south of the pole** (#27's review): a place within a quarter-span of it would put the
  // centre below −90°, which MapKit rejects as an invalid region rather than clamping. At the pole
  // itself the region is `regionFor`'s own for that point, as on the Map tab.
  return { ...framed, latitude: Math.max(-90, framed.latitude - framed.latitudeDelta * SHEET_CLEARANCE) };
}
