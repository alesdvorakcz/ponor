// The package's own official Jest mock, imported first and named `mock…` for the
// babel-plugin-jest-hoist reason every screen suite in this repo records: a `jest.mock()` factory
// may only close over out-of-scope identifiers starting with `mock`/`require`, and every
// `jest.mock()` call is hoisted above every import regardless.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, cleanup, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { useDives, type DiveListState } from '../db/useDives';
import { useDiveSampleShapes } from '../db/useDiveSampleShapes';
import { useDiveSites, type DiveSiteListState } from '../db/useDiveSites';
import { useUnitSystem } from '../db/useUnitSystem';
import { assignDiveNumbers } from '../domain/diveNumber';
import { dive } from '../domain/diveFixture';
import { type ProfilePoint } from '../domain/profile';
import { catalogueUnreadable, logbookUnreadable } from '../domain/logbook';
import { SITE_DEFAULT_FIELDS, type SiteDefaultField } from '../domain/siteDefaults';
import { type Dive, type DiveSite } from '../domain/types';
import { setActiveLanguage } from '../i18n';
import { completePlacePick, placePickRequest, type PlacePickRequest } from '../navigation/placePick';
import { unnamedSite } from '../format/display';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { makeStyles } from '../theme/styles';
import DiveSiteScreen from './DiveSiteScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useDiveSites', () => ({ useDiveSites: jest.fn() }));
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
// Task 6's row sparkline map — its own hook, mocked on its own for the same reason `useDives`
// above is: a live database read this screen must be renderable without.
jest.mock('../db/useDiveSampleShapes', () => ({ useDiveSampleShapes: jest.fn() }));
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));
// The hand-back registry at its own seam, as the picker's and the create page's suites mock it:
// `placePick.test.ts` proves what completing does to the form and the stack.
jest.mock('../navigation/placePick', () => ({
  placePickRequest: jest.fn(),
  completePlacePick: jest.fn(),
  firstParam: jest.requireActual('../navigation/placePick').firstParam,
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

const mockUseDiveSites = useDiveSites as jest.MockedFunction<typeof useDiveSites>;
const mockUseDives = useDives as jest.MockedFunction<typeof useDives>;
const mockUseDiveSampleShapes = useDiveSampleShapes as jest.MockedFunction<typeof useDiveSampleShapes>;
const mockUseUnitSystem = useUnitSystem as jest.MockedFunction<typeof useUnitSystem>;
const mockParams = useLocalSearchParams as jest.MockedFunction<typeof useLocalSearchParams>;
const mockRequest = placePickRequest as jest.MockedFunction<typeof placePickRequest>;
const mockComplete = completePlacePick as jest.MockedFunction<typeof completePlacePick>;

/**
 * **A site in the shape §2.3 actually writes: a name, and whatever the dive that created it
 * happened to carry.**
 *
 * The default here is the barest of those — a name and nothing else — because that is the row a
 * page has to be worth opening for, and because a fixture full of complete sites would never
 * exercise the branch where the catalogue knows nothing. Every richer field is opted into by the
 * test that is about it. Note `maxDepthM` is null by default in a way the others are not merely
 * by convention: §2.3 refuses to seed it from a dive at all.
 */
const rock = (over: Partial<DiveSite> = {}): DiveSite => ({
  id: 's1',
  name: 'Kotelna',
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

function catalogueState(sites: DiveSite[], over: Partial<DiveSiteListState> = {}): DiveSiteListState {
  return { sites, resolved: true, error: undefined, ...over };
}

function divesState(dives: Dive[], over: Partial<DiveListState> = {}): DiveListState {
  return {
    dives,
    numbers: assignDiveNumbers(dives, 0),
    resolved: true,
    error: undefined,
    settingsError: undefined,
    ...over,
  };
}

beforeEach(() => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock()]));
  mockUseDives.mockReturnValue(divesState([]));
  mockUseDiveSampleShapes.mockReturnValue({ shapes: new Map(), resolved: true, error: undefined });
  mockUseUnitSystem.mockReturnValue('metric');
  mockParams.mockReturnValue({ id: 's1' });
  (router.push as jest.Mock).mockClear();
  (router.back as jest.Mock).mockClear();
  mockRequest.mockReset();
  mockComplete.mockReset();
});

// Task 6's row sparkline: a small hand-rolled series, enough to prove the wiring reaches the
// row at all — `ProfileSparkline.test.tsx` and `DiveRow.test.tsx` already own the real fixture.
const SERIES: ProfilePoint[] = [
  { t: 0, v: 5 },
  { t: 30, v: 12 },
  { t: 60, v: 3 },
];

function allNodes(t: RenderResult) {
  return t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
}

function textIn(t: RenderResult): string[] {
  return allNodes(t)
    .filter((n) => n.type === 'Text')
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

const show = () => render(<DiveSiteScreen />);

/** A dive at this site, in the shape a real logbook holds: the id pairs it, the snapshot says
 * what it was called (§6). */
const atKotelna = (over: Partial<Dive> = {}) =>
  dive({ siteId: 's1', siteName: 'Kotelna', maxDepthM: 18.2, waterTempC: 12, ...over });

// --- The site with only a name, which §5 makes the minimum a row can be ---------------------

/**
 * **The guard this whole screen turns on.** A site that is a name and nothing else has no
 * catalogue facts to draw, so the page is worth opening only because of the half the catalogue
 * does not hold — the diver's own dives here, which nothing else in the app lists (the logbook
 * groups by trip, the Map by mark, Stats by logbook).
 *
 * Written against the default fixture deliberately: a suite whose sites all carried five facts
 * would pass with this branch broken and never say so.
 */
it('is worth opening for a site that has nothing but a name', async () => {
  mockUseDives.mockReturnValue(divesState([atKotelna(), atKotelna({ maxDepthM: 12, waterTempC: 8 })]));
  const t = await show();
  const text = textIn(t);
  expect(text).toContain('Kotelna');
  expect(text).toContain('2 dives · deepest 18.2 m · 8–12 °C');
  expect(text).toContain('Your dives');
  // ...and the dives themselves, not merely a count of them.
  expect(text).toContain('18.2');
});

// A heading with nothing under it is the shape §0.6 refuses on the dive detail: a cluster over zero
// rows, and a note about rows that are not there.
it('draws no cluster and no note for a site the catalogue knows nothing else about', async () => {
  mockUseDives.mockReturnValue(divesState([atKotelna()]));
  const text = textIn(await show());
  expect(text).not.toContain('The site');
  expect(text).not.toContain('Country');
  expect(text).not.toContain('Site depth');
  expect(text.join(' ')).not.toContain('a new dive logged here');
});

// --- What the catalogue knows, in one cluster with a note (§6, §2.1; the owner's pick C) ------

/** The note under *The site*, or `undefined` when the page draws none. */
function noteIn(t: RenderResult): string | undefined {
  return textIn(t).find((line) => line.includes('a new dive logged here'));
}

/**
 * **One *The site* cluster, and a note under it naming the rows that do something** — the owner's
 * pick C on the board *#31 · Site defaults, altitude offer* (2026-11-17). What picking the site
 * will write into a new dive is said once, under the cluster, by naming the things it fills — since
 * issue #6 the salinity row and the water body and ways in tiles, each by the label it is drawn with.
 */
it('puts what a site gives a new dive among its facts, and says which rows those are', async () => {
  mockUseDiveSites.mockReturnValue(
    catalogueState([rock({ country: 'CZ', maxDepthM: 42, entry: ['shore'], salinity: 'fresh', waterBody: 'quarry' })]),
  );
  const t = await show();
  const lines = textIn(t);
  expect(lines).toContain('The site');
  expect(lines).not.toContain('Site defaults');
  expect(lines).toContain('42.0 m');
  // The salinity as its own row; the water body and the way in as tiles; no shared *Water* row.
  expect(labelsIn(t)).toContain('Salinity');
  expect(lines).toContain('Fresh');
  expect(lines).not.toContain('Water');
  expect(lines).not.toContain('Fresh · Quarry');
  expect(tileWordsIn(t)).toEqual([
    ['Quarry', 'Water body'],
    ['Shore', 'Entry'],
  ]);
  expect(noteIn(t)).toBe(
    'Salinity, Water body and Entry fill in a new dive logged here, over anything carried from your last dive.',
  );
  // The note closes the cluster: under its last row.
  expect(lines.indexOf(noteIn(t)!)).toBeGreaterThan(lines.indexOf('Country'));
});

/**
 * **`max_depth_m` is the SITE's depth and it is not any dive's**, which is the distinction §6
 * draws, §2.3 protects by refusing to seed the column from a dive, and M2o's report records as the
 * one that bit. This is the only screen in the app that shows both figures at once, inches apart,
 * so it is the only place that distinction can be read — or misread.
 *
 * Asserted as the pair rather than as either figure alone: a page that labelled the site's depth
 * `Depth`, or that fed the summary line the site's number, would still show two plausible metres.
 */
it('says the site’s own depth and the diver’s deepest dive here as two different figures', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ maxDepthM: 42 })]));
  mockUseDives.mockReturnValue(divesState([atKotelna({ maxDepthM: 18.2 })]));
  const text = textIn(await show());
  expect(text).toContain('1 dive · deepest 18.2 m · 12 °C');
  expect(text).toContain('Site depth');
  expect(text).toContain('42.0 m');
  expect(text).not.toContain('Depth');
});

/**
 * **The note is decided by the prefill's own reading** (`siteDefaultValue`), field by field — so
 * each of `SITE_DEFAULT_FIELDS` on its own must put its row in the note, and the page and the prefill
 * cannot disagree. Iterated over that list rather than over hand-written fields, so a fourth default
 * added to `domain/siteDefaults.ts` is asked about here too (and fails to compile below until it is
 * given a site that holds it).
 */
it.each(SITE_DEFAULT_FIELDS)('names the row a site’s %s fills in, and only that row', async (field) => {
  const only: Record<SiteDefaultField, { site: Partial<DiveSite>; row: string }> = {
    entry: { site: { entry: ['boat'] }, row: 'Entry' },
    salinity: { site: { salinity: 'salt' }, row: 'Salinity' },
    waterBody: { site: { waterBody: 'ocean' }, row: 'Water body' },
  };
  mockUseDiveSites.mockReturnValue(catalogueState([rock(only[field].site)]));
  expect(noteIn(await show())).toBe(
    `${only[field].row} fills in a new dive logged here, over anything carried from your last dive.`,
  );
});

/** Every labelled row on screen, read off the label style rather than off the text. */
function labelsIn(t: RenderResult): string[] {
  const styles = makeStyles('light');
  return allNodes(t)
    .filter((n) => [n.props?.style].flat(5).includes(styles.factLabel))
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

/** The words on each tile of *The site*, value first (issue #6). */
function tileWordsIn(t: RenderResult): string[][] {
  const styles = makeStyles('light');
  return allNodes(t)
    .filter((n) => n.type === 'View' && [n.props?.style].flat(5).includes(styles.conditionTile))
    .map((tile) => tile.queryAll((n) => n.type === 'Text').flatMap((n) => n.children).filter((c): c is string => typeof c === 'string'));
}

// Issue #6, the owner's call: the water body and the ways in are tiles with their drawings, as the
// site's types are; salinity has no shape to draw and is the one row left of the three.
it('draws the water body and the ways in as tiles, and the salinity as the one row', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ entry: ['boat'], salinity: 'salt', waterBody: 'ocean' })]));
  const t = await show();
  expect(labelsIn(t)).toEqual(['Salinity']);
  expect(textIn(t)).toContain('Salt');
  expect(tileWordsIn(t)).toEqual([
    ['Ocean', 'Water body'],
    ['Boat', 'Entry'],
  ]);
});

it('draws the water body as a tile with no salinity row when the site records only the body', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ waterBody: 'lake' })]));
  const t = await show();
  expect(labelsIn(t)).toEqual([]);
  expect(tileWordsIn(t)).toEqual([['Lake', 'Water body']]);
});

/**
 * **A `null` column means the catalogue does not know, not that the answer is empty** — that
 * module's own rule — so the row is absent rather than drawn as a dash, and the note names only the
 * rows that are there.
 */
it('omits a row the catalogue has no opinion about, and leaves it out of the note', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ country: 'CZ', entry: ['shore'] })]));
  const t = await show();
  const lines = textIn(t);
  expect(lines).toContain('Entry');
  expect(lines).not.toContain('Water');
  expect(lines).not.toContain('—');
  expect(noteIn(t)).toBe('Entry fills in a new dive logged here, over anything carried from your last dive.');
});

/**
 * **A site's entry is a set** (#31). The page draws it whatever its size; the note names it only
 * when the prefill would write it — exactly one way in (`siteDefaultValue`, §2.1). Several ways in
 * are left to the diver (#63), so the note must not promise them.
 */
it('names one way in in the note', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ entry: ['boat'], salinity: 'salt', waterBody: 'ocean' })]));
  const t = await show();
  expect(textIn(t)).toContain('Boat');
  expect(noteIn(t)).toBe('Salinity, Water body and Entry fill in a new dive logged here, over anything carried from your last dive.');
});

it('draws two ways in as two Entry tiles, and names only the water in the note', async () => {
  mockUseDiveSites.mockReturnValue(
    catalogueState([rock({ entry: ['shore', 'boat'], salinity: 'salt', waterBody: 'ocean' })]),
  );
  const t = await show();
  const lines = textIn(t);
  expect(lines.indexOf('Entry')).toBeGreaterThan(lines.indexOf('The site'));
  expect(tileWordsIn(t)).toEqual([
    ['Ocean', 'Water body'],
    ['Shore', 'Entry'],
    ['Boat', 'Entry'],
  ]);
  expect(noteIn(t)).toBe('Salinity and Water body fill in a new dive logged here, over anything carried from your last dive.');
});

it('draws several ways in with no note when nothing else fills in a dive', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ entry: ['shore', 'boat'] })]));
  const t = await show();
  expect(tileWordsIn(t)).toEqual([
    ['Shore', 'Entry'],
    ['Boat', 'Entry'],
  ]);
  expect(noteIn(t)).toBeUndefined();
});

it('draws no entry row for a site that records none', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ entry: [], salinity: 'salt' })]));
  const lines = textIn(await show());
  expect(lines).toContain('Salt');
  expect(lines).not.toContain('Entry');
});

it('draws the cluster with no note when it knows only the place', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ country: 'CZ' })]));
  const t = await show();
  expect(textIn(t)).toContain('The site');
  expect(textIn(t)).toContain('CZ');
  expect(noteIn(t)).toBeUndefined();
});

/** The canvas draws the note as a note about the rows, not a sentence of the page: muted mono. */
it('draws the note in its own muted mono', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ entry: ['boat'] })]));
  const t = await show();
  const styles = makeStyles('light');
  const note = noteIn(t);
  expect(note).toBeDefined();
  const node = allNodes(t).find((n) => n.type === 'Text' && n.children[0] === note);
  expect(node).toBeDefined();
  expect(styles.siteFactsNoteText).toBeDefined();
  expect([node?.props.style].flat(5)).toContain(styles.siteFactsNoteText);
});

// --- Which dives the page claims -------------------------------------------------------------

/**
 * `divesAtSite` owns the rule and states it; what this screen has to get right is that it asks
 * that question rather than a looser one. A dive at another site with the same name, a dive whose
 * CENTRE is called Kotelna, and a planned dive here are the three a looser rule would let through.
 */
it('lists the dives that were at this site and no others', async () => {
  mockUseDives.mockReturnValue(
    divesState([
      atKotelna({ maxDepthM: 18.2 }),
      dive({ siteId: 's2', siteName: 'Kotelna', maxDepthM: 30.5 }),
      dive({ siteName: 'Divoká Šárka', maxDepthM: 22.4 }),
      dive({ centerName: 'Kotelna', maxDepthM: 27.7 }),
      dive({ status: 'planned', siteId: 's1', siteName: 'Kotelna', maxDepthM: 11.1 }),
    ]),
  );
  const text = textIn(await show());
  expect(text).toContain('1 dive · deepest 18.2 m · 12 °C');
  expect(text).toContain('18.2');
  expect(text).not.toContain('30.5');
  expect(text).not.toContain('22.4');
  expect(text).not.toContain('27.7');
  expect(text).not.toContain('11.1');
});

/**
 * **An unpaired dive belongs by its folded name**, which is what makes this page worth having at
 * all: §2.3 started publishing sites in M2o, so a diver who has been here forty times and then
 * added the site from dive forty-one has one paired dive and thirty-nine that are not.
 */
it('counts a dive that named the site by hand', async () => {
  mockUseDives.mockReturnValue(divesState([dive({ siteName: 'kotelna', maxDepthM: 9.4 })]));
  expect(textIn(await show())).toContain('1 dive · deepest 9.4 m');
});

// Task 6's whole reason for calling out the wiring by name: a `samples` prop that nothing
// ever passes draws nothing, forever. This proves the map `useDiveSampleShapes()` hands back
// actually reaches this page's own dive list.
// Task 6 review, Finding 6: a second dive with NO entry in `shapes` — without it, a screen
// that passed every row the same constant series would pass this test just as well as one
// that genuinely looks the series up by id.
it("passes each dive its own series from useDiveSampleShapes() through to its row's sparkline", async () => {
  mockUseDives.mockReturnValue(
    divesState([dive({ id: 'has-series', siteId: 's1' }), dive({ id: 'no-series', siteId: 's1' })]),
  );
  mockUseDiveSampleShapes.mockReturnValue({
    shapes: new Map([['has-series', SERIES]]),
    resolved: true,
    error: undefined,
  });
  const t = await show();
  expect(t.root ? t.root.queryAll((n) => n.type === 'RNSVGPath') : []).toHaveLength(1);
});

// A page opened to ask "what have I done here" answers even when the answer is none — the one
// place this screen deliberately differs from `formatSiteRow`, which omits a nought.
it('says 0 dives rather than nothing at all', async () => {
  const text = textIn(await show());
  expect(text).toContain('0 dives');
  expect(text).not.toContain('Your dives');
});

it('opens a dive from its row', async () => {
  const one = atKotelna();
  mockUseDives.mockReturnValue(divesState([one]));
  const t = await show();
  const styles = makeStyles('light');
  const row = allNodes(t).find((n) => [n.props?.style].flat(5).includes(styles.diveRow));
  expect(row).toBeDefined();
  await fireEvent.press(row!);
  expect(String((router.push as jest.Mock).mock.calls[0]?.[0])).toBe(`/dive/${one.id}`);
});

// --- The three states of a site that is not here ----------------------------------------------

/**
 * §10: a screen with no answer must not state one. `useLiveQuery` hands back `[]` on the renders
 * before its query returns, so *"Site not found"* said unconditionally would be a claim about a
 * database nothing has yet asked.
 */
it('states nothing about a catalogue it has not read yet', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([], { resolved: false }));
  expect(textIn(await show())).toEqual(['‹ Back']);
});

it('says the site is not here once it has looked', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([]));
  expect(textIn(await show())).toContain('Site not found.');
});

/**
 * **A merged site is exactly this branch** (§5, M2r). `db/catalogue.ts`'s `pickable` hands back
 * live, `status = 'active'` rows only, so a duplicate an admin folded away never reaches this
 * screen's list and the page says so — rather than being shown beside its survivor, or reading
 * `merged_into` here, which the pull's own repoint makes unnecessary.
 *
 * The fixture is a real merged row rather than an empty catalogue, so this cannot pass merely
 * because the hook returned nothing.
 */
it('does not open a page for a site an admin merged away', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ id: 's-survivor', name: 'Kotelna' })]));
  mockParams.mockReturnValue({ id: 's-merged' });
  const text = textIn(await show());
  expect(text).toContain('Site not found.');
  expect(text).not.toContain('Kotelna');
});

// A failed read must never read as "not found": one is a broken device, the other is a site that
// is genuinely gone.
it('reports a failed catalogue read rather than a missing site', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([], { error: new Error('nope') }));
  const text = textIn(await show());
  expect(text).toContain(catalogueUnreadable());
  expect(text).not.toContain('Site not found.');
});

// The way out is on both branches, for `DiveDetailScreen`'s stated reason: a page reached by an
// unknown id is more of a dead end than a real one, not less.
it('offers the way out whether or not the site is here', async () => {
  expect(textIn(await show())).toContain('‹ Back');
  mockUseDiveSites.mockReturnValue(catalogueState([]));
  expect(textIn(await show())).toContain('‹ Back');
});

/**
 * **Asserted through the cold-deep-link branch, because the ordinary one cannot fail.**
 * `leaveTo` pops the stack when there is history, and every exit in the app pops the same way — so
 * a press with `canGoBack()` true proves only that something was called, and a back control wired
 * to `backToDives` would satisfy it. The fallback is the only branch that names a route
 * (`navigation/leaveScreen.ts`, whose own suite pins the pair for all five exits).
 */
it('leaves for the sites directory rather than for the map', async () => {
  (router.canGoBack as jest.Mock).mockReturnValueOnce(false);
  const t = await show();
  const back = allNodes(t).find((n) => n.props?.accessibilityLabel === 'Go back');
  expect(back).toBeDefined();
  await fireEvent.press(back!);
  expect(router.replace).toHaveBeenCalledWith('/sites');
});

// --- The logbook underneath it ------------------------------------------------------------------

/**
 * The site is readable and the logbook is not, which is a different failure from either of the two
 * above and gets the sentence five other screens say about the same event (`logbookUnreadable`,
 * domain/logbook.ts). The page still names the site and still says what the catalogue knows: what
 * failed is the half about the diver.
 */
it('names the site and reports the logbook failure under it', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ country: 'CZ' })]));
  mockUseDives.mockReturnValue(divesState([], { error: new Error('nope') }));
  const text = textIn(await show());
  expect(text).toContain('Kotelna');
  expect(text).toContain(logbookUnreadable());
  expect(text).toContain('CZ');
  // No summary: "0 dives" over an unreadable logbook is a figure with nothing behind it.
  expect(text).not.toContain('0 dives');
});

it('says nothing about a logbook it has not read yet', async () => {
  mockUseDives.mockReturnValue(divesState([], { resolved: false }));
  const text = textIn(await show());
  expect(text).toContain('Kotelna');
  expect(text).not.toContain('0 dives');
});

// --- Naming, units and paint ----------------------------------------------------------------

// `dive_sites.name` is nullable in both databases (§6), so a row with none can arrive by pull. A
// heading a screen reader announces as nothing is worse than one it announces as unnamed, and it
// must be the words the rest of the app uses.
it('calls an unnamed site what the rest of the app calls one', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ name: null })]));
  expect(textIn(await show())).toContain(unnamedSite());
});

/** Both depths follow the diver's own system — the summary's, which is a dive's, and the
 * cluster's, which is the site's. Two conversions, one setting. */
it('reads both depths in the diver’s own units', async () => {
  mockUseUnitSystem.mockReturnValue('imperial');
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ maxDepthM: 42 })]));
  mockUseDives.mockReturnValue(divesState([atKotelna()]));
  const said = textIn(await show()).join(' ');
  expect(said).toContain('60 ft');
  expect(said).toContain('138 ft');
  expect(said).not.toContain(' m');
});

// §0.1's sweep: the depth palette reaches this screen exactly where it reaches every other one —
// on a `DiveRow`'s own depth, beside its own number — and nothing else is painted.
it('paints nothing of its own', async () => {
  mockUseDiveSites.mockReturnValue(
    catalogueState([rock({ country: 'CZ', maxDepthM: 42, entry: ['shore'], salinity: 'fresh' })]),
  );
  mockUseDives.mockReturnValue(divesState([atKotelna()]));
  expect(unexpectedGraphics(await show(), 'light')).toEqual([]);
});

// **...and none on a row whose sparkline actually draws** (review, Finding 6). The sweep above
// renders with no entry in `shapes` at all, so the sparkline Task 6 put in every row had never
// met this guard on this screen — exactly the latent exposure `DivesScreen`'s own equivalent
// test (`draws none on a list whose rows have a shape to draw`) closed there.
it('paints nothing of its own on a row whose sparkline actually draws', async () => {
  mockUseDives.mockReturnValue(
    divesState([dive({ id: 'has-series', siteId: 's1' }), dive({ id: 'no-series', siteId: 's1' })]),
  );
  mockUseDiveSampleShapes.mockReturnValue({
    shapes: new Map([['has-series', SERIES]]),
    resolved: true,
    error: undefined,
  });
  const t = await show();
  // The sweep below is worthless if nothing drew: an empty shapes map would make it pass for
  // the reason the sweep above does.
  expect(t.root ? t.root.queryAll((n) => n.type === 'RNSVGPath') : []).toHaveLength(1);
  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});

// The title is the screen's own, in the app's one heading treatment — not a borrowed one.
it('sets its heading in the treatment every other screen title uses', async () => {
  const t = await show();
  const styles = makeStyles('light');
  const heading = allNodes(t).find((n) => [n.props?.style].flat(5).includes(styles.siteHeading));
  expect(heading?.children).toEqual(['Kotelna']);
});


// ---------------------------------------------------------------------------------------
// Czech (M3h)
// ---------------------------------------------------------------------------------------

describe('in Czech', () => {
  beforeEach(() => {
    setActiveLanguage('cs');
  });
  afterEach(async () => {
    await cleanup();
    setActiveLanguage('en');
  });

  /** The page's cluster and the note under it, which is the one sentence §2.1 has to say here —
   * that picking this site OUTRANKS carry-over rather than merely filling in. Czech conjugates the
   * reflexive verb alike for one row and two, so one sentence serves both. */
  it('names its cluster, its rows and its note in Czech', async () => {
    mockUseDiveSites.mockReturnValue(
      catalogueState([rock({ country: 'HR', maxDepthM: 42, entry: ['shore'], salinity: 'salt', waterBody: 'ocean' })]),
    );
    const t = await show();
    const said = textIn(t);
    expect(said).toContain('Lokalita');
    expect(said).toContain('Země');
    expect(said).toContain('Hloubka lokality');
    expect(said).toContain('Slanost');
    expect(said).toContain('Slaná');
    expect(said).toContain('‹ Zpět');
    expect(tileWordsIn(t)).toEqual([
      ['Oceán', 'Vodní plocha'],
      ['Břeh', 'Vstup'],
    ]);
    expect(said).toContain(
      'Slanost, Vodní plocha a Vstup se u nového ponoru zde vyplní místo toho, co se převzalo z minulého ponoru.',
    );
    expect(said).not.toContain('Site depth');
  });

  it('names one row in the note in Czech', async () => {
    mockUseDiveSites.mockReturnValue(catalogueState([rock({ entry: ['shore', 'boat'], salinity: 'salt' })]));
    const t = await show();
    expect(tileWordsIn(t)).toEqual([
      ['Břeh', 'Vstup'],
      ['Loď', 'Vstup'],
    ]);
    expect(textIn(t)).toContain('Slanost se u nového ponoru zde vyplní místo toho, co se převzalo z minulého ponoru.');
  });

  it('says a site it cannot find is not there, in Czech', async () => {
    mockUseDiveSites.mockReturnValue(catalogueState([]));
    expect(textIn(await show())).toContain('Lokalita nenalezena.');
  });

  /**
   * **This screen's own subscription** (`useT`, src/i18n), and the only thing that proves it is
   * there: nothing is re-rendered by the test, so the repaint can only come from this screen
   * hearing i18next's `languageChanged`. `LanguageSync` is a sibling in the root layout and its
   * state change reaches nobody here — without the hook a diver would change the setting in
   * Settings, come back, and read the old words until something else redrew the screen.
   */
  it('repaints itself when the language changes under it', async () => {
    await cleanup();
    setActiveLanguage('en');
    mockUseDiveSites.mockReturnValue(catalogueState([rock({ country: 'HR' })]));
    const t = await show();
    expect(textIn(t)).toContain('Country');

    await act(() => {
      setActiveLanguage('cs');
    });
    expect(textIn(t)).toContain('Země');
    expect(textIn(t)).not.toContain('Country');
  });
});

// --- Show on map (issue #21) -------------------------------------------------------------------
//
// The dive detail's card, on a site's page as the design canvas draws it: Ponor's own map pointed
// at this site. Where the map then opens and what it selects is `MapScreen.test.tsx`'s; this page
// only has to offer it, for a site that has a position, and push the right route.

/** The card, by what a screen reader hears — the label is the card's own, not this page's. */
function mapCard(t: RenderResult) {
  return allNodes(t).find((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === 'Show on map');
}

it('offers the site on the map, with its position under the words', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ latitude: 49.72134, longitude: 16.20311 })]));
  const t = await show();
  expect(mapCard(t)).toBeDefined();
  expect(textIn(t)).toContain('49.72134, 16.20311');
});

it('pushes the map pointed at this site', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ latitude: 49.72134, longitude: 16.20311 })]));
  const t = await show();
  await fireEvent.press(mapCard(t)!);
  // `over: 'page'`: the map is pushed over this page, so a link back to it from the map goes back.
  expect(router.push).toHaveBeenCalledWith({ pathname: '/site/[id]/map', params: { id: 's1', over: 'page' } });
});

// §5 asks a new site for a name and nothing else, so this is the ordinary site, not an edge.
it('offers no map for a site with no position', async () => {
  const t = await show();
  expect(mapCard(t)).toBeUndefined();
  expect(textIn(t)).not.toContain('Show on map');
});

it('puts the card under the page’s own lines and above the site’s facts', async () => {
  mockUseDiveSites.mockReturnValue(
    catalogueState([rock({ country: 'Czechia', latitude: 49.72134, longitude: 16.20311 })]),
  );
  const lines = textIn(await show());
  expect(lines.indexOf('Show on map')).toBeGreaterThan(lines.indexOf('Kotelna'));
  expect(lines.indexOf('Show on map')).toBeLessThan(lines.indexOf('The site'));
});

// --- What a site says about itself (#31) -------------------------------------------------------

const teti = (over: Partial<DiveSite> = {}) =>
  rock({
    name: 'Kamena vrata',
    siteTypes: ['wreck', 'wall'],
    suitableFor: 'advanced',
    maxDepthM: 34,
    altitudeM: 312.6,
    wreckName: 'Teti',
    wreckSunkYear: 1930,
    altNames: ['Teti wreck'],
    country: 'HR',
    description: 'A wreck on a wall.\n\nCurrent on the east side.',
    ...over,
  });

it('puts the description under the page’s own lines and above the map card', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([teti({ latitude: 43.0611, longitude: 16.1834 })]));
  mockUseDives.mockReturnValue(divesState([atKotelna({ siteName: 'Kamena vrata', siteId: 's1' })]));
  const t = await show();
  const lines = textIn(t);
  const description = 'A wreck on a wall.\n\nCurrent on the east side.';
  expect(lines.indexOf(description)).toBeGreaterThan(lines.indexOf('Kamena vrata'));
  expect(lines.indexOf(description)).toBeGreaterThan(lines.findIndex((line) => line.startsWith('1 dive')));
  expect(lines.indexOf(description)).toBeLessThan(lines.indexOf('Show on map'));
  expect(lines.indexOf('Show on map')).toBeLessThan(lines.indexOf('The site'));
});

it('shows the site’s facts in the canvas’s order, each only when filled', async () => {
  mockUseDiveSites.mockReturnValue(
    catalogueState([teti({ entry: ['shore', 'boat'], salinity: 'salt', waterBody: 'ocean' })]),
  );
  const t = await show();
  // The site's types lead the cluster as tiles since issue #6, so they are no longer a labelled row.
  const labels = ['Suitable for', 'Site depth', 'Altitude', 'Wreck', 'Salinity', 'Other names', 'Country'];
  // The rows as drawn, label by label, so the order is the cluster's and not the text's at large.
  expect(labelsIn(t)).toEqual(labels);
  const lines = textIn(t);
  for (const value of ['Wreck', 'Wall', 'Advanced', '34.0 m', '313 m', 'Teti · sunk 1930', 'Salt', 'Ocean', 'Shore', 'Boat', 'Teti wreck', 'HR']) {
    expect(lines).toContain(value);
  }
});

// Issue #6: the site's types are tiles with their drawings, as the dive detail's conditions are,
// where #31 printed them as one line. A token this build does not know keeps its word, undrawn.
it('shows the site’s types as tiles with their drawings, not as a line of text', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([teti()]));
  const t = await show();
  const styles = makeStyles('light');
  const tiles = allNodes(t).filter((n) => n.type === 'View' && [n.props?.style].flat(5).includes(styles.conditionTile));
  expect(tiles.map((tile) => tile.queryAll((n) => n.type === 'Text').flatMap((n) => n.children)[0])).toEqual(['Wreck', 'Wall']);
  for (const tile of tiles) expect(tile.queryAll((n) => n.type === 'RNSVGSvgView')).toHaveLength(1);
  expect(textIn(t)).not.toContain('Wreck · Wall');
  expect(labelsIn(t)).not.toContain('Site type');
});

// Final review, Critical #1: a list from another client's build may hold a number or a null (#31
// guards `formatPlaceTokens` for exactly this, display.test.ts). The tiles must skip them, not crash
// the page every diver who pulls that site would open; and a repeated token must not collide.
it('skips a site type that is not a word, and survives a repeated one', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([teti({ siteTypes: ['wreck', 3, null, 'wreck'] as never })]));
  const t = await show();
  const styles = makeStyles('light');
  const tiles = allNodes(t).filter((n) => n.type === 'View' && [n.props?.style].flat(5).includes(styles.conditionTile));
  expect(tiles).toHaveLength(2);
  // Inside the tiles only: the page also has a *Wreck* fact row, for the ship's name.
  expect(tiles.map((tile) => tile.queryAll((n) => n.type === 'Text').flatMap((n) => n.children)[0])).toEqual(['Wreck', 'Wreck']);
});

// PR #66 review, finding 1: `formatPlaceTokens` refused a value that is not a list at all, and the
// tiles that replaced its rows must too. `jsonArray` degrades a bad column to `[]`, but the page
// re-checks rather than trusting `$type<>`, as `toDive` does (db/schema.ts).
it('draws no tiles from a site type or way in that is not a list, and still draws the page', async () => {
  mockUseDiveSites.mockReturnValue(
    catalogueState([teti({ siteTypes: null as never, entry: { boat: true } as never, salinity: 'salt', waterBody: 'ocean' })]),
  );
  const t = await show();
  expect(tileWordsIn(t)).toEqual([['Ocean', 'Water body']]);
  expect(labelsIn(t)).toContain('Salinity');
  expect(labelsIn(t)).toContain('Country');
});

// #69: a blank string is a string, so the guard above let it through, and it drew a tile with no
// word. The page reads its lists through the guard `formatPlaceTokens` uses, so the two agree.
it('draws no tile for a blank site type or way in', async () => {
  mockUseDiveSites.mockReturnValue(
    catalogueState([teti({ siteTypes: ['wreck', '', '  '] as never, entry: ['', 'shore', '  '] as never, waterBody: null })]),
  );
  const t = await show();
  expect(tileWordsIn(t).map(([word]) => word)).toEqual(['Wreck', 'Shore']);
});

it('keeps an unknown site type as a word on an undrawn tile', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([teti({ siteTypes: ['wall', 'cavern'] as never })]));
  const t = await show();
  const styles = makeStyles('light');
  const tiles = allNodes(t).filter((n) => n.type === 'View' && [n.props?.style].flat(5).includes(styles.conditionTile));
  expect(tiles).toHaveLength(2);
  expect(tiles[1]!.queryAll((n) => n.type === 'RNSVGSvgView')).toHaveLength(0);
});

it('draws only the facts the site has', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ wreckSunkYear: 1930 })]));
  const lines = textIn(await show());
  expect(lines).toContain('Wreck');
  expect(lines).toContain('sunk 1930');
  for (const label of ['Site type', 'Suitable for', 'Site depth', 'Altitude', 'Salinity', 'Water body', 'Entry', 'Other names', 'Country']) {
    expect(lines).not.toContain(label);
  }
});

it('shows an altitude in the diver’s unit, signed below sea level, and in ink like the depth', async () => {
  mockUseUnitSystem.mockReturnValue('imperial');
  mockUseDiveSites.mockReturnValue(catalogueState([teti({ altitudeM: -430 })]));
  const t = await show();
  expect(textIn(t)).toContain('-1411 ft');
  const value = allNodes(t).find((n) => n.type === 'Text' && n.children[0] === '-1411 ft');
  const depth = allNodes(t).find((n) => n.type === 'Text' && n.children[0] === '112 ft');
  // No band colour: it is drawn exactly as the site depth beside it is.
  expect(value).toBeDefined();
  expect(value?.props.style).toEqual(depth?.props.style);
});

it('shows an altitude of sea level, which is an answer and not an absence', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ altitudeM: 0 })]));
  const lines = textIn(await show());
  expect(lines).toContain('Altitude');
  expect(lines).toContain('0 m');
});

it('shows a type this build does not know as a word', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ siteTypes: ['wall', 'cavern'] as never })]));
  const lines = textIn(await show());
  // One tile per type since issue #6, so each is its own word rather than one line.
  expect(lines).toContain('Wall');
  expect(lines).toContain('Cavern');
  expect(lines.join(' ')).not.toContain('vocabulary.');
});

it('draws a long description whole', async () => {
  const long = Array.from({ length: 40 }, (_, i) => `Line ${i} of what a diver wrote.`).join('\n');
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ description: long })]));
  const t = await show();
  const styles = makeStyles('light');
  const node = allNodes(t).find((n) => [n.props?.style].flat(5).includes(styles.siteDescription));
  expect(node?.children).toEqual([long]);
  expect(node?.props.numberOfLines).toBeUndefined();
});

it('draws no description for blank text', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ description: ' \n ' })]));
  const t = await show();
  const styles = makeStyles('light');
  expect(allNodes(t).some((n) => [n.props?.style].flat(5).includes(styles.siteDescription))).toBe(false);
});

it('puts the note under the whole cluster and above the diver’s own dives', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([teti({ entry: ['shore'], salinity: 'salt', waterBody: 'ocean' })]));
  mockUseDives.mockReturnValue(divesState([atKotelna()]));
  const t = await show();
  const lines = textIn(t);
  const note = lines.indexOf(noteIn(t)!);
  expect(lines.indexOf('Country')).toBeLessThan(note);
  expect(lines.indexOf('Your dives')).toBeGreaterThan(note);
  expect(lines.filter((line) => line === 'The site')).toHaveLength(1);
});

it('says a site depth in ink, as the page always has', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([teti()]));
  expect(unexpectedGraphics(await show(), 'light')).toEqual([]);
});

describe('the new facts in Czech', () => {
  beforeEach(() => {
    setActiveLanguage('cs');
  });
  afterEach(async () => {
    await cleanup();
    setActiveLanguage('en');
  });

  it('names its labels and says the year as a year', async () => {
    mockUseDiveSites.mockReturnValue(catalogueState([teti()]));
    const lines = textIn(await show());
    for (const label of ['Typ lokality', 'Vhodné pro', 'Hloubka lokality', 'Vrak', 'Jiné názvy', 'Země']) {
      expect(lines).toContain(label);
    }
    expect(lines).toContain('Teti · potopen roku 1930');
  });
});

// --- Opened from a near-match on *New dive site* (owner's call, PR #35) -------------------------

describe('opened from a near-match', () => {
  const pickRequest: PlacePickRequest = {
    kind: 'site',
    selected: null,
    dive: { pin: null, entry: [], salinity: null, waterBody: null, siteId: null, diveId: null },
    onPick: jest.fn(),
  };
  const labelled = (t: RenderResult, label: string) => allNodes(t).find((n) => n.props?.accessibilityLabel === label);

  beforeEach(() => {
    mockParams.mockReturnValue({ id: 's1', pick: 'tok' });
    mockRequest.mockImplementation((token) => (token === 'tok' ? pickRequest : null));
  });

  it('offers Use this site, which picks it and closes this page, the create page and the picker', async () => {
    const t = await show();
    expect(textIn(t)).toContain('Use this site');
    await fireEvent.press(labelled(t, 'Use this site')!);
    expect(mockComplete).toHaveBeenCalledWith('tok', { id: 's1', name: 'Kotelna' }, 3);
  });

  // The pick's dismiss and a `‹ Back` landing during it would pop the dive form too, and a second
  // `‹ Back` would leave the create page as well as this one.
  it('lets one way off happen: Use this site or ‹ Back, once', async () => {
    const t = await show();
    await fireEvent.press(labelled(t, 'Use this site')!);
    await fireEvent.press(labelled(t, 'Go back')!);
    await fireEvent.press(labelled(t, 'Use this site')!);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();

    await cleanup();
    mockComplete.mockClear();
    const again = await show();
    await fireEvent.press(labelled(again, 'Go back')!);
    await fireEvent.press(labelled(again, 'Go back')!);
    await fireEvent.press(labelled(again, 'Use this site')!);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('a site with no name is picked as none, as the picker picks one', async () => {
    mockUseDiveSites.mockReturnValue(catalogueState([rock({ name: null })]));
    const t = await show();
    await fireEvent.press(labelled(t, 'Use this site')!);
    expect(mockComplete).toHaveBeenCalledWith('tok', { id: 's1', name: '' }, 3);
  });

  // Nothing to answer: the request was settled or lost to a reload, so the page is just the site's.
  it('offers nothing to use when the registry no longer holds the request', async () => {
    mockRequest.mockReturnValue(null);
    const t = await show();
    expect(textIn(t)).not.toContain('Use this site');
  });

  it('offers nothing to use when it was not opened from a near-match', async () => {
    mockParams.mockReturnValue({ id: 's1' });
    const t = await show();
    expect(textIn(t)).not.toContain('Use this site');
    // And `‹ Back` is the page's own, unclaimed: each press leaves.
    await fireEvent.press(labelled(t, 'Go back')!);
    await fireEvent.press(labelled(t, 'Go back')!);
    expect(router.back).toHaveBeenCalledTimes(2);
  });

  it('paints nothing of its own', async () => {
    const t = await show();
    expect(unexpectedGraphics(t, 'light')).toEqual([]);
  });

  it('words the button in Czech', async () => {
    setActiveLanguage('cs');
    try {
      const t = await show();
      expect(textIn(t)).toContain('Použít tuto lokalitu');
    } finally {
      await cleanup();
      setActiveLanguage('en');
    }
  });
});
