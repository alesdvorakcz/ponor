import { renderHook } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { diveRowsQuery } from './dives';
import { divesBeforeQuery } from './settings';
import { useDives } from './useDives';

/**
 * `useDives`' own wiring — the three fields it builds out of two `useLiveQuery` results, which
 * nothing else in this repo could reach.
 *
 * **A second file beside `useDives.test.ts`, and it has to be.** That file drives
 * `composeDives` against a REAL better-sqlite3 database through the real `diveRowsQuery` and
 * `divesBeforeQuery`; this one has to replace `useLiveQuery` wholesale (it needs a reactive
 * native database), and replacing it means also replacing `./client`, which opens one on
 * import, and both query builders, which are the only way a stubbed `useLiveQuery` can tell
 * which of the two reads it is being asked about. Every one of those mocks would break every
 * test in the other file. `DiveFormScreen`'s three suites are the same shape: one module, one
 * file per environment it has to be examined in.
 *
 * **What is stubbed and what is not.** `toDives`, `readDivesBefore` and `assignDiveNumbers`
 * all stay real — they are the halves with rules in them, and stubbing them would leave this
 * file asserting against its own idea of what the hook returns. Only the two query builders
 * are replaced, and only so the stub below can dispatch on which query it was handed.
 *
 * This is the file that can fail on `resolved`, on `error` and on `settingsError`. Every screen
 * that reads this hook `jest.mock`s the whole module, so all three lines are otherwise
 * completely undefended — the exact gap `useGearPresets.test.ts` was written for one hook over,
 * where deleting `error: rows.error` left 69 screen tests green while a diver whose read failed
 * was told they simply had no presets.
 */
jest.mock('./client', () => ({ db: { theAppsOwnDatabase: true } }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: jest.fn() }));
jest.mock('./dives', () => ({
  ...jest.requireActual('./dives'),
  diveRowsQuery: jest.fn(() => 'the dives query'),
}));
jest.mock('./settings', () => ({
  ...jest.requireActual('./settings'),
  divesBeforeQuery: jest.fn(() => 'the dives_before query'),
}));

const mockUseLiveQuery = useLiveQuery as unknown as jest.Mock;
const mockDiveRowsQuery = diveRowsQuery as unknown as jest.Mock;
const mockDivesBeforeQuery = divesBeforeQuery as unknown as jest.Mock;

let seq = 0;
/** One `dives` row, in the shape `toDive` reads. Ids come from a counter so two rows built
 * with identical arguments are still distinct. */
const diveRow = (over: Record<string, unknown> = {}) => ({
  id: `dive-${String(seq++).padStart(4, '0')}`,
  date: '2026-08-16',
  status: 'logged',
  timeIn: null,
  durationMin: null,
  maxDepthM: null,
  avgDepthM: null,
  siteId: null,
  siteName: null,
  centerId: null,
  centerName: null,
  entry: null,
  salinity: null,
  waterBody: null,
  latitude: null,
  longitude: null,
  waterTempC: null,
  airTempC: null,
  visibilityM: null,
  waves: null,
  current: null,
  surge: null,
  suit: null,
  hood: null,
  gloves: null,
  boots: null,
  weightsKg: null,
  buddy: null,
  guide: null,
  title: null,
  notes: null,
  rating: null,
  tanksJson: null,
  manualOrder: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

/** A stand-in for the moment a query's rows landed. Any `Date` will do — `isResolved` reads its
 * presence, never its value — so one constant says "answered" everywhere below. */
const ANSWERED = new Date('2026-08-16T09:15:00.000Z');

interface QueryState {
  data?: unknown[];
  error?: Error;
  updatedAt?: Date;
}

/**
 * Stubs BOTH live queries, dispatching on the query object each was handed — which is the whole
 * reason the two builders above are mocked to return distinguishable strings. Dispatching on
 * call order instead would silently follow whichever `useLiveQuery` call the hook happens to
 * make first, and this file exists precisely to pin that the two reads are kept apart.
 *
 * `mockImplementation`, never `mockReturnValue`, and `data` defaulting to `[]` rather than
 * `undefined`: the real `useLiveQuery` hands back a fresh object every render and seeds `data`
 * with `[]` from the first one for a `db.select()` builder (`isResolved`, db/liveQuery.ts). A
 * stub modelling one frozen object, or an `undefined` `data` this app's reads never produce, is
 * the fiction that has twice let this repo ship a defect behind a full green suite.
 */
function stubQueries(dives: QueryState, settings: QueryState = {}) {
  mockUseLiveQuery.mockImplementation((query: unknown) => {
    const state = query === 'the dives query' ? dives : settings;
    return { data: state.data ?? [], error: state.error, updatedAt: state.updatedAt };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// The wire itself: the app's own database, through the two shared query builders rather than
// queries written here — `listDives` and this hook are built from the same parts precisely so
// they cannot diverge.
it('reads through the shared queries, against the app’s own database', async () => {
  stubQueries({ updatedAt: ANSWERED });
  await renderHook(() => useDives());
  expect(mockDiveRowsQuery).toHaveBeenCalledWith({ theAppsOwnDatabase: true });
  expect(mockDivesBeforeQuery).toHaveBeenCalledWith({ theAppsOwnDatabase: true });
  expect(mockUseLiveQuery).toHaveBeenCalledWith('the dives query');
  expect(mockUseLiveQuery).toHaveBeenCalledWith('the dives_before query');
});

/**
 * M1f's own field, and the decision it records. `dives` is `[]` in three different situations —
 * nothing read yet, a diver with no dives, a read that failed — and until `resolved` existed a
 * caller could tell only the third of them apart. `DiveDetailScreen` therefore said "Dive not
 * found." about a dive that was there, and the edit form drew thirty blank rows over a real
 * dive, on every single open.
 *
 * The last two cases are the ones the field had to CHOOSE between, and they are the reason this
 * is one field reporting on the dives read rather than a pair matching `error`/`settingsError`.
 */
describe('resolved', () => {
  it('is false while the dives query has not answered', async () => {
    stubQueries({});
    const { result } = await renderHook(() => useDives());
    expect(result.current.resolved).toBe(false);
  });

  it('is true once the dives query has answered with no dives at all', async () => {
    // The distinction the whole field exists for: this and the case above hand back the same
    // empty `dives`, and only one of them is a diver who should be shown "Log your first dive".
    stubQueries({ data: [], updatedAt: ANSWERED });
    const { result } = await renderHook(() => useDives());
    expect(result.current.resolved).toBe(true);
    expect(result.current.dives).toEqual([]);
  });

  it('is true for a dives read that failed, so a screen waiting on it cannot hang', async () => {
    // `useLiveQuery` never sets `updatedAt` on a rejection, so a failed read would stay
    // unresolved for ever under an `updatedAt`-only rule — and a screen that waits before it
    // consults `error` would sit on a frame saying nothing instead of reporting the failure.
    stubQueries({ error: new Error('disk full') });
    const { result } = await renderHook(() => useDives());
    expect(result.current.resolved).toBe(true);
  });

  it('does not wait on the settings read, which only supplies a numbering offset', async () => {
    // The mirror of the defect this hook's docblock records. Merging the two ERRORS once let a
    // failed settings read blank the whole logbook; waiting on both READS would let a slow
    // settings read hold the whole logbook back, one render earlier and for the same bad
    // reason — a display preference deciding whether the dives are shown at all.
    stubQueries({ data: [diveRow()], updatedAt: ANSWERED }, {});
    const { result } = await renderHook(() => useDives());
    expect(result.current.resolved).toBe(true);
    expect(result.current.dives).toHaveLength(1);
  });

  it('is false while the dives read is outstanding even though the settings read has answered', async () => {
    // The other direction of the same choice, so neither query can be swapped for the other:
    // an offset that has arrived says nothing about whether the dives have.
    stubQueries({}, { data: [], updatedAt: ANSWERED });
    const { result } = await renderHook(() => useDives());
    expect(result.current.resolved).toBe(false);
  });
});

/**
 * The two error fields, which have never had a test that could fail on them either: both screens
 * that read them mock this module wholesale. They are two fields rather than one for the reason
 * the hook's docblock gives at length — a merged version once rendered two perfectly good dives
 * as nothing but a failure message, over a display preference — and the pair below is what
 * stops that merge from being reintroduced silently.
 */
describe('the two errors, kept apart', () => {
  it('reports a failed dives read as fatal, and says nothing about the settings', async () => {
    const failed = new Error('disk full');
    stubQueries({ error: failed }, { data: [], updatedAt: ANSWERED });
    const { result } = await renderHook(() => useDives());
    expect(result.current.error).toBe(failed);
    expect(result.current.settingsError).toBeUndefined();
  });

  it('keeps the dives when only the settings read failed', async () => {
    const failed = new Error('settings unreadable');
    stubQueries({ data: [diveRow()], updatedAt: ANSWERED }, { error: failed });
    const { result } = await renderHook(() => useDives());
    expect(result.current.settingsError).toBe(failed);
    // The half that matters: `error` stays clear, because DivesScreen blanks the whole screen
    // for that one and there are perfectly good dives to show.
    expect(result.current.error).toBeUndefined();
    expect(result.current.dives).toHaveLength(1);
  });
});

// The rest of the pipeline: the rows go through `toDives` and `assignDiveNumbers`, and the
// offset through `readDivesBefore` — none of them stubbed, so this drives the same chain the app
// does. Stubbed newest-last so the ordering is neither the answer nor already correct.
it('numbers the dives it read, from the offset the settings read supplied', async () => {
  const older = diveRow({ date: '2026-08-16' });
  const newer = diveRow({ date: '2026-08-18' });
  stubQueries(
    { data: [older, newer], updatedAt: ANSWERED },
    { data: [{ key: 'dives_before', value: '247' }], updatedAt: ANSWERED },
  );
  const { result } = await renderHook(() => useDives());
  expect(result.current.dives.map((d) => d.id)).toEqual([newer.id, older.id]);
  expect(result.current.numbers.get(older.id)).toBe(248);
  expect(result.current.numbers.get(newer.id)).toBe(249);
});
