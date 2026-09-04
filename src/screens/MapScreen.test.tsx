// The package's own official Jest mock, imported first and named `mock…` for the
// babel-plugin-jest-hoist reason `DivesScreen.test.tsx` records: a `jest.mock()` factory may
// only close over out-of-scope identifiers starting with `mock`/`require`, and every
// `jest.mock()` call is hoisted above every import regardless. This screen's root composes
// `screenTopInset(insets.top)` like every other, and the real hook throws without a Provider.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { router } from 'expo-router';

import { useAuthSession } from '../cloud/useAuthSession';
import { useDives, type DiveListState } from '../db/useDives';
import { useDiveCenters, type DiveCenterListState } from '../db/useDiveCenters';
import { useDiveSites, type DiveSiteListState } from '../db/useDiveSites';
import { useUnitSystem } from '../db/useUnitSystem';
import { assignDiveNumbers } from '../domain/diveNumber';
import { dive } from '../domain/diveFixture';
import { UNNAMED_CENTER, UNNAMED_SITE } from '../format/display';
import { type Dive, type DiveCenter, type DiveSite } from '../domain/types';
import { locationPermission, requestLocationPermission } from '../platform/locationPermission';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { depthBandColor } from '../theme/depth';
import { makeStyles } from '../theme/styles';
import { CATALOGUE_UNREADABLE, LOGBOOK_UNREADABLE } from '../domain/logbook';
import MapScreen from './MapScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
jest.mock('../db/useDiveSites', () => ({ useDiveSites: jest.fn() }));
// The centres half of the catalogue (M3c) — its own hook, mocked on its own, which is also what
// makes "a failed centres read does not take the sites off the map" a thing this file can state.
jest.mock('../db/useDiveCenters', () => ({ useDiveCenters: jest.fn() }));
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));
jest.mock('../cloud/useAuthSession', () => ({
  useAuthSession: jest.fn(() => ({ session: null, resolved: true })),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
// **Both halves mocked, and the second one is the point.** `platform/locationPermission.ts`
// keeps reading the status apart from asking for it precisely because iOS spends its one sheet
// on whoever asks first (§3, M2m). Mocking only the read would leave "this screen never asks"
// unassertable — the ask would not exist to be counted. With both here, a screen that started
// calling `requestLocationPermission` is red.
jest.mock('../platform/locationPermission', () => ({
  locationPermission: jest.fn(async () => 'denied'),
  requestLocationPermission: jest.fn(async () => 'granted'),
}));

const mockUseDives = useDives as jest.MockedFunction<typeof useDives>;
const mockUseDiveSites = useDiveSites as jest.MockedFunction<typeof useDiveSites>;
const mockUseDiveCenters = useDiveCenters as jest.MockedFunction<typeof useDiveCenters>;
const mockUseAuthSession = useAuthSession as jest.MockedFunction<typeof useAuthSession>;
const mockUseUnitSystem = useUnitSystem as jest.MockedFunction<typeof useUnitSystem>;
const mockLocationPermission = locationPermission as jest.MockedFunction<typeof locationPermission>;
const mockRequestLocationPermission = requestLocationPermission as jest.MockedFunction<
  typeof requestLocationPermission
>;

/** The dive read, in the state a screen normally meets it: resolved, no failure, real numbers
 * from the real numbering rule rather than hand-written ones (§2.5 computes them, so a test
 * that typed them would be asserting its own arithmetic). */
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

function catalogueState(sites: DiveSite[], over: Partial<DiveSiteListState> = {}): DiveSiteListState {
  return { sites, resolved: true, error: undefined, ...over };
}

function centresState(centers: DiveCenter[], over: Partial<DiveCenterListState> = {}): DiveCenterListState {
  return { centers, resolved: true, error: undefined, ...over };
}

let centreSeq = 0;
/** A catalogue centre in the shape M2o actually writes: **a name and nothing else** (§2.3 — "a
 * centre inherits its name alone"). Every other field is opted into by a test that is about it,
 * which is what stops a fixture full of complete centres from hiding the common case. */
const centre = (over: Partial<DiveCenter> = {}): DiveCenter => ({
  id: `centre-${String(centreSeq++).padStart(4, '0')}`,
  name: 'Ponorka',
  country: null,
  latitude: null,
  longitude: null,
  website: null,
  createdBy: null,
  status: 'active',
  mergedInto: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  deletedAt: null,
  dirty: false,
  ...over,
});

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

beforeEach(() => {
  mockUseDives.mockReturnValue(divesState([]));
  mockUseDiveSites.mockReturnValue(catalogueState([]));
  mockUseDiveCenters.mockReturnValue(centresState([]));
  mockUseAuthSession.mockReturnValue({ session: null, resolved: true });
  mockUseUnitSystem.mockReturnValue('metric');
  mockLocationPermission.mockResolvedValue('denied');
  mockRequestLocationPermission.mockClear();
  (router.push as jest.Mock).mockClear();
});

/** Renders and lets the permission read settle, so no assertion runs against a frame the screen
 * has already moved past and no `act()` warning is printed after the test has passed. */
async function show(): Promise<RenderResult> {
  const t = await render(<MapScreen />);
  await act(async () => {});
  return t;
}

function allNodes(t: RenderResult) {
  return t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
}

function textIn(t: RenderResult): string[] {
  return allNodes(t)
    .filter((n) => n.type === 'Text')
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

function markers(t: RenderResult) {
  return allNodes(t).filter((n) => n.props?.coordinate !== undefined);
}

/** Every mark's spoken name, which since M3e names the KIND as well as the place — three kinds
 * draw at once and the numeral, the glyph and the empty disc that tell them apart are invisible
 * to a screen reader (`format/display.ts`). */
function markLabels(t: RenderResult): string[] {
  return markers(t).map((m) => String(m.props.accessibilityLabel));
}

/**
 * **The summary line itself, found by its own style rather than by looking for a substring.**
 *
 * Measured: assertions that merely searched every `Text` for a phrase could not tell a line the
 * screen chose not to draw from one whose words happened to differ, so a summary that described a
 * kind the diver had switched OFF stayed green. This answers `null` when the screen drew no line
 * at all, which is what §10's "a screen with no answer must not state one" actually looks like.
 */
function summaryLine(t: RenderResult): string | null {
  const styles = makeStyles('light');
  const node = allNodes(t).find((n) => [n.props?.style].flat(5).includes(styles.mapSummary));
  if (node === undefined) return null;
  // Read back with its spaces normalised: the line's clauses are joined with U+00A0 inside them
  // so it folds at a middot rather than through a figure (`format/display.ts`), and pasting
  // invisible characters into a dozen expectations here would make every one of them unreadable
  // for a reason none of them is about. `display.test.ts` owns that rule and names the
  // characters out loud.
  return node.children
    .filter((c): c is string => typeof c === 'string')
    .join('')
    .replaceAll('\u00A0', ' ');
}

function hasMap(t: RenderResult): boolean {
  return allNodes(t).some((n) => n.props?.initialRegion !== undefined);
}

/** The capsule's glyphs, by the label a screen reader would hear — which is what this screen
 * decides; which SF Symbol each draws is `ActionCapsule.test.tsx`'s and `symbolName.test.tsx`'s. */
function capsuleButtons(t: RenderResult) {
  const styles = makeStyles('light');
  const float = allNodes(t).find((n) => [n.props?.style].flat(5).includes(styles.capsuleFloat));
  if (float === undefined) throw new Error('MapScreen did not render its floating capsule');
  return float.queryAll(
    (n) => typeof n.props?.accessibilityLabel === 'string' && n.props?.accessibilityRole === 'button',
  );
}

function capsuleLabels(t: RenderResult): string[] {
  return capsuleButtons(t).map((n) => String(n.props.accessibilityLabel));
}

/** Which of the capsule's switches report themselves as on — the state channel a screen reader
 * gets, beside the inverted ink a sighted diver gets (`ActionCapsule.test.tsx` owns the ink). */
function capsuleSelected(t: RenderResult): boolean[] {
  return capsuleButtons(t).map((n) => Boolean((n.props.accessibilityState as { selected?: boolean })?.selected));
}

function labelled(t: RenderResult, label: string) {
  const node = allNodes(t).find((n) => n.props?.accessibilityLabel === label);
  if (node === undefined) throw new Error(`MapScreen rendered nothing labelled ${label}`);
  return node;
}

/** A real control — a capsule switch, a sheet's close — pressed through `fireEvent`, which is
 * the responder gate a device actually consults. M2l's own lesson: a test that calls the
 * handler directly would not notice a control that refuses the press. */
async function press(t: RenderResult, label: string) {
  await fireEvent.press(labelled(t, label));
}

/**
 * **A mark on the map, which under Jest is a stand-in `View`** (`__mocks__/react-native-maps.js`).
 *
 * Its handler is invoked rather than pressed, and that is deliberate rather than a shortcut: on
 * a device this press arrives from `MKMapView` selecting an annotation, so a synthesised touch
 * on a stand-in view would be a gesture no diver makes and would prove nothing extra. The claim
 * carried here is the one we wrote — the handler each mark is given reports that mark, and the
 * screen does the right thing with it. **That a mark is pressable at all, and that the three
 * kinds read as three kinds, is a simulator question.**
 */
async function tapMark(t: RenderResult, label: string) {
  const node = labelled(t, label);
  await act(async () => {
    (node.props.onPress as () => void)();
  });
}

/** A dive at a named site with a fix on it — the shape M2l's *use my location* produces. */
const pinned = (over: Partial<Dive> = {}) =>
  dive({ siteId: 's1', siteName: 'Blue Hole', latitude: 43.5081, longitude: 16.4402, ...over });

// --- The screen names itself in every state (§0.6, and `DivesScreen`'s own four branches) ---

it('says what screen this is whatever else it can say', async () => {
  for (const state of [
    divesState([], { resolved: false }),
    divesState([], { error: new Error('nope') }),
    divesState([]),
    divesState([pinned()]),
  ]) {
    mockUseDives.mockReturnValue(state);
    const t = await show();
    expect(textIn(t)).toContain('Map');
  }
});

// §10: "a screen with no answer must not state one." An unread logbook and an empty one are the
// same `[]`, so the branch before the read lands says nothing at all — no summary, no empty
// sentence, and no map centred on nowhere.
it('states nothing about a logbook it has not read yet', async () => {
  mockUseDives.mockReturnValue(divesState([], { resolved: false }));
  const t = await show();
  expect(textIn(t)).toEqual(['Map']);
  expect(hasMap(t)).toBe(false);
});

// A failed read must never fall through to an empty-map sentence, which is the same rule
// `DivesScreen` keeps between its own error and empty branches.
it('reports a failed logbook read rather than an empty map', async () => {
  mockUseDives.mockReturnValue(divesState([], { error: new Error('nope') }));
  const t = await show();
  expect(textIn(t).join(' ')).toContain(LOGBOOK_UNREADABLE);
  expect(hasMap(t)).toBe(false);
});

// **The two empty states, and they are different sentences.** The second is the common one for
// every logbook older than M2l (§10: no dive logged in M1 can carry a GPS point), and it is the
// one that has to name the gesture — nothing on this screen sets a pin, so a diver told only
// "nothing here" has been given no way to act.
it('tells an empty logbook apart from a logbook with no pins in it', async () => {
  mockUseDives.mockReturnValue(divesState([]));
  const empty = textIn(await show()).join(' ');
  expect(empty).toContain('No dives logged yet');

  mockUseDives.mockReturnValue(divesState([dive(), dive(), dive()]));
  const unpinned = textIn(await show()).join(' ');
  expect(unpinned).not.toContain('No dives logged yet');
  expect(unpinned).toContain('None of your 3 logged dives has a pin yet');
  expect(unpinned).toContain('Use my location');
});

// §1: the tab opens and says something true with no dives, no permission and no network. The
// map itself is drawn only when there is somewhere to put it — `regionFor` answers null for no
// marks rather than inventing a centre.
it('draws no map at all until there is a place to draw one', async () => {
  mockUseDives.mockReturnValue(divesState([dive(), dive()]));
  expect(hasMap(await show())).toBe(false);
});

// --- The marks (§3: "clustered pins of your dives (badge = count per site)") ---

it('draws one mark per site, badged with the dives there', async () => {
  mockUseDives.mockReturnValue(
    divesState([
      pinned(),
      pinned({ latitude: null, longitude: null }),
      dive({ siteId: 's2', siteName: 'Shark Point', latitude: 43.9, longitude: 15.2 }),
    ]),
  );
  const t = await show();
  expect(markers(t)).toHaveLength(2);
  expect(markLabels(t)).toEqual(['Blue Hole, 2 dives', 'Shark Point, 1 dive']);
  const badges = markers(t).map((m) =>
    m
      .queryAll((n) => n.type === 'Text')
      .flatMap((n) => n.children)
      .filter((c): c is string => typeof c === 'string'),
  );
  expect(badges).toEqual([['2'], ['1']]);
});

// The line under the title, which is the only thing that says how much of the logbook is on the
// map. `formatMapSummary` owns the words; what is pinned here is that the screen counts the
// right populations — dives at drawn places, and LOGGED dives, planned excluded (§2.4).
it('says how much of the logbook is on the map', async () => {
  mockUseDives.mockReturnValue(
    divesState([
      pinned(),
      pinned({ latitude: null, longitude: null }),
      dive(),
      dive({ status: 'planned' }),
    ]),
  );
  expect(summaryLine(await show())).toBe('2 of 3 dives');
});

// --- The site sheet (§3: "tapping a site shows your dives there with a depth/temp summary") ---

async function openBlueHole(): Promise<RenderResult> {
  mockUseDives.mockReturnValue(
    divesState([
      pinned({ maxDepthM: 18.2, waterTempC: 24, durationMin: 45 }),
      pinned({ latitude: null, longitude: null, maxDepthM: 12, waterTempC: 18, durationMin: 40 }),
    ]),
  );
  const t = await show();
  await tapMark(t, 'Blue Hole, 2 dives');
  return t;
}

it('opens a sheet naming the site, its depth and its water', async () => {
  const lines = textIn(await openBlueHole());
  expect(lines).toContain('Blue Hole');
  expect(lines).toContain('2 dives · deepest 18.2 m · 18–24 °C');
});

// The sheet lists every dive at the place, including the one carrying no fix of its own — §3
// says "your dives there", and the badge already promised two.
it('lists every dive at the site, not only the ones that were pinned', async () => {
  const t = await openBlueHole();
  const styles = makeStyles('light');
  const rows = allNodes(t).filter((n) => [n.props?.style].flat(5).includes(styles.diveRow));
  expect(rows).toHaveLength(2);
});

/**
 * **Where §0.1's colour actually lives on this screen.**
 *
 * The marks are monochrome — `DiveMap.test.tsx` sweeps that, and `DiveMap.tsx` carries the
 * argument — and the palette appears here instead, on the dives in the sheet, each depth in its
 * own band beside its own number, exactly as on the logbook. Asserted positively rather than
 * left as the absence of colour elsewhere: "no hue on the marks" is only half a design decision,
 * and a screen that had quietly stopped showing depth colour anywhere would satisfy the other
 * half perfectly.
 */
it('draws each dive’s own depth in its own band inside the sheet', async () => {
  const t = await openBlueHole();
  const colours = allNodes(t)
    .flatMap((n) => [n.props?.style].flat(5))
    .filter((entry): entry is { color?: string } => typeof entry === 'object' && entry !== null)
    .map((entry) => entry.color)
    .filter((value): value is string => typeof value === 'string');
  // The two dives in this sheet are 18.2 m and 12.0 m, which are two different bands — asserted
  // as two rather than one, because a sheet that painted every row the same colour would satisfy
  // a single-band check and would be exactly the defect (a hue that no longer encodes depth).
  // `depthBandColor` is asked for the answer rather than a hex being typed here, so a palette
  // edit moves this test with the app (§4.1, and `theme/depth.ts` is the scale's one reader).
  expect(colours).toContain(depthBandColor(3, 'light'));
  expect(colours).toContain(depthBandColor(2, 'light'));
  expect(depthBandColor(3, 'light')).not.toBe(depthBandColor(2, 'light'));
});

it('opens a dive from the sheet', async () => {
  const t = await openBlueHole();
  const styles = makeStyles('light');
  const row = allNodes(t).find((n) => [n.props?.style].flat(5).includes(styles.diveRow));
  expect(row).toBeDefined();
  await fireEvent.press(row!);
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(String((router.push as jest.Mock).mock.calls[0]?.[0])).toMatch(/^\/dive\//);
});

it('closes the sheet again', async () => {
  const t = await openBlueHole();
  expect(textIn(t)).toContain('2 dives · deepest 18.2 m · 18–24 °C');
  await press(t, 'Close Blue Hole');
  expect(textIn(t)).not.toContain('2 dives · deepest 18.2 m · 18–24 °C');
});

// --- The filter (§3, M3e: "the three layers are a filter, not a mode") ---

/**
 * **Three switches, all of them drawn, all of them saying what a press would do.**
 *
 * M3c's capsule showed "the two layers you are not on", so its contents changed with its state
 * and a glyph moved under the diver's thumb. A row of switches cannot do that: the set is fixed,
 * the order is `MAP_MARK_KINDS`', and what changes is each switch's own label and its state.
 */
it('offers a switch for each kind, and says what pressing it would do', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  const t = await show();
  expect(capsuleLabels(t)).toEqual(['Hide your dives', 'Show community sites', 'Show dive centres']);
  await press(t, 'Show community sites');
  expect(capsuleLabels(t)).toEqual(['Hide your dives', 'Hide community sites', 'Show dive centres']);
  await press(t, 'Hide your dives');
  expect(capsuleLabels(t)).toEqual(['Show your dives', 'Hide community sites', 'Show dive centres']);
});

/**
 * **The state is reported, and in two channels** — inverted ink for a diver who can see it
 * (`ActionCapsule.test.tsx` owns that half) and `accessibilityState.selected` for one who
 * cannot. §0.1 leaves no third one.
 *
 * It opens on the diver's own dives alone, which is exactly what the tab did before it was a
 * filter: a diver who never touches the control sees no change, and a fresh device still meets
 * one sentence rather than three.
 */
it('opens on the diver’s own dives and reports which switches are on', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  const t = await show();
  expect(capsuleSelected(t)).toEqual([true, false, false]);
  await press(t, 'Show dive centres');
  expect(capsuleSelected(t)).toEqual([true, false, true]);
  await press(t, 'Hide your dives');
  expect(capsuleSelected(t)).toEqual([false, false, true]);
});

/**
 * **The whole point of the reversal: all three kinds on one map at once** (owner's call, M3e).
 *
 * §3: *"the question a diver actually has on a map is what is near here, and a mode can only
 * ever answer one third of it at a time."* Three marks, three spoken kinds, one map.
 */
it('draws the diver’s dives, the community’s sites and its centres together', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  mockUseDiveSites.mockReturnValue(catalogueState([site({ name: 'Vis', latitude: 43.06, longitude: 16.18 })]));
  mockUseDiveCenters.mockReturnValue(centresState([centre({ name: 'Ponorka', latitude: 43.5, longitude: 16.44 })]));
  const t = await show();
  await press(t, 'Show community sites');
  await press(t, 'Show dive centres');
  expect(markLabels(t)).toEqual(['Blue Hole, 1 dive', 'Vis, dive site', 'Ponorka, dive centre']);
  expect(summaryLine(t)).toBe('1 dive · 1 site · 1 centre');
});

// Switching a kind off takes its marks off the map and its clause out of the line — the half
// that makes this a filter rather than three things always drawn.
it('takes a kind off the map when it is switched off', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  mockUseDiveSites.mockReturnValue(catalogueState([site({ name: 'Vis', latitude: 43.06, longitude: 16.18 })]));
  const t = await show();
  await press(t, 'Show community sites');
  expect(markLabels(t)).toEqual(['Blue Hole, 1 dive', 'Vis, dive site']);
  await press(t, 'Hide community sites');
  expect(markLabels(t)).toEqual(['Blue Hole, 1 dive']);
  expect(summaryLine(t)).toBe('1 dive');
});

/**
 * **And the same for each of the other two**, which is a table rather than three sentences
 * because the interesting claim is that no kind is drawn by accident: measured, dropping the
 * filter from the CENTRES alone left every other assertion in this file green, since nothing
 * else here has a positioned centre it does not also switch on.
 */
it.each([
  ['Show community sites', 'Vis, dive site'],
  ['Show dive centres', 'Ponorka, dive centre'],
] as const)('draws nothing for a kind whose switch is off (%s)', async (label, mark) => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  mockUseDiveSites.mockReturnValue(catalogueState([site({ name: 'Vis', latitude: 43.06, longitude: 16.18 })]));
  mockUseDiveCenters.mockReturnValue(centresState([centre({ name: 'Ponorka', latitude: 43.5, longitude: 16.44 })]));
  const t = await show();
  expect(markLabels(t)).toEqual(['Blue Hole, 1 dive']);
  expect(summaryLine(t)).toBe('1 dive');
  await press(t, label);
  expect(markLabels(t)).toEqual(['Blue Hole, 1 dive', mark]);
});

/**
 * **Nothing switched on is a legitimate state, and the control is what says so** — every glyph
 * plain, none inverted. What it may not be is a blank map with no explanation (brief §3), so the
 * screen names all three switches in a sentence.
 */
it('says what an empty selection means rather than drawing a blank map', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  const t = await show();
  await press(t, 'Hide your dives');
  expect(capsuleSelected(t)).toEqual([false, false, false]);
  expect(hasMap(t)).toBe(false);
  const said = textIn(t).join(' ');
  expect(said).toContain('Nothing selected');
  expect(said).toContain('your dives');
  expect(said).toContain('community sites');
  expect(said).toContain('dive centres');
  // ...and no summary line at all, since there is no population to describe. Asserted as the
  // absence of the LINE rather than of a phrase: a screen still reporting the logbook it was
  // told not to draw would otherwise slip through on wording.
  expect(summaryLine(t)).toBeNull();
});

// The capsule is drawn even on the branches that have nothing to show, unlike the Dives
// screen's: those glyphs act on the data, this one acts on the screen, and a diver whose
// logbook read failed must still be able to switch the community on and look at that.
it('keeps the filter reachable when a kind it is showing has failed', async () => {
  mockUseDives.mockReturnValue(divesState([], { error: new Error('nope') }));
  expect(capsuleLabels(await show())).toEqual([
    'Hide your dives',
    'Show community sites',
    'Show dive centres',
  ]);
});

// --- The community sites ---

// **What the community switch does when there is nothing behind it**, which is the state the
// catalogue is in on every device today: `dive_sites` arrives only through a pull. Two
// sentences, because a guest is not waiting for the same thing a signed-in diver is — §7.4
// erases the catalogue on the way out precisely because "a guest never had them".
it('says why there are no community sites, and says it differently to a guest', async () => {
  const guest = await show();
  await press(guest, 'Show community sites');
  const guestText = textIn(guest).join(' ');
  expect(guestText).toContain('No community sites here yet');
  expect(guestText).toContain('an account');

  mockUseAuthSession.mockReturnValue({ session: { user: { id: 'u1' } } as never, resolved: true });
  const member = await show();
  await press(member, 'Show community sites');
  const memberText = textIn(member).join(' ');
  expect(memberText).toContain('No community sites here yet');
  expect(memberText).not.toContain('an account');
  expect(memberText).toContain('sync');
});

/**
 * **The device holds sites and none of them can be drawn, which is a different sentence from
 * "there are none" — and the screen did not have it until M3e.**
 *
 * The community layer counted only the sites it could position, so a device holding thirty
 * pinless rows was told "No community sites here yet. …your next sync brings them down", which
 * is false twice over: they are here, and no sync will change anything. The centres layer has
 * had its own version of this sentence since M3c; this is the sibling it should always have had.
 */
it('tells an empty catalogue apart from a catalogue with no positions in it', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([site({ name: 'Vis' }), site({ name: 'Kotelna' })]));
  const t = await show();
  await press(t, 'Show community sites');
  const said = textIn(t).join(' ');
  expect(said).not.toContain('No community sites here yet');
  expect(said).toContain('None of your 2 community sites has a position yet');
  expect(said).toContain('Use my location');
});

// "Couldn't read the catalogue" and "there are no community sites yet" are different sentences,
// and today they would look identical — an empty catalogue is the expected state, which is
// exactly what would let a failure hide inside it for ever.
it('reports a failed catalogue read rather than an empty one', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([], { error: new Error('nope') }));
  const t = await show();
  await press(t, 'Show community sites');
  expect(textIn(t).join(' ')).toContain(CATALOGUE_UNREADABLE);
});

it('states nothing about a catalogue it has not read yet', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  mockUseDiveSites.mockReturnValue(catalogueState([], { resolved: false }));
  const t = await show();
  await press(t, 'Show community sites');
  expect(textIn(t).join(' ')).not.toContain('No community sites here yet');
  // No clause in the summary either: a read with no answer must not be reported as `0 sites`.
  expect(summaryLine(t)).toBe('1 dive');
});

/**
 * **An emptiness is NOT explained while there is still a map**, which is the other half of the
 * same rule and the half that keeps the screen livable.
 *
 * A failure is always said, because the map is then silently not showing what was asked for. An
 * emptiness is reported by the summary line's own `0 sites`, in the line the screen was drawing
 * anyway — and a paragraph explaining an empty community catalogue over a map full of the diver's
 * own dives is a reproach for something they did not do. It is also the ordinary state of every
 * device today, so the alternative is that paragraph appearing for everyone, always.
 *
 * Measured: without this, dropping the `marks.length > 0` guard left the whole file green.
 */
it('reports an empty kind as a nought rather than a paragraph, while there is a map', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  const t = await show();
  await press(t, 'Show community sites');
  expect(hasMap(t)).toBe(true);
  expect(summaryLine(t)).toBe('1 dive · 0 sites');
  expect(textIn(t).join(' ')).not.toContain('No community sites here yet');
});

/**
 * **A failure is said even while there is still a map**, which is a state a mode never had: with
 * one layer drawing, a failed read WAS the empty screen. With three filters the catalogue can
 * fail behind a map full of the diver's own dives, and a screen that reported nothing would
 * quietly draw fewer marks than were asked for.
 */
it('says a switched-on kind failed even when the map is still full', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  mockUseDiveSites.mockReturnValue(catalogueState([], { error: new Error('nope') }));
  const t = await show();
  await press(t, 'Show community sites');
  expect(hasMap(t)).toBe(true);
  expect(textIn(t).join(' ')).toContain(CATALOGUE_UNREADABLE);
});

// ...and it is not said about a kind the diver switched off. A catalogue that failed while
// nobody asked for it is not news.
it('says nothing about a kind that failed and is not switched on', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  mockUseDiveSites.mockReturnValue(catalogueState([], { error: new Error('nope') }));
  mockUseDiveCenters.mockReturnValue(centresState([], { error: new Error('nope') }));
  expect(textIn(await show()).join(' ')).not.toContain(CATALOGUE_UNREADABLE);
});

/**
 * **One sentence per failure, not per kind.** `CATALOGUE_UNREADABLE` is one sentence about "the
 * community catalogue" and both halves of it failing is one thing gone wrong — printing it twice
 * would be the screen counting its own tables at the diver.
 */
it('says the catalogue failed once, however many of its tables did', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([], { error: new Error('nope') }));
  mockUseDiveCenters.mockReturnValue(centresState([], { error: new Error('nope') }));
  const t = await show();
  await press(t, 'Show community sites');
  await press(t, 'Show dive centres');
  expect(textIn(t).filter((line) => line === CATALOGUE_UNREADABLE)).toHaveLength(1);
});

it('draws the community sites that carry a position, and names them', async () => {
  mockUseDiveSites.mockReturnValue(
    catalogueState([
      site({ name: 'Vis', country: 'Croatia', entry: 'boat', maxDepthM: 34, latitude: 43.06, longitude: 16.18 }),
      site({ name: 'Nowhere in particular' }),
    ]),
  );
  const t = await show();
  await press(t, 'Show community sites');
  expect(markers(t)).toHaveLength(1);
  expect(summaryLine(t)).toBe('0 dives · 1 of 2 sites');
  await tapMark(t, 'Vis, dive site');
  expect(textIn(t)).toContain('Vis');
  expect(textIn(t)).toContain('Croatia · Boat · 34.0 m');
});

// §5 asks a new site only for a name, but `dive_sites.name` is nullable in both databases (§6,
// so §7's one-transaction push can never reject a diver's whole sync over one row), and a row
// with none can therefore arrive by pull. A mark a screen reader announces as nothing is worse
// than one it announces as unnamed — and it must be the same "nothing" the dive list already
// uses, which is why `UNNAMED_SITE` is imported rather than typed into the screen.
it('calls an unnamed catalogue site what the rest of the app calls one', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([site({ latitude: 43.06, longitude: 16.18 })]));
  const t = await show();
  await press(t, 'Show community sites');
  expect(markLabels(t)).toEqual([`${UNNAMED_SITE}, dive site`]);
});

// --- One place, one mark (M3e, brief §2) ---

/**
 * **A dive and the site it was logged at are the same coordinate, not near it.**
 *
 * §2.3's *Add "…" as a new site* copies the dive's own pin into the new row and pairs the dive to
 * it by id (`siteFactsFrom`, domain/diveFormSchema.ts), so every site this app creates sits
 * exactly under the dive that created it. With both switched on, nothing stopping it would draw
 * two marks in one pixel — and which one a diver saw would be whichever the platform drew last.
 *
 * The diver's own mark wins because it says strictly more, and `sitesWithoutYourMark`
 * (domain/mapSites.ts) decides it by identity rather than by distance.
 */
it('draws one mark for a place the diver has dived, not two on the same pixel', async () => {
  const row = site({ id: 's1', name: 'Blue Hole', latitude: 43.5081, longitude: 16.4402 });
  mockUseDives.mockReturnValue(divesState([pinned()]));
  mockUseDiveSites.mockReturnValue(catalogueState([row]));
  const t = await show();
  await press(t, 'Show community sites');
  expect(markLabels(t)).toEqual(['Blue Hole, 1 dive']);
  // And the line does not claim a mark it did not draw.
  expect(summaryLine(t)).toBe('1 dive · 0 of 1 site');
});

// The site comes back the moment the diver's own marks are not there to stand on it — which is
// what makes the rule an absorption rather than a filter that hides catalogue rows.
it('draws the catalogue’s own mark for that place once your dives are switched off', async () => {
  const row = site({ id: 's1', name: 'Blue Hole', latitude: 43.5081, longitude: 16.4402 });
  mockUseDives.mockReturnValue(divesState([pinned()]));
  mockUseDiveSites.mockReturnValue(catalogueState([row]));
  const t = await show();
  await press(t, 'Show community sites');
  await press(t, 'Hide your dives');
  expect(markLabels(t)).toEqual(['Blue Hole, dive site']);
});

/**
 * **What absorbing costs, which is nothing** — the place's own sheet carries the catalogue's
 * facts line, from the same formatter a community site's sheet uses, so the row's information is
 * not lost with its dot.
 *
 * It does not consult the filter: switching sites off says "do not put the catalogue on my map",
 * not "do not tell me what my own dive site is". So the facts are there with the community
 * switch off, which is where this asserts them.
 */
it('gives a dived catalogue site’s facts to the sheet its own mark opens', async () => {
  mockUseDives.mockReturnValue(divesState([pinned({ maxDepthM: 18.2 })]));
  mockUseDiveSites.mockReturnValue(
    catalogueState([site({ id: 's1', name: 'Blue Hole', country: 'Croatia', entry: 'boat', maxDepthM: 34 })]),
  );
  const t = await show();
  await tapMark(t, 'Blue Hole, 1 dive');
  expect(textIn(t)).toContain('1 dive · deepest 18.2 m');
  expect(textIn(t)).toContain('Croatia · Boat · 34.0 m');
});

// ...and a place the catalogue does not hold gets no line rather than an empty one — a dive at a
// hand-typed site is every dive in a logbook that has never synced.
it('says nothing about a place the catalogue does not know', async () => {
  mockUseDives.mockReturnValue(
    divesState([dive({ siteName: 'Kotelna', latitude: 43.5, longitude: 16.4, maxDepthM: 18.2 })]),
  );
  mockUseDiveSites.mockReturnValue(catalogueState([site({ id: 's9', name: 'Kotelna', country: 'Croatia' })]));
  const t = await show();
  await tapMark(t, 'Kotelna, 1 dive');
  expect(textIn(t)).toContain('1 dive · deepest 18.2 m');
  expect(textIn(t)).not.toContain('Croatia');
});

/**
 * A key from one kind names nothing in another, so a selection that survived a filter change
 * would describe a mark that is no longer drawn.
 *
 * **The round trip is the assertion, and the one-way version was measured green in M2n.** Going
 * away closes the sheet whether or not the key was cleared, because the mark is not rendered at
 * all — so a test that stopped there would pass over a screen that quietly kept the key. Coming
 * BACK is where a kept key shows itself: the sheet reopens on a mark the diver did not press.
 */
it('forgets the open sheet when the filter changes, and does not reopen it on the way back', async () => {
  mockUseDives.mockReturnValue(divesState([pinned({ maxDepthM: 18.2 })]));
  const t = await show();
  await tapMark(t, 'Blue Hole, 1 dive');
  expect(textIn(t)).toContain('1 dive · deepest 18.2 m');
  await press(t, 'Hide your dives');
  expect(textIn(t)).not.toContain('1 dive · deepest 18.2 m');
  await press(t, 'Show your dives');
  expect(textIn(t)).not.toContain('1 dive · deepest 18.2 m');
});

// ...including a switch the sheet is not about, which is the blunt half of that rule: switching
// dives ON takes a community site off the map (the absorption above), so a site's sheet has to
// close on a press about something else.
it('forgets the open sheet when a kind it is not about is switched', async () => {
  mockUseDiveSites.mockReturnValue(
    catalogueState([site({ name: 'Vis', country: 'Croatia', latitude: 43.06, longitude: 16.18 })]),
  );
  const t = await show();
  await press(t, 'Show community sites');
  await tapMark(t, 'Vis, dive site');
  expect(textIn(t)).toContain('Croatia');
  await press(t, 'Show dive centres');
  expect(textIn(t)).not.toContain('Croatia');
});

// --- The centres ---

/** Puts the centres on the map, which is one press from where the screen opens. */
async function withCentres(): Promise<RenderResult> {
  const t = await show();
  await press(t, 'Show dive centres');
  return t;
}

/**
 * **A centre's mark is the same disc a site's is, with the filter's own glyph inside it.**
 *
 * That is the whole vocabulary M3e had left: §0.1 spends every hue on depth and M3c built the
 * shape alternative and looked at it — a square beside a circle reads as the same mark drawn
 * wrong. What this screen owns is which kind each mark is; `DiveMap.test.tsx` owns what each kind
 * draws, and only the simulator can say whether the three read as three.
 */
it('draws the centres that carry a position, and says which kind they are', async () => {
  mockUseDiveCenters.mockReturnValue(
    centresState([
      centre({ name: 'Ponorka', latitude: 50.08, longitude: 14.44 }),
      centre({ name: 'Aqua Split' }),
    ]),
  );
  const t = await withCentres();
  expect(markLabels(t)).toEqual(['Ponorka, dive centre']);
  // No badge — a catalogue row the diver has never dived is not a count of anything.
  expect(markers(t).flatMap((m) => m.queryAll((n) => n.type === 'Text'))).toEqual([]);
});

/**
 * **Both figures, because they are almost never the same one.** §2.3 gives a new centre its name
 * alone — the form's pin is where the diver entered the water — so a catalogue of three centres
 * with one position is the ordinary state, and a line reading "1 centre" would make this look
 * like a map of every centre there is.
 */
it('says how many centres it is NOT drawing', async () => {
  mockUseDiveCenters.mockReturnValue(
    centresState([
      centre({ name: 'Ponorka', latitude: 50.08, longitude: 14.44 }),
      centre({ name: 'Aqua Split' }),
      centre({ name: 'Kotelna' }),
    ]),
  );
  expect(summaryLine(await withCentres())).toBe('0 dives · 1 of 3 centres');
});

/**
 * **The ordinary state of this kind**: the device holds centres and none of them can be drawn. A
 * different sentence from "you have no centres", and one that names the gesture — exactly as the
 * pinless-dives sentence names *"Use my location"*, because a map with nothing on it and no way
 * to act is a reproach.
 */
it('sends a diver to the list when no centre has a position', async () => {
  mockUseDiveCenters.mockReturnValue(centresState([centre({ name: 'Ponorka' }), centre({ name: 'Kotelna' })]));
  const t = await withCentres();
  expect(textIn(t).join(' ')).toContain('None of your 2 centres has a position yet');
  expect(textIn(t).join(' ')).toContain('All centres');
  expect(hasMap(t)).toBe(false);
});

// The way into the directory is drawn while centres are on and not otherwise — it is a control
// about centres, and §0.6 objects to a control that is about something not on screen.
it('offers the directory while centres are switched on and not otherwise', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  const t = await show();
  expect(textIn(t)).not.toContain('All centres');
  await press(t, 'Show community sites');
  expect(textIn(t)).not.toContain('All centres');
  await press(t, 'Show dive centres');
  expect(textIn(t)).toContain('All centres');
  await press(t, 'All centres');
  expect(String((router.push as jest.Mock).mock.calls.at(-1)?.[0])).toBe('/centers');
  await press(t, 'Hide dive centres');
  expect(textIn(t)).not.toContain('All centres');
});

// Drawn on every branch, the failing one included — the same reasoning the capsule is: the
// directory reads the same table and reports for itself, and a control that vanished when the
// data failed would strand a diver on the broken half.
it('keeps the directory reachable when the centres read has failed', async () => {
  mockUseDiveCenters.mockReturnValue(centresState([], { error: new Error('nope') }));
  const t = await withCentres();
  expect(textIn(t)).toContain(CATALOGUE_UNREADABLE);
  expect(textIn(t)).toContain('All centres');
});

it('states nothing about a centres catalogue it has not read yet', async () => {
  mockUseDiveCenters.mockReturnValue(centresState([], { resolved: false }));
  const t = await withCentres();
  expect(textIn(t).join(' ')).not.toContain('No dive centres here yet');
  // ...and no clause for them in the summary either: a read with no answer must not be
  // reported as `0 centres`. The line still describes the dives, which HAVE answered.
  expect(summaryLine(t)).toBe('0 dives');
});

// The same guest/member split the community sites draw, and for the same reason: §5 puts an
// account behind both ways a centre reaches this table.
it('says why there are no centres, and says it differently to a guest', async () => {
  const guest = await withCentres();
  expect(textIn(guest).join(' ')).toContain('No dive centres here yet');
  expect(textIn(guest).join(' ')).toContain('an account');

  mockUseAuthSession.mockReturnValue({ session: { user: { id: 'u1' } } as never, resolved: true });
  const member = await withCentres();
  expect(textIn(member).join(' ')).toContain('No dive centres here yet');
  expect(textIn(member).join(' ')).not.toContain('an account');
  expect(textIn(member).join(' ')).toContain('sync');
});

/**
 * **A centre's mark goes to its page; a site's and a place's open a sheet.** A site has nowhere
 * else in the app to be shown, so its sheet IS its page; a centre has one, and drawing a peek of
 * it under the map would put the same three facts in two places.
 *
 * **M3c gave that asymmetry to the layer and M3e has to give it back to the mark**, which is one
 * of the three prices the filter pays. What makes it legible is the `storefront` glyph: the one
 * kind whose press leaves the screen is the one kind whose mark carries a symbol.
 */
it('opens a centre’s page from its mark, and opens no sheet', async () => {
  mockUseDiveCenters.mockReturnValue(
    centresState([centre({ id: 'c-p', name: 'Ponorka', country: 'CZ', latitude: 50.08, longitude: 14.44 })]),
  );
  const t = await withCentres();
  await tapMark(t, 'Ponorka, dive centre');
  expect(String((router.push as jest.Mock).mock.calls.at(-1)?.[0])).toBe('/center/c-p');
  // Nothing of the site sheet's vocabulary appears: no close control, no facts line.
  expect(allNodes(t).some((n) => n.props?.accessibilityLabel === 'Close Ponorka')).toBe(false);
  expect(textIn(t)).not.toContain('CZ');
});

/**
 * **And a site's mark does NOT navigate, which is the half that makes the asymmetry a rule
 * rather than a coincidence.** The two kinds carry ids from two tables and the same id can name a
 * row in each; a press that read the key without the kind would open a centre's page from a
 * site's dot.
 */
it('opens a sheet from a site’s mark even when a centre shares its id', async () => {
  mockUseDiveSites.mockReturnValue(
    catalogueState([site({ id: 'shared', name: 'Vis', country: 'Croatia', latitude: 43.06, longitude: 16.18 })]),
  );
  mockUseDiveCenters.mockReturnValue(centresState([centre({ id: 'shared', name: 'Ponorka' })]));
  const t = await show();
  await press(t, 'Show community sites');
  await tapMark(t, 'Vis, dive site');
  expect(router.push).not.toHaveBeenCalled();
  expect(textIn(t)).toContain('Croatia');
});

/**
 * **One sheet at a time, even where the two key spaces touch.**
 *
 * A place's key is `site:<id>` / `name:<fold>` / `dive:<id>` and a catalogue mark's key is the
 * row's own id, so the two overlap only if a `dive_sites` row is literally called `site:s1` —
 * which nothing this app writes ever is (§6's ids are client-generated UUIDv7) and which a pull
 * from a server this build did not write could still deliver. Both sheets are looked up by KIND
 * as well as by key for that, and measured: replacing the kind check with a null check left every
 * other assertion in this file green, because nothing else here makes the two spaces meet.
 */
it('opens one sheet when a catalogue row is named like a place key', async () => {
  mockUseDives.mockReturnValue(divesState([pinned({ maxDepthM: 18.2 })]));
  mockUseDiveSites.mockReturnValue(
    catalogueState([site({ id: 'site:s1', name: 'Vis', country: 'Croatia', latitude: 43.06, longitude: 16.18 })]),
  );
  const t = await show();
  await press(t, 'Show community sites');
  const closes = () =>
    allNodes(t).filter((n) => String(n.props?.accessibilityLabel ?? '').startsWith('Close '));

  await tapMark(t, 'Blue Hole, 1 dive');
  expect(textIn(t)).toContain('1 dive · deepest 18.2 m');
  expect(textIn(t)).not.toContain('Croatia');
  expect(closes()).toHaveLength(1);

  // ...and the other way round, which is a separate mutation and was separately green: the
  // catalogue row's sheet must not also open the place whose key its id happens to spell.
  await press(t, 'Close Blue Hole');
  await tapMark(t, 'Vis, dive site');
  expect(textIn(t)).toContain('Croatia');
  expect(textIn(t)).not.toContain('1 dive · deepest 18.2 m');
  expect(closes()).toHaveLength(1);
});

// `dive_centers.name` is nullable in both databases (§6), so a row with none can arrive by pull.
// A mark a screen reader announces as nothing is worse than one it announces as unnamed — and it
// must be the CENTRE's own words, not the site's: `UNNAMED_SITE` here would announce a dive shop
// as a dive site, which is precisely the confusion the glyph exists to avoid.
it('calls an unnamed centre what the rest of the app calls one', async () => {
  mockUseDiveCenters.mockReturnValue(centresState([centre({ name: null, latitude: 50.08, longitude: 14.44 })]));
  const t = await withCentres();
  expect(markLabels(t)).toEqual([`${UNNAMED_CENTER}, dive centre`]);
  expect(markLabels(t)).not.toEqual([`${UNNAMED_SITE}, dive centre`]);
});

// A failed centres read must not take the sites off the map — that is what the two hooks are two
// hooks for (db/useDiveCenters.ts), and with both drawn at once it is visible rather than
// theoretical.
it('keeps the community sites drawable when the centres read has failed', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([site({ name: 'Vis', latitude: 43.06, longitude: 16.18 })]));
  mockUseDiveCenters.mockReturnValue(centresState([], { error: new Error('nope') }));
  const t = await show();
  await press(t, 'Show community sites');
  await press(t, 'Show dive centres');
  expect(markLabels(t)).toEqual(['Vis, dive site']);
  expect(summaryLine(t)).toBe('0 dives · 1 site');
});

// --- Location (§5 of the brief: a map needs no permission, and must not ask for one) ---

it('never asks for location permission, and reads the standing answer instead', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  await show();
  await waitFor(() => expect(mockLocationPermission).toHaveBeenCalled());
  expect(mockRequestLocationPermission).not.toHaveBeenCalled();
});

// `granted` specifically, rather than "not denied": `servicesOff` outranks even a granted
// permission and `unknown` is a failed query rather than a yes.
it.each([
  ['granted', true],
  ['denied', false],
  ['undetermined', false],
  ['servicesOff', false],
  ['unknown', false],
] as const)('draws the diver’s own position only when the permission reads %s', async (state, expected) => {
  mockLocationPermission.mockResolvedValue(state);
  mockUseDives.mockReturnValue(divesState([pinned()]));
  const t = await show();
  const map = allNodes(t).find((n) => n.props?.initialRegion !== undefined);
  expect(map?.props.showsUserLocation).toBe(expected);
});

// --- The header's own geometry, which the stylesheet cannot check on its own ---

// **The half `styles.test.ts` structurally cannot see** (`DivesScreen.test.tsx` makes the same
// pairing for its own capsule): the sheet derives the header's trailing reserve from a glyph
// COUNT, and how many glyphs are in the capsule is a prop rather than a style. The count went
// from one to two to three across three milestones, and each time this is what would have caught
// the reserve being left behind — putting the summary line back under the glass, silently.
it('reserves exactly the header width the capsule it renders actually needs', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  const t = await show();
  const styles = makeStyles('light') as unknown as Record<string, Record<string, number>>;
  const glyphs = capsuleLabels(t).length;
  const capsuleWidth =
    (styles.actionCapsulePlain?.paddingHorizontal ?? 0) * 2 +
    glyphs * (styles.capsuleGlyph?.width ?? 0) +
    Math.max(glyphs - 1, 0) * (styles.capsuleDivider?.width ?? 0);
  const leadingEdge = (styles.capsuleFloat?.right ?? 0) + capsuleWidth;
  expect(styles.mapTitle?.paddingRight).toBeGreaterThanOrEqual(leadingEdge);
  expect(styles.mapSummary?.paddingRight).toBeGreaterThanOrEqual(leadingEdge);
});

// --- §0.1's sweep, on the one screen where hue was a genuinely open question ---

it('paints nothing outside the sheet, and never from the depth scale on a mark', async () => {
  mockUseDives.mockReturnValue(divesState([pinned({ maxDepthM: 18.2 })]));
  mockUseDiveSites.mockReturnValue(catalogueState([site({ name: 'Vis', latitude: 43.06, longitude: 16.18 })]));
  mockUseDiveCenters.mockReturnValue(centresState([centre({ name: 'Ponorka', latitude: 43.5, longitude: 16.44 })]));
  const t = await show();
  await press(t, 'Show community sites');
  await press(t, 'Show dive centres');
  // `useColorScheme()` reports light under Jest and this screen resolves its own scheme from it,
  // so the sweep can only be run against the sheet that actually rendered — a dark-scheme sweep
  // over a light render would find none of its own styles known and report the entire tree.
  // **The dark half is not skipped, it is somewhere else**: `DiveMap.test.tsx` sweeps the marks
  // in both schemes, because that component takes its scheme as a prop rather than reading the
  // OS, and the marks are the only thing on this screen where the hue question was ever open.
  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});
