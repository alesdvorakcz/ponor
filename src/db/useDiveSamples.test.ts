import { renderHook } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from './client';
import { diveSampleRowsQuery } from './diveSamples';
import type { DiveSample } from './schema';
import { useDiveSamples } from './useDiveSamples';

/**
 * The hook's own wiring — `useGearPresets.test.ts`'s shape, mock for mock, because this is the
 * same object one table over and the reasons it gives all hold here.
 *
 * `useLiveQuery` is replaced wholesale (it needs a real reactive database) and `./client` with
 * it, since importing it opens one. `diveSampleRowsQuery` is stubbed only so it can be asked
 * what it was handed; **`toDiveSamples` stays real**, because it is the half of the pipeline
 * that has a rule in it — an absent row and a stored-but-empty series are both `null`, never
 * `[]`, which is what stops a chart drawing zero points instead of not drawing at all (§0.4).
 */
jest.mock('./client', () => ({ db: { theAppsOwnDatabase: true } }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: jest.fn() }));
jest.mock('./diveSamples', () => ({
  ...jest.requireActual('./diveSamples'),
  diveSampleRowsQuery: jest.fn(() => 'the live rows query'),
}));

const mockUseLiveQuery = useLiveQuery as unknown as jest.Mock;
const mockRowsQuery = diveSampleRowsQuery as unknown as jest.Mock;

const SERIES: DiveSample[] = [
  [0, 1.2, 27.7, 188.9],
  [10, 12.4, 27.4, 186.1],
];

const row = (over: Record<string, unknown> = {}) => ({
  id: 'dive-1',
  series: SERIES,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

/**
 * `mockImplementation`, never `mockReturnValue`, and `data` defaulting to `[]` rather than
 * `undefined` — `useGearPresets.test.ts` carries both reasons in full: the real hook hands back
 * a fresh object each render, and it seeds `data` with `[]` for a `db.select()` builder, so
 * `updatedAt` is the only field that says whether the query has answered.
 */
function stubQuery(state: { data?: unknown[]; error?: Error; updatedAt?: Date }) {
  mockUseLiveQuery.mockImplementation(() => ({
    data: state.data ?? [],
    error: state.error,
    updatedAt: state.updatedAt,
  }));
}

const ANSWERED = new Date('2026-08-16T09:15:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
});

it('hands back the series stored for the dive', async () => {
  stubQuery({ data: [row()], updatedAt: ANSWERED });
  const { result } = await renderHook(() => useDiveSamples('dive-1'));
  expect(result.current.samples).toEqual(SERIES);
});

// Most dives have no profile at all, and that is not an error — §0.4's "no curve is drawn for
// a dive without a real sample series" starts here.
it('hands back null for a dive with no series at all', async () => {
  stubQuery({ data: [], updatedAt: ANSWERED });
  const { result } = await renderHook(() => useDiveSamples('dive-1'));
  expect(result.current.samples).toBeNull();
  expect(result.current.error).toBeUndefined();
});

// The rule that makes `null` mean one thing: a row holding an empty series is a dive with no
// profile, exactly as a missing row is. `[]` would reach a chart as "draw nothing here", which
// is a different instruction from "there is nothing to draw".
it('hands back null for a row whose series is empty, not an empty array', async () => {
  stubQuery({ data: [row({ series: [] })], updatedAt: ANSWERED });
  const { result } = await renderHook(() => useDiveSamples('dive-1'));
  expect(result.current.samples).toBeNull();
});

it('hands back the error the read failed with, rather than a dive that has no profile', async () => {
  const failed = new Error('disk full');
  stubQuery({ error: failed });
  const { result } = await renderHook(() => useDiveSamples('dive-1'));
  expect(result.current.error).toBe(failed);
  expect(result.current.samples).toBeNull();
});

/**
 * `error` is `useCurrentError`'s, not `useLiveQuery`'s own — that hook sets `error` in its
 * failure paths and never clears it, so a field forwarded raw stands for the life of the
 * component through every later read that succeeds. The rule and its cases live in
 * `db/liveQuery.ts`; this is the wiring, and the only place it can fail.
 */
it('stops reporting a failure once a later read succeeds', async () => {
  const failed = new Error('disk full');
  stubQuery({ error: failed });
  const { result, rerender } = await renderHook(() => useDiveSamples('dive-1'));
  expect(result.current.error).toBe(failed);

  stubQuery({ data: [row()], error: failed, updatedAt: ANSWERED });
  await rerender(undefined);

  expect(result.current.error).toBeUndefined();
  expect(result.current.samples).toEqual(SERIES);
});

describe('resolved', () => {
  it('is false while the query has not answered', async () => {
    stubQuery({});
    const { result } = await renderHook(() => useDiveSamples('dive-1'));
    expect(result.current.resolved).toBe(false);
    // ...and the samples read exactly as a dive with no profile does, which is why a caller
    // that has to tell the two apart cannot do it on `samples` alone.
    expect(result.current.samples).toBeNull();
  });

  it('is true once the query has answered that the dive has no series', async () => {
    stubQuery({ data: [], updatedAt: ANSWERED });
    const { result } = await renderHook(() => useDiveSamples('dive-1'));
    expect(result.current.resolved).toBe(true);
  });

  it('is true for a read that failed, so a screen waiting on it cannot hang', async () => {
    stubQuery({ error: new Error('disk full') });
    const { result } = await renderHook(() => useDiveSamples('dive-1'));
    expect(result.current.resolved).toBe(true);
  });
});

// The wire itself: the app's own database, through the shared query rather than a second one
// written here — `getDiveSamples` and this hook are built from the same two parts precisely so
// they cannot diverge.
it('reads through the shared query, against the app’s own database', async () => {
  stubQuery({ data: [], updatedAt: ANSWERED });
  await renderHook(() => useDiveSamples('dive-1'));
  expect(mockRowsQuery).toHaveBeenCalledWith(db, 'dive-1');
});

/**
 * **The dependency `useGearPresets` never had to think about.** `useLiveQuery` subscribes
 * inside a `useEffect` whose deps default to `[]` (drizzle-orm/expo-sqlite/query.js), so a
 * query rebuilt for a different id on a later render is simply never run: the effect does not
 * re-fire and the hook keeps delivering the first dive's rows. Every other live read in this
 * app is parameterless and cannot reach that state; this one takes an id, so it has to pass it
 * as the dependency — and a screen reused across two dives (expo-router keeps a route's
 * component mounted) would otherwise draw the previous dive's profile under this dive's name.
 */
it('re-subscribes when it is asked about a different dive', async () => {
  stubQuery({ data: [], updatedAt: ANSWERED });
  await renderHook(() => useDiveSamples('dive-1'));
  expect(mockUseLiveQuery).toHaveBeenCalledWith('the live rows query', ['dive-1']);
});
