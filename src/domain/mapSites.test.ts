import { dive } from './diveFixture';
import {
  groupDivesByPlace,
  pointOf,
  regionFor,
  sitesWithPoints,
  waterTempRange,
  type MapPoint,
} from './mapSites';
import { type DiveSite } from './types';
import { UNNAMED_SITE } from '../format/display';

/**
 * **The half of the Map tab a test can actually settle.**
 *
 * `react-native-maps` is mocked under Jest, so nothing about the drawn map is checkable here or
 * in `DiveMap.test.tsx` — see that file and `components/DiveMap.tsx` for the exact split. What
 * IS checkable is every rule the screen applies before the map is handed anything, and that is
 * all of it: which dives can be pinned, which of them share a mark, where that mark goes, what
 * the badge counts, and what rectangle frames the lot. Those are this module.
 */

/** A catalogue row with only the fields these tests read. `dive_sites` is nullable almost
 * everywhere (§6), so the base is the shape most likely to break a caller. */
let siteSeq = 0;
const site = (over: Partial<DiveSite> = {}): DiveSite => ({
  id: `site-${String(siteSeq++).padStart(4, '0')}`,
  name: null,
  country: null,
  latitude: null,
  longitude: null,
  salinity: null,
  waterBody: null,
  entry: null,
  maxDepthM: null,
  createdBy: null,
  status: 'active',
  mergedInto: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  deletedAt: null,
  dirty: false,
  ...over,
});

describe('pointOf', () => {
  it('reads a pair the device stored', () => {
    expect(pointOf({ latitude: 43.5081, longitude: 16.4402 })).toEqual({
      latitude: 43.5081,
      longitude: 16.4402,
    });
    // Null Island is a legal fix and this module has no business calling it implausible — see
    // the function's own docblock.
    expect(pointOf({ latitude: 0, longitude: 0 })).toEqual({ latitude: 0, longitude: 0 });
  });

  // Half a point is not a point, which is the same rule `formatCoordinates` (format/display.ts)
  // already applies to the same pair one screen over.
  it.each([
    ['no latitude', { latitude: null, longitude: 16.44 }],
    ['no longitude', { latitude: 43.5, longitude: null }],
    ['neither', { latitude: null, longitude: null }],
  ])('refuses %s', (_label, source) => {
    expect(pointOf(source)).toBeNull();
  });

  // §1's write boundary stores what it is handed and §7 applies rows this build never composed,
  // so an off-the-earth value can arrive. Handed to a map it drags the whole region with it.
  it.each([
    ['a latitude past the pole', { latitude: 91, longitude: 0 }],
    ['a latitude past the south pole', { latitude: -90.5, longitude: 0 }],
    ['a longitude past the antimeridian', { latitude: 0, longitude: 181 }],
    ['NaN', { latitude: Number.NaN, longitude: 0 }],
    ['Infinity', { latitude: 0, longitude: Number.POSITIVE_INFINITY }],
  ])('refuses %s', (_label, source) => {
    expect(pointOf(source)).toBeNull();
  });

  // The poles and the antimeridian themselves are real places, so the bound is inclusive.
  it('keeps the extremes, which are places rather than errors', () => {
    expect(pointOf({ latitude: 90, longitude: 180 })).toEqual({ latitude: 90, longitude: 180 });
    expect(pointOf({ latitude: -90, longitude: -180 })).toEqual({ latitude: -90, longitude: -180 });
  });
});

describe('groupDivesByPlace', () => {
  // §3's clustering, in its ordinary case: four dives at one site are one mark badged 4.
  it('puts every dive sharing a site id under one mark', () => {
    const places = groupDivesByPlace([
      dive({ siteId: 's1', siteName: 'Blue Hole', latitude: 43.5, longitude: 16.4 }),
      dive({ siteId: 's1', siteName: 'Blue Hole', latitude: 43.51, longitude: 16.41 }),
      dive({ siteId: 's1', siteName: 'Blue Hole' }),
    ]);
    expect(places).toHaveLength(1);
    expect(places[0]?.dives).toHaveLength(3);
    expect(places[0]?.label).toBe('Blue Hole');
  });

  // **The badge counts your dives there, not your fixes there** — the claim `formatMyDivesSummary`
  // depends on when it says "on the map" rather than "pinned". A dive with no coordinates at a
  // site another dive pinned is still one of your dives there (§3: "tapping a site shows your
  // dives there"), and dropping it would badge 1 over a sheet listing 3.
  it('counts the dives at a place, including the ones carrying no fix of their own', () => {
    const places = groupDivesByPlace([
      dive({ siteId: 's1', siteName: 'Blue Hole' }),
      dive({ siteId: 's1', siteName: 'Blue Hole', latitude: 43.5, longitude: 16.4 }),
      dive({ siteId: 's1', siteName: 'Blue Hole' }),
    ]);
    expect(places[0]?.dives).toHaveLength(3);
    expect(places[0]?.point).toEqual({ latitude: 43.5, longitude: 16.4 });
  });

  // A site renamed by an admin (§5) leaves old dives holding the name they were logged with, so
  // the snapshots disagree while the id does not. One rock, one mark.
  it('keeps dives together under one site id even when their name snapshots differ', () => {
    const places = groupDivesByPlace([
      dive({ siteId: 's1', siteName: 'Blue Hole (north)', latitude: 43.5, longitude: 16.4 }),
      dive({ siteId: 's1', siteName: 'Blue Hole' }),
    ]);
    expect(places).toHaveLength(1);
    expect(places[0]?.dives).toHaveLength(2);
  });

  // §2.3's fold, applied to grouping: a logbook that has never synced holds hand-typed names
  // only, and `Blue hole` and `Blue Hole` are one rock rather than two marks on top of it.
  // `foldForMatching` (domain/search.ts) is the owner; this pins that it is consulted at all.
  it('folds a hand-typed site name, so one rock is one mark', () => {
    const places = groupDivesByPlace([
      dive({ siteName: 'Blue Hole', latitude: 43.5, longitude: 16.4 }),
      dive({ siteName: 'blue hole' }),
      dive({ siteName: 'Modrá díra', latitude: 43.6, longitude: 16.5 }),
      dive({ siteName: 'modra dira' }),
    ]);
    expect(places).toHaveLength(2);
    expect(places.map((place) => place.dives.length)).toEqual([2, 2]);
    // The LABEL is the diver's own spelling, never the folded key — the fold decides what
    // matches, not what is read.
    expect(places.map((place) => place.label)).toEqual(['Blue Hole', 'Modrá díra']);
  });

  // **A centre is a shop, not a place you dived** — the one axis on which this differs from
  // `tripKeyOf` (domain/trips.ts), which groups a trip centre-first. Two dives at two unnamed
  // sites through one shop are two marks, at their own coordinates; merged they would be one
  // mark at whichever fix came first, claiming a place that does not exist.
  it('never groups by dive centre, however tempting the shared name looks', () => {
    const places = groupDivesByPlace([
      dive({ centerName: 'Dive Centre Split', latitude: 43.5, longitude: 16.4 }),
      dive({ centerName: 'Dive Centre Split', latitude: 43.9, longitude: 15.2 }),
    ]);
    expect(places).toHaveLength(2);
    // ...and each is still CALLED by the centre, because that is what `diveSiteLabel` answers
    // for a dive with no site. Grouping and labelling are different questions (§4.1).
    expect(places.map((place) => place.label)).toEqual(['Dive Centre Split', 'Dive Centre Split']);
  });

  // A pinned dive with nothing naming its place stands alone rather than being merged with
  // every other unnamed dive — merging them would invent a place out of a shared absence.
  it('leaves a pinned dive with no site standing on its own', () => {
    const places = groupDivesByPlace([
      dive({ latitude: 43.5, longitude: 16.4 }),
      dive({ latitude: 20.1, longitude: -87.5 }),
    ]);
    expect(places).toHaveLength(2);
    expect(places.map((place) => place.label)).toEqual([UNNAMED_SITE, UNNAMED_SITE]);
    expect(places.map((place) => place.dives.length)).toEqual([1, 1]);
  });

  // The state of every logbook older than M2l (§10: no dive logged in M1 can carry a GPS point).
  // It is an empty map rather than an error, and the screen's own branch says which of the two
  // empty sentences to draw.
  it('drops a place no dive of which carries a fix', () => {
    expect(groupDivesByPlace([dive({ siteName: 'Blue Hole' }), dive({ siteName: 'Blue Hole' })])).toEqual([]);
  });

  // §2.4: a plan is somewhere you intend to go. Keeping it would badge a mark 2 over a sheet
  // whose depth summary — `logbookStats`, which excludes plans — describes 1.
  it('leaves planned dives off the map entirely, badge and sheet alike', () => {
    const places = groupDivesByPlace([
      dive({ status: 'planned', siteId: 's1', siteName: 'Blue Hole', latitude: 43.5, longitude: 16.4 }),
      dive({ status: 'logged', siteId: 's1', siteName: 'Blue Hole', latitude: 43.5, longitude: 16.4 }),
    ]);
    expect(places[0]?.dives).toHaveLength(1);
    expect(places[0]?.dives[0]?.status).toBe('logged');
  });

  // ...and a place whose ONLY dive is planned is not a place at all, which is the half a filter
  // applied after grouping would get wrong.
  it('draws no mark for a place holding nothing but a plan', () => {
    expect(
      groupDivesByPlace([dive({ status: 'planned', siteName: 'Blue Hole', latitude: 43.5, longitude: 16.4 })]),
    ).toEqual([]);
  });

  // The order the caller hands in is the order back out, which is what makes `point` the most
  // recent dive's fix on a screen fed by `useDives()` (newest first). Stated in the docblock as
  // a property of the caller's order rather than of the data, and pinned here so a "tidy" sort
  // inside the grouping shows up.
  it('takes its position from the first pinned dive in the order it was handed', () => {
    const newest = dive({ siteId: 's1', latitude: 43.5, longitude: 16.4 });
    const older = dive({ siteId: 's1', latitude: 10, longitude: 10 });
    expect(groupDivesByPlace([newest, older])[0]?.point).toEqual({ latitude: 43.5, longitude: 16.4 });
    expect(groupDivesByPlace([older, newest])[0]?.point).toEqual({ latitude: 10, longitude: 10 });
  });

  // A key that could collide would merge two unrelated places into one mark. The tiers are
  // prefixed for exactly this: a site whose id is the folded form of another site's name.
  it('keeps a site id apart from a site name that folds to the same string', () => {
    const places = groupDivesByPlace([
      dive({ siteId: 'blue hole', latitude: 43.5, longitude: 16.4 }),
      dive({ siteName: 'Blue Hole', latitude: 43.6, longitude: 16.5 }),
    ]);
    expect(places).toHaveLength(2);
  });

  it('has nothing to say about an empty logbook', () => {
    expect(groupDivesByPlace([])).toEqual([]);
  });
});

describe('sitesWithPoints', () => {
  it('keeps the catalogue rows that carry a position', () => {
    const placed = site({ name: 'Blue Hole', latitude: 43.5, longitude: 16.4 });
    expect(sitesWithPoints([placed, site({ name: 'Nowhere' })])).toEqual([
      { site: placed, point: { latitude: 43.5, longitude: 16.4 } },
    ]);
  });

  // The state of the catalogue today: `dive_sites` reaches the device only through a pull and
  // nothing creates a site yet, so this is the branch the community layer's empty screen is for.
  it('answers an empty layer for a catalogue that has none', () => {
    expect(sitesWithPoints([])).toEqual([]);
    expect(sitesWithPoints([site(), site()])).toEqual([]);
  });
});

describe('waterTempRange', () => {
  it('reports the coldest and the warmest water recorded', () => {
    expect(
      waterTempRange([dive({ waterTempC: 21 }), dive({ waterTempC: 9 }), dive({ waterTempC: 24 })]),
    ).toEqual({ coldestC: 9, warmestC: 24 });
  });

  it('reports one reading as a range of itself, so a caller needs no second shape', () => {
    expect(waterTempRange([dive({ waterTempC: 18 }), dive()])).toEqual({ coldestC: 18, warmestC: 18 });
  });

  // Sea water freezes below zero, and `formatTemperature` prints the sign for exactly this.
  it('keeps sub-zero water', () => {
    expect(waterTempRange([dive({ waterTempC: -1.5 }), dive({ waterTempC: 4 })])).toEqual({
      coldestC: -1.5,
      warmestC: 4,
    });
  });

  // Null when nothing recorded, never `0` — a site nobody took a temperature at is not a site
  // at freezing point, which is this module's standing rule and `logbookStats`' too.
  it('says nothing at all when no dive recorded a temperature', () => {
    expect(waterTempRange([dive(), dive()])).toBeNull();
    expect(waterTempRange([])).toBeNull();
  });

  // A corrupt reading collapses into "no reading here" rather than poisoning the pair — the
  // same treatment `logbookStats` gives a corrupt duration, and for the same reason: one bad
  // row must not blank a figure the diver's other dives earned.
  it('ignores a reading that is not a number', () => {
    expect(
      waterTempRange([dive({ waterTempC: Number.NaN }), dive({ waterTempC: 20 })]),
    ).toEqual({ coldestC: 20, warmestC: 20 });
  });

  // §2.4 again: a plan carries no temperature, and if a diver typed one it is a forecast.
  it('excludes planned dives, exactly as the badge and the depth summary do', () => {
    expect(waterTempRange([dive({ status: 'planned', waterTempC: 30 }), dive({ waterTempC: 12 })])).toEqual({
      coldestC: 12,
      warmestC: 12,
    });
  });
});

describe('regionFor', () => {
  // §1: a map opened at an invented centre is a screen showing a place the diver has never
  // been, drawn exactly like a screen showing places they have.
  it('frames nothing, so the screen can say something true instead', () => {
    expect(regionFor([])).toBeNull();
  });

  it('centres on the pins and leaves air around them', () => {
    const region = regionFor([
      { latitude: 43.0, longitude: 16.0 },
      { latitude: 44.0, longitude: 17.0 },
    ]);
    expect(region?.latitude).toBeCloseTo(43.5, 10);
    expect(region?.longitude).toBeCloseTo(16.5, 10);
    // Wider than the span itself, or the outermost pins sit on the screen's own edge.
    expect(region?.latitudeDelta).toBeGreaterThan(1);
    expect(region?.longitudeDelta).toBeGreaterThan(1);
  });

  // One pin has a bounding box of zero, and any multiple of zero is zero: a region with a zero
  // delta renders at maximum zoom, which is a view of the sea floor from six inches.
  it('gives a single pin a region a diver can recognise', () => {
    const region = regionFor([{ latitude: 43.5081, longitude: 16.4402 }]);
    expect(region?.latitude).toBeCloseTo(43.5081, 10);
    expect(region?.longitude).toBeCloseTo(16.4402, 10);
    expect(region?.latitudeDelta).toBeGreaterThan(0);
    expect(region?.longitudeDelta).toBeGreaterThan(0);
  });

  // The floor is on both axes, not only on the degenerate case: two pins 50 m apart would
  // otherwise be framed as tightly as one pin is not.
  it('floors the zoom for pins that are merely very close together', () => {
    const tight = regionFor([
      { latitude: 43.5, longitude: 16.4 },
      { latitude: 43.5004, longitude: 16.4004 },
    ]);
    const single = regionFor([{ latitude: 43.5, longitude: 16.4 }]);
    expect(tight?.latitudeDelta).toBe(single?.latitudeDelta);
    expect(tight?.longitudeDelta).toBe(single?.longitudeDelta);
  });

  // **The antimeridian, which is the only interesting line in the function.** A logbook holding
  // Fiji and Samoa spans two degrees the short way and 358 the long way; naive `max − min` reads
  // the long way and frames the Atlantic. Mutating `longitudeArc` back to `last - first` makes
  // this red and leaves every other assertion in this file green.
  it('frames pins across the antimeridian the short way round', () => {
    const region = regionFor([
      { latitude: -18, longitude: 179 },
      { latitude: -14, longitude: -179 },
    ]);
    expect(region?.longitudeDelta).toBeLessThan(10);
    // The midpoint of 179°E and 179°W is the antimeridian itself, reported in the [−180, 180)
    // a map region expects.
    expect(Math.abs(region?.longitude ?? 0)).toBeCloseTo(180, 6);
  });

  // ...and the ordinary case is the same arithmetic, which is what makes the wrap-aware version
  // safe to have: there is no second code path for a normal logbook to drift away from.
  it('still frames an ordinary spread the obvious way', () => {
    const region = regionFor([
      { latitude: 20, longitude: -87 },
      { latitude: 43, longitude: 16 },
    ]);
    expect(region?.longitude).toBeCloseTo(-35.5, 10);
    expect(region?.longitudeDelta).toBeCloseTo(103 * 1.4, 6);
  });

  // A region wider than the earth is not a region. The padding multiplier alone would produce
  // one for a logbook spanning most of the globe.
  it('never asks for more of the earth than there is', () => {
    const points: MapPoint[] = [
      { latitude: -80, longitude: -179 },
      { latitude: 80, longitude: 0 },
      { latitude: 0, longitude: 179 },
    ];
    const region = regionFor(points);
    expect(region?.latitudeDelta).toBeLessThanOrEqual(180);
    expect(region?.longitudeDelta).toBeLessThanOrEqual(360);
  });
});
