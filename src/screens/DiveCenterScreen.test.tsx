// The package's own official Jest mock, imported first and named `mock…` for the
// babel-plugin-jest-hoist reason every screen suite in this repo records: a `jest.mock()`
// factory may only close over out-of-scope identifiers starting with `mock`/`require`, and
// every `jest.mock()` call is hoisted above every import regardless.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, cleanup, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { useDiveCenters, type DiveCenterListState } from '../db/useDiveCenters';
import { useDives, type DiveListState } from '../db/useDives';
import { useDiveSampleShapes } from '../db/useDiveSampleShapes';
import { useUnitSystem } from '../db/useUnitSystem';
import { assignDiveNumbers } from '../domain/diveNumber';
import { dive } from '../domain/diveFixture';
import { type ProfilePoint } from '../domain/profile';
import { catalogueUnreadable, logbookUnreadable } from '../domain/logbook';
import { type Dive, type DiveCenter } from '../domain/types';
import { setActiveLanguage } from '../i18n';
import { unnamedCenter } from '../format/display';
import { openAddressInMaps } from '../platform/mapsLink';
import { openContactUrl } from '../platform/openContact';
import { openWebsite } from '../platform/openWebsite';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { makeStyles } from '../theme/styles';
import DiveCenterScreen from './DiveCenterScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useDiveCenters', () => ({ useDiveCenters: jest.fn() }));
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
// Task 6's row sparkline map — its own hook, mocked on its own for the same reason `useDives`
// above is: a live database read this screen must be renderable without.
jest.mock('../db/useDiveSampleShapes', () => ({ useDiveSampleShapes: jest.fn() }));
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));
// The seam, not the platform: `platform/openWebsite.ts` owns what may be handed to the outside
// world and is tested on its own. Mocking it here is what lets this file assert *which* string
// this screen hands over, without a browser — the shape `confirmDestructive` is mocked in.
jest.mock('../platform/openWebsite', () => ({
  ...jest.requireActual('../platform/openWebsite'),
  openWebsite: jest.fn(async () => {}),
}));

// The same seam for what a phone number, an email and an address hand to the device: the rules
// are `openContact.test.ts`'s and `mapsLink.test.ts`'s, and this file asserts which string the
// screen hands over.
jest.mock('../platform/openContact', () => ({
  ...jest.requireActual('../platform/openContact'),
  openContactUrl: jest.fn(async () => {}),
}));
jest.mock('../platform/mapsLink', () => ({
  ...jest.requireActual('../platform/mapsLink'),
  openAddressInMaps: jest.fn(),
}));

const mockUseDiveCenters = useDiveCenters as jest.MockedFunction<typeof useDiveCenters>;
const mockUseDives = useDives as jest.MockedFunction<typeof useDives>;
const mockUseDiveSampleShapes = useDiveSampleShapes as jest.MockedFunction<typeof useDiveSampleShapes>;
const mockUseUnitSystem = useUnitSystem as jest.MockedFunction<typeof useUnitSystem>;
const mockParams = useLocalSearchParams as jest.MockedFunction<typeof useLocalSearchParams>;
const mockOpenWebsite = openWebsite as jest.MockedFunction<typeof openWebsite>;
const mockOpenContactUrl = openContactUrl as jest.MockedFunction<typeof openContactUrl>;
const mockOpenAddressInMaps = openAddressInMaps as jest.MockedFunction<typeof openAddressInMaps>;

/**
 * **A centre in the shape M2o actually writes: a name and nothing else.**
 *
 * §2.3 is explicit — *"a centre inherits its name alone — the form's pin is where the diver
 * entered the water, so writing it to a centre files a dive site as the shop's address"* — and
 * the country is derived from a pin, so a centre created by this app has neither. Every richer
 * field below is opted into by the one test that is about it. **A fixture full of complete
 * centres would never exercise the common case**, which is the case this page has to be worth
 * opening for.
 */
const centre = (over: Partial<DiveCenter> = {}): DiveCenter => ({
  id: 'c1',
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

function catalogueState(centers: DiveCenter[], over: Partial<DiveCenterListState> = {}): DiveCenterListState {
  return { centers, resolved: true, error: undefined, ...over };
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
  mockUseDiveCenters.mockReturnValue(catalogueState([centre()]));
  mockUseDives.mockReturnValue(divesState([]));
  mockUseDiveSampleShapes.mockReturnValue({ shapes: new Map(), resolved: true, error: undefined });
  mockUseUnitSystem.mockReturnValue('metric');
  mockParams.mockReturnValue({ id: 'c1' });
  mockOpenWebsite.mockClear();
  mockOpenContactUrl.mockClear();
  mockOpenAddressInMaps.mockClear();
  (router.push as jest.Mock).mockClear();
});

function allNodes(t: RenderResult) {
  return t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
}

function textIn(t: RenderResult): string[] {
  return allNodes(t)
    .filter((n) => n.type === 'Text')
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

function labelled(t: RenderResult, label: string) {
  const node = allNodes(t).find((n) => n.props?.accessibilityLabel === label);
  if (node === undefined) throw new Error(`the centre page rendered nothing labelled ${label}`);
  return node;
}

const show = () => render(<DiveCenterScreen />);

/** A dive with this centre, in the shape a real logbook holds: the id pairs it, the snapshot
 * says what it was called (§6). */
const withPonorka = (over: Partial<Dive> = {}) =>
  dive({ centerId: 'c1', centerName: 'Ponorka', maxDepthM: 18.2, waterTempC: 21, ...over });

// Task 6's row sparkline: a small hand-rolled series, enough to prove the wiring reaches the
// row at all — `ProfileSparkline.test.tsx` and `DiveRow.test.tsx` already own the real fixture.
const SERIES: ProfilePoint[] = [
  { t: 0, v: 5 },
  { t: 30, v: 12 },
  { t: 60, v: 3 },
];

// Task 6's whole reason for calling out the wiring by name: a `samples` prop that nothing
// ever passes draws nothing, forever. This proves the map `useDiveSampleShapes()` hands back
// actually reaches this page's own dive list.
// Task 6 review, Finding 6: a second dive with NO entry in `shapes` — without it, a screen
// that passed every row the same constant series would pass this test just as well as one
// that genuinely looks the series up by id.
it("passes each dive its own series from useDiveSampleShapes() through to its row's sparkline", async () => {
  mockUseDives.mockReturnValue(
    divesState([withPonorka({ id: 'has-series' }), withPonorka({ id: 'no-series' })]),
  );
  mockUseDiveSampleShapes.mockReturnValue({
    shapes: new Map([['has-series', SERIES]]),
    resolved: true,
    error: undefined,
  });
  const t = await show();
  expect(t.root ? t.root.queryAll((n) => n.type === 'RNSVGPath') : []).toHaveLength(1);
});

// --- The centre with only a name, which is the common case by design (§2.3) ----------------

/**
 * **The guard this whole screen turns on.** A centre that is a name and nulls — still the common
 * one, since the create page's position and website are optional (issue #19) — has no
 * catalogue facts to draw, so the page is worth opening only because of the half the catalogue
 * does not hold — the diver's own dives with them, which nothing else in the app lists.
 *
 * Written against the default fixture deliberately: a suite whose centres all had a country and
 * a website would pass with this branch broken and never say so.
 */
it('is worth opening for a centre that has nothing but a name', async () => {
  mockUseDives.mockReturnValue(divesState([withPonorka(), withPonorka({ maxDepthM: 12, waterTempC: 24 })]));
  const t = await show();
  const text = textIn(t);
  expect(text).toContain('Ponorka');
  expect(text).toContain('2 dives · deepest 18.2 m · 21–24 °C');
  expect(text).toContain('Your dives');
  // ...and the dives themselves, not merely a count of them.
  expect(text).toContain('18.2');
});

// A heading with nothing under it is the shape §0.6 refuses on the dive detail, and it is the
// one this branch would produce: a "Centre" cluster over zero rows.
it('draws no catalogue cluster for a centre with no catalogue facts', async () => {
  mockUseDives.mockReturnValue(divesState([withPonorka()]));
  const text = textIn(await show());
  expect(text).not.toContain('Contact');
  expect(text).not.toContain('Country');
  expect(text).not.toContain('Website');
});

// --- What the catalogue knows, when it knows anything --------------------------------------

it('shows the country and the website when the row carries them', async () => {
  mockUseDiveCenters.mockReturnValue(
    catalogueState([centre({ country: 'HR', website: 'https://ponorka.example' })]),
  );
  const text = textIn(await show());
  expect(text).toContain('Contact');
  expect(text).toContain('Country');
  expect(text).toContain('HR');
  expect(text).toContain('Website');
  expect(text).toContain('https://ponorka.example');
});

it('opens an address the app will actually open, and hands over exactly what it showed', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([centre({ website: 'https://ponorka.example' })]));
  const t = await show();
  await fireEvent.press(labelled(t, 'Open https://ponorka.example'));
  expect(mockOpenWebsite).toHaveBeenCalledWith('https://ponorka.example');
});

/**
 * **A value that is not an address is a fact, not a control** — the row shows it and cannot be
 * pressed. `platform/openWebsite.ts` owns the rule; what this pins is that the screen *asks*
 * rather than assuming every stored `website` is one, which is the difference between a row a
 * diver reads and a dead control (§0.6).
 */
it('shows a website that is not an address as plain text, with nothing to press', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([centre({ website: 'ponorka.example' })]));
  const t = await show();
  expect(textIn(t)).toContain('ponorka.example');
  expect(allNodes(t).some((n) => n.props?.accessibilityLabel === 'Open ponorka.example')).toBe(false);
});

// --- Which dives the page claims -----------------------------------------------------------

/**
 * `divesWithCenter` owns the rule and states it; what this screen has to get right is that it
 * asks that question rather than a looser one. A dive at another centre with the same name, and
 * a planned dive with this one, are the two that a looser rule would let through.
 */
it('lists the dives that were with this centre and no others', async () => {
  mockUseDives.mockReturnValue(
    divesState([
      withPonorka({ maxDepthM: 18.2 }),
      dive({ centerId: 'c2', centerName: 'Ponorka', maxDepthM: 30.5 }),
      dive({ centerName: 'Aqua Split', maxDepthM: 22.4 }),
      dive({ status: 'planned', centerId: 'c1', centerName: 'Ponorka', maxDepthM: 11.1 }),
    ]),
  );
  const text = textIn(await show());
  expect(text).toContain('1 dive · deepest 18.2 m · 21 °C');
  expect(text).toContain('18.2');
  expect(text).not.toContain('30.5');
  expect(text).not.toContain('22.4');
  expect(text).not.toContain('11.1');
});

// An unpaired dive belongs by its folded name, which is every dive logged before M2o (§2.3).
it('counts a dive that named the centre by hand', async () => {
  mockUseDives.mockReturnValue(divesState([dive({ centerName: 'ponorka', maxDepthM: 9.4 })]));
  expect(textIn(await show())).toContain('1 dive · deepest 9.4 m');
});

// A page opened to ask "what did I do with this shop" answers even when the answer is none —
// the one place this screen deliberately differs from `formatCenterRow`, which omits a nought.
it('says 0 dives rather than nothing at all', async () => {
  const text = textIn(await show());
  expect(text).toContain('0 dives');
  expect(text).not.toContain('Your dives');
});

it('opens a dive from its row', async () => {
  const one = withPonorka();
  mockUseDives.mockReturnValue(divesState([one]));
  const t = await show();
  const styles = makeStyles('light');
  const row = allNodes(t).find((n) => [n.props?.style].flat(5).includes(styles.diveRow));
  expect(row).toBeDefined();
  await fireEvent.press(row!);
  expect(String((router.push as jest.Mock).mock.calls[0]?.[0])).toBe(`/dive/${one.id}`);
});

// --- The three states of a centre that is not here ------------------------------------------

/**
 * §10: a screen with no answer must not state one. `useLiveQuery` hands back `[]` on the renders
 * before its query returns, so *"Centre not found"* said unconditionally would be a claim about
 * a database nothing has yet asked — the defect `DiveDetailScreen`'s own not-found branch
 * records at length.
 */
it('states nothing about a catalogue it has not read yet', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([], { resolved: false }));
  expect(textIn(await show())).toEqual(['‹ Back']);
});

it('says the centre is not here once it has looked', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([]));
  expect(textIn(await show())).toContain('Centre not found.');
});

// A failed read must never read as "not found": one is a broken device, the other is a centre
// that is genuinely gone (an admin merged or hid it, `pickable` in db/catalogue.ts).
it('reports a failed catalogue read rather than a missing centre', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([], { error: new Error('nope') }));
  const text = textIn(await show());
  expect(text).toContain(catalogueUnreadable());
  expect(text).not.toContain('Centre not found.');
});

// The way out is on both branches, for `DiveDetailScreen`'s stated reason: a page reached by an
// unknown id is more of a dead end than a real one, not less.
it('offers the way out whether or not the centre is here', async () => {
  expect(textIn(await show())).toContain('‹ Back');
  mockUseDiveCenters.mockReturnValue(catalogueState([]));
  expect(textIn(await show())).toContain('‹ Back');
});

// --- The logbook underneath it --------------------------------------------------------------

/**
 * The centre is readable and the logbook is not, which is a different failure from either of the
 * two above and gets the sentence four other screens say about the same event
 * (`logbookUnreadable`, domain/logbook.ts). The page still names the centre: what failed is the
 * half about the diver, not the half about the shop.
 */
it('names the centre and reports the logbook failure under it', async () => {
  mockUseDives.mockReturnValue(divesState([], { error: new Error('nope') }));
  const text = textIn(await show());
  expect(text).toContain('Ponorka');
  expect(text).toContain(logbookUnreadable());
  // No summary: "0 dives" over an unreadable logbook is a figure with nothing behind it.
  expect(text).not.toContain('0 dives');
});

it('says nothing about a logbook it has not read yet', async () => {
  mockUseDives.mockReturnValue(divesState([], { resolved: false }));
  const text = textIn(await show());
  expect(text).toContain('Ponorka');
  expect(text).not.toContain('0 dives');
});

// --- Naming, units and paint -----------------------------------------------------------------

// `dive_centers.name` is nullable in both databases (§6), so a row with none can arrive by pull.
// A heading a screen reader announces as nothing is worse than one it announces as unnamed, and
// it must be the words the rest of the app uses.
it('calls an unnamed centre what the rest of the app calls one', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([centre({ name: null })]));
  expect(textIn(await show())).toContain(unnamedCenter());
});

it('reads the summary in the diver’s own units', async () => {
  mockUseUnitSystem.mockReturnValue('imperial');
  mockUseDives.mockReturnValue(divesState([withPonorka()]));
  expect(textIn(await show()).join(' ')).toContain('60 ft');
});

// §0.1's sweep: the depth palette reaches this screen exactly where it reaches every other one —
// on a `DiveRow`'s own depth, beside its own number — and nothing else is painted.
it('paints nothing of its own', async () => {
  mockUseDives.mockReturnValue(divesState([withPonorka()]));
  expect(unexpectedGraphics(await show(), 'light')).toEqual([]);
});

// **...and none on a row whose sparkline actually draws** (review, Finding 6). The sweep above
// renders with no entry in `shapes` at all, so the sparkline Task 6 put in every row had never
// met this guard on this screen — exactly the latent exposure `DivesScreen`'s own equivalent
// test (`draws none on a list whose rows have a shape to draw`) closed there.
it('paints nothing of its own on a row whose sparkline actually draws', async () => {
  mockUseDives.mockReturnValue(
    divesState([withPonorka({ id: 'has-series' }), withPonorka({ id: 'no-series' })]),
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
  const heading = allNodes(t).find((n) => [n.props?.style].flat(5).includes(styles.centerHeading));
  expect(heading?.children).toEqual(['Ponorka']);
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

  it('names its cluster, its rows and its way out in Czech', async () => {
    mockUseDiveCenters.mockReturnValue(
      catalogueState([centre({ country: 'CZ', website: 'https://ponorka.example' })]),
    );
    const said = textIn(await show());
    expect(said).toContain('Kontakt');
    expect(said).toContain('Země');
    expect(said).toContain('Web');
    expect(said).toContain('‹ Zpět');
    expect(said).not.toContain('Website');
  });

  it('says a centre it cannot find is not there, in Czech', async () => {
    mockUseDiveCenters.mockReturnValue(catalogueState([]));
    expect(textIn(await show())).toContain('Centrum nenalezeno.');
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
    mockUseDiveCenters.mockReturnValue(catalogueState([centre({ country: 'CZ' })]));
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
// The dive detail's card, on a centre's page as the design canvas draws it. §2.3 gives a centre no
// position of its own, so the card appears only for one somebody placed — a catalogue that
// surveyed it, or a diver pressing *Use current position* on the create page (issue #19).

it('offers the centre on the map, with its position under the words', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([centre({ latitude: 43.0611, longitude: 16.1834 })]));
  const t = await show();
  expect(textIn(t)).toContain('Show on map');
  expect(textIn(t)).toContain('43.06110, 16.18340');
});

it('pushes the map pointed at this centre', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([centre({ latitude: 43.0611, longitude: 16.1834 })]));
  const t = await show();
  await fireEvent.press(labelled(t, 'Show on map'));
  // `over: 'page'`: the map is pushed over this page, so a link back to it from the map goes back.
  expect(router.push).toHaveBeenCalledWith({ pathname: '/center/[id]/map', params: { id: 'c1', over: 'page' } });
});

it('offers no map for a centre with no position, which is every centre this app creates', async () => {
  const t = await show();
  expect(textIn(t)).not.toContain('Show on map');
});

it('puts the card under the page’s own lines and above the centre’s facts', async () => {
  mockUseDiveCenters.mockReturnValue(
    catalogueState([centre({ country: 'Croatia', latitude: 43.0611, longitude: 16.1834 })]),
  );
  const lines = textIn(await show());
  expect(lines.indexOf('Show on map')).toBeGreaterThan(lines.indexOf('Ponorka'));
  expect(lines.indexOf('Show on map')).toBeLessThan(lines.indexOf('Contact'));
});

// --- What a centre says about itself (#31) -----------------------------------------------------

const nautica = (over: Partial<DiveCenter> = {}) =>
  centre({
    name: 'Nautica Vis',
    address: 'Otok Vis, Kut 12',
    phone: '+385 21 555 0123',
    email: 'dive@nautica-vis.example',
    openingHours: 'Mon–Sat 8–18',
    website: 'https://nautica-vis.example',
    country: 'HR',
    services: ['air', 'nitrox'],
    agencies: ['padi', 'other'],
    description: 'A small shop on the quay.\nBoats leave at nine.',
    ...over,
  });

it('puts the description under the page’s own lines and above the map card', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([nautica({ latitude: 43.0611, longitude: 16.1834 })]));
  mockUseDives.mockReturnValue(divesState([withPonorka({ centerName: 'Nautica Vis', centerId: 'c1' })]));
  const t = await show();
  const lines = textIn(t);
  const description = 'A small shop on the quay.\nBoats leave at nine.';
  expect(lines.indexOf(description)).toBeGreaterThan(lines.indexOf('Nautica Vis'));
  expect(lines.indexOf(description)).toBeGreaterThan(lines.findIndex((line) => line.startsWith('1 dive')));
  expect(lines.indexOf(description)).toBeLessThan(lines.indexOf('Show on map'));
  // Whole, with its newline, and in the description's own style.
  const styles = makeStyles('light');
  const node = allNodes(t).find((n) => [n.props?.style].flat(5).includes(styles.centerDescription));
  expect(node).toBeDefined();
  expect(node?.props.numberOfLines).toBeUndefined();
});

it('draws no description for blank text', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([nautica({ description: '  \n ' })]));
  const t = await show();
  const styles = makeStyles('light');
  expect(allNodes(t).some((n) => [n.props?.style].flat(5).includes(styles.centerDescription))).toBe(false);
});

it('opens the address in the device’s maps', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([nautica()]));
  const t = await show();
  await fireEvent.press(labelled(t, 'Show Otok Vis, Kut 12 on a map'));
  expect(mockOpenAddressInMaps).toHaveBeenCalledWith('Otok Vis, Kut 12');
});

it('calls the number', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([nautica()]));
  const t = await show();
  await fireEvent.press(labelled(t, 'Call +385 21 555 0123'));
  expect(mockOpenContactUrl).toHaveBeenCalledWith('tel:+385215550123');
});

it('writes to the email address', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([nautica()]));
  const t = await show();
  await fireEvent.press(labelled(t, 'Write to dive@nautica-vis.example'));
  expect(mockOpenContactUrl).toHaveBeenCalledWith('mailto:dive@nautica-vis.example');
});

it('shows a number or an address it cannot open as text, with nothing to press', async () => {
  mockUseDiveCenters.mockReturnValue(
    catalogueState([nautica({ phone: 'ask at the bar', email: 'x@y.example?bcc=z@w.example' })]),
  );
  const t = await show();
  expect(textIn(t)).toContain('ask at the bar');
  expect(textIn(t)).toContain('x@y.example?bcc=z@w.example');
  const links = allNodes(t).filter((n) => n.props?.accessibilityRole === 'link');
  const labels = links.map((n) => n.props.accessibilityLabel);
  expect(labels.some((label) => String(label).startsWith('Call'))).toBe(false);
  expect(labels.some((label) => String(label).startsWith('Write to'))).toBe(false);
  // Pressing the text itself opens nothing: no ancestor of it is a handler that reaches `openURL`.
  for (const text of ['ask at the bar', 'x@y.example?bcc=z@w.example']) {
    const node = allNodes(t).find((n) => n.type === 'Text' && n.children.includes(text));
    expect(node).toBeDefined();
    await fireEvent.press(node!);
  }
  expect(mockOpenContactUrl).not.toHaveBeenCalled();
});

it('shows the number in the figure face and the address, email and hours in the name face', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([nautica()]));
  const t = await show();
  const styles = makeStyles('light');
  const withStyle = (key: 'centerFactFigure' | 'centerFactValue') =>
    allNodes(t)
      .filter((n) => n.type === 'Text' && [n.props?.style].flat(5).includes(styles[key]))
      .flatMap((n) => n.children);
  expect(withStyle('centerFactFigure')).toEqual(['+385 21 555 0123']);
  expect(withStyle('centerFactValue')).toEqual(
    expect.arrayContaining(['Otok Vis, Kut 12', 'dive@nautica-vis.example', 'Mon–Sat 8–18']),
  );
});

it('lists contact, then services and agencies as lines of text', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([nautica()]));
  mockUseDives.mockReturnValue(divesState([withPonorka({ centerName: 'Nautica Vis' })]));
  const lines = textIn(await show());
  const order = ['Contact', 'Services', 'Your dives'].map((heading) => lines.indexOf(heading));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(lines).toEqual(expect.arrayContaining(['Air · Nitrox', 'PADI · Other', 'Agencies']));
  // Contact rows in the canvas's order.
  const rows = ['Address', 'Phone', 'Email', 'Opening hours', 'Website', 'Country'].map((l) => lines.indexOf(l));
  expect(rows.every((i) => i >= 0)).toBe(true);
  expect(rows).toEqual([...rows].sort((a, b) => a - b));
});

it('draws no services cluster for a centre with none', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([nautica({ services: [], agencies: [] })]));
  expect(textIn(await show())).not.toContain('Services');
});

it('reads a service this build does not know as a word, and skips what is not a string', async () => {
  mockUseDiveCenters.mockReturnValue(
    catalogueState([nautica({ services: ['freediving', 3, null] as never, agencies: [] })]),
  );
  const lines = textIn(await show());
  expect(lines).toContain('Freediving');
  expect(lines.join(' ')).not.toContain('vocabulary.');
});

it('words its links in Czech', async () => {
  setActiveLanguage('cs');
  try {
    mockUseDiveCenters.mockReturnValue(catalogueState([nautica()]));
    const t = await show();
    labelled(t, 'Zavolat na +385 21 555 0123');
    labelled(t, 'Napsat na dive@nautica-vis.example');
    labelled(t, 'Ukázat Otok Vis, Kut 12 na mapě');
    expect(textIn(t)).toContain('Agentury');
  } finally {
    await cleanup();
    setActiveLanguage('en');
  }
});
