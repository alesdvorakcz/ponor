import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, cleanup, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { addCenter, addSite, findSiteTwins, type SiteTwin } from '../cloud/addToCatalogue';
import { useAuthSession } from '../cloud/useAuthSession';
import { setActiveLanguage } from '../i18n';
import { completePlacePick, placePickRequest, type PlacePickRequest } from '../navigation/placePick';
import { countryFor } from '../platform/geocode';
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
jest.mock('../platform/geocode', () => ({ countryFor: jest.fn() }));
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
const mockFocusEffect = useFocusEffect as jest.MockedFunction<typeof useFocusEffect>;

const styles = makeStyles('light');

const pin = { latitude: 43.06, longitude: 16.18 };
const diveAt = { pin, entry: 'boat', salinity: 'salt', waterBody: 'ocean', siteId: null } as const;
const noDive = { pin: null, entry: null, salinity: null, waterBody: null, siteId: null };

/** One of §2.3's near-matches as `findSiteTwins` answers it — no country and no position unless told. */
const twin = (value: string, id: string, over: Partial<SiteTwin> = {}): SiteTwin => ({
  value,
  id,
  country: null,
  point: null,
  ...over,
});

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
  expect(labelled(t, 'Entry: Boat').props.accessibilityState).toMatchObject({ selected: true });
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
  // A centre inherits its name alone: no water, no entry; a website instead.
  expect(has(t, 'Salinity: Salt')).toBe(false);
  expect(textIn(t)).not.toContain('from this dive');
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
  expect(mockTwins).toHaveBeenCalledWith('Lom Leštinka', { latitude: 50.1, longitude: 14.4 });
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
  expect(mockTwins).toHaveBeenLastCalledWith('Lom Leštinka', { latitude: 50.1, longitude: 14.4 });
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
  expect(mockTwins).toHaveBeenCalledWith('Lom Leštinka', pin);
  expect(mockAddSite).toHaveBeenCalledWith(
    {
      name: 'Lom Leštinka',
      latitude: 43.06,
      longitude: 16.18,
      entry: 'boat',
      salinity: 'salt',
      waterBody: 'ocean',
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
  expect(mockTwins).toHaveBeenCalledWith('Nová Kotelna', null);
  expect(mockAddSite).toHaveBeenCalledWith(
    {
      name: 'Nová Kotelna',
      latitude: null,
      longitude: null,
      entry: null,
      salinity: null,
      waterBody: null,
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

it('an exact device match gets its own sentence, not a question', async () => {
  mockParams.mockReturnValue({ token: 'tok', name: 'lom lestinka' });
  mockTwins.mockResolvedValue([twin('Lom Leštinka', 's-twin')]);
  const t = await showSite();
  await press(t, 'Save site');
  expect(textIn(t)).toContain('“Lom Leštinka” is already a site.');
  expect(textIn(t).join(' ')).not.toContain('Did you mean');
  expect(has(t, 'Save as a new site anyway')).toBe(true);
});

// Owner's call on PR #35: a diver checks a match is really the same place before using it, so a tap
// opens the site's own page — carrying the form's token, for its *Use this site* — and picks nothing.
it('tapping a match opens that site’s page with the pick token, and picks nothing', async () => {
  mockTwins.mockResolvedValue([twin('Lom Leštinka', 's-same'), twin('Lom Leština', 's-twin')]);
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
  mockTwins.mockResolvedValue([twin('Lom Leštinka', 's-same'), twin('Lom Leština', 's-twin')]);
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
    twin('Lom Leštinka', 's-same'),
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
  expect(mockTwins).toHaveBeenLastCalledWith('Lom Leštinka II', null);
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
    },
    undefined,
  );
  expect(mockComplete).toHaveBeenCalledWith('tok', { id: 'new-centre-id', name: 'Ponorka' }, 2);
});

it('holds a centre’s website still while the write is out', async () => {
  const written = deferred<string>();
  mockAddCenter.mockReturnValue(written.promise);
  mockRequest.mockReturnValue(request({ kind: 'center' }));
  const t = await showCenter();
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
    { name: 'Ponorka', latitude: 43.1, longitude: 16.2, website: null },
    { latitude: 43.1, longitude: 16.2, country: null },
  );
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
  expect(mockAddCenter).toHaveBeenCalledWith(expect.objectContaining({ latitude: 43.1, longitude: 16.2 }), {
    latitude: 43.1,
    longitude: 16.2,
    country: 'HR',
  });
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
});
