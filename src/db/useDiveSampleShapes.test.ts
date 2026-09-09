import { renderHook } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from './client';
import { everyDiveSampleRowsQuery } from './diveSamples';
import type { DiveSample } from './schema';
import { useDiveSampleShapes } from './useDiveSampleShapes';

/**
 * The hook's own wiring — `useGearPresets.test.ts`'s shape, mock for mock, because Task 6's
 * ruling asks this hook to follow that one exactly, "including how it handles `resolved` and
 * `error` and why it memoises."
 *
 * `useLiveQuery` is replaced wholesale (it needs a real reactive database) and `./client` with
 * it, since importing it opens one. `everyDiveSampleRowsQuery` is stubbed only so it can be
 * asked what it was handed; **`toDiveSampleShapes` stays real**, because it is the half of the
 * pipeline that has a rule in it — a row with no series, or a stored-but-empty one, gets no
 * entry in the map at all, which is what `diveSamples.test.ts` already pins at the repository.
 */
jest.mock('./client', () => ({ db: { theAppsOwnDatabase: true } }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: jest.fn() }));
jest.mock('./diveSamples', () => ({
  ...jest.requireActual('./diveSamples'),
  everyDiveSampleRowsQuery: jest.fn(() => 'the live rows query'),
}));

const mockUseLiveQuery = useLiveQuery as unknown as jest.Mock;
const mockRowsQuery = everyDiveSampleRowsQuery as unknown as jest.Mock;

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

it('hands back a map holding every dive that has a series', async () => {
  stubQuery({ data: [row(), row({ id: 'dive-2', series: [[0, 5, null, null]] })], updatedAt: ANSWERED });
  const { result } = await renderHook(() => useDiveSampleShapes());
  expect(result.current.shapes.get('dive-1')).toEqual(SERIES);
  expect(result.current.shapes.get('dive-2')).toEqual([[0, 5, null, null]]);
  expect(result.current.shapes.size).toBe(2);
});

// Most dives have no profile at all, and that is not an error — the same "absent and empty
// are one answer" rule `useDiveSamples` states as `null`, here as "no entry in the map".
it('hands back an empty map when nothing has a series yet', async () => {
  stubQuery({ data: [], updatedAt: ANSWERED });
  const { result } = await renderHook(() => useDiveSampleShapes());
  expect(result.current.shapes.size).toBe(0);
  expect(result.current.error).toBeUndefined();
});

it('gives a row with an empty series no entry, not an empty array', async () => {
  stubQuery({ data: [row({ series: [] })], updatedAt: ANSWERED });
  const { result } = await renderHook(() => useDiveSampleShapes());
  expect(result.current.shapes.has('dive-1')).toBe(false);
});

it('hands back the error the read failed with, rather than a logbook with no profiles at all', async () => {
  const failed = new Error('disk full');
  stubQuery({ error: failed });
  const { result } = await renderHook(() => useDiveSampleShapes());
  expect(result.current.error).toBe(failed);
  // ...and no shapes, which is what makes the two answers distinguishable at all: a caller
  // seeing an empty map alone cannot tell a failed read from a logbook with nothing imported.
  expect(result.current.shapes.size).toBe(0);
});

/**
 * `error` is `useCurrentError`'s, not `useLiveQuery`'s own — that hook sets `error` in its
 * failure paths and never clears it, so a field forwarded raw stands for the life of the
 * component through every later read that succeeds, which is exactly the plausible lie this
 * task's own ruling exists to keep out of the diver's logbook. The rule and its cases live in
 * `db/liveQuery.ts`; this is the wiring, and the only place it can fail.
 */
it('stops reporting a failure once a later read succeeds', async () => {
  const failed = new Error('disk full');
  stubQuery({ error: failed });
  const { result, rerender } = await renderHook(() => useDiveSampleShapes());
  expect(result.current.error).toBe(failed);

  stubQuery({ data: [row()], error: failed, updatedAt: ANSWERED });
  await rerender(undefined);

  expect(result.current.error).toBeUndefined();
  expect(result.current.shapes.get('dive-1')).toEqual(SERIES);
});

describe('resolved', () => {
  it('is false while the query has not answered', async () => {
    stubQuery({});
    const { result } = await renderHook(() => useDiveSampleShapes());
    expect(result.current.resolved).toBe(false);
  });

  it('is true once the query has answered with no series at all', async () => {
    stubQuery({ data: [], updatedAt: ANSWERED });
    const { result } = await renderHook(() => useDiveSampleShapes());
    expect(result.current.resolved).toBe(true);
  });

  it('is true once the query has answered with a series', async () => {
    stubQuery({ data: [row()], updatedAt: ANSWERED });
    const { result } = await renderHook(() => useDiveSampleShapes());
    expect(result.current.resolved).toBe(true);
  });

  it('is true for a read that failed, so a screen waiting on it cannot hang', async () => {
    stubQuery({ error: new Error('disk full') });
    const { result } = await renderHook(() => useDiveSampleShapes());
    expect(result.current.resolved).toBe(true);
  });
});

// The wire itself: the app's own database, through the shared query rather than a second one
// written here — `listDiveSamples` and this hook are built from the same query precisely so
// they cannot diverge (`diveSamples.test.ts` pins the same fact from the repository side).
it('reads through the shared query, against the app’s own database', async () => {
  stubQuery({ data: [], updatedAt: ANSWERED });
  await renderHook(() => useDiveSampleShapes());
  expect(mockRowsQuery).toHaveBeenCalledWith(db);
  expect(mockUseLiveQuery).toHaveBeenCalledWith('the live rows query');
});

/**
 * **These rows render in a list, and this is the property that makes memoising worth
 * anything** (`useGearPresets`'s own docblock states the mechanism this leans on): `useLiveQuery`
 * holds `data` in `useState` and hands back the SAME array reference until the query genuinely
 * re-runs, so `toDiveSampleShapes` only has to recompute when a row actually changed. Proven
 * directly rather than assumed — a stub that returns one frozen array across two renders is
 * exactly what the real hook does between two database-inert renders.
 */
it('hands back the same map reference across a render that changed nothing underneath it', async () => {
  const data = [row()];
  stubQuery({ data, updatedAt: ANSWERED });
  const { result, rerender } = await renderHook(() => useDiveSampleShapes());
  const first = result.current.shapes;

  await rerender(undefined);
  expect(result.current.shapes).toBe(first);
});
