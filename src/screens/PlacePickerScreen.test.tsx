import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, cleanup, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router, useFocusEffect } from 'expo-router';

import { searchCenters, searchCentersNear } from '../cloud/searchCenters';
import { searchSites, searchSitesNear } from '../cloud/searchSites';
import { useAuthSession } from '../cloud/useAuthSession';
import { useDiveCenters, type DiveCenterListState } from '../db/useDiveCenters';
import { useDives, type DiveListState } from '../db/useDives';
import { useDiveSites, type DiveSiteListState } from '../db/useDiveSites';
import { useUnitSystem } from '../db/useUnitSystem';
import { assignDiveNumbers } from '../domain/diveNumber';
import { dive } from '../domain/diveFixture';
import { catalogueUnreadable } from '../domain/logbook';
import { type Dive, type DiveCenter, type DiveSite } from '../domain/types';
import { LIVE_SEARCH_DELAY_MS } from '../hooks/useCatalogueSupplement';
import { setActiveLanguage } from '../i18n';
import {
  completePlacePick,
  forgetPlacePick,
  placePickRequest,
  type PlacePickRequest,
} from '../navigation/placePick';
import { roughPosition, type PositionOutcome } from '../platform/location';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import PlacePickerScreen from './PlacePickerScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useDiveSites', () => ({ useDiveSites: jest.fn() }));
jest.mock('../db/useDiveCenters', () => ({ useDiveCenters: jest.fn() }));
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));
jest.mock('../cloud/useAuthSession', () => ({
  useAuthSession: jest.fn(() => ({ session: null, resolved: true })),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), dismiss: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({ token: 'tok' })),
  // Inert: a test that needs the page to regain focus calls the registered effect itself.
  useFocusEffect: jest.fn(),
}));
// The hand-back registry at its own seam: its suite proves what completing and forgetting do to
// the form and the stack. What is left for this file is which of the three the page calls, when,
// and with what.
jest.mock('../navigation/placePick', () => ({
  placePickRequest: jest.fn(),
  completePlacePick: jest.fn(),
  forgetPlacePick: jest.fn(),
}));
// Near me's question to the device, answered by each test.
jest.mock('../platform/location', () => ({ roughPosition: jest.fn() }));
// The online supplement's two halves, mocked where `DiveSitesScreen.test.tsx` mocks them: the
// RPC clients (whose own suites prove what they ask) and the catalogue writers.
jest.mock('../cloud/searchSites', () => ({
  searchSites: jest.fn(async () => []),
  searchSitesNear: jest.fn(async () => []),
}));
jest.mock('../cloud/searchCenters', () => ({
  searchCenters: jest.fn(async () => []),
  searchCentersNear: jest.fn(async () => []),
}));
jest.mock('../db/catalogue', () => ({
  applyPulledDiveSites: jest.fn(async () => []),
  applyPulledDiveCenters: jest.fn(async () => []),
}));
jest.mock('../db/client', () => ({ db: {} }));
jest.mock('../cloud/supabase', () => ({ cloud: { configured: false, missing: [] } }));

const mockUseDiveSites = useDiveSites as jest.MockedFunction<typeof useDiveSites>;
const mockUseDiveCenters = useDiveCenters as jest.MockedFunction<typeof useDiveCenters>;
const mockUseDives = useDives as jest.MockedFunction<typeof useDives>;
const mockUseUnitSystem = useUnitSystem as jest.MockedFunction<typeof useUnitSystem>;
const mockUseAuthSession = useAuthSession as jest.MockedFunction<typeof useAuthSession>;
const mockRequest = placePickRequest as jest.MockedFunction<typeof placePickRequest>;
const mockComplete = completePlacePick as jest.MockedFunction<typeof completePlacePick>;
const mockForget = forgetPlacePick as jest.MockedFunction<typeof forgetPlacePick>;
const mockRough = roughPosition as jest.MockedFunction<typeof roughPosition>;
const mockSearchSites = searchSites as jest.MockedFunction<typeof searchSites>;
const mockSearchSitesNear = searchSitesNear as jest.MockedFunction<typeof searchSitesNear>;
const mockSearchCenters = searchCenters as jest.MockedFunction<typeof searchCenters>;
const mockSearchCentersNear = searchCentersNear as jest.MockedFunction<typeof searchCentersNear>;
const mockFocusEffect = useFocusEffect as jest.MockedFunction<typeof useFocusEffect>;
const actualPlacePick = jest.requireActual<typeof import('../navigation/placePick')>('../navigation/placePick');

const styles = makeStyles('light');
const theme = themeFor('light');

let seq = 0;
const site = (over: Partial<DiveSite> = {}): DiveSite => ({
  id: `s${String(seq++)}`,
  name: 'Kotelna',
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

const center = (over: Partial<DiveCenter> = {}): DiveCenter => ({
  id: `c${String(seq++)}`,
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

function sitesState(sites: DiveSite[], over: Partial<DiveSiteListState> = {}): DiveSiteListState {
  return { sites, resolved: true, error: undefined, ...over };
}

function centersState(centers: DiveCenter[], over: Partial<DiveCenterListState> = {}): DiveCenterListState {
  return { centers, resolved: true, error: undefined, ...over };
}

function divesState(dives: Dive[]): DiveListState {
  return { dives, numbers: assignDiveNumbers(dives, 0), resolved: true, error: undefined, settingsError: undefined };
}

const noDive = { pin: null, entry: null, salinity: null, waterBody: null, siteId: null };

const request = (over: Partial<PlacePickRequest> = {}): PlacePickRequest => ({
  kind: 'site',
  selected: null,
  dive: noDive,
  onPick: jest.fn(),
  ...over,
});

const signedIn = () =>
  mockUseAuthSession.mockReturnValue({ session: { user: { id: 'me' } } as never, resolved: true });

/** A promise the test settles by hand — Near me's fix, held in flight. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseDiveSites.mockReturnValue(sitesState([]));
  mockUseDiveCenters.mockReturnValue(centersState([]));
  mockUseDives.mockReturnValue(divesState([]));
  mockUseUnitSystem.mockReturnValue('metric');
  mockUseAuthSession.mockReturnValue({ session: null, resolved: true });
  mockRequest.mockReturnValue(request());
  mockSearchSites.mockResolvedValue([]);
  mockSearchSitesNear.mockResolvedValue([]);
  mockSearchCenters.mockResolvedValue([]);
  mockSearchCentersNear.mockResolvedValue([]);
});

// --- Reading what was drawn ---------------------------------------------------------------------

type Node = NonNullable<RenderResult['root']>;

function allNodes(t: RenderResult): Node[] {
  return t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
}

function stylesOf(node: Node): unknown[] {
  return [node.props?.style].flat(Infinity);
}

function hosts(t: RenderResult, style: object): Node[] {
  return allNodes(t).filter((n) => typeof n.type === 'string' && stylesOf(n).includes(style));
}

/** Every string under a node, in reading order — so a nested `Text` reads as one line. */
function textOf(node: Node): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

function textIn(t: RenderResult): string[] {
  return allNodes(t)
    .filter((n) => n.type === 'Text')
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

const groupTitles = (t: RenderResult) => hosts(t, styles.pickerGroupTitle).map(textOf);
const rowNames = (t: RenderResult) => hosts(t, styles.pickerRowName).map(textOf);

/** The pressable row whose name is `name`. */
function rowFor(t: RenderResult, name: string): Node {
  const row = hosts(t, styles.pickerRow).find((n) =>
    n.queryAll((c) => stylesOf(c).includes(styles.pickerRowName)).some((c) => textOf(c) === name),
  );
  if (row === undefined) throw new Error(`the picker drew no row named ${name}`);
  return row;
}

function within(row: Node, style: object): string | undefined {
  const node = row.queryAll((c) => typeof c.type === 'string' && stylesOf(c).includes(style))[0];
  return node === undefined ? undefined : textOf(node);
}

const metaOf = (row: Node) => within(row, styles.pickerRowMeta);

/** The SF Symbol names drawn inside a node (a real `SymbolView` resolves to `SymbolModule`). */
function symbolsIn(node: Node): string[] {
  return node
    .queryAll((c) => typeof c.type === 'string' && c.type.includes('SymbolModule'))
    .map((c) => String(c.props.name));
}

function labelled(t: RenderResult, label: string): Node {
  const node = allNodes(t).find((n) => n.props?.accessibilityLabel === label);
  if (node === undefined) throw new Error(`the picker rendered nothing labelled ${label}`);
  return node;
}

function textNode(t: RenderResult, text: string): Node {
  const node = allNodes(t).find((n) => n.type === 'Text' && textOf(n) === text);
  if (node === undefined) throw new Error(`the picker rendered no text ${text}`);
  return node;
}

const nearMe = (t: RenderResult) => {
  const [pill] = hosts(t, styles.pickerNearMe);
  if (pill === undefined) throw new Error('the picker drew no Near me pill');
  return pill;
};

const showSite = () => render(<PlacePickerScreen kind="site" />);
const showCenter = () => render(<PlacePickerScreen kind="center" />);

async function type(t: RenderResult, text: string, field = 'Search sites') {
  await fireEvent.changeText(labelled(t, field), text);
}

async function press(t: RenderResult, text: string) {
  await fireEvent.press(textNode(t, text));
}

// --- Opening ------------------------------------------------------------------------------------

it('opens with Dived here, most recently dived first, and the search focused', async () => {
  mockUseDiveSites.mockReturnValue(
    sitesState([site({ id: 's-a', name: 'Alpha' }), site({ id: 's-b', name: 'Bravo' }), site({ id: 's-c', name: 'Charlie' })]),
  );
  mockUseDives.mockReturnValue(
    divesState([
      dive({ siteId: 's-a', date: '2026-01-10' }),
      dive({ siteId: 's-b', date: '2026-05-18' }),
      // A plan is not a visit: Charlie is in the catalogue and never dived.
      dive({ siteId: 's-c', date: '2026-09-01', status: 'planned' }),
    ]),
  );
  const t = await showSite();
  expect(textIn(t)).toContain('Choose a site');
  expect(groupTitles(t)).toEqual(['Dived here']);
  expect(rowNames(t)).toEqual(['Bravo', 'Alpha']);
  expect(labelled(t, 'Search sites').props.autoFocus).toBe(true);
});

// A new diver opened a page holding a title, a search and a pill and nothing else — no row, no
// sentence, nothing saying that typing is the way in. One muted line says it, and only there.
describe('the prompt', () => {
  const SITE_PROMPT = 'Type a name to find a site or create one.';
  const CENTRE_PROMPT = 'Type a name to find a centre or create one.';
  const notes = (t: RenderResult) => hosts(t, styles.pickerNoteText).map(textOf);

  it('stands where rows would be for a diver with nothing to list, and goes once a name is typed', async () => {
    const t = await showSite();
    expect(notes(t)).toEqual([SITE_PROMPT]);
    expect(rowNames(t)).toEqual([]);
    await type(t, 'Vis');
    expect(textIn(t)).not.toContain(SITE_PROMPT);
    expect(rowNames(t)).toEqual(['Create “Vis”']);
  });

  it('is not shown once Dived here lists something', async () => {
    mockUseDiveSites.mockReturnValue(sitesState([site({ id: 's-a', name: 'Alpha' })]));
    mockUseDives.mockReturnValue(divesState([dive({ siteId: 's-a', date: '2026-01-10' })]));
    const t = await showSite();
    expect(rowNames(t)).toEqual(['Alpha']);
    expect(textIn(t)).not.toContain(SITE_PROMPT);
  });

  it('is not shown under Near me', async () => {
    mockRough.mockResolvedValue({ found: true, latitude: 43, longitude: 16 });
    const t = await showSite();
    await press(t, 'Near me');
    await act(async () => {});
    expect(textIn(t)).not.toContain(SITE_PROMPT);
    expect(textIn(t)).toContain('Nothing within 50 km.');
  });

  // A read that has not answered states nothing — the dived rows may be a moment away.
  it('says nothing before the logbook and the catalogue have answered', async () => {
    mockUseDives.mockReturnValue({ ...divesState([]), resolved: false });
    const t = await showSite();
    expect(textIn(t)).not.toContain(SITE_PROMPT);
    await t.unmount();
    mockUseDives.mockReturnValue(divesState([]));
    mockUseDiveSites.mockReturnValue(sitesState([], { resolved: false }));
    const again = await showSite();
    expect(textIn(again)).not.toContain(SITE_PROMPT);
  });

  // The centre picker always ends in *Or · No centre* while nothing is typed; the prompt is what
  // gives that *Or* something to be the alternative to.
  it('in the centre picker, stands above Or · No centre', async () => {
    mockRequest.mockReturnValue(request({ kind: 'center' }));
    const t = await showCenter();
    expect(notes(t)).toEqual([CENTRE_PROMPT]);
    expect(groupTitles(t)).toEqual(['Or']);
    expect(rowNames(t)).toEqual(['No centre']);
    await type(t, 'Ponorka', 'Search centres');
    expect(textIn(t)).not.toContain(CENTRE_PROMPT);
  });
});

it('shows Selected: and the name, and checks that row', async () => {
  mockRequest.mockReturnValue(request({ selected: { id: 's-b', name: 'Bravo' } }));
  mockUseDiveSites.mockReturnValue(sitesState([site({ id: 's-a', name: 'Alpha' }), site({ id: 's-b', name: 'Bravo' })]));
  mockUseDives.mockReturnValue(
    divesState([
      dive({ siteId: 's-a', date: '2026-01-10', maxDepthM: 20 }),
      dive({ siteId: 's-b', date: '2026-05-18', maxDepthM: 30 }),
    ]),
  );
  const t = await showSite();

  const [line] = hosts(t, styles.pickerSelectedText);
  expect(line && textOf(line)).toBe('Selected: Bravo');

  const bravo = rowFor(t, 'Bravo');
  expect(symbolsIn(bravo)).toEqual(['checkmark']);
  expect(within(bravo, styles.pickerRowFigure)).toBeUndefined();
  expect(bravo.props.accessibilityState).toMatchObject({ selected: true });

  const alpha = rowFor(t, 'Alpha');
  expect(symbolsIn(alpha)).toEqual([]);
  expect(within(alpha, styles.pickerRowFigure)).toBe('20.0 m');
  expect(alpha.props.accessibilityState).toMatchObject({ selected: false });
});

// --- Typing: the five defects of #19 ---------------------------------------------------------------

it('a catalogue site nobody has dived is listed when its name is typed', async () => {
  mockUseDiveSites.mockReturnValue(sitesState([site({ name: 'Kotelna', country: 'CZ' })]));
  const t = await showSite();
  expect(rowNames(t)).toEqual([]);
  await type(t, 'kot');
  expect(groupTitles(t)).toEqual(['Other sites · 1']);
  expect(rowNames(t)).toEqual(['Kotelna', 'Create “kot”']);
});

it('typing an existing site’s full name lists it above Create, and picking it completes with its id', async () => {
  mockUseDiveSites.mockReturnValue(sitesState([site({ id: 's-vis', name: 'Vis' })]));
  const t = await showSite();
  await type(t, 'Vis');
  expect(rowNames(t)).toEqual(['Vis', 'Create “Vis”']);
  await press(t, 'Vis');
  expect(mockComplete).toHaveBeenCalledWith('tok', { id: 's-vis', name: 'Vis' }, 1);
  expect(router.push).not.toHaveBeenCalled();
});

it('a site created on this phone moments ago is found and reads added by you', async () => {
  signedIn();
  const t = await showSite();
  // The live read after the create page's write: the row is local and waiting to go up.
  mockUseDiveSites.mockReturnValue(sitesState([site({ id: 's-new', name: 'Nová stěna', dirty: true, createdBy: 'me' })]));
  await type(t, 'nova');
  expect(rowNames(t)).toEqual(['Nová stěna', 'Create “nova”']);
  expect(metaOf(rowFor(t, 'Nová stěna'))).toBe('added by you');
});

it('a row’s meta and figure', async () => {
  signedIn();
  mockUseDiveSites.mockReturnValue(
    sitesState([
      site({ id: 's-dived', name: 'Divers Bay', country: 'HR' }),
      site({ id: 's-comm', name: 'Divoká skála', country: 'HR', createdBy: 'someone' }),
    ]),
  );
  mockUseDives.mockReturnValue(
    divesState([
      dive({ siteId: 's-dived', date: '2026-02-01', maxDepthM: 20 }),
      dive({ siteId: 's-dived', date: '2026-05-18', maxDepthM: 34.6 }),
      dive({ siteId: 's-dived', date: '2026-04-01', maxDepthM: 12 }),
      dive({ siteId: 's-dived', date: '2026-03-01' }),
    ]),
  );
  const t = await showSite();
  const dived = rowFor(t, 'Divers Bay');
  expect(metaOf(dived)).toBe('4 dives · last 18 May 2026');
  expect(within(dived, styles.pickerRowFigure)).toBe('34.6 m');
  // An aggregate takes no band colour (§0.6): the figure is drawn in ink and nothing else.
  expect(styles.pickerRowFigure.color).toBe(theme.fg);
  const [figure] = dived.queryAll((c) => typeof c.type === 'string' && stylesOf(c).includes(styles.pickerRowFigure));
  expect(figure && stylesOf(figure)).toEqual([styles.pickerRowFigure]);

  await type(t, 'div');
  expect(metaOf(rowFor(t, 'Divoká skála'))).toBe('community · HR');

  // A guest's own row: nothing will push it until they sign in.
  await cleanup();
  mockUseAuthSession.mockReturnValue({ session: null, resolved: true });
  mockUseDiveSites.mockReturnValue(sitesState([site({ name: 'Moje lom', dirty: true })]));
  const guest = await showSite();
  await type(guest, 'moje');
  expect(metaOf(rowFor(guest, 'Moje lom'))).toBe('on this phone only · not shared yet');
});

// --- Creating -------------------------------------------------------------------------------------

it('Create opens the new site page with the typed name', async () => {
  signedIn();
  const t = await showSite();
  await type(t, 'Vis ');
  expect(metaOf(rowFor(t, 'Create “Vis”'))).toBe('new site · details next');
  await press(t, 'Create “Vis”');
  expect(router.push).toHaveBeenCalledWith({ pathname: '/site/new', params: { token: 'tok', name: 'Vis' } });
  expect(mockComplete).not.toHaveBeenCalled();
});

it('Create opens the new centre page from the centre picker', async () => {
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const t = await showCenter();
  await type(t, 'Ponorka', 'Search centres');
  await press(t, 'Create “Ponorka”');
  expect(router.push).toHaveBeenCalledWith({ pathname: '/center/new', params: { token: 'tok', name: 'Ponorka' } });
});

it('guest: the create row says kept on this phone', async () => {
  const t = await showSite();
  await type(t, 'Vis');
  expect(metaOf(rowFor(t, 'Create “Vis”'))).toBe('new site · kept on this phone until you sign in');
});

// --- Near me ---------------------------------------------------------------------------------------

describe('Near me', () => {
  const fix = { latitude: 43, longitude: 16 };

  it('shows Locating…, then one Near you list nearest first, with distances', async () => {
    mockUseDiveSites.mockReturnValue(
      sitesState([
        site({ id: 's-far', name: 'Far', latitude: 43.3, longitude: 16 }),
        site({ id: 's-near', name: 'Near', latitude: 43.01, longitude: 16 }),
        site({ id: 's-out', name: 'Out of range', latitude: 44, longitude: 16 }),
        site({ id: 's-nowhere', name: 'Nowhere' }),
      ]),
    );
    mockUseDives.mockReturnValue(divesState([dive({ siteId: 's-far', date: '2026-05-18' })]));
    const located = deferred<PositionOutcome>();
    mockRough.mockReturnValue(located.promise);
    const t = await showSite();
    expect(groupTitles(t)).toEqual(['Dived here']);

    await press(t, 'Near me');
    expect(textIn(t)).toContain('Locating…');
    expect(textIn(t)).not.toContain('Near me');

    await act(async () => located.resolve({ found: true, ...fix }));
    expect(groupTitles(t)).toEqual(['Near you · within 50 km']);
    expect(rowNames(t)).toEqual(['Near', 'Far']);
    expect(within(rowFor(t, 'Near'), styles.pickerRowDistance)).toBe('1.1 km');
    expect(within(rowFor(t, 'Far'), styles.pickerRowDistance)).toBe('33 km');
    expect(metaOf(rowFor(t, 'Far'))).toBe('dived · 1 dive');
    expect(metaOf(rowFor(t, 'Near'))).toBe('community');
    expect(nearMe(t).props.accessibilityState).toMatchObject({ selected: true });
    // The query still filters, and *Near you* takes no count: its heading already states a bound.
    await type(t, 'ar');
    expect(groupTitles(t)).toEqual(['Near you · within 50 km']);
    expect(rowNames(t)).toEqual(['Near', 'Far', 'Create “ar”']);
    await type(t, '');
    // The same RPC, asked around the fix (§2.3's supplement, by position).
    expect(mockSearchSitesNear).toHaveBeenCalledWith(expect.anything(), fix, 50_000);
    expect(mockSearchCentersNear).not.toHaveBeenCalled();

    // Pressed again, it turns off and the history comes back.
    await press(t, 'Near me');
    expect(groupTitles(t)).toEqual(['Dived here']);
    expect(nearMe(t).props.accessibilityState).toMatchObject({ selected: false });
  });

  it('says so when nothing is in range, and keeps Create while something is typed', async () => {
    mockRough.mockResolvedValue({ found: true, ...fix });
    mockUseDiveSites.mockReturnValue(sitesState([site({ name: 'Vis', latitude: 44, longitude: 16 })]));
    const t = await showSite();
    await press(t, 'Near me');
    await act(async () => {});
    expect(textIn(t)).toContain('Nothing within 50 km.');
    await type(t, 'vis');
    expect(textIn(t)).toContain('Nothing within 50 km matches “vis”.');
    expect(rowNames(t)).toEqual(['Create “vis”']);
  });

  it.each([
    ['denied', 'Location is off for Ponor. Turn it on in the device’s Settings.'],
    ['servicesOff', 'Location Services are off for this device.'],
    ['timedOut', 'Couldn’t find where you are. Try again.'],
    ['failed', 'Couldn’t find where you are. Try again.'],
  ] as const)('refused (%s) turns the pill off and says why', async (reason, sentence) => {
    mockRough.mockResolvedValue({ found: false, reason });
    const t = await showSite();
    await press(t, 'Near me');
    await act(async () => {});
    expect(textIn(t)).toContain(sentence);
    expect(textIn(t)).toContain('Near me');
    expect(nearMe(t).props.accessibilityState).toMatchObject({ selected: false });
  });

  it('pressed twice while locating asks once', async () => {
    const located = deferred<PositionOutcome>();
    mockRough.mockReturnValue(located.promise);
    const t = await showSite();
    await fireEvent.press(nearMe(t));
    await fireEvent.press(nearMe(t));
    expect(mockRough).toHaveBeenCalledTimes(1);
    await act(async () => located.resolve({ found: true, ...fix }));
    expect(mockRough).toHaveBeenCalledTimes(1);
  });

  // Pins the OUTCOME, not the `alive` guard: under React 19 a state update after unmount is a
  // silent no-op, so this stays green with the guard removed (checked). The guard is kept for
  // Review Focus 2 all the same; what this asserts is that nothing reaches the server or the form.
  it('a fix arriving after the page closed changes nothing', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const located = deferred<PositionOutcome>();
    mockRough.mockReturnValue(located.promise);
    const t = await showSite();
    await press(t, 'Near me');
    await t.unmount();
    await act(async () => located.resolve({ found: true, ...fix }));
    expect(mockSearchSitesNear).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

// --- The centre picker ------------------------------------------------------------------------------

it('centre: Near Vrak Teti leaves out centres already under Dived with; No centre completes with an empty pick', async () => {
  mockRequest.mockReturnValue(request({ kind: 'center', dive: { ...noDive, siteId: 's-teti' } }));
  mockUseDiveSites.mockReturnValue(sitesState([site({ id: 's-teti', name: 'Vrak Teti', latitude: 43, longitude: 16 })]));
  mockUseDiveCenters.mockReturnValue(
    centersState([
      center({ id: 'c-dived', name: 'Dived Shop', latitude: 43.01, longitude: 16 }),
      center({ id: 'c-near', name: 'Near Shop', latitude: 43.03, longitude: 16 }),
      center({ id: 'c-far', name: 'Far Shop', latitude: 43.5, longitude: 16 }),
    ]),
  );
  mockUseDives.mockReturnValue(divesState([dive({ centerId: 'c-dived', siteId: 's-teti', date: '2026-05-18' })]));
  const t = await showCenter();
  expect(textIn(t)).toContain('Choose a centre');
  expect(groupTitles(t)).toEqual(['Dived with', 'Near Vrak Teti', 'Or']);
  expect(rowNames(t)).toEqual(['Dived Shop', 'Near Shop', 'No centre']);
  expect(metaOf(rowFor(t, 'Dived Shop'))).toBe('1 dive · 1 site · last 18 May 2026');
  expect(metaOf(rowFor(t, 'Near Shop'))).toBe('3.3 km from Vrak Teti');
  expect(within(rowFor(t, 'Near Shop'), styles.pickerRowDistance)).toBe('3.3 km');
  expect(metaOf(rowFor(t, 'No centre'))).toBe('you dived without one');

  await press(t, 'No centre');
  expect(mockComplete).toHaveBeenCalledWith('tok', { id: null, name: '' }, 1);
});

describe('the live supplement', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // The pair that must travel together: the centre picker asks `search_centers`, never sites.
  it('asks the server for what the picker is choosing', async () => {
    mockRequest.mockReturnValue(request({ kind: 'center' }));
    const t = await showCenter();
    await type(t, 'Ponorka', 'Search centres');
    await act(async () => {
      jest.advanceTimersByTime(LIVE_SEARCH_DELAY_MS);
    });
    expect(mockSearchCenters).toHaveBeenCalledWith(expect.anything(), 'Ponorka');
    expect(mockSearchSites).not.toHaveBeenCalled();
  });
});

// --- When things go wrong ----------------------------------------------------------------------------

it('a failed catalogue read still lists Dived here, shows the unreadable message and offers Create', async () => {
  mockUseDiveSites.mockReturnValue(sitesState([site({ id: 's-a', name: 'Alpha' })], { error: new Error('nope') }));
  mockUseDives.mockReturnValue(divesState([dive({ siteId: 's-a' })]));
  const t = await showSite();
  expect(groupTitles(t)).toEqual(['Dived here']);
  expect(rowNames(t)).toEqual(['Alpha']);
  expect(textIn(t)).toContain(catalogueUnreadable());
  await type(t, 'Zlatá');
  expect(rowNames(t)).toEqual(['Create “Zlatá”']);
  expect(textIn(t)).toContain(catalogueUnreadable());
});

// The other half of a failed read: the FIRST read failed, so there are no rows at all. The page
// says it could not read the catalogue, and never also says that nothing is near — a failed read
// counts as resolved (db/liveQuery.ts), so "resolved" alone would let the false empty through.
it('a first catalogue read that failed says so, never calls the catalogue empty, and offers Create', async () => {
  mockRough.mockResolvedValue({ found: true, latitude: 43, longitude: 16 });
  mockUseDiveSites.mockReturnValue(sitesState([], { error: new Error('nope') }));
  mockUseDives.mockReturnValue(divesState([dive({ siteId: 's-a' })]));
  const t = await showSite();
  expect(rowNames(t)).toEqual([]);
  expect(textIn(t)).toContain(catalogueUnreadable());
  await press(t, 'Near me');
  await act(async () => {});
  expect(nearMe(t).props.accessibilityState).toMatchObject({ selected: true });
  expect(textIn(t)).toContain(catalogueUnreadable());
  expect(textIn(t).join(' ')).not.toContain('Nothing within');
  await type(t, 'Vis');
  expect(rowNames(t)).toEqual(['Create “Vis”']);
  expect(textIn(t).join(' ')).not.toContain('Nothing within');
});

it('a token the registry no longer knows still lists, searches and creates, and a pick just closes', async () => {
  mockRequest.mockReturnValue(null);
  mockUseDiveSites.mockReturnValue(sitesState([site({ id: 's-vis', name: 'Vis' })]));
  const t = await showSite();
  await type(t, 'vis');
  expect(rowNames(t)).toEqual(['Vis', 'Create “vis”']);
  await press(t, 'Vis');
  expect(mockComplete).toHaveBeenCalledWith('tok', { id: 's-vis', name: 'Vis' }, 1);
});

it('long names render whole', async () => {
  const long =
    'Vrak Teti — jižní ostroh pod majákem, kde se za dobré viditelnosti dá doplavat až ke druhé kotvě';
  mockRequest.mockReturnValue(request({ selected: { id: 's-long', name: long } }));
  mockUseDiveSites.mockReturnValue(sitesState([site({ id: 's-long', name: long })]));
  mockUseDives.mockReturnValue(divesState([dive({ siteId: 's-long' })]));
  const t = await showSite();
  const carrying = allNodes(t).filter((n) => n.type === 'Text' && textOf(n).includes(long));
  // The row's name and the Selected line, at least.
  expect(carrying.length).toBeGreaterThanOrEqual(2);
  for (const node of carrying) expect(node.props.numberOfLines).toBeUndefined();
});

// --- Leaving ----------------------------------------------------------------------------------------

it('Cancel forgets the request and goes back without a pick', async () => {
  const t = await showSite();
  await fireEvent.press(labelled(t, 'Leave without choosing'));
  expect(mockForget).toHaveBeenCalledWith('tok');
  expect(router.back).toHaveBeenCalled();
  expect(mockComplete).not.toHaveBeenCalled();
});

// --- One way off per tap ------------------------------------------------------------------------
//
// The real `completePlacePick` here, so what is counted is what reaches the stack: a second
// completion's `dismiss(1)` would pop the dive form itself.
describe('a double tap', () => {
  beforeEach(() => mockComplete.mockImplementation(actualPlacePick.completePlacePick));
  afterEach(() => mockComplete.mockReset());

  it('on a row completes once and closes one screen', async () => {
    mockUseDiveSites.mockReturnValue(sitesState([site({ id: 's-a', name: 'Alpha' })]));
    mockUseDives.mockReturnValue(divesState([dive({ siteId: 's-a' })]));
    const t = await showSite();
    await press(t, 'Alpha');
    await press(t, 'Alpha');
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(router.dismiss).toHaveBeenCalledTimes(1);
    expect(router.dismiss).toHaveBeenCalledWith(1);
  });

  it('on No centre completes once and closes one screen', async () => {
    mockRequest.mockReturnValue(request({ kind: 'center' }));
    const t = await showCenter();
    await press(t, 'No centre');
    await press(t, 'No centre');
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(router.dismiss).toHaveBeenCalledTimes(1);
  });

  it('on Cancel goes back once', async () => {
    const t = await showSite();
    await fireEvent.press(labelled(t, 'Leave without choosing'));
    await fireEvent.press(labelled(t, 'Leave without choosing'));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('on Create pushes one create page, and coming back from it lets the diver pick', async () => {
    mockUseDiveSites.mockReturnValue(sitesState([site({ id: 's-vis', name: 'Vis' })]));
    const t = await showSite();
    await type(t, 'Vis');
    await press(t, 'Create “Vis”');
    await press(t, 'Create “Vis”');
    expect(router.push).toHaveBeenCalledTimes(1);
    // Nothing else leaves while the create page is the way off…
    await press(t, 'Vis');
    expect(mockComplete).not.toHaveBeenCalled();
    // …until `‹ Back` on the create page brings the diver here again.
    const focused = mockFocusEffect.mock.calls[mockFocusEffect.mock.calls.length - 1]?.[0];
    expect(focused).toBeDefined();
    await act(async () => {
      focused?.();
    });
    await press(t, 'Vis');
    expect(mockComplete).toHaveBeenCalledWith('tok', { id: 's-vis', name: 'Vis' }, 1);
  });
});

// Swipe-back leaves the same way Cancel does: the page unmounts and the request goes with it.
it('leaving by swipe-back forgets the request too', async () => {
  const t = await showSite();
  await t.unmount();
  expect(mockForget).toHaveBeenCalledWith('tok');
  expect(mockComplete).not.toHaveBeenCalled();
});

// §0.1's sweep: every colour on the page is the sheet's.
it('paints nothing of its own', async () => {
  mockRequest.mockReturnValue(request({ selected: { id: 's-a', name: 'Alpha' } }));
  mockUseDiveSites.mockReturnValue(sitesState([site({ id: 's-a', name: 'Alpha', maxDepthM: 42 })]));
  mockUseDives.mockReturnValue(divesState([dive({ siteId: 's-a', maxDepthM: 41 })]));
  expect(unexpectedGraphics(await showSite(), 'light')).toEqual([]);
});

describe('in Czech', () => {
  beforeEach(() => {
    setActiveLanguage('cs');
  });
  afterEach(async () => {
    await cleanup();
    setActiveLanguage('en');
  });

  it('titles the page and words the create row in Czech', async () => {
    const t = await showSite();
    expect(textIn(t)).toContain('Vyberte lokalitu');
    expect(textIn(t)).toContain('Napište název a najděte lokalitu, nebo vytvořte novou.');
    await type(t, 'Vis', 'Hledat lokality');
    expect(rowNames(t)).toEqual(['Vytvořit „Vis“']);
    expect(textIn(t)).not.toContain('Choose a site');
  });
});
