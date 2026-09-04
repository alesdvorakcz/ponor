// The package's own official Jest mock, imported first and named `mock…` for the
// babel-plugin-jest-hoist reason every screen suite in this repo records: a `jest.mock()`
// factory may only close over out-of-scope identifiers starting with `mock`/`require`, and
// every `jest.mock()` call is hoisted above every import regardless.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { useDiveCenters, type DiveCenterListState } from '../db/useDiveCenters';
import { useDives, type DiveListState } from '../db/useDives';
import { useUnitSystem } from '../db/useUnitSystem';
import { assignDiveNumbers } from '../domain/diveNumber';
import { dive } from '../domain/diveFixture';
import { CATALOGUE_UNREADABLE, LOGBOOK_UNREADABLE } from '../domain/logbook';
import { type Dive, type DiveCenter } from '../domain/types';
import { UNNAMED_CENTER } from '../format/display';
import { openWebsite } from '../platform/openWebsite';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { makeStyles } from '../theme/styles';
import DiveCenterScreen from './DiveCenterScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useDiveCenters', () => ({ useDiveCenters: jest.fn() }));
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
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

const mockUseDiveCenters = useDiveCenters as jest.MockedFunction<typeof useDiveCenters>;
const mockUseDives = useDives as jest.MockedFunction<typeof useDives>;
const mockUseUnitSystem = useUnitSystem as jest.MockedFunction<typeof useUnitSystem>;
const mockParams = useLocalSearchParams as jest.MockedFunction<typeof useLocalSearchParams>;
const mockOpenWebsite = openWebsite as jest.MockedFunction<typeof openWebsite>;

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
  mockUseUnitSystem.mockReturnValue('metric');
  mockParams.mockReturnValue({ id: 'c1' });
  mockOpenWebsite.mockClear();
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

// --- The centre with only a name, which is the common case by design (§2.3) ----------------

/**
 * **The guard this whole screen turns on.** A centre that is a name and nine nulls has no
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
  expect(text).not.toContain('Centre');
  expect(text).not.toContain('Country');
  expect(text).not.toContain('Website');
});

// --- What the catalogue knows, when it knows anything --------------------------------------

it('shows the country and the website when the row carries them', async () => {
  mockUseDiveCenters.mockReturnValue(
    catalogueState([centre({ country: 'HR', website: 'https://ponorka.example' })]),
  );
  const text = textIn(await show());
  expect(text).toContain('Centre');
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
  expect(textIn(await show())).toEqual(['‹ Centres']);
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
  expect(text).toContain(CATALOGUE_UNREADABLE);
  expect(text).not.toContain('Centre not found.');
});

// The way out is on both branches, for `DiveDetailScreen`'s stated reason: a page reached by an
// unknown id is more of a dead end than a real one, not less.
it('offers the way out whether or not the centre is here', async () => {
  expect(textIn(await show())).toContain('‹ Centres');
  mockUseDiveCenters.mockReturnValue(catalogueState([]));
  expect(textIn(await show())).toContain('‹ Centres');
});

// --- The logbook underneath it --------------------------------------------------------------

/**
 * The centre is readable and the logbook is not, which is a different failure from either of the
 * two above and gets the sentence four other screens say about the same event
 * (`LOGBOOK_UNREADABLE`, domain/logbook.ts). The page still names the centre: what failed is the
 * half about the diver, not the half about the shop.
 */
it('names the centre and reports the logbook failure under it', async () => {
  mockUseDives.mockReturnValue(divesState([], { error: new Error('nope') }));
  const text = textIn(await show());
  expect(text).toContain('Ponorka');
  expect(text).toContain(LOGBOOK_UNREADABLE);
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
  expect(textIn(await show())).toContain(UNNAMED_CENTER);
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

// The title is the screen's own, in the app's one heading treatment — not a borrowed one.
it('sets its heading in the treatment every other screen title uses', async () => {
  const t = await show();
  const styles = makeStyles('light');
  const heading = allNodes(t).find((n) => [n.props?.style].flat(5).includes(styles.centerHeading));
  expect(heading?.children).toEqual(['Ponorka']);
});
