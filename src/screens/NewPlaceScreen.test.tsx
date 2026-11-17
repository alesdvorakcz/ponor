import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, cleanup, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { addCenter, addSite, findSiteTwins, type SiteTwin } from '../cloud/addToCatalogue';
import { useAuthSession } from '../cloud/useAuthSession';
import { useUnitSystem } from '../db/useUnitSystem';
import { setActiveLanguage } from '../i18n';
import { completePlacePick, placePickRequest, type DiveContext, type PlacePickRequest } from '../navigation/placePick';
import { countryFor, countryForAddress } from '../platform/geocode';
import { currentPosition, type PositionOutcome } from '../platform/location';
import { makeStyles } from '../theme/styles';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import NewPlaceScreen from './NewPlaceScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../cloud/useAuthSession', () => ({
  useAuthSession: jest.fn(() => ({ session: null, resolved: true })),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), dismiss: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({ token: 'tok', name: 'Lom Leštinka' })),
  useFocusEffect: jest.fn(),
}));
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));
// The hand-back registry at its own seam, as `PlacePickerScreen.test.tsx` mocks it: its suite proves
// what completing does to the form and the stack; what is left here is when the page completes and
// with what.
jest.mock('../navigation/placePick', () => ({
  placePickRequest: jest.fn(),
  completePlacePick: jest.fn(),
  firstParam: jest.requireActual('../navigation/placePick').firstParam,
}));
// The catalogue's writes and §2.3's duplicate check, at their own seam: `addToCatalogue.test.ts` proves
// what each writes and asks. This file owns which of them the page calls, when, and with what.
jest.mock('../cloud/addToCatalogue', () => ({
  findSiteTwins: jest.fn(),
  addSite: jest.fn(),
  addCenter: jest.fn(),
}));
// The device's answer to "where am I" — the stored-pin request, unchanged — and its geocoder.
jest.mock('../platform/location', () => ({
  ...jest.requireActual('../platform/location'),
  currentPosition: jest.fn(),
}));
jest.mock('../platform/geocode', () => ({ countryFor: jest.fn(), countryForAddress: jest.fn() }));
jest.mock('../hooks/useKeyboardShown', () => ({ useKeyboardShown: jest.fn(() => false) }));

const mockParams = useLocalSearchParams as jest.MockedFunction<typeof useLocalSearchParams>;
const mockUseAuthSession = useAuthSession as jest.MockedFunction<typeof useAuthSession>;
const mockRequest = placePickRequest as jest.MockedFunction<typeof placePickRequest>;
const mockComplete = completePlacePick as jest.MockedFunction<typeof completePlacePick>;
const mockTwins = findSiteTwins as jest.MockedFunction<typeof findSiteTwins>;
const mockAddSite = addSite as jest.MockedFunction<typeof addSite>;
const mockAddCenter = addCenter as jest.MockedFunction<typeof addCenter>;
const mockPosition = currentPosition as jest.MockedFunction<typeof currentPosition>;
const mockCountry = countryFor as jest.MockedFunction<typeof countryFor>;
const mockAddressCountry = countryForAddress as jest.MockedFunction<typeof countryForAddress>;
const mockFocusEffect = useFocusEffect as jest.MockedFunction<typeof useFocusEffect>;
const mockUnits = useUnitSystem as jest.MockedFunction<typeof useUnitSystem>;

const styles = makeStyles('light');

const pin = { latitude: 43.06, longitude: 16.18 };
// The dive's entry as a new site inherits it — a set of its one way in (#31, `siteFactsFrom`).
const diveAt: DiveContext = { pin, entry: ['boat'], salinity: 'salt', waterBody: 'ocean', siteId: null, diveId: null };
const noDive: DiveContext = { pin: null, entry: [], salinity: null, waterBody: null, siteId: null, diveId: null };

/** One of §2.3's near-matches as `findSiteTwins` answers it — no country and no position unless told. */
const twin = (value: string, id: string, over: Partial<SiteTwin> = {}): SiteTwin => ({
  value,
  id,
  country: null,
  point: null,
  relation: { kind: 'similar' },
  ...over,
});

/** The same, for a match whose name IS the name typed (§2.3's exact device match). */
const sameName = (value: string, id: string): SiteTwin => twin(value, id, { relation: { kind: 'sameName' } });

const request = (over: Partial<PlacePickRequest> = {}): PlacePickRequest => ({
  kind: 'site',
  selected: null,
  dive: noDive,
  onPick: jest.fn(),
  ...over,
});

/** A promise the test settles by hand — a check, a write or a fix held in flight. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.mockReturnValue({ token: 'tok', name: 'Lom Leštinka' });
  mockUseAuthSession.mockReturnValue({ session: null, resolved: true });
  mockRequest.mockReturnValue(request());
  mockTwins.mockResolvedValue([]);
  mockAddSite.mockResolvedValue('new-id');
  mockAddCenter.mockResolvedValue('new-centre-id');
  mockCountry.mockResolvedValue(null);
  mockAddressCountry.mockResolvedValue(null);
  mockUnits.mockReturnValue('metric');
});

// --- Reading what was drawn ---------------------------------------------------------------------

type Node = NonNullable<RenderResult['root']>;

function allNodes(t: RenderResult): Node[] {
  return t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
}

function stylesOf(node: Node): unknown[] {
  return [node.props?.style].flat(Infinity);
}

/** Every string under a node, in reading order — so a nested `Text` reads as one line. */
function textOf(node: Node): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

function textIn(t: RenderResult): string[] {
  return allNodes(t)
    .filter((n) => n.type === 'Text')
    .map(textOf);
}

const count = (t: RenderResult, text: string) => textIn(t).filter((line) => line === text).length;

function labelled(t: RenderResult, label: string): Node {
  const node = allNodes(t).find((n) => n.props?.accessibilityLabel === label);
  if (node === undefined) throw new Error(`the page rendered nothing labelled ${label}`);
  return node;
}

const has = (t: RenderResult, label: string) => allNodes(t).some((n) => n.props?.accessibilityLabel === label);

/** The symbols drawn inside a node (a real `SymbolView` resolves to `SymbolModule`). */
function symbolsIn(node: Node): unknown[] {
  return node.queryAll((c) => typeof c.type === 'string' && c.type.includes('SymbolModule')).map((c) => c.props.name);
}

/**
 * The `onPress` a node was rendered with, read off its fiber the way `fireEvent` itself finds it. A
 * test calls it to deliver taps from ONE render — two before the first one's re-render could disable
 * the control, as a real double tap can — or to tap a control `fireEvent` would refuse as disabled,
 * so it is the handler's own guard being tested and not only the `disabled` prop.
 */
function onPressOf(node: Node): () => void {
  type Fiber = { memoizedProps?: { onPress?: unknown } | null; return: Fiber | null };
  let fiber = (node as unknown as { unstable_fiber?: Fiber }).unstable_fiber ?? null;
  for (; fiber !== null; fiber = fiber.return) {
    const onPress = fiber.memoizedProps?.onPress;
    if (typeof onPress === 'function') return onPress as () => void;
  }
  throw new Error('nothing above this node handles a press');
}

/** The value a read-only row draws beside its label (the *Country* row). */
function rowValue(t: RenderResult, label: string): string | undefined {
  const row = allNodes(t).find(
    (n) =>
      typeof n.type === 'string' &&
      stylesOf(n).includes(styles.formFieldRow) &&
      n.queryAll((c) => c.type === 'Text').some((c) => textOf(c) === label),
  );
  const texts = row?.queryAll((c) => c.type === 'Text').map(textOf) ?? [];
  return texts.find((text) => text !== label);
}

const showSite = () => render(<NewPlaceScreen kind="site" />);
const showCenter = () => render(<NewPlaceScreen kind="center" />);

const saveButton = (t: RenderResult, label = 'Save site') => labelled(t, label);

async function press(t: RenderResult, label: string) {
  await fireEvent.press(labelled(t, label));
}

async function type(t: RenderResult, label: string, text: string) {
  await fireEvent.changeText(labelled(t, label), text);
}

/** Opens a closed group by its header, as a diver does (`FormGroup` says *Expand …* while shut). */
async function expand(t: RenderResult, title: string) {
  await press(t, `Expand ${title}`);
}

/** Every input labelled `label`, in reading order — the *Other name* rows share one label. */
function inputsLabelled(t: RenderResult, label: string): Node[] {
  return allNodes(t).filter((n) => n.type === 'TextInput' && n.props?.accessibilityLabel === label);
}

const otherNames = (t: RenderResult): string[] => inputsLabelled(t, 'Other name').map((n) => n.props.value);

async function typeOtherName(t: RenderResult, index: number, text: string) {
  const row = inputsLabelled(t, 'Other name')[index];
  if (row === undefined) throw new Error(`the page has no other-name row ${index}`);
  await fireEvent.changeText(row, text);
}

/** Every #31 fact as `addSite` / `addCenter` is handed it when the page left it blank — `null`, or
 * an empty set. */
const NO_SITE_DETAILS = {
  description: null,
  siteTypes: [],
  suitableFor: null,
  maxDepthM: null,
  altitudeM: null,
  wreckName: null,
  wreckSunkYear: null,
  altNames: [],
};
const NO_CENTRE_DETAILS = {
  address: null,
  phone: null,
  email: null,
  openingHours: null,
  description: null,
  services: [],
  agencies: [],
};

// --- Opening ------------------------------------------------------------------------------------

it('prefills the typed name, the dive’s pin, salinity, water body and entry', async () => {
  mockRequest.mockReturnValue(request({ dive: diveAt }));
  mockCountry.mockResolvedValue('HR');
  const t = await showSite();

  expect(textIn(t)).toContain('New dive site');
  expect(textIn(t)).toContain('the name is the only thing required');
  expect(labelled(t, 'Name').props.value).toBe('Lom Leštinka');
  // A capital on the first letter only — most languages do not title-case a place's name.
  expect(labelled(t, 'Name').props.autoCapitalize).toBe('sentences');
  // The dive's own pin, and the country it answers to.
  expect(textIn(t)).toContain('43.06000, 16.18000');
  expect(mockCountry).toHaveBeenCalledWith(43.06, 16.18);
  expect(rowValue(t, 'Country')).toBe('HR');
  // The water and the entry, as the dive has them — each one marked as the dive's, and the pin too.
  expect(labelled(t, 'Salinity: Salt').props.accessibilityState).toMatchObject({ selected: true });
  expect(labelled(t, 'Water body: Ocean').props.accessibilityState).toMatchObject({ selected: true });
  expect(labelled(t, 'Entry: Boat').props.accessibilityState).toMatchObject({ checked: true });
  expect(count(t, 'from this dive')).toBe(4);
  // Never the phone's position unasked (the spec's anti-goal).
  expect(mockPosition).not.toHaveBeenCalled();

  // A chip the diver changes is no longer the dive's.
  await press(t, 'Salinity: Fresh');
  expect(labelled(t, 'Salinity: Fresh').props.accessibilityState).toMatchObject({ selected: true });
  expect(count(t, 'from this dive')).toBe(3);
});

it('a centre’s position starts empty even when the dive has a pin', async () => {
  mockRequest.mockReturnValue(request({ kind: 'center', dive: diveAt }));
  const t = await showCenter();
  expect(textIn(t)).toContain('New dive centre');
  expect(textIn(t)).not.toContain('43.06000, 16.18000');
  expect(textIn(t)).toContain('asks the phone where you are');
  expect(rowValue(t, 'Country')).toBe('—');
  expect(mockCountry).not.toHaveBeenCalled();
  // A centre inherits its name alone: no water, no entry; a website instead, under *Contact*.
  expect(has(t, 'Salinity: Salt')).toBe(false);
  expect(textIn(t)).not.toContain('from this dive');
  await expand(t, 'Contact');
  const website = labelled(t, 'Website');
  expect(website.props.placeholder).toBe('optional');
  // An address, not prose: the URL keyboard and AutoFill hint, and no capital on the first letter.
  expect(website.props).toMatchObject({ keyboardType: 'url', textContentType: 'URL', autoCapitalize: 'none' });
  expect(has(t, 'Save centre')).toBe(true);
});

// --- Position -----------------------------------------------------------------------------------

it('Use current position asks the device and shows the coordinates', async () => {
  const located = deferred<PositionOutcome>();
  mockPosition.mockReturnValue(located.promise);
  mockCountry.mockResolvedValue('CZ');
  const t = await showSite();
  expect(textIn(t)).toContain('asks the phone where you are');
  expect(rowValue(t, 'Country')).toBe('—');

  await press(t, 'Use current position');
  expect(textIn(t)).toContain('Locating…');
  expect(mockPosition).toHaveBeenCalledTimes(1);

  await act(async () => located.resolve({ found: true, latitude: 50.1, longitude: 14.4 }));
  expect(textIn(t)).toContain('50.10000, 14.40000');
  // The phone's position, asked for — not the dive's.
  expect(textIn(t)).not.toContain('from this dive');
  expect(mockCountry).toHaveBeenCalledWith(50.1, 14.4);
  expect(rowValue(t, 'Country')).toBe('CZ');
});

it('a site prefilled with the dive’s pin takes the phone’s once asked, and saves that', async () => {
  mockRequest.mockReturnValue(request({ dive: diveAt }));
  mockPosition.mockResolvedValue({ found: true, latitude: 50.1, longitude: 14.4 });
  const t = await showSite();
  expect(count(t, 'from this dive')).toBe(4);
  await press(t, 'Use current position');
  expect(textIn(t)).toContain('50.10000, 14.40000');
  expect(textIn(t)).not.toContain('43.06000, 16.18000');
  // The position's caption goes; the three chips are still the dive's.
  expect(count(t, 'from this dive')).toBe(3);
  await press(t, 'Save site');
  expect(mockTwins).toHaveBeenCalledWith('Lom Leštinka', [], { latitude: 50.1, longitude: 14.4 });
  // The country handed on is the phone's position's, never the dive pin's it replaced.
  expect(mockAddSite).toHaveBeenCalledWith(expect.objectContaining({ latitude: 50.1, longitude: 14.4 }), {
    latitude: 50.1,
    longitude: 14.4,
    country: null,
  });
});

// `currentPosition` can take its full 20 s. A Save pressed meanwhile would write the row without the
// position the diver asked for, so Save waits for the answer.
it('Save is shut while Locating…, and saves the fix once it lands', async () => {
  const located = deferred<PositionOutcome>();
  mockPosition.mockReturnValue(located.promise);
  const t = await showSite();
  await press(t, 'Use current position');
  expect(saveButton(t).props.accessibilityState).toMatchObject({ disabled: true });
  await act(async () => onPressOf(saveButton(t))());
  expect(mockTwins).not.toHaveBeenCalled();
  expect(mockAddSite).not.toHaveBeenCalled();

  await act(async () => located.resolve({ found: true, latitude: 50.1, longitude: 14.4 }));
  expect(saveButton(t).props.accessibilityState).toMatchObject({ disabled: false });
  await press(t, 'Save site');
  expect(mockAddSite).toHaveBeenCalledWith(
    expect.objectContaining({ latitude: 50.1, longitude: 14.4 }),
    { latitude: 50.1, longitude: 14.4, country: null },
  );
});

// The server's check was asked around the old position, so a new one is a new question.
it('a new position forgets the question', async () => {
  mockTwins.mockResolvedValue([twin('Lom Leština', 's-twin')]);
  mockPosition.mockResolvedValue({ found: true, latitude: 50.1, longitude: 14.4 });
  const t = await showSite();
  await press(t, 'Save site');
  expect(textIn(t)).toContain('Did you mean “Lom Leština”?');

  await press(t, 'Use current position');
  expect(textIn(t)).not.toContain('Did you mean “Lom Leština”?');
  expect(has(t, 'Save site')).toBe(true);
  mockTwins.mockResolvedValue([]);
  await press(t, 'Save site');
  expect(mockTwins).toHaveBeenCalledTimes(2);
  expect(mockTwins).toHaveBeenLastCalledWith('Lom Leštinka', [], { latitude: 50.1, longitude: 14.4 });
  expect(mockAddSite).toHaveBeenCalledTimes(1);
});

it('Use current position pressed twice at once asks the device once', async () => {
  const located = deferred<PositionOutcome>();
  mockPosition.mockReturnValue(located.promise);
  const t = await showSite();
  const locate = onPressOf(labelled(t, 'Use current position'));
  await act(async () => {
    locate();
    locate();
  });
  expect(mockPosition).toHaveBeenCalledTimes(1);
  await act(async () => located.resolve({ found: true, latitude: 50.1, longitude: 14.4 }));
  expect(mockPosition).toHaveBeenCalledTimes(1);
});

it.each([
  ['servicesOff', 'Location Services are off for this device. Turn them on to pin a dive.'],
  ['denied', 'Ponor is not allowed to use your location. Allow it in the device’s Settings, then tap again.'],
  ['timedOut', 'That took too long. Try again where there is more sky.'],
  [
    'imprecise',
    'That fix was only good to about 100 m — too rough to pin a dive site. Try again where there is more sky.',
  ],
  ['failed', 'Could not get a location fix. Try again in a moment.'],
] as const)('a refusal (%s) shows the GPS row’s sentence and keeps the position empty', async (reason, sentence) => {
  mockPosition.mockResolvedValue({ found: false, reason });
  const t = await showSite();
  await press(t, 'Use current position');
  expect(textIn(t)).toContain(sentence);
  expect(textIn(t)).toContain('asks the phone where you are');
  expect(mockCountry).not.toHaveBeenCalled();
});

// --- Who is creating ----------------------------------------------------------------------------

it('the guest line shows only for a guest', async () => {
  const guestLine = 'Kept on this phone. It joins the community map when you sign in.';
  const guest = await showSite();
  expect(textIn(guest)).toContain(guestLine);
  await cleanup();

  mockUseAuthSession.mockReturnValue({ session: { user: { id: 'me' } } as never, resolved: true });
  const diver = await showSite();
  expect(textIn(diver)).not.toContain(guestLine);
});

// --- Saving a site ------------------------------------------------------------------------------

it('Save with no near match creates the site and returns its id and name to the form, closing both pages', async () => {
  mockRequest.mockReturnValue(request({ dive: diveAt }));
  const t = await showSite();
  await press(t, 'Save site');
  expect(mockTwins).toHaveBeenCalledWith('Lom Leštinka', [], pin);
  expect(mockAddSite).toHaveBeenCalledWith(
    {
      name: 'Lom Leštinka',
      latitude: 43.06,
      longitude: 16.18,
      entry: ['boat'],
      salinity: 'salt',
      waterBody: 'ocean',
      ...NO_SITE_DETAILS,
    },
    // The *Country* row's answer for this very pin (`—`, here), so Save asks the geocoder nothing.
    { ...pin, country: null },
  );
  expect(mockComplete).toHaveBeenCalledWith('tok', { id: 'new-id', name: 'Lom Leštinka' }, 2);
  expect(router.back).not.toHaveBeenCalled();
});

it('saves the name as trimmed, and a site with no position and no water as nulls', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Kotelna' });
  const t = await showSite();
  await type(t, 'Name', '  Nová Kotelna  ');
  await press(t, 'Save site');
  expect(mockTwins).toHaveBeenCalledWith('Nová Kotelna', [], null);
  expect(mockAddSite).toHaveBeenCalledWith(
    {
      name: 'Nová Kotelna',
      latitude: null,
      longitude: null,
      entry: [],
      salinity: null,
      waterBody: null,
      ...NO_SITE_DETAILS,
    },
    // No position, so nothing was looked up and nothing is handed over.
    undefined,
  );
  expect(mockComplete).toHaveBeenCalledWith('tok', { id: 'new-id', name: 'Nová Kotelna' }, 2);
});

it('Save is disabled while the name is blank', async () => {
  const t = await showSite();
  await type(t, 'Name', '   ');
  expect(saveButton(t).props.accessibilityState).toMatchObject({ disabled: true });
  await act(async () => onPressOf(saveButton(t))());
  expect(mockTwins).not.toHaveBeenCalled();
  expect(mockAddSite).not.toHaveBeenCalled();
});

it('a near match is asked first; the second press creates anyway', async () => {
  mockTwins.mockResolvedValue([twin('Lom Leština', 's-twin')]);
  const t = await showSite();
  await press(t, 'Save site');
  expect(textIn(t)).toContain('Did you mean “Lom Leština”?');
  expect(mockAddSite).not.toHaveBeenCalled();
  expect(mockComplete).not.toHaveBeenCalled();

  await press(t, 'Save as a new site anyway');
  expect(mockTwins).toHaveBeenCalledTimes(1);
  expect(mockAddSite).toHaveBeenCalledTimes(1);
  expect(mockComplete).toHaveBeenCalledWith('tok', { id: 'new-id', name: 'Lom Leštinka' }, 2);
});

// How a match relates is `findSiteTwins`' answer (`twinRelation`), and the page words it: it folds
// no name itself.
it('an exact device match gets its own sentence, not a question', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'lom lestinka' });
  mockTwins.mockResolvedValue([sameName('Lom Leštinka', 's-twin')]);
  const t = await showSite();
  await press(t, 'Save site');
  expect(textIn(t)).toContain('“Lom Leštinka” is already a site.');
  expect(textIn(t).join(' ')).not.toContain('Did you mean');
  expect(has(t, 'Save as a new site anyway')).toBe(true);
});

// #31's third sentence: a match on another name is neither a guess nor the same name. Here the
// issue's own case — *Stone Gate*, typed with *Kamena vrata* beside it, meets an existing
// *Kamena vrata* — and a tap opens that site, as any match's does.
it('says “Kamena vrata” is another name for Stone Gate', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Stone Gate' });
  mockTwins.mockResolvedValue([
    twin('Kamena vrata', 's-kamena', { relation: { kind: 'otherName', alias: 'Kamena vrata', name: 'Stone Gate' } }),
  ]);
  const t = await showSite();
  await press(t, 'Save site');
  expect(textIn(t)).toContain('“Kamena vrata” is another name for Stone Gate.');
  expect(textIn(t).join(' ')).not.toContain('Did you mean');
  expect(textIn(t).join(' ')).not.toContain('is already a site');
  expect(has(t, 'Save as a new site anyway')).toBe(true);
  await press(t, '“Kamena vrata” is another name for Stone Gate.');
  expect(router.push).toHaveBeenCalledWith({ pathname: '/site/[id]', params: { id: 's-kamena', pick: 'tok' } });
});

// The question is asked about the row Save would write: its other names clean (`cleanAltNames`) —
// no blank, no repeat, nothing that is the name itself — exactly as they are then saved.
it('asks with the other names it will save', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Stone Gate' });
  const t = await showSite();
  await expand(t, 'Other names');
  for (const [index, other] of [' Kamena vrata ', 'stone gate', 'Kamená Vrata'].entries()) {
    await typeOtherName(t, index, other);
    await press(t, 'Add another name');
  }
  await press(t, 'Save site');
  expect(mockTwins).toHaveBeenCalledWith('Stone Gate', ['Kamena vrata'], null);
  expect(mockAddSite).toHaveBeenCalledWith(expect.objectContaining({ altNames: ['Kamena vrata'] }), undefined);
});

// The server's half was asked with the other names that were on the page, so changing one is a new
// question, as a new name or a new position is.
it('forgets a standing question when an other name changes', async () => {
  mockTwins.mockResolvedValue([twin('Lom Leština', 's-twin')]);
  const t = await showSite();
  await press(t, 'Save site');
  expect(textIn(t)).toContain('Did you mean “Lom Leština”?');

  await expand(t, 'Other names');
  await typeOtherName(t, 0, 'Lom pod Leštinou');
  expect(textIn(t)).not.toContain('Did you mean “Lom Leština”?');
  expect(has(t, 'Save site')).toBe(true);
  mockTwins.mockResolvedValue([]);
  await press(t, 'Save site');
  expect(mockTwins).toHaveBeenCalledTimes(2);
  expect(mockTwins).toHaveBeenLastCalledWith('Lom Leštinka', ['Lom pod Leštinou'], null);
  expect(mockAddSite).toHaveBeenCalledTimes(1);
});

// Owner's call on PR #35: a diver checks a match is really the same place before using it, so a tap
// opens the site's own page — carrying the form's token, for its *Use this site* — and picks nothing.
it('tapping a match opens that site’s page with the pick token, and picks nothing', async () => {
  mockTwins.mockResolvedValue([sameName('Lom Leštinka', 's-same'), twin('Lom Leština', 's-twin')]);
  const t = await showSite();
  await press(t, 'Save site');
  await press(t, 'Did you mean “Lom Leština”?');
  expect(router.push).toHaveBeenCalledWith({ pathname: '/site/[id]', params: { id: 's-twin', pick: 'tok' } });
  expect(mockComplete).not.toHaveBeenCalled();
  expect(mockAddSite).not.toHaveBeenCalled();
  // One way off while that page opens: a second tap, on the other match, on Save or on Back, does
  // nothing more.
  await press(t, '“Lom Leštinka” is already a site.');
  await act(async () => onPressOf(labelled(t, 'Save as a new site anyway'))());
  await press(t, 'Go back');
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.back).not.toHaveBeenCalled();
  expect(mockAddSite).not.toHaveBeenCalled();
});

// `‹ Back` on the match's page returns here exactly as it was left — the name, the chips, the
// position and the question still standing — and the page is usable again.
it('comes back from a match’s page as it was left, and can open another or save anyway', async () => {
  mockRequest.mockReturnValue(request({ dive: diveAt }));
  mockTwins.mockResolvedValue([sameName('Lom Leštinka', 's-same'), twin('Lom Leština', 's-twin')]);
  const t = await showSite();
  await press(t, 'Salinity: Fresh');
  await press(t, 'Save site');
  await press(t, 'Did you mean “Lom Leština”?');
  const focused = mockFocusEffect.mock.calls[mockFocusEffect.mock.calls.length - 1]?.[0];
  expect(focused).toBeDefined();
  await act(async () => {
    focused?.();
  });
  expect(labelled(t, 'Name').props.value).toBe('Lom Leštinka');
  expect(labelled(t, 'Salinity: Fresh').props.accessibilityState).toMatchObject({ selected: true });
  expect(textIn(t)).toContain('43.06000, 16.18000');
  expect(textIn(t)).toContain('Did you mean “Lom Leština”?');
  await press(t, '“Lom Leštinka” is already a site.');
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/site/[id]', params: { id: 's-same', pick: 'tok' } });
  await act(async () => {
    focused?.();
  });
  await press(t, 'Save as a new site anyway');
  expect(mockAddSite).toHaveBeenCalledTimes(1);
  expect(mockComplete).toHaveBeenCalledWith('tok', { id: 'new-id', name: 'Lom Leštinka' }, 2);
});

// The owner's call on PR #35: the match's country and how far it is from the position on the page,
// so a diver can judge it before opening it — and no chevron, though a tap opens a page: §0.6 spends
// the chevron on in-place disclosure and never on navigation, and #5 decides how a row says it can
// be pressed.
it('words a match with its country and its distance from the position on the page, and draws no chevron', async () => {
  mockRequest.mockReturnValue(request({ dive: diveAt }));
  // 0.0011° of latitude north of the dive's pin: about 122 m, read to the nearest ten.
  mockTwins.mockResolvedValue([
    twin('Lom Leština', 's-twin', { country: 'HR', point: { latitude: 43.0611, longitude: 16.18 } }),
  ]);
  const t = await showSite();
  await press(t, 'Save site');
  expect(textIn(t)).toContain('HR · 120 m away');
  expect(labelled(t, 'Did you mean “Lom Leština”?').props.accessibilityHint).toBe('HR · 120 m away');
  expect(symbolsIn(labelled(t, 'Did you mean “Lom Leština”?'))).toEqual([]);
});

it('leaves out the distance when either place has no position, and the line when nothing is known', async () => {
  mockTwins.mockResolvedValue([
    twin('Lom Leština', 's-twin', { country: 'HR', point: { latitude: 43.0611, longitude: 16.18 } }),
    sameName('Lom Leštinka', 's-same'),
  ]);
  // No position on the page: the dive has no pin.
  const t = await showSite();
  await press(t, 'Save site');
  expect(textIn(t)).toContain('HR');
  expect(textIn(t).join(' ')).not.toContain('away');
  // The second match knows neither, so it is the sentence alone.
  const same = labelled(t, '“Lom Leštinka” is already a site.');
  expect(same.props.accessibilityHint).toBeUndefined();
  expect(same.queryAll((n) => n.type === 'Text').map(textOf)).toEqual(['“Lom Leštinka” is already a site.']);
});

it('editing the name forgets the question', async () => {
  mockTwins.mockResolvedValue([twin('Lom Leština', 's-twin')]);
  const t = await showSite();
  await press(t, 'Save site');
  expect(textIn(t)).toContain('Did you mean “Lom Leština”?');

  await type(t, 'Name', 'Lom Leštinka II');
  expect(textIn(t)).not.toContain('Did you mean “Lom Leština”?');
  expect(has(t, 'Save site')).toBe(true);
  // The next press is about a new name, so it is checked again rather than created.
  mockTwins.mockResolvedValue([]);
  await press(t, 'Save site');
  expect(mockTwins).toHaveBeenCalledTimes(2);
  expect(mockTwins).toHaveBeenLastCalledWith('Lom Leštinka II', [], null);
  expect(mockComplete).toHaveBeenCalledWith('tok', { id: 'new-id', name: 'Lom Leštinka II' }, 2);
});

// What is written is what is on screen: from Save until a question or a failure hands them back,
// the name and the chips cannot change underneath the check or the write.
it('holds the name and the chips still while the check is out', async () => {
  const checked = deferred<SiteTwin[]>();
  mockTwins.mockReturnValue(checked.promise);
  mockRequest.mockReturnValue(request({ dive: diveAt }));
  const t = await showSite();
  await press(t, 'Save site');
  expect(labelled(t, 'Name').props.editable).toBe(false);
  expect(labelled(t, 'Salinity: Fresh').props.accessibilityState).toMatchObject({ disabled: true });
  await type(t, 'Name', 'Lom Leštinka II');
  await press(t, 'Salinity: Fresh');
  expect(labelled(t, 'Name').props.value).toBe('Lom Leštinka');
  expect(labelled(t, 'Salinity: Salt').props.accessibilityState).toMatchObject({ selected: true });

  await act(async () => checked.resolve([twin('Lom Leština', 's-twin')]));
  // The question hands them back.
  expect(labelled(t, 'Name').props.editable).not.toBe(false);
  expect(labelled(t, 'Salinity: Fresh').props.accessibilityState).not.toMatchObject({ disabled: true });
});

it('a failed write shows the failed line and does not complete', async () => {
  const failedLine = "Couldn't save that just now. Nothing on the dive has changed.";
  mockAddSite.mockRejectedValueOnce(new Error('disk full'));
  const t = await showSite();
  await press(t, 'Save site');
  expect(textIn(t)).toContain(failedLine);
  expect(mockComplete).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
  // The button comes back, and a retry goes through.
  expect(saveButton(t).props.accessibilityState).toMatchObject({ disabled: false });
  await press(t, 'Save site');
  expect(mockComplete).toHaveBeenCalledWith('tok', { id: 'new-id', name: 'Lom Leštinka' }, 2);
  expect(textIn(t)).not.toContain(failedLine);
});

// Review Focus 1: both presses land before the page re-renders, so `disabled` cannot be what stops
// the second — they are delivered from the same render, as a real double tap can be.
it('Save pressed twice while saving creates one row', async () => {
  const checked = deferred<SiteTwin[]>();
  const written = deferred<string>();
  mockTwins.mockReturnValue(checked.promise);
  mockAddSite.mockReturnValue(written.promise);
  const t = await showSite();
  const save = onPressOf(saveButton(t));
  await act(async () => {
    save();
    save();
  });
  expect(mockTwins).toHaveBeenCalledTimes(1);
  expect(labelled(t, 'Saving…').props.accessibilityState).toMatchObject({ disabled: true });

  await act(async () => checked.resolve([]));
  await act(async () => onPressOf(labelled(t, 'Saving…'))());
  expect(mockAddSite).toHaveBeenCalledTimes(1);

  await act(async () => written.resolve('new-id'));
  // And once it has gone through, the page is on its way out: nothing makes a second row.
  await act(async () => onPressOf(labelled(t, 'Saving…'))());
  expect(mockTwins).toHaveBeenCalledTimes(1);
  expect(mockAddSite).toHaveBeenCalledTimes(1);
  expect(mockComplete).toHaveBeenCalledTimes(1);
});

// Review Focus 2. Under React 19 a state update after unmount is a silent no-op, so what this pins is
// the outcome — nothing written, nothing delivered, nothing logged — rather than the guard itself.
it('closing the page while the check is out delivers nothing', async () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const checked = deferred<SiteTwin[]>();
  mockTwins.mockReturnValue(checked.promise);
  const t = await showSite();
  await press(t, 'Save site');
  await t.unmount();
  await act(async () => checked.resolve([]));
  expect(mockAddSite).not.toHaveBeenCalled();
  expect(mockComplete).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

it('closing the page while the write is out keeps the row and delivers nothing', async () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const written = deferred<string>();
  mockAddSite.mockReturnValue(written.promise);
  const t = await showSite();
  await press(t, 'Save site');
  expect(mockAddSite).toHaveBeenCalledTimes(1);
  await t.unmount();
  await act(async () => written.resolve('new-id'));
  expect(mockComplete).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

// `‹ Back` while the write is out: the page is already leaving, so the write landing a moment later
// must not also complete — a `dismiss(2)` after the pop would close the dive form itself.
it('‹ Back goes back once, and a write landing after it delivers nothing', async () => {
  const written = deferred<string>();
  mockAddSite.mockReturnValue(written.promise);
  const t = await showSite();
  await press(t, 'Save site');
  await press(t, 'Go back');
  await press(t, 'Go back');
  expect(router.back).toHaveBeenCalledTimes(1);
  await act(async () => written.resolve('new-id'));
  expect(mockComplete).not.toHaveBeenCalled();
});

it('‹ Back while the check is out writes nothing', async () => {
  const checked = deferred<SiteTwin[]>();
  mockTwins.mockReturnValue(checked.promise);
  const t = await showSite();
  await press(t, 'Save site');
  await press(t, 'Go back');
  await act(async () => checked.resolve([]));
  expect(mockAddSite).not.toHaveBeenCalled();
  expect(mockComplete).not.toHaveBeenCalled();
  expect(router.back).toHaveBeenCalledTimes(1);
});

// The diver answered the question with *anyway*; a match tapped while that write is out would pair
// the dive with the old site and then be overwritten by the new row.
it('a match is inert while the write it was answered with is out', async () => {
  const written = deferred<string>();
  mockTwins.mockResolvedValue([twin('Lom Leština', 's-twin')]);
  mockAddSite.mockReturnValue(written.promise);
  const t = await showSite();
  await press(t, 'Save site');
  await press(t, 'Save as a new site anyway');
  await act(async () => onPressOf(labelled(t, 'Did you mean “Lom Leština”?'))());
  expect(mockComplete).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
  await act(async () => written.resolve('new-id'));
  expect(mockComplete).toHaveBeenCalledTimes(1);
  expect(mockComplete).toHaveBeenCalledWith('tok', { id: 'new-id', name: 'Lom Leštinka' }, 2);
});

// Review Focus 3: the registry lost the request (a JS reload under the open pages).
it('a token the registry no longer knows still creates, and just goes back', async () => {
  mockRequest.mockReturnValue(null);
  const t = await showSite();
  await press(t, 'Save site');
  expect(mockAddSite).toHaveBeenCalledTimes(1);
  expect(mockComplete).not.toHaveBeenCalled();
  expect(router.back).toHaveBeenCalledTimes(1);
});

// --- Saving a centre ----------------------------------------------------------------------------

it('a centre saves straight away with its website and no check', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Ponorka' });
  mockRequest.mockReturnValue(request({ kind: 'center', dive: diveAt }));
  const t = await showCenter();
  await expand(t, 'Contact');
  await type(t, 'Website', '  https://ponorka.example  ');
  await press(t, 'Save centre');
  expect(mockTwins).not.toHaveBeenCalled();
  expect(mockAddSite).not.toHaveBeenCalled();
  expect(mockAddCenter).toHaveBeenCalledWith(
    {
      name: 'Ponorka',
      latitude: null,
      longitude: null,
      website: 'https://ponorka.example',
      ...NO_CENTRE_DETAILS,
    },
    undefined,
    undefined,
  );
  expect(mockComplete).toHaveBeenCalledWith('tok', { id: 'new-centre-id', name: 'Ponorka' }, 2);
});

it('holds a centre’s website still while the write is out', async () => {
  const written = deferred<string>();
  mockAddCenter.mockReturnValue(written.promise);
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const t = await showCenter();
  await expand(t, 'Contact');
  await press(t, 'Save centre');
  expect(labelled(t, 'Website').props.editable).toBe(false);
  expect(labelled(t, 'Name').props.editable).toBe(false);
  await act(async () => written.resolve('new-centre-id'));
});

it('a centre with a position and no website saves both halves of the pin and a null website', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Ponorka' });
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  mockPosition.mockResolvedValue({ found: true, latitude: 43.1, longitude: 16.2 });
  const t = await showCenter();
  await press(t, 'Use current position');
  await press(t, 'Save centre');
  expect(mockAddCenter).toHaveBeenCalledWith(
    { name: 'Ponorka', latitude: 43.1, longitude: 16.2, website: null, ...NO_CENTRE_DETAILS },
    { latitude: 43.1, longitude: 16.2, country: null },
    undefined,
  );
});

// --- What else a place says (issue #31) -----------------------------------------------------------

// The canvas's round 3: the description is what a diver opens a place to learn, so it is an
// ordinary field straight under the name — and public, which the row says.
it('puts the description straight under the name, saying everyone can read it', async () => {
  const t = await showSite();
  const lines = textIn(t);
  const at = lines.indexOf('Name');
  expect(lines.slice(at, at + 4)).toEqual(['Name', 'Description', 'everyone can read it', 'Position']);
  expect(lines.indexOf('Use current position')).toBeGreaterThan(at);
  const description = labelled(t, 'Description');
  expect(description.props).toMatchObject({ placeholder: 'optional', multiline: true, autoCapitalize: 'sentences' });
  // No cap on what it holds.
  expect(description.props.maxLength).toBeUndefined();
});

it('puts a centre’s address under its name, and the description under the address', async () => {
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const t = await showCenter();
  const lines = textIn(t);
  const at = lines.indexOf('Name');
  expect(lines.slice(at, at + 5)).toEqual(['Name', 'Address', 'Description', 'everyone can read it', 'Position']);
  // Never corrected: a street the keyboard does not know is still the street.
  expect(labelled(t, 'Address').props).toMatchObject({ autoCapitalize: 'words', autoCorrect: false, placeholder: 'optional' });
});

it('puts the country under the position card', async () => {
  mockRequest.mockReturnValue(request({ dive: diveAt }));
  const site = textIn(await showSite());
  // Under the card's coordinates, and above the group the dive's water and entry opened.
  expect(site.indexOf('Country')).toBeGreaterThan(site.indexOf('43.06000, 16.18000'));
  expect(site.indexOf('Country')).toBeLessThan(site.indexOf('The site'));
  expect(site.indexOf('The site')).toBeLessThan(site.indexOf('Salinity'));
  await cleanup();

  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const centre = textIn(await showCenter());
  expect(centre.indexOf('Country')).toBeGreaterThan(centre.indexOf('Use current position'));
  expect(centre.indexOf('Country')).toBeLessThan(centre.indexOf('Contact'));
});

// §2.2 on this page: no data, closed; data carried, open. A site made from a dive holds the dive's
// water and entry, so *The site* opens on them, each still marked as the dive's.
it('opens The site when the dive handed it a value, with the dive’s marks', async () => {
  mockRequest.mockReturnValue(request({ dive: diveAt }));
  const t = await showSite();
  expect(labelled(t, 'Collapse The site').props.accessibilityState).toMatchObject({ expanded: true });
  expect(textIn(t)).not.toContain('water, entry, type, depth');
  expect(labelled(t, 'Salinity: Salt').props.accessibilityState).toMatchObject({ selected: true });
  expect(labelled(t, 'Water body: Ocean').props.accessibilityState).toMatchObject({ selected: true });
  expect(labelled(t, 'Entry: Boat').props.accessibilityState).toMatchObject({ checked: true });
  expect(count(t, 'from this dive')).toBe(4);
  // *Other names* holds nothing, so it stays shut.
  expect(labelled(t, 'Expand Other names').props.accessibilityState).toMatchObject({ expanded: false });

  // Closed again, the group still saves what it holds.
  await press(t, 'Collapse The site');
  expect(has(t, 'Salinity: Salt')).toBe(false);
  await press(t, 'Save site');
  expect(mockAddSite).toHaveBeenCalledWith(expect.objectContaining({ salinity: 'salt', waterBody: 'ocean', entry: ['boat'] }), {
    ...pin,
    country: null,
  });
});

it('keeps a group closed while it holds nothing, saying what it holds', async () => {
  // The dive's pin alone opens nothing: the position stands above the groups, not in one.
  mockRequest.mockReturnValue(request({ dive: { ...noDive, pin } }));
  const site = await showSite();
  expect(labelled(site, 'Expand The site').props.accessibilityState).toMatchObject({ expanded: false });
  expect(textIn(site)).toContain('water, entry, type, depth');
  expect(textIn(site)).toContain('names it also goes by');
  expect(textIn(site)).not.toContain('Salinity');
  expect(has(site, 'Salinity: Salt')).toBe(false);
  expect(has(site, 'Other name')).toBe(false);
  // Opened, its fields say it instead.
  await expand(site, 'The site');
  expect(textIn(site)).not.toContain('water, entry, type, depth');
  expect(has(site, 'Salinity: Salt')).toBe(true);
  await cleanup();

  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const centre = await showCenter();
  expect(textIn(centre)).toContain('website, phone, email, hours');
  expect(textIn(centre)).toContain('services, agencies');
  expect(has(centre, 'Website')).toBe(false);
  expect(has(centre, 'Phone')).toBe(false);
  expect(has(centre, 'Services: Air')).toBe(false);
});

// The canvas rule (§0.6): an optional text field with no unit says `optional`, never a blank that
// looks like it forgot something; one with a unit shows the unit instead.
it('says optional on every optional text field of a site, and shows the unit on the depth', async () => {
  const t = await showSite();
  await expand(t, 'The site');
  await press(t, 'Site type: Wreck');
  await expand(t, 'Other names');
  expect(labelled(t, 'Wreck name').props.placeholder).toBe('optional');
  expect(labelled(t, 'Year sunk').props.placeholder).toBe('optional');
  expect(inputsLabelled(t, 'Other name').map((n) => n.props.placeholder)).toEqual(['optional']);
  expect(labelled(t, 'Site depth').props.placeholder).toBeUndefined();
  expect(labelled(t, 'Altitude').props.placeholder).toBeUndefined();
});

it('says optional on every optional text field of a centre', async () => {
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const t = await showCenter();
  await expand(t, 'Contact');
  for (const label of ['Website', 'Phone', 'Email', 'Opening hours']) {
    expect(labelled(t, label).props.placeholder).toBe('optional');
  }
});

it('asks the wreck’s name and year only while Wreck is a type', async () => {
  const t = await showSite();
  await expand(t, 'The site');
  expect(labelled(t, 'Site type: Wreck').props.accessibilityRole).toBe('checkbox');
  expect(has(t, 'Wreck name')).toBe(false);
  expect(has(t, 'Year sunk')).toBe(false);
  await press(t, 'Site type: Reef');
  expect(has(t, 'Wreck name')).toBe(false);

  await press(t, 'Site type: Wreck');
  expect(labelled(t, 'Wreck name').props).toMatchObject({ autoCorrect: false });
  const year = labelled(t, 'Year sunk');
  expect(year.props.keyboardType).toBe('number-pad');
  // A year is a figure: mono, as every figure on the form.
  expect(stylesOf(year)).toContain(styles.formFieldInputMono);
  await type(t, 'Wreck name', 'Teti');
  await type(t, 'Year sunk', '1930');

  await press(t, 'Site type: Wreck');
  expect(has(t, 'Wreck name')).toBe(false);
  expect(has(t, 'Year sunk')).toBe(false);
  // Kept while hidden, should Wreck be chosen again.
  await press(t, 'Site type: Wreck');
  expect(labelled(t, 'Wreck name').props.value).toBe('Teti');
  expect(labelled(t, 'Year sunk').props.value).toBe('1930');
});

// A site's entry is a set (#31): *the site offers what is possible; the dive logs which one was
// done*. The dive's one way in seeds it and is marked as the dive's until the set is changed; from
// then on the row says what kind of field it is, as *Site type* does.
it('takes every way into the site, starting from the dive’s', async () => {
  mockRequest.mockReturnValue(request({ dive: diveAt }));
  const t = await showSite();
  const boat = labelled(t, 'Entry: Boat');
  expect(boat.props.accessibilityRole).toBe('checkbox');
  expect(boat.props.accessibilityState).toMatchObject({ checked: true });
  expect(count(t, 'from this dive')).toBe(4);
  // *Site type*'s caption, and not yet the entry's: that one still says the set is the dive's.
  expect(count(t, 'any that apply')).toBe(1);

  await press(t, 'Entry: Shore');
  expect(labelled(t, 'Entry: Shore').props.accessibilityState).toMatchObject({ checked: true });
  expect(labelled(t, 'Entry: Boat').props.accessibilityState).toMatchObject({ checked: true });
  expect(count(t, 'from this dive')).toBe(3);
  expect(count(t, 'any that apply')).toBe(2);

  await press(t, 'Save site');
  // The vocabulary's order, whichever was pressed first.
  expect(mockAddSite).toHaveBeenCalledWith(expect.objectContaining({ entry: ['shore', 'boat'] }), {
    ...pin,
    country: null,
  });
});

it('says any that apply on the entry of a site no dive handed one, and saves none as an empty set', async () => {
  const t = await showSite();
  await expand(t, 'The site');
  expect(labelled(t, 'Entry: Shore').props.accessibilityState).toMatchObject({ checked: false });
  expect(count(t, 'any that apply')).toBe(2);
  expect(count(t, 'from this dive')).toBe(0);
  // Pressed and pressed again is nothing again, and a set, not a null.
  await press(t, 'Entry: Other');
  await press(t, 'Entry: Other');
  await press(t, 'Save site');
  expect(mockAddSite).toHaveBeenCalledWith(expect.objectContaining({ entry: [] }), undefined);
});

it('saves every new fact of a site', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Vrak Teti' });
  const t = await showSite();
  await type(t, 'Description', 'A steamer on the southern spur.');
  await expand(t, 'The site');
  await press(t, 'Site type: Wall');
  await press(t, 'Site type: Wreck');
  await press(t, 'Suitable for: Advanced');
  await type(t, 'Site depth', '34');
  await type(t, 'Wreck name', 'Teti');
  await type(t, 'Year sunk', '1930');
  await expand(t, 'Other names');
  await type(t, 'Other name', 'Teti wreck');
  await press(t, 'Save site');
  expect(mockAddSite).toHaveBeenCalledWith(
    {
      name: 'Vrak Teti',
      latitude: null,
      longitude: null,
      entry: [],
      salinity: null,
      waterBody: null,
      description: 'A steamer on the southern spur.',
      // The vocabulary's order, whichever was pressed first.
      siteTypes: ['wreck', 'wall'],
      suitableFor: 'advanced',
      maxDepthM: 34,
      altitudeM: null,
      wreckName: 'Teti',
      wreckSunkYear: 1930,
      altNames: ['Teti wreck'],
    },
    undefined,
  );
});

// Review Focus 5: SI is stored. An imperial diver's 100 published as 100 m would tell every diver
// the site is three times as deep as it is.
it('stores a site depth typed in feet as metres', async () => {
  mockUnits.mockReturnValue('imperial');
  const t = await showSite();
  await expand(t, 'The site');
  expect(rowValue(t, 'Site depth')).toBe('ft');
  expect(labelled(t, 'Site depth').props.keyboardType).toBe('decimal-pad');
  expect(stylesOf(labelled(t, 'Site depth'))).toContain(styles.formFieldInputMono);
  await type(t, 'Site depth', '100');
  await press(t, 'Save site');
  expect(mockAddSite.mock.calls[0]?.[0].maxDepthM).toBeCloseTo(30.48, 2);
});

// --- Altitude (#31) -----------------------------------------------------------------------------

it('asks for a site’s altitude after its depth, in the diver’s unit, optional and a figure', async () => {
  const t = await showSite();
  await expand(t, 'The site');
  expect(rowValue(t, 'Altitude')).toBe('m');
  expect(labelled(t, 'Altitude').props.value).toBe('');
  // A minus sign on the keypad: below sea level is a place.
  expect(labelled(t, 'Altitude').props.keyboardType).toBe('numbers-and-punctuation');
  expect(stylesOf(labelled(t, 'Altitude'))).toContain(styles.formFieldInputMono);
  const labels = textIn(t);
  expect(labels.indexOf('Altitude')).toBeGreaterThan(labels.indexOf('Site depth'));
  await press(t, 'Save site');
  expect(mockAddSite.mock.calls[0]?.[0].altitudeM).toBeNull();
});

it('saves an altitude below sea level', async () => {
  const t = await showSite();
  await expand(t, 'The site');
  await type(t, 'Altitude', '-430');
  await press(t, 'Save site');
  expect(mockAddSite.mock.calls[0]?.[0].altitudeM).toBe(-430);
});

it('stores an altitude typed in feet as whole metres', async () => {
  mockUnits.mockReturnValue('imperial');
  const t = await showSite();
  await expand(t, 'The site');
  expect(rowValue(t, 'Altitude')).toBe('ft');
  await type(t, 'Altitude', '1000');
  await press(t, 'Save site');
  // 304.8 m, to the metre.
  expect(mockAddSite.mock.calls[0]?.[0].altitudeM).toBe(305);
});

it('fills the altitude from the fix when Use current position is pressed, and saves it rounded', async () => {
  mockPosition.mockResolvedValue({ found: true, latitude: 50.1, longitude: 14.4, altitude: 312.6 });
  const t = await showSite();
  await press(t, 'Use current position');
  expect(labelled(t, 'Altitude').props.value).toBe('313');
  await press(t, 'Save site');
  expect(mockAddSite.mock.calls[0]?.[0].altitudeM).toBe(313);
});

it('shows the fix’s altitude in feet to an imperial diver, and still saves whole metres', async () => {
  mockUnits.mockReturnValue('imperial');
  mockPosition.mockResolvedValue({ found: true, latitude: 50.1, longitude: 14.4, altitude: 312.6 });
  const t = await showSite();
  await press(t, 'Use current position');
  expect(labelled(t, 'Altitude').props.value).toBe('1026');
  await press(t, 'Save site');
  expect(mockAddSite.mock.calls[0]?.[0].altitudeM).toBe(313);
});

it('opens The site when the fix fills the altitude, so a value it will save is never hidden', async () => {
  mockPosition.mockResolvedValue({ found: true, latitude: 50.1, longitude: 14.4, altitude: 312.6 });
  const t = await showSite();
  expect(has(t, 'Altitude')).toBe(false);
  await press(t, 'Use current position');
  expect(has(t, 'Altitude')).toBe(true);
});

it('leaves the altitude as it was when the fix carries none', async () => {
  mockPosition.mockResolvedValue({ found: true, latitude: 50.1, longitude: 14.4 });
  const t = await showSite();
  await expand(t, 'The site');
  await type(t, 'Altitude', '250');
  await press(t, 'Use current position');
  expect(labelled(t, 'Altitude').props.value).toBe('250');
  await press(t, 'Save site');
  expect(mockAddSite.mock.calls[0]?.[0].altitudeM).toBe(250);
});

it('lets the diver type over a filled altitude, and a later fix overwrites it', async () => {
  mockPosition.mockResolvedValue({ found: true, latitude: 50.1, longitude: 14.4, altitude: 312.6 });
  const t = await showSite();
  await press(t, 'Use current position');
  await type(t, 'Altitude', '320');
  expect(labelled(t, 'Altitude').props.value).toBe('320');
  mockPosition.mockResolvedValue({ found: true, latitude: 50.1, longitude: 14.4, altitude: 100.2 });
  await press(t, 'Use current position');
  expect(labelled(t, 'Altitude').props.value).toBe('100');
  await type(t, 'Altitude', '321');
  await press(t, 'Save site');
  expect(mockAddSite.mock.calls[0]?.[0].altitudeM).toBe(321);
});

it('sets no altitude from a pin the dive handed over', async () => {
  mockRequest.mockReturnValue(request({ dive: diveAt }));
  const t = await showSite();
  // The dive's salinity, water body and entry open the group already.
  expect(labelled(t, 'Altitude').props.value).toBe('');
  await press(t, 'Save site');
  expect(mockAddSite.mock.calls[0]?.[0].altitudeM).toBeNull();
});

it('forgets the wreck’s name and year once Wreck is taken off', async () => {
  const t = await showSite();
  await expand(t, 'The site');
  await press(t, 'Site type: Wreck');
  await type(t, 'Wreck name', 'Teti');
  await type(t, 'Year sunk', '1930');
  await press(t, 'Site type: Wreck');
  await press(t, 'Site type: Reef');
  await press(t, 'Save site');
  expect(mockAddSite).toHaveBeenCalledWith(
    expect.objectContaining({ siteTypes: ['reef'], wreckName: null, wreckSunkYear: null }),
    undefined,
  );
});

// The server casts the column to `integer`: a whole year from a whole-number pad is the first
// guard, and `db/integers.ts`' rounding at the write the second.
it('takes only digits as the year sunk', async () => {
  const t = await showSite();
  await expand(t, 'The site');
  await press(t, 'Site type: Wreck');
  await type(t, 'Year sunk', '19a3x0');
  expect(labelled(t, 'Year sunk').props.value).toBe('1930');
  // Four at most: a year, never a figure that only starts like one.
  await type(t, 'Year sunk', '1930.5');
  expect(labelled(t, 'Year sunk').props.value).toBe('1930');
  await press(t, 'Save site');
  expect(mockAddSite).toHaveBeenCalledWith(expect.objectContaining({ wreckSunkYear: 1930 }), undefined);
});

// Review Focus 2: the saved list is clean — no blank, no repeat by fold, nothing that folds to the
// site's own name — so search and the duplicate check never match a site against itself.
it('saves other names without blanks, repeats or the site’s own name', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Kamena vrata' });
  const t = await showSite();
  await expand(t, 'Other names');
  const typed = ['Stone Gate', 'stone gate', 'Kamená Vrata'];
  for (const [index, other] of typed.entries()) {
    await typeOtherName(t, index, other);
    await press(t, 'Add another name');
  }
  expect(otherNames(t)).toEqual([...typed, '']);
  await press(t, 'Save site');
  expect(mockAddSite).toHaveBeenCalledWith(expect.objectContaining({ altNames: ['Stone Gate'] }), undefined);
});

it('adds a row for another name', async () => {
  const t = await showSite();
  await expand(t, 'Other names');
  expect(otherNames(t)).toEqual(['']);
  // A place's name, as the page's own *Name* takes one.
  expect(labelled(t, 'Other name').props).toMatchObject({ autoCapitalize: 'sentences', autoCorrect: false });
  await typeOtherName(t, 0, 'Stone Gate');
  await press(t, 'Add another name');
  expect(otherNames(t)).toEqual(['Stone Gate', '']);
});

// The pill shows *+ Add a name*; a screen reader hears the act without the glyph, which VoiceOver
// would otherwise read as "plus" (`back.anyLabel` is the precedent).
it('says + Add a name to a screen reader without the plus', async () => {
  const t = await showSite();
  await expand(t, 'Other names');
  const pill = labelled(t, 'Add another name');
  expect(pill.props.accessibilityRole).toBe('button');
  expect(textOf(pill)).toBe('+ Add a name');
  expect(has(t, '+ Add a name')).toBe(false);
});

it('saves every new fact of a centre', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Nautica Vis' });
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const t = await showCenter();
  await type(t, 'Address', ' Otok Vis, Kut 12 ');
  await type(t, 'Description', 'Family centre in Kut bay.');
  await expand(t, 'Contact');
  await type(t, 'Website', 'https://nautica-vis.example');
  await type(t, 'Phone', '+385 21 555 0123');
  await type(t, 'Email', 'dive@nautica-vis.example');
  await type(t, 'Opening hours', 'Daily 8–18, closed Nov–Mar');
  await expand(t, 'Services');
  await press(t, 'Services: Nitrox');
  await press(t, 'Services: Air');
  await press(t, 'Training agencies: Other');
  await press(t, 'Training agencies: PADI');
  await press(t, 'Save centre');
  expect(mockAddCenter).toHaveBeenCalledWith(
    {
      name: 'Nautica Vis',
      latitude: null,
      longitude: null,
      website: 'https://nautica-vis.example',
      address: 'Otok Vis, Kut 12',
      phone: '+385 21 555 0123',
      email: 'dive@nautica-vis.example',
      openingHours: 'Daily 8–18, closed Nov–Mar',
      description: 'Family centre in Kut bay.',
      services: ['air', 'nitrox'],
      agencies: ['padi', 'other'],
    },
    undefined,
    undefined,
  );
});

// It is the shop's number, email and address, not the diver's, and everyone reads them: each opts
// out of AutoFill in so many words, since saying nothing still lets Android's Autofill offer the
// diver's own by the field's input type.
it('offers the phone keypad and the email keyboard, and fills in neither from the diver’s own details', async () => {
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const t = await showCenter();
  await expand(t, 'Contact');
  const optOut = { textContentType: 'none', autoComplete: 'off', importantForAutofill: 'no' };
  const phone = labelled(t, 'Phone');
  expect(phone.props).toMatchObject({ keyboardType: 'phone-pad', ...optOut });
  const email = labelled(t, 'Email');
  expect(email.props).toMatchObject({
    keyboardType: 'email-address',
    autoCapitalize: 'none',
    autoCorrect: false,
    ...optOut,
  });
  expect(labelled(t, 'Address').props).toMatchObject(optOut);
});

// What is saved is what is on screen: from Save until a question or a failure hands them back,
// nothing new on the page can change underneath the check or the write.
it('holds the new fields still while saving', async () => {
  const checked = deferred<SiteTwin[]>();
  mockTwins.mockReturnValue(checked.promise);
  const site = await showSite();
  await expand(site, 'The site');
  await press(site, 'Site type: Wreck');
  await expand(site, 'Other names');
  await press(site, 'Save site');
  for (const field of ['Description', 'Site depth', 'Altitude', 'Wreck name', 'Year sunk', 'Other name']) {
    expect([field, labelled(site, field).props.editable]).toEqual([field, false]);
  }
  for (const control of ['Site type: Reef', 'Suitable for: Advanced', 'Add another name']) {
    expect([control, labelled(site, control).props.accessibilityState]).toEqual([
      control,
      expect.objectContaining({ disabled: true }),
    ]);
  }
  await press(site, 'Add another name');
  expect(otherNames(site)).toEqual(['']);
  await act(async () => checked.resolve([]));
  await cleanup();

  const written = deferred<string>();
  mockAddCenter.mockReturnValue(written.promise);
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const centre = await showCenter();
  await expand(centre, 'Contact');
  await expand(centre, 'Services');
  await press(centre, 'Save centre');
  for (const field of ['Address', 'Description', 'Website', 'Phone', 'Email', 'Opening hours']) {
    expect([field, labelled(centre, field).props.editable]).toEqual([field, false]);
  }
  for (const control of ['Services: Air', 'Training agencies: PADI']) {
    expect([control, labelled(centre, control).props.accessibilityState]).toEqual([
      control,
      expect.objectContaining({ disabled: true }),
    ]);
  }
  await act(async () => written.resolve('new-centre-id'));
});

it('saves a long description whole', async () => {
  const long = 'Bow at 18 m, stern at 34 m; expect current on the outer side.\n'.repeat(100).slice(0, 5000);
  expect(long).toHaveLength(5000);
  const t = await showSite();
  await type(t, 'Description', long);
  await press(t, 'Save site');
  expect(mockAddSite).toHaveBeenCalledWith(expect.objectContaining({ description: long }), undefined);
});

// --- The country, asked once ----------------------------------------------------------------------

// The *Country* row asked the geocoder about the position on screen; Save hands that answer on with
// the point it is for, rather than `addSite` asking the same question again (up to four seconds more
// of *Saving…* offline).
it('Save hands on the country the page shows for the position it saves', async () => {
  mockRequest.mockReturnValue(request({ dive: diveAt }));
  mockCountry.mockResolvedValue('HR');
  const t = await showSite();
  expect(rowValue(t, 'Country')).toBe('HR');
  await press(t, 'Save site');
  expect(mockCountry).toHaveBeenCalledTimes(1);
  expect(mockAddSite).toHaveBeenCalledWith(expect.objectContaining({ latitude: 43.06, longitude: 16.18 }), {
    ...pin,
    country: 'HR',
  });
});

it('a centre hands on the country shown for the position it asked for', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Ponorka' });
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  mockPosition.mockResolvedValue({ found: true, latitude: 43.1, longitude: 16.2 });
  mockCountry.mockResolvedValue('HR');
  const t = await showCenter();
  await press(t, 'Use current position');
  expect(rowValue(t, 'Country')).toBe('HR');
  await press(t, 'Save centre');
  expect(mockAddCenter).toHaveBeenCalledWith(
    expect.objectContaining({ latitude: 43.1, longitude: 16.2 }),
    { latitude: 43.1, longitude: 16.2, country: 'HR' },
    undefined,
  );
});

// An answer about the dive's pin is not an answer about the phone's position that replaced it, and
// one still on its way is not on screen: either way `addSite` asks for itself.
it('hands on nothing while the position on screen has no answer yet', async () => {
  mockRequest.mockReturnValue(request({ dive: diveAt }));
  const forPhone = deferred<string | null>();
  mockCountry.mockImplementation(async (latitude) => (latitude === 50.1 ? forPhone.promise : 'HR'));
  mockPosition.mockResolvedValue({ found: true, latitude: 50.1, longitude: 14.4 });
  const t = await showSite();
  expect(rowValue(t, 'Country')).toBe('HR');
  await press(t, 'Use current position');
  expect(rowValue(t, 'Country')).toBe('—');
  await press(t, 'Save site');
  expect(mockAddSite).toHaveBeenCalledWith(expect.objectContaining({ latitude: 50.1, longitude: 14.4 }), undefined);
  await act(async () => forPhone.resolve('CZ'));
});

// --- The country from an address (a centre with no pin; issue #31) --------------------------------

/** Types an address and leaves the box, as a diver does. */
async function enterAddress(t: RenderResult, text: string) {
  await type(t, 'Address', text);
  await fireEvent(labelled(t, 'Address'), 'blur');
}

it('looks the country up from the address once it is entered, and says where it came from', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Nautica Vis' });
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  mockAddressCountry.mockResolvedValue('HR');
  const t = await showCenter();
  expect(rowValue(t, 'Country')).toBe('—');
  await enterAddress(t, ' Otok Vis, Kut 12 ');
  expect(mockAddressCountry).toHaveBeenCalledWith('Otok Vis, Kut 12');
  expect(rowValue(t, 'Country')).toBe('HR · from the address');
});

it('does not look an address up while the centre has a position', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Nautica Vis' });
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  mockPosition.mockResolvedValue({ found: true, latitude: 43.1, longitude: 16.2 });
  mockCountry.mockResolvedValue('SI');
  mockAddressCountry.mockResolvedValue('HR');
  const t = await showCenter();
  await press(t, 'Use current position');
  await enterAddress(t, 'Otok Vis, Kut 12');
  expect(mockAddressCountry).not.toHaveBeenCalled();
  expect(rowValue(t, 'Country')).toBe('SI');
});

it('forgets an answer about an address since changed', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Nautica Vis' });
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  mockAddressCountry.mockResolvedValue('HR');
  const t = await showCenter();
  await enterAddress(t, 'Otok Vis, Kut 12');
  await type(t, 'Address', 'Piran 3');
  expect(rowValue(t, 'Country')).toBe('—');
});

it('drops an address answer that lands after the page has closed', async () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockParams.mockReturnValue({ token: 'tok', name: 'Nautica Vis' });
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const answer = deferred<string | null>();
  mockAddressCountry.mockReturnValue(answer.promise);
  const t = await showCenter();
  await enterAddress(t, 'Otok Vis, Kut 12');
  await t.unmount();
  await act(async () => answer.resolve('HR'));
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

it('keeps the answer for the address in the box when a slower one for an earlier address lands last', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Nautica Vis' });
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const first = deferred<string | null>();
  mockAddressCountry.mockImplementation(async (address) => (address === 'Otok Vis, Kut 12' ? first.promise : 'SI'));
  const t = await showCenter();
  await enterAddress(t, 'Otok Vis, Kut 12');
  await enterAddress(t, 'Piran 3');
  await act(async () => first.resolve('HR'));
  expect(rowValue(t, 'Country')).toBe('SI · from the address');
});

it('hands the address answer to addCenter with the address it is for', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Nautica Vis' });
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  mockAddressCountry.mockResolvedValue('HR');
  const t = await showCenter();
  await enterAddress(t, ' Otok Vis, Kut 12 ');
  await press(t, 'Save centre');
  expect(mockAddCenter).toHaveBeenCalledWith(
    expect.objectContaining({ address: 'Otok Vis, Kut 12', latitude: null, longitude: null }),
    undefined,
    { address: 'Otok Vis, Kut 12', country: 'HR' },
  );
});

it('Save waits for an address lookup still out instead of asking again', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Nautica Vis' });
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const answer = deferred<string | null>();
  mockAddressCountry.mockReturnValue(answer.promise);
  const t = await showCenter();
  await enterAddress(t, 'Otok Vis, Kut 12');
  await press(t, 'Save centre');
  expect(mockAddCenter).not.toHaveBeenCalled();
  await act(async () => answer.resolve('HR'));
  expect(mockAddressCountry).toHaveBeenCalledTimes(1);
  expect(mockAddCenter).toHaveBeenCalledWith(expect.anything(), undefined, { address: 'Otok Vis, Kut 12', country: 'HR' });
});

// As a site's twin check: `‹ Back` while Save waits is a way off, and a community row cannot be
// deleted once written (§5), so the answer landing after it writes nothing.
it('‹ Back while Save waits for the address lookup writes nothing', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Nautica Vis' });
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const answer = deferred<string | null>();
  mockAddressCountry.mockReturnValue(answer.promise);
  const t = await showCenter();
  await enterAddress(t, 'Otok Vis, Kut 12');
  await press(t, 'Save centre');
  await press(t, 'Go back');
  await act(async () => answer.resolve('HR'));
  expect(mockAddCenter).not.toHaveBeenCalled();
  expect(mockComplete).not.toHaveBeenCalled();
  expect(router.back).toHaveBeenCalledTimes(1);
});

it('hands on no address answer once the address has changed', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'Nautica Vis' });
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  mockAddressCountry.mockResolvedValue('HR');
  const t = await showCenter();
  await enterAddress(t, 'Otok Vis, Kut 12');
  await type(t, 'Address', 'Piran 3');
  await press(t, 'Save centre');
  expect(mockAddCenter).toHaveBeenCalledWith(expect.anything(), undefined, undefined);
});

it('never asks a site’s country from anything but its pin', async () => {
  const t = await showSite();
  expect(has(t, 'Address')).toBe(false);
  await press(t, 'Save site');
  expect(mockAddressCountry).not.toHaveBeenCalled();
});

// --- The page itself ----------------------------------------------------------------------------

it('‹ Back goes back without saving anything', async () => {
  const t = await showSite();
  expect(textIn(t)).toContain('‹ Back');
  await press(t, 'Go back');
  expect(router.back).toHaveBeenCalledTimes(1);
  expect(mockAddSite).not.toHaveBeenCalled();
  expect(mockComplete).not.toHaveBeenCalled();
});

// §0.1's sweep: every colour on the page is the sheet's.
it('paints nothing of its own', async () => {
  mockRequest.mockReturnValue(request({ dive: diveAt }));
  mockTwins.mockResolvedValue([twin('Lom Leština', 's-twin')]);
  const t = await showSite();
  await expand(t, 'Other names');
  await press(t, 'Save site');
  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});

describe('in Czech', () => {
  beforeEach(() => {
    setActiveLanguage('cs');
  });
  afterEach(async () => {
    await cleanup();
    setActiveLanguage('en');
  });

  it('titles the page and words the save button in Czech', async () => {
    const t = await showSite();
    expect(textIn(t)).toContain('Nová potápěčská lokalita');
    expect(has(t, 'Uložit lokalitu')).toBe(true);
    expect(textIn(t)).not.toContain('New dive site');
  });

  it('words a match’s distance in Czech', async () => {
    mockRequest.mockReturnValue(request({ dive: diveAt }));
    mockTwins.mockResolvedValue([
      twin('Lom Leština', 's-twin', { country: 'HR', point: { latitude: 43.0611, longitude: 16.18 } }),
    ]);
    const t = await showSite();
    await press(t, 'Uložit lokalitu');
    expect(textIn(t)).toContain('Nemysleli jste „Lom Leština“?');
    expect(textIn(t)).toContain('HR · 120 m odtud');
  });

  it('says where an address’s country came from in Czech', async () => {
    mockParams.mockReturnValue({ token: 'tok', name: 'Nautica Vis' });
    mockRequest.mockReturnValue(request({ kind: 'center' }));
    mockAddressCountry.mockResolvedValue('HR');
    const t = await showCenter();
    await type(t, 'Adresa', 'Otok Vis, Kut 12');
    await fireEvent(labelled(t, 'Adresa'), 'blur');
    expect(rowValue(t, 'Země')).toBe('HR · z adresy');
  });

  it('says another name in Czech', async () => {
    mockParams.mockReturnValue({ token: 'tok', name: 'Stone Gate' });
    mockTwins.mockResolvedValue([
      twin('Kamena vrata', 's-kamena', { relation: { kind: 'otherName', alias: 'Kamena vrata', name: 'Stone Gate' } }),
    ]);
    const t = await showSite();
    await press(t, 'Uložit lokalitu');
    expect(textIn(t)).toContain('„Kamena vrata“ je jiný název pro Stone Gate.');
  });

  it('names the new fields and groups in Czech', async () => {
    const site = await showSite();
    expect(textIn(site)).toContain('Popis');
    expect(textIn(site)).toContain('uvidí ho všichni');
    expect(textIn(site)).toContain('Lokalita');
    expect(textIn(site)).toContain('Jiné názvy');
    await press(site, 'Rozbalit Jiné názvy');
    expect(textIn(site)).toContain('+ Přidat název');
    expect(textOf(labelled(site, 'Přidat další název'))).toBe('+ Přidat název');
    await cleanup();

    mockRequest.mockReturnValue(request({ kind: 'center' }));
    const centre = await showCenter();
    expect(textIn(centre)).toContain('Kontakt');
    expect(textIn(centre)).toContain('Služby');
    await press(centre, 'Rozbalit Služby');
    expect(textIn(centre)).toContain('Výcvikové agentury');
  });
});
