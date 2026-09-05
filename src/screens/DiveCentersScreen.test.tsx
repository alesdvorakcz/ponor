import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router } from 'expo-router';

import { searchCenters } from '../cloud/searchCenters';
import { useAuthSession } from '../cloud/useAuthSession';
import { applyPulledDiveCenters } from '../db/catalogue';
import { useDiveCenters, type DiveCenterListState } from '../db/useDiveCenters';
import { useDives, type DiveListState } from '../db/useDives';
import { assignDiveNumbers } from '../domain/diveNumber';
import { dive } from '../domain/diveFixture';
import { CATALOGUE_UNREADABLE } from '../domain/logbook';
import { type Dive, type DiveCenter } from '../domain/types';
import { UNNAMED_CENTER } from '../format/display';
import { LIVE_SEARCH_DELAY_MS } from '../hooks/useCatalogueSupplement';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import DiveCentersScreen from './DiveCentersScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useDiveCenters', () => ({ useDiveCenters: jest.fn() }));
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
jest.mock('../cloud/useAuthSession', () => ({
  useAuthSession: jest.fn(() => ({ session: null, resolved: true })),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
}));
// The two halves of the online supplement, mocked at their own seams: the RPC client (whose own
// suite proves what it asks and what it refuses) and the catalogue write (whose rule —
// `applyPulledRows`, clean and only where it may safely replace — is db/dirty.ts's). What is
// left for this file to state is that this screen wires the one to the other.
jest.mock('../cloud/searchCenters', () => ({ searchCenters: jest.fn(async () => []) }));
jest.mock('../db/catalogue', () => ({ applyPulledDiveCenters: jest.fn(async () => []) }));
// `db/client` is a native module (expo-sqlite) and `cloud/supabase` builds a real client with a
// token-refresh timer; neither is anything this screen decides, and both are only ever handed on
// to the two mocks above.
jest.mock('../db/client', () => ({ db: {} }));
jest.mock('../cloud/supabase', () => ({ cloud: { configured: false, missing: [] } }));

const mockUseDiveCenters = useDiveCenters as jest.MockedFunction<typeof useDiveCenters>;
const mockUseDives = useDives as jest.MockedFunction<typeof useDives>;
const mockUseAuthSession = useAuthSession as jest.MockedFunction<typeof useAuthSession>;
const mockSearchCenters = searchCenters as jest.MockedFunction<typeof searchCenters>;
const mockApply = applyPulledDiveCenters as jest.MockedFunction<typeof applyPulledDiveCenters>;

/** A centre in the shape M2o writes: a name and nothing else (§2.3). Everything richer is opted
 * into by the test that is about it. */
let seq = 0;
const centre = (over: Partial<DiveCenter> = {}): DiveCenter => ({
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

function catalogueState(centers: DiveCenter[], over: Partial<DiveCenterListState> = {}): DiveCenterListState {
  return { centers, resolved: true, error: undefined, ...over };
}

function divesState(dives: Dive[], over: Partial<DiveListState> = {}): DiveListState {
  return { dives, numbers: assignDiveNumbers(dives, 0), resolved: true, error: undefined, settingsError: undefined, ...over };
}

beforeEach(() => {
  mockUseDiveCenters.mockReturnValue(catalogueState([]));
  mockUseDives.mockReturnValue(divesState([]));
  mockUseAuthSession.mockReturnValue({ session: null, resolved: true });
  mockSearchCenters.mockResolvedValue([]);
  mockSearchCenters.mockClear();
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
  if (node === undefined) throw new Error(`the centres directory rendered nothing labelled ${label}`);
  return node;
}

/** The rows a diver would read, top to bottom — the names, in the order they are drawn. */
function rowNames(t: RenderResult): string[] {
  return allNodes(t)
    .filter((n) => typeof n.props?.accessibilityLabel === 'string' && String(n.props.accessibilityLabel).startsWith('Open '))
    .map((n) => String(n.props.accessibilityLabel).slice('Open '.length));
}

const show = () => render(<DiveCentersScreen />);

/** Types into the field the way a diver does — through the real `TextInput`, which is the
 * responder gate a device consults. */
async function type(t: RenderResult, text: string) {
  await fireEvent.changeText(labelled(t, 'Search centres'), text);
}

// --- The directory itself -------------------------------------------------------------------

/**
 * **It opens on the whole catalogue**, which is the one behavioural difference from
 * `SearchScreen`: that screen clears its list on arrival because the list it would otherwise show
 * is the logbook the diver has just left, and there is nowhere else in the app that *this* list
 * appears at all.
 */
it('opens on every centre the device holds, in a stable order', async () => {
  mockUseDiveCenters.mockReturnValue(
    catalogueState([centre({ name: 'Železná' }), centre({ name: 'aqua split' }), centre({ name: 'Ponorka' })]),
  );
  const t = await show();
  expect(rowNames(t)).toEqual(['aqua split', 'Ponorka', 'Železná']);
  expect(textIn(t)).toContain('3 centres');
});

// The row's second line is what the catalogue and the logbook together know — the two halves
// that make a directory of community shops worth reading (`formatCenterRow`).
it('says what the catalogue knows and how many dives the diver has there', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([centre({ id: 'c-p', name: 'Ponorka', country: 'CZ' })]));
  // A logbook with dives that are NOT this centre's in it, deliberately: a row counting
  // `dives.length` would read "4 dives" and satisfy any fixture where every dive was this
  // centre's. Two belong (one paired, one named by hand) and two do not.
  mockUseDives.mockReturnValue(
    divesState([
      dive({ centerId: 'c-p', centerName: 'Ponorka' }),
      dive({ centerName: 'ponorka' }),
      dive({ centerName: 'Aqua Split' }),
      dive({ centerName: null }),
    ]),
  );
  expect(textIn(await show())).toContain('CZ · 2 dives');
});

/**
 * **A centre the diver has never dived with shows no count**, which is the standing rule of
 * `format/display.ts` doing real work: most rows in a community directory are shops this diver
 * has never used, and a column of `0 dives` would say the same nothing on every row.
 */
it('draws no second line at all for a centre with nothing behind either half', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([centre({ name: 'Ponorka' })]));
  const text = textIn(await show());
  expect(text).toContain('Ponorka');
  expect(text).not.toContain('0 dives');
});

it('calls an unnamed centre what the rest of the app calls one', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([centre({ name: null })]));
  expect(rowNames(await show())).toEqual([UNNAMED_CENTER]);
});

it('opens a centre from its row', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([centre({ id: 'c-p', name: 'Ponorka' })]));
  const t = await show();
  await fireEvent.press(labelled(t, 'Open Ponorka'));
  expect(String((router.push as jest.Mock).mock.calls[0]?.[0])).toBe('/center/c-p');
});

it('offers a way out', async () => {
  const t = await show();
  await fireEvent.press(labelled(t, 'Close centres'));
  expect(router.back).toHaveBeenCalled();
});

// --- Searching --------------------------------------------------------------------------------

// The fold is `foldForMatching`'s on both sides, which is why `zelezna` finds `Železná` here for
// the same reason it does in the logbook and on the server (§2.3, M2j).
it('filters the list as the diver types, accents folded', async () => {
  mockUseDiveCenters.mockReturnValue(
    catalogueState([centre({ name: 'Železná' }), centre({ name: 'Ponorka' })]),
  );
  const t = await show();
  await type(t, 'zelez');
  expect(rowNames(t)).toEqual(['Železná']);
  expect(textIn(t)).toContain('1 centre');
});

it('says when nothing matches, which is not the same as having none', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([centre({ name: 'Ponorka' })]));
  const t = await show();
  await type(t, 'kotelna');
  expect(textIn(t)).toContain('No centres match your search.');
  expect(textIn(t).join(' ')).not.toContain('No dive centres yet');
});

// --- The online supplement (§2.3's "live search adds anything newer when online") ------------

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
   * **The rows go into the device's catalogue, not into a second list on screen.** That is the
   * whole design: `search_centers` renders with `public.sync_site`, so a row from it is
   * byte-for-byte a pulled row, and the live query re-renders with it. There is no merge-by-id
   * on this screen and no "local or remote" state on any row.
   */
  it('asks the server and hands what comes back to the catalogue', async () => {
    const row = { id: 'c-remote', name: 'Kotelna' } as never;
    mockSearchCenters.mockResolvedValue([row]);
    const t = await show();
    // **Accented and capitalised on purpose.** The query goes over the wire RAW — the server
    // folds it with `public.name_fold`, and a client that pre-folded would fold twice and
    // diverge silently (§2.3). A lowercase ASCII query would be identical to its own fold and
    // would let a client-side fold through unnoticed.
    await type(t, 'Železná');
    await settle();
    expect(mockSearchCenters).toHaveBeenCalledWith(expect.anything(), 'Železná');
    expect(mockApply).toHaveBeenCalledWith(expect.anything(), [row]);
  });

  /**
   * **The pause is real**, which is the half a "how many calls" test cannot see: with the delay
   * at zero the cleanup of each keystroke's effect still cancels the one before it, so the count
   * stays at one either way. What separates the two is whether anything is asked *before* the
   * diver has stopped typing.
   */
  it('waits for the diver to stop typing before it asks anything', async () => {
    const t = await show();
    await type(t, 'kot');
    await act(async () => {
      jest.advanceTimersByTime(LIVE_SEARCH_DELAY_MS - 1);
    });
    expect(mockSearchCenters).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(mockSearchCenters).toHaveBeenCalledTimes(1);
  });

  // A keystroke is not a question: seven of them would be seven round trips, six already stale
  // when they land. What the pause delays is a list getting longer, never a list appearing.
  it('asks once for a name typed in one go, not once per keystroke', async () => {
    const t = await show();
    await type(t, 'k');
    await type(t, 'ko');
    await type(t, 'kot');
    await settle();
    expect(mockSearchCenters).toHaveBeenCalledTimes(1);
    expect(mockSearchCenters).toHaveBeenCalledWith(expect.anything(), 'kot');
  });

  // `search_centers` raises when it is given neither a query nor a position, so an empty field is
  // a call that would only ever be an error — and the whole catalogue is already on screen.
  it('never asks for an empty query', async () => {
    const t = await show();
    await type(t, 'kot');
    await type(t, '   ');
    await settle();
    expect(mockSearchCenters).not.toHaveBeenCalled();
  });

  // Nothing to write is nothing to write: an empty answer must not reach the catalogue at all,
  // or every keystroke made out of signal would be a write.
  it('writes nothing when the server had nothing to add', async () => {
    const t = await show();
    await type(t, 'kotelna');
    await settle();
    expect(mockSearchCenters).toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  /**
   * §1: the app runs offline. `searchCenters` answers `[]` for every way of failing and this
   * screen says nothing about it — a notice under a search field that fired on every keystroke
   * made out of signal is the message with no gesture beneath it §0.6 objects to four times.
   */
  it('says nothing when the supplement fails, and keeps the device’s own rows on screen', async () => {
    mockSearchCenters.mockRejectedValue(new Error('offline'));
    mockUseDiveCenters.mockReturnValue(catalogueState([centre({ name: 'Ponorka' })]));
    const t = await show();
    await type(t, 'pon');
    await settle();
    expect(rowNames(t)).toEqual(['Ponorka']);
    expect(textIn(t).join(' ')).not.toContain('Couldn');
  });

  // A write that rejects is the same outcome as a server that never answered — the device's own
  // rows, already on screen — and must not take the screen down with it.
  it('survives a catalogue that refused the write', async () => {
    mockSearchCenters.mockResolvedValue([{ id: 'c-remote' } as never]);
    mockApply.mockRejectedValue(new Error('locked'));
    const t = await show();
    await type(t, 'kot');
    await settle();
    expect(textIn(t).join(' ')).not.toContain('Couldn');
  });
});

// --- The four states, kept apart --------------------------------------------------------------

// §10: a screen with no answer must not state one. An unread catalogue and an empty one are the
// same `[]`.
it('states nothing about a catalogue it has not read yet', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([], { resolved: false }));
  const text = textIn(await show()).join(' ');
  expect(text).not.toContain('No dive centres yet');
  expect(text).not.toContain('0 centres');
});

it('reports a failed read rather than an empty directory', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([], { error: new Error('nope') }));
  const text = textIn(await show());
  expect(text).toContain(CATALOGUE_UNREADABLE);
  expect(text.join(' ')).not.toContain('No dive centres yet');
});

/**
 * **Two sentences, because a guest is not waiting for the same thing a signed-in diver is** — the
 * split the Map's community layer already draws. A centre reaches this table through a pull or
 * through §2.3's *add a centre*, and §5 puts an account behind both, so telling a guest their
 * next sync will bring centres would point at something that cannot happen.
 */
it('says why it is empty, and says it differently to a guest', async () => {
  const guest = textIn(await show()).join(' ');
  expect(guest).toContain('No dive centres yet');
  expect(guest).toContain('an account');

  mockUseAuthSession.mockReturnValue({ session: { user: { id: 'u1' } } as never, resolved: true });
  const member = textIn(await show()).join(' ');
  expect(member).toContain('No dive centres yet');
  expect(member).not.toContain('an account');
  expect(member).toContain('sync');
});

// §0.1's sweep: nothing on this screen is painted from outside the sheet, and nothing here is a
// depth.
it('paints nothing of its own', async () => {
  mockUseDiveCenters.mockReturnValue(catalogueState([centre({ name: 'Ponorka', country: 'CZ' })]));
  expect(unexpectedGraphics(await show(), 'light')).toEqual([]);
});
