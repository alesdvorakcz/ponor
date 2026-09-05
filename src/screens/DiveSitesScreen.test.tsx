import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router } from 'expo-router';

import { searchSites } from '../cloud/searchSites';
import { useAuthSession } from '../cloud/useAuthSession';
import { applyPulledDiveSites } from '../db/catalogue';
import { useDives, type DiveListState } from '../db/useDives';
import { useDiveSites, type DiveSiteListState } from '../db/useDiveSites';
import { useUnitSystem } from '../db/useUnitSystem';
import { assignDiveNumbers } from '../domain/diveNumber';
import { dive } from '../domain/diveFixture';
import { CATALOGUE_UNREADABLE } from '../domain/logbook';
import { type Dive, type DiveSite } from '../domain/types';
import { UNNAMED_SITE } from '../format/display';
import { LIVE_SEARCH_DELAY_MS } from '../hooks/useCatalogueSupplement';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import DiveSitesScreen from './DiveSitesScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useDiveSites', () => ({ useDiveSites: jest.fn() }));
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));
jest.mock('../cloud/useAuthSession', () => ({
  useAuthSession: jest.fn(() => ({ session: null, resolved: true })),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
}));
// The two halves of the online supplement, mocked at their own seams: the RPC client (whose own
// suite proves what it asks and what it refuses) and the catalogue write (whose rule —
// `applyPulledRows`, clean and only where it may safely replace — is db/dirty.ts's). What is left
// for this file to state is that this screen wires the one to the other, through the hook the
// centres directory shares.
jest.mock('../cloud/searchSites', () => ({ searchSites: jest.fn(async () => []) }));
jest.mock('../db/catalogue', () => ({ applyPulledDiveSites: jest.fn(async () => []) }));
// `db/client` is a native module (expo-sqlite) and `cloud/supabase` builds a real client with a
// token-refresh timer; neither is anything this screen decides, and both are only ever handed on
// to the two mocks above.
jest.mock('../db/client', () => ({ db: {} }));
jest.mock('../cloud/supabase', () => ({ cloud: { configured: false, missing: [] } }));

const mockUseDiveSites = useDiveSites as jest.MockedFunction<typeof useDiveSites>;
const mockUseDives = useDives as jest.MockedFunction<typeof useDives>;
const mockUseUnitSystem = useUnitSystem as jest.MockedFunction<typeof useUnitSystem>;
const mockUseAuthSession = useAuthSession as jest.MockedFunction<typeof useAuthSession>;
const mockSearchSites = searchSites as jest.MockedFunction<typeof searchSites>;
const mockApply = applyPulledDiveSites as jest.MockedFunction<typeof applyPulledDiveSites>;

/** A site in the barest shape §5 allows: a name and nothing else. Everything richer is opted into
 * by the test that is about it. */
let seq = 0;
const rock = (over: Partial<DiveSite> = {}): DiveSite => ({
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

function catalogueState(sites: DiveSite[], over: Partial<DiveSiteListState> = {}): DiveSiteListState {
  return { sites, resolved: true, error: undefined, ...over };
}

function divesState(dives: Dive[], over: Partial<DiveListState> = {}): DiveListState {
  return { dives, numbers: assignDiveNumbers(dives, 0), resolved: true, error: undefined, settingsError: undefined, ...over };
}

beforeEach(() => {
  mockUseDiveSites.mockReturnValue(catalogueState([]));
  mockUseDives.mockReturnValue(divesState([]));
  mockUseUnitSystem.mockReturnValue('metric');
  mockUseAuthSession.mockReturnValue({ session: null, resolved: true });
  mockSearchSites.mockResolvedValue([]);
  mockSearchSites.mockClear();
  mockApply.mockClear();
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
  if (node === undefined) throw new Error(`the sites directory rendered nothing labelled ${label}`);
  return node;
}

/** The rows a diver would read, top to bottom — the names, in the order they are drawn. */
function rowNames(t: RenderResult): string[] {
  return allNodes(t)
    .filter((n) => typeof n.props?.accessibilityLabel === 'string' && String(n.props.accessibilityLabel).startsWith('Open '))
    .map((n) => String(n.props.accessibilityLabel).slice('Open '.length));
}

const show = () => render(<DiveSitesScreen />);

/** Types into the field the way a diver does — through the real `TextInput`, which is the
 * responder gate a device consults. */
async function type(t: RenderResult, text: string) {
  await fireEvent.changeText(labelled(t, 'Search sites'), text);
}

// --- The directory itself ---------------------------------------------------------------------

/**
 * **It opens on the whole catalogue**, which is the one behavioural difference from
 * `SearchScreen`: that screen clears its list on arrival because the list it would otherwise show
 * is the logbook the diver has just left.
 */
it('opens on every site the device holds, in a stable order', async () => {
  mockUseDiveSites.mockReturnValue(
    catalogueState([rock({ name: 'Železná' }), rock({ name: 'divoká šárka' }), rock({ name: 'Kotelna' })]),
  );
  const t = await show();
  expect(rowNames(t)).toEqual(['divoká šárka', 'Kotelna', 'Železná']);
  expect(textIn(t)).toContain('3 sites');
});

/**
 * **The row's second line is the catalogue's five facts and the diver's own count** — the axis on
 * which this directory differs from the centres one, because §6 gives a site four facts a centre
 * does not have. `formatSiteRow` owns the words.
 */
it('says what the catalogue knows and how many dives the diver has there', async () => {
  mockUseDiveSites.mockReturnValue(
    catalogueState([
      rock({ id: 's-kot', name: 'Kotelna', country: 'CZ', entry: 'shore', salinity: 'fresh', waterBody: 'quarry', maxDepthM: 42 }),
    ]),
  );
  // A logbook with dives that are NOT this site's in it, deliberately: a row counting
  // `dives.length` would read "4 dives" and satisfy any fixture where every dive was this site's.
  // Two belong (one paired, one named by hand) and two do not.
  mockUseDives.mockReturnValue(
    divesState([
      dive({ siteId: 's-kot', siteName: 'Kotelna' }),
      dive({ siteName: 'kotelna' }),
      dive({ siteName: 'Divoká Šárka' }),
      dive({ centerName: 'Kotelna' }),
    ]),
  );
  expect(textIn(await show())).toContain('CZ · Shore · Fresh · Quarry · 42.0 m · 2 dives');
});

it('reads the row in the diver’s own units', async () => {
  mockUseUnitSystem.mockReturnValue('imperial');
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ maxDepthM: 42 })]));
  expect(textIn(await show())).toContain('138 ft');
});

/**
 * **A site the diver has never dived shows no count**, which is the standing rule of
 * `format/display.ts` doing real work: most rows in a community catalogue are places this diver
 * has never been, and a column of `0 dives` would say the same nothing on every row.
 */
it('draws no second line at all for a site with nothing behind either half', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ name: 'Kotelna' })]));
  const text = textIn(await show());
  expect(text).toContain('Kotelna');
  expect(text).not.toContain('0 dives');
});

it('calls an unnamed site what the rest of the app calls one', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ name: null })]));
  expect(rowNames(await show())).toEqual([UNNAMED_SITE]);
});

it('opens a site from its row', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ id: 's-kot', name: 'Kotelna' })]));
  const t = await show();
  await fireEvent.press(labelled(t, 'Open Kotelna'));
  expect(String((router.push as jest.Mock).mock.calls[0]?.[0])).toBe('/site/s-kot');
});

/** The way out lands on the Map, which is where the pill that opens this screen lives. Asserted
 * through the cold-deep-link branch: with history to pop, every exit in the app pops the same way,
 * so `router.back()` alone would be satisfied by a control wired to any of them. */
it('offers a way out, and it goes back to the map', async () => {
  (router.canGoBack as jest.Mock).mockReturnValueOnce(false);
  const t = await show();
  await fireEvent.press(labelled(t, 'Close sites'));
  expect(router.replace).toHaveBeenCalledWith('/map');
});

// --- Searching ----------------------------------------------------------------------------------

// The fold is `foldForMatching`'s on both sides, which is why `zelezna` finds `Železná` here for
// the same reason it does in the logbook and on the server (§2.3, M2j).
it('filters the list as the diver types, accents folded', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ name: 'Železná' }), rock({ name: 'Kotelna' })]));
  const t = await show();
  await type(t, 'zelez');
  expect(rowNames(t)).toEqual(['Železná']);
  expect(textIn(t)).toContain('1 site');
});

it('says when nothing matches, which is not the same as having none', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ name: 'Kotelna' })]));
  const t = await show();
  await type(t, 'blue hole');
  expect(textIn(t)).toContain('No sites match your search.');
  expect(textIn(t).join(' ')).not.toContain('No dive sites yet');
});

// --- The online supplement (§2.3's "live search adds anything newer when online") ---------------

describe('the live supplement', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** Lets the debounce fire and the two promises behind it settle. */
  async function settle() {
    await act(async () => {
      jest.advanceTimersByTime(LIVE_SEARCH_DELAY_MS);
    });
    await act(async () => {});
  }

  /**
   * **`search_sites` finally has a caller**, five milestones after it was written (M2j) and a
   * standing item in both M3c's and M3e's reports.
   *
   * The rows go into the device's catalogue, not into a second list on screen: the function renders
   * with `public.sync_site`, so a row from it is byte-for-byte a pulled row, and the live query
   * re-renders with it. There is no merge-by-id on this screen and no "local or remote" state on
   * any row.
   */
  it('asks the server and hands what comes back to the catalogue', async () => {
    const row = { id: 's-remote', name: 'Železná' } as never;
    mockSearchSites.mockResolvedValue([row]);
    const t = await show();
    // **Accented and capitalised on purpose.** The query goes over the wire RAW — the server folds
    // it with `public.name_fold`, and a client that pre-folded would fold twice and diverge
    // silently (§2.3). A lowercase ASCII query would be identical to its own fold and would let a
    // client-side fold through unnoticed.
    await type(t, 'Železná');
    await settle();
    expect(mockSearchSites).toHaveBeenCalledWith(expect.anything(), 'Železná');
    expect(mockApply).toHaveBeenCalledWith(expect.anything(), [row]);
  });

  /**
   * **The pause is real**, which is the half a "how many calls" test cannot see: with the delay at
   * zero the cleanup of each keystroke's effect still cancels the one before it, so the count stays
   * at one either way. What separates the two is whether anything is asked *before* the diver has
   * stopped typing.
   */
  it('waits for the diver to stop typing before it asks anything', async () => {
    const t = await show();
    await type(t, 'kot');
    await act(async () => {
      jest.advanceTimersByTime(LIVE_SEARCH_DELAY_MS - 1);
    });
    expect(mockSearchSites).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(mockSearchSites).toHaveBeenCalledTimes(1);
  });

  // `search_sites` raises when it is given neither a query nor a position, so an empty field is a
  // call that would only ever be an error — and the whole catalogue is already on screen.
  it('never asks for an empty query', async () => {
    const t = await show();
    await type(t, 'kot');
    await type(t, '   ');
    await settle();
    expect(mockSearchSites).not.toHaveBeenCalled();
  });

  /**
   * §1: the app runs offline. `searchSites` answers `[]` for every way of failing and this screen
   * says nothing about it — a notice under a search field that fired on every keystroke made out of
   * signal is the message with no gesture beneath it §0.6 objects to four times.
   */
  it('says nothing when the supplement fails, and keeps the device’s own rows on screen', async () => {
    mockSearchSites.mockRejectedValue(new Error('offline'));
    mockUseDiveSites.mockReturnValue(catalogueState([rock({ name: 'Kotelna' })]));
    const t = await show();
    await type(t, 'kot');
    await settle();
    expect(rowNames(t)).toEqual(['Kotelna']);
    expect(textIn(t).join(' ')).not.toContain('Couldn');
  });
});

// --- The four states, kept apart ------------------------------------------------------------------

// §10: a screen with no answer must not state one. An unread catalogue and an empty one are the
// same `[]`.
it('states nothing about a catalogue it has not read yet', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([], { resolved: false }));
  const text = textIn(await show()).join(' ');
  expect(text).not.toContain('No dive sites yet');
  expect(text).not.toContain('0 sites');
});

it('reports a failed read rather than an empty directory', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([], { error: new Error('nope') }));
  const text = textIn(await show());
  expect(text).toContain(CATALOGUE_UNREADABLE);
  expect(text.join(' ')).not.toContain('No dive sites yet');
});

/**
 * **Two sentences, because a guest is not waiting for the same thing a signed-in diver is** — the
 * split the Map's community layer and the centres directory both draw. A site reaches this table
 * through a pull or through §2.3's *add a site*, and §5 puts an account behind both, so telling a
 * guest their next sync will bring sites would point at something that cannot happen.
 */
it('says why it is empty, and says it differently to a guest', async () => {
  const guest = textIn(await show()).join(' ');
  expect(guest).toContain('No dive sites yet');
  expect(guest).toContain('an account');

  mockUseAuthSession.mockReturnValue({ session: { user: { id: 'u1' } } as never, resolved: true });
  const member = textIn(await show()).join(' ');
  expect(member).toContain('No dive sites yet');
  expect(member).not.toContain('an account');
  expect(member).toContain('sync');
});

// §0.1's sweep: nothing on this screen is painted from outside the sheet, and nothing here is a
// depth in the sense the palette encodes — the site's own depth is a catalogue fact on a row of
// text, which is the same ruling §0.6 gives an aggregate.
it('paints nothing of its own', async () => {
  mockUseDiveSites.mockReturnValue(catalogueState([rock({ name: 'Kotelna', country: 'CZ', maxDepthM: 42 })]));
  expect(unexpectedGraphics(await show(), 'light')).toEqual([]);
});
