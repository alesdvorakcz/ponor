import { dive } from './diveFixture';
import { focusRegion, focusTarget, type FocusSources } from './mapFocus';
import { groupDivesByPlace, regionContains, sitesWithoutYourMark } from './mapSites';
import { type DiveCenter, type DiveSite } from './types';

/**
 * **Which mark a focused map selects, and where it opens** (issue #21).
 *
 * The keys, points and regions below are written out by hand — `site:<id>`, `dive:<id>`, the
 * coordinates and a quarter of 0.02° — rather than read back off `groupDivesByPlace` or
 * `regionFor`, so a change to either of those that moved a focus is red here instead of carried
 * along. The one place another module is asked is the agreement with `sitesWithoutYourMark`,
 * which is a witness rather than the subject: the focus must select the diver's mark exactly when
 * that function takes the catalogue's dot off the map.
 */

const BLUE_HOLE = { latitude: 43.0378, longitude: 16.1489 };
const SPLIT = { latitude: 43.5081, longitude: 16.4402 };

let rowSeq = 0;
const site = (over: Partial<DiveSite> = {}): DiveSite => ({
  id: `site-${String(rowSeq++).padStart(4, '0')}`,
  name: null,
  country: null,
  latitude: null,
  longitude: null,
  salinity: null,
  waterBody: null,
  entry: [],
  maxDepthM: null,
  siteTypes: [],
  suitableFor: null,
  altNames: [],
  description: null,
  wreckName: null,
  wreckSunkYear: null,
  altitudeM: null,
  createdBy: null,
  status: 'active',
  mergedInto: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  deletedAt: null,
  dirty: false,
  ...over,
});

const centre = (over: Partial<DiveCenter> = {}): DiveCenter => ({
  id: `centre-${String(rowSeq++).padStart(4, '0')}`,
  name: 'Ponorka',
  country: null,
  latitude: null,
  longitude: null,
  website: null,
  address: null,
  phone: null,
  email: null,
  openingHours: null,
  services: [],
  agencies: [],
  description: null,
  createdBy: null,
  status: 'active',
  mergedInto: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  deletedAt: null,
  dirty: false,
  ...over,
});

/** Every read answered, with nothing in it — each test fills in what it is about. */
const answered = (over: Partial<FocusSources> = {}): FocusSources => ({
  dives: [],
  sites: [],
  centers: [],
  ...over,
});

describe('focusTarget — a dive', () => {
  it('is its place’s mark, at the dive’s own position', () => {
    const blue = dive({ id: 'd1', siteId: 'blue', siteName: 'Blue Hole', ...BLUE_HOLE });
    const target = focusTarget({ kind: 'dive', id: 'd1' }, answered({ dives: [blue] }));
    expect(target).toMatchObject({ kind: 'dive', point: BLUE_HOLE, mark: { kind: 'mine', key: 'site:blue' } });
  });

  // §3 groups by site identity, so the mark a dive is drawn under is shared with every dive at
  // that place and is positioned at the FIRST pinned one. The camera goes to THAT mark, not to this
  // dive's own pin (#27's review): the mark is what is selected and what the sheet must clear, and
  // a pin that drifted from it would open with the selected mark off-centre. Built by #21 the other
  // way round, and this test said so; it is the test that changed.
  it('selects the shared mark of a place, and centres on that mark rather than its own pin', () => {
    const newer = dive({ id: 'newer', siteId: 'blue', siteName: 'Blue Hole', ...BLUE_HOLE });
    const older = dive({ id: 'older', siteId: 'blue', siteName: 'Blue Hole', latitude: 43.0381, longitude: 16.1492 });
    const target = focusTarget({ kind: 'dive', id: 'older' }, answered({ dives: [newer, older] }));
    expect(target).toMatchObject({ markAt: BLUE_HOLE, mark: { kind: 'mine', key: 'site:blue' } });
  });

  // …while Directions still goes to the dive's OWN pin — what its card shows (#27's second review).
  it('keeps the dive’s own pin as its point, for Directions', () => {
    const newer = dive({ id: 'newer', siteId: 'blue', siteName: 'Blue Hole', ...BLUE_HOLE });
    const older = dive({ id: 'older', siteId: 'blue', siteName: 'Blue Hole', latitude: 43.0381, longitude: 16.1492 });
    const target = focusTarget({ kind: 'dive', id: 'older' }, answered({ dives: [newer, older] }));
    expect(target).toMatchObject({ point: { latitude: 43.0381, longitude: 16.1492 } });
  });

  // A dive with no pin at a site where others have pins: its place IS drawn, but the dive is not —
  // `drawsOnMap` says so, and its page shows no card to open the map from (#27's second review).
  it('finds nothing for a pinless dive, even where its place is drawn by others', () => {
    const pinned = dive({ id: 'pinned', siteId: 'blue', siteName: 'Blue Hole', ...BLUE_HOLE });
    const pinless = dive({ id: 'pinless', siteId: 'blue', siteName: 'Blue Hole' });
    expect(focusTarget({ kind: 'dive', id: 'pinless' }, answered({ dives: [pinned, pinless] }))).toBeNull();
  });

  it('is a place of its own for a dive at no named site', () => {
    const loose = dive({ id: 'loose', ...SPLIT });
    expect(focusTarget({ kind: 'dive', id: 'loose' }, answered({ dives: [loose] }))).toMatchObject({
      mark: { kind: 'mine', key: 'dive:loose' },
    });
  });

  it('waits for the logbook', () => {
    expect(focusTarget({ kind: 'dive', id: 'd1' }, answered({ dives: null }))).toBe('pending');
  });

  it('waits for nothing else', () => {
    const blue = dive({ id: 'd1', ...BLUE_HOLE });
    expect(focusTarget({ kind: 'dive', id: 'd1' }, { dives: [blue], sites: null, centers: null })).not.toBe('pending');
  });

  it('finds nothing for a dive that is gone', () => {
    expect(focusTarget({ kind: 'dive', id: 'gone' }, answered({ dives: [dive({ ...BLUE_HOLE })] }))).toBeNull();
  });

  it('finds nothing for a dive with no position, or one no map can draw', () => {
    const none = dive({ id: 'none' });
    const offGlobe = dive({ id: 'off', latitude: 91, longitude: 16 });
    expect(focusTarget({ kind: 'dive', id: 'none' }, answered({ dives: [none] }))).toBeNull();
    expect(focusTarget({ kind: 'dive', id: 'off' }, answered({ dives: [offGlobe] }))).toBeNull();
  });

  // §2.4: a plan is never on the map, so there is no mark to select and nothing to centre on that
  // the diver could see. The dive detail sends a plan to the device's maps instead.
  it('finds nothing for a planned dive, which the map does not draw', () => {
    const plan = dive({ id: 'plan', status: 'planned', siteName: 'Blue Hole', ...BLUE_HOLE });
    expect(focusTarget({ kind: 'dive', id: 'plan' }, answered({ dives: [plan] }))).toBeNull();
  });
});

describe('focusTarget — a site', () => {
  it('is the community’s mark for a site the diver has not dived', () => {
    const row = site({ id: 'blue', name: 'Blue Hole', ...BLUE_HOLE });
    expect(focusTarget({ kind: 'site', id: 'blue' }, answered({ sites: [row] }))).toMatchObject({
      kind: 'site',
      point: BLUE_HOLE,
      mark: { kind: 'community', key: 'blue' },
    });
  });

  // M3e takes the catalogue's dot off the map where the diver's own mark stands on that site, so
  // the dot is not there to select — the mark standing there is the diver's.
  it('is the diver’s own mark for a site they have dived', () => {
    const row = site({ id: 'blue', name: 'Blue Hole', ...BLUE_HOLE });
    const been = dive({ siteId: 'blue', siteName: 'Blue Hole', ...BLUE_HOLE });
    expect(focusTarget({ kind: 'site', id: 'blue' }, answered({ dives: [been], sites: [row] }))).toMatchObject({
      point: BLUE_HOLE,
      mark: { kind: 'mine', key: 'site:blue' },
    });
  });

  // The catalogue's position and the diver's mark need not agree — later dives drift by the GPS's
  // own error, and an admin can move a row. The focus selects the diver's mark, so it centres on
  // that mark: centring on the row's position could leave the selected mark at the screen's edge or
  // under its own sheet (#27's review).
  it('centres a dived site on the diver’s own mark, not on the catalogue’s position', () => {
    const row = site({ id: 'blue', name: 'Blue Hole', latitude: 43.06, longitude: 16.2 });
    const been = dive({ siteId: 'blue', siteName: 'Blue Hole', ...BLUE_HOLE });
    expect(focusTarget({ kind: 'site', id: 'blue' }, answered({ dives: [been], sites: [row] }))).toMatchObject({
      // Camera on the mark; Directions to the row's own position, what the site's card shows.
      markAt: BLUE_HOLE,
      point: { latitude: 43.06, longitude: 16.2 },
      mark: { kind: 'mine', key: 'site:blue' },
    });
  });

  // …and so a dived site needs no position of its own: the mark is the diver's, drawn at their pin,
  // and Directions goes there too, having nowhere else.
  it('finds a dived site that has no position of its own, at the diver’s mark', () => {
    const row = site({ id: 'blue', name: 'Blue Hole' });
    const been = dive({ siteId: 'blue', siteName: 'Blue Hole', ...BLUE_HOLE });
    expect(focusTarget({ kind: 'site', id: 'blue' }, answered({ dives: [been], sites: [row] }))).toMatchObject({
      markAt: BLUE_HOLE,
      point: BLUE_HOLE,
    });
  });

  // The witness: the dot is dropped by `sitesWithoutYourMark`, and the focus has to land on the
  // diver's mark in exactly the cases where it is. Three dives, three answers — paired by id
  // (absorbed), typed by the same name with no id (NOT absorbed: §3 never matches by folded name),
  // and pinned but planned (not drawn, so not absorbed).
  it('selects the diver’s mark exactly when the map has taken the dot away', () => {
    const row = site({ id: 'blue', name: 'Blue Hole', ...BLUE_HOLE });
    for (const been of [
      dive({ siteId: 'blue', siteName: 'Blue Hole', ...BLUE_HOLE }),
      dive({ siteId: null, siteName: 'Blue Hole', ...BLUE_HOLE }),
      dive({ status: 'planned', siteId: 'blue', siteName: 'Blue Hole', ...BLUE_HOLE }),
    ]) {
      const dotDrawn = sitesWithoutYourMark([{ row, point: BLUE_HOLE }], groupDivesByPlace([been])).length === 1;
      const target = focusTarget({ kind: 'site', id: 'blue' }, answered({ dives: [been], sites: [row] }));
      expect(target === null || target === 'pending' ? null : target.mark.kind).toBe(dotDrawn ? 'community' : 'mine');
    }
  });

  // Which of the two marks a site is depends on the logbook, so answering from the catalogue alone
  // would select the dot and then, a frame later, a different mark.
  it('waits for the logbook as well as for the catalogue', () => {
    const row = site({ id: 'blue', ...BLUE_HOLE });
    expect(focusTarget({ kind: 'site', id: 'blue' }, answered({ sites: null }))).toBe('pending');
    expect(focusTarget({ kind: 'site', id: 'blue' }, answered({ sites: [row], dives: null }))).toBe('pending');
  });

  it('finds nothing for a site that is gone or has no position', () => {
    const pinless = site({ id: 'pinless', name: 'Lom' });
    expect(focusTarget({ kind: 'site', id: 'gone' }, answered({ sites: [pinless] }))).toBeNull();
    expect(focusTarget({ kind: 'site', id: 'pinless' }, answered({ sites: [pinless] }))).toBeNull();
  });
});

describe('focusTarget — a centre', () => {
  it('is its own mark', () => {
    const row = centre({ id: 'ponorka', ...SPLIT });
    expect(focusTarget({ kind: 'center', id: 'ponorka' }, answered({ centers: [row] }))).toMatchObject({
      kind: 'center',
      point: SPLIT,
      mark: { kind: 'centers', key: 'ponorka' },
    });
  });

  it('waits for the centres and for nothing else', () => {
    const row = centre({ id: 'ponorka', ...SPLIT });
    expect(focusTarget({ kind: 'center', id: 'ponorka' }, answered({ centers: null }))).toBe('pending');
    expect(focusTarget({ kind: 'center', id: 'ponorka' }, { dives: null, sites: null, centers: [row] })).not.toBe(
      'pending',
    );
  });

  // §2.3: a centre this app creates has its name alone, so this is the ordinary centre.
  it('finds nothing for a centre with no position', () => {
    expect(focusTarget({ kind: 'center', id: 'c' }, answered({ centers: [centre({ id: 'c' })] }))).toBeNull();
  });
});

describe('focusRegion', () => {
  it('frames the place at the zoom a single mark gets, centred on it, when no sheet will open', () => {
    // To ten places rather than exactly: `regionFor` carries a longitude through the antimeridian
    // arithmetic, which hands 16.1489 back as 16.148900000000026.
    const region = focusRegion(BLUE_HOLE, false);
    expect(region.latitude).toBeCloseTo(43.0378, 10);
    expect(region.longitude).toBeCloseTo(16.1489, 10);
    expect(region.latitudeDelta).toBe(0.02);
    expect(region.longitudeDelta).toBe(0.02);
  });

  // The sheet covers up to the bottom half of the map, so the place goes to the middle of the top
  // half: the camera sits a quarter of the span (0.005°) south of it.
  it('moves the place into the top half when its sheet will open', () => {
    const region = focusRegion(BLUE_HOLE, true);
    expect(region.latitude).toBeCloseTo(43.0328, 10);
    expect(region.longitude).toBeCloseTo(16.1489, 10);
    expect(region.latitudeDelta).toBe(0.02);
    expect(region.longitudeDelta).toBe(0.02);
  });

  it('keeps the place on the map either way', () => {
    expect(regionContains(focusRegion(BLUE_HOLE, true), BLUE_HOLE)).toBe(true);
    expect(regionContains(focusRegion(BLUE_HOLE, false), BLUE_HOLE)).toBe(true);
  });

  // A quarter-span south of a place this close to the South Pole is below −90°, which MapKit
  // rejects as an invalid region — a crash rather than a bad frame (#27's review).
  it('never moves the camera south of the South Pole', () => {
    const region = focusRegion({ latitude: -89.999, longitude: 0 }, true);
    expect(region.latitude).toBeGreaterThanOrEqual(-90);
    expect(region.latitude).toBe(-90);
  });
});
