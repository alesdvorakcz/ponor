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
import { useDiveSites, type DiveSiteListState } from '../db/useDiveSites';
import { useUnitSystem } from '../db/useUnitSystem';
import { assignDiveNumbers } from '../domain/diveNumber';
import { dive } from '../domain/diveFixture';
import { UNNAMED_SITE } from '../format/display';
import { type Dive, type DiveSite } from '../domain/types';
import { locationPermission, requestLocationPermission } from '../platform/locationPermission';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { depthBandColor } from '../theme/depth';
import { makeStyles } from '../theme/styles';
import MapScreen from './MapScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
jest.mock('../db/useDiveSites', () => ({ useDiveSites: jest.fn() }));
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

function hasMap(t: RenderResult): boolean {
  return allNodes(t).some((n) => n.props?.initialRegion !== undefined);
}

/** The capsule's glyphs, by the label a screen reader would hear — which is what this screen
 * decides; which SF Symbol each draws is `ActionCapsule.test.tsx`'s and `symbolName.test.tsx`'s. */
function capsuleLabels(t: RenderResult): string[] {
  const styles = makeStyles('light');
  const float = allNodes(t).find((n) => [n.props?.style].flat(5).includes(styles.capsuleFloat));
  if (float === undefined) throw new Error('MapScreen did not render its floating capsule');
  return float
    .queryAll((n) => typeof n.props?.accessibilityLabel === 'string' && n.props?.accessibilityRole === 'button')
    .map((n) => String(n.props.accessibilityLabel));
}

function labelled(t: RenderResult, label: string) {
  const node = allNodes(t).find((n) => n.props?.accessibilityLabel === label);
  if (node === undefined) throw new Error(`MapScreen rendered nothing labelled ${label}`);
  return node;
}

/** A real control — the capsule's toggle, a sheet's close — pressed through `fireEvent`, which
 * is the responder gate a device actually consults. M2l's own lesson: a test that calls the
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
 * screen does the right thing with it. **That a mark is pressable at all, and that its target is
 * §0.5's 48 dp, is a simulator question.**
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
  expect(textIn(t).join(' ')).toContain("Couldn't open your logbook");
  expect(hasMap(t)).toBe(false);
});

// **The two empty states §5 of the brief asks for, and they are different sentences.** The
// second is the common one for every logbook older than M2l (§10: no dive logged in M1 can carry
// a GPS point), and it is the one that has to name the gesture — nothing on this screen sets a
// pin, so a diver told only "nothing here" has been given no way to act.
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
  expect(markers(t).map((m) => m.props.accessibilityLabel)).toEqual(['Blue Hole', 'Shark Point']);
  const badges = markers(t).map((m) =>
    m
      .queryAll((n) => n.type === 'Text')
      .flatMap((n) => n.children)
      .filter((c): c is string => typeof c === 'string'),
  );
  expect(badges).toEqual([['2'], ['1']]);
});

// The line under the title, which is the only thing that says which layer is showing (§0.1
// leaves no hue for it) and the only thing that says how much of the logbook is actually on the
// map. `formatMyDivesSummary` owns the words; what is pinned here is that the screen counts the
// right populations — sites, dives at those sites, and LOGGED dives, planned excluded (§2.4).
it('says which layer is showing and how much of the logbook is on it', async () => {
  mockUseDives.mockReturnValue(
    divesState([
      pinned(),
      pinned({ latitude: null, longitude: null }),
      dive(),
      dive({ status: 'planned' }),
    ]),
  );
  expect(textIn(await show())).toContain('Your dives · 1 site · 2 of 3 dives on the map');
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
  await tapMark(t, 'Blue Hole');
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

// --- The layer toggle (§3: "toggle to explore all community sites") ---

// One control, two states, and the label says what pressing it DOES rather than what is
// showing — which is what lets a plain `CapsuleAction` serve as a toggle without `ActionCapsule`
// growing a state of its own.
it('offers one toggle whose label names the layer it takes you to', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  const t = await show();
  expect(capsuleLabels(t)).toEqual(['Explore community sites']);
  await press(t, 'Explore community sites');
  expect(capsuleLabels(t)).toEqual(['Show my dives']);
});

// The capsule is drawn even on the branches that have nothing to show, unlike the Dives
// screen's: those glyphs act on the data, this one acts on the screen, and a diver whose
// logbook read failed must still be able to cross to the other layer.
it('keeps the toggle reachable when the layer it is on has failed', async () => {
  mockUseDives.mockReturnValue(divesState([], { error: new Error('nope') }));
  expect(capsuleLabels(await show())).toEqual(['Explore community sites']);
});

// **What the toggle does when there is nothing behind it**, which is the state the catalogue is
// in on every device today: `dive_sites` arrives only through a pull and nothing creates a site
// yet. Two sentences, because a guest is not waiting for the same thing a signed-in diver is —
// §7.4 erases the catalogue on the way out precisely because "a guest never had them".
it('says why the community layer is empty, and says it differently to a guest', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  const guest = await show();
  await press(guest, 'Explore community sites');
  const guestText = textIn(guest).join(' ');
  expect(guestText).toContain('No community sites here yet');
  expect(guestText).toContain('an account');

  mockUseAuthSession.mockReturnValue({ session: { user: { id: 'u1' } } as never, resolved: true });
  const member = await show();
  await press(member, 'Explore community sites');
  const memberText = textIn(member).join(' ');
  expect(memberText).toContain('No community sites here yet');
  expect(memberText).not.toContain('an account');
  expect(memberText).toContain('sync');
});

// "Couldn't read the catalogue" and "there are no community sites yet" are different sentences,
// and today they would look identical — an empty layer is the expected state, which is exactly
// what would let a failure hide inside it for ever.
it('reports a failed catalogue read rather than an empty layer', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  mockUseDiveSites.mockReturnValue(catalogueState([], { error: new Error('nope') }));
  const t = await show();
  await press(t, 'Explore community sites');
  expect(textIn(t).join(' ')).toContain("Couldn't read the community catalogue");
});

it('states nothing about a catalogue it has not read yet', async () => {
  mockUseDives.mockReturnValue(divesState([pinned()]));
  mockUseDiveSites.mockReturnValue(catalogueState([], { resolved: false }));
  const t = await show();
  await press(t, 'Explore community sites');
  expect(textIn(t).join(' ')).not.toContain('No community sites here yet');
  expect(hasMap(t)).toBe(false);
});

it('draws the community sites that carry a position, and names them', async () => {
  mockUseDives.mockReturnValue(divesState([]));
  mockUseDiveSites.mockReturnValue(
    catalogueState([
      site({ name: 'Vis', country: 'Croatia', entry: 'boat', maxDepthM: 34, latitude: 43.06, longitude: 16.18 }),
      site({ name: 'Nowhere in particular' }),
    ]),
  );
  const t = await show();
  await press(t, 'Explore community sites');
  expect(markers(t)).toHaveLength(1);
  expect(textIn(t)).toContain('Community · 1 site');
  await tapMark(t, 'Vis');
  expect(textIn(t)).toContain('Vis');
  expect(textIn(t)).toContain('Croatia · Boat · 34.0 m');
});

// §5 asks a new site only for a name, but `dive_sites.name` is nullable in both databases (§6,
// so §7's one-transaction push can never reject a diver's whole sync over one row), and a row
// with none can therefore arrive by pull. A mark a screen reader announces as nothing is worse
// than one it announces as unnamed — and it must be the same "nothing" the dive list already
// uses, which is why `UNNAMED_SITE` is imported rather than typed into the screen.
it('calls an unnamed catalogue site what the rest of the app calls one', async () => {
  mockUseDives.mockReturnValue(divesState([]));
  mockUseDiveSites.mockReturnValue(catalogueState([site({ latitude: 43.06, longitude: 16.18 })]));
  const t = await show();
  await press(t, 'Explore community sites');
  expect(markers(t).map((m) => m.props.accessibilityLabel)).toEqual([UNNAMED_SITE]);
});

/**
 * A key from one layer names nothing in the other, so a selection that survived the switch would
 * describe a mark that is no longer drawn.
 *
 * **The round trip is the assertion, and the one-way version was measured green.** Going to the
 * community layer closes the sheet whether or not the key was cleared, because the other layer's
 * sheet is not rendered at all — so a test that stopped there would pass over a screen that
 * quietly kept the key. Coming BACK is where a kept key shows itself: the sheet reopens on a
 * mark the diver did not press, on a screen they have just navigated to.
 */
it('forgets the open sheet when the layer changes, and does not reopen it on the way back', async () => {
  mockUseDives.mockReturnValue(divesState([pinned({ maxDepthM: 18.2 })]));
  mockUseDiveSites.mockReturnValue(catalogueState([site({ name: 'Vis', latitude: 43.06, longitude: 16.18 })]));
  const t = await show();
  await tapMark(t, 'Blue Hole');
  expect(textIn(t)).toContain('1 dive · deepest 18.2 m');
  await press(t, 'Explore community sites');
  expect(textIn(t)).not.toContain('1 dive · deepest 18.2 m');
  await press(t, 'Show my dives');
  expect(textIn(t)).not.toContain('1 dive · deepest 18.2 m');
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
// COUNT, and how many glyphs are in the capsule is a prop rather than a style. A second glyph
// added here without moving the constant puts the summary line back under the glass, silently.
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
  const t = await show();
  // `useColorScheme()` reports light under Jest and this screen resolves its own scheme from it,
  // so the sweep can only be run against the sheet that actually rendered — a dark-scheme sweep
  // over a light render would find none of its own styles known and report the entire tree.
  // **The dark half is not skipped, it is somewhere else**: `DiveMap.test.tsx` sweeps the marks
  // in both schemes, because that component takes its scheme as a prop rather than reading the
  // OS, and the marks are the only thing on this screen where the hue question was ever open.
  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});
