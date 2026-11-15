import { renderHook } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { diveSiteRowQuery } from './catalogue';
import { db } from './client';
import { useDiveSite } from './useDiveSite';

/**
 * **One catalogue site, live, by id** (#27's second review) — the read a planned dive's *Show on
 * map* decides with. `useLiveQuery` is faked here, as in `useDiveSamples.test.ts`: what this hook
 * owns is which query it subscribes to, what the subscription depends on, and how a row or no row
 * becomes its answer.
 */

jest.mock('./client', () => ({ db: { theAppsOwnDatabase: true } }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: jest.fn() }));
jest.mock('./catalogue', () => ({
  ...jest.requireActual('./catalogue'),
  diveSiteRowQuery: jest.fn(() => 'the one-row query'),
}));

const mockUseLiveQuery = useLiveQuery as unknown as jest.Mock;
const mockRowQuery = diveSiteRowQuery as unknown as jest.Mock;

const ANSWERED = new Date('2026-08-16T09:15:00.000Z');
const row = { id: 's1', name: 'Blue Hole', latitude: 43.0378, longitude: 16.1489 };

function stubQuery(state: { data?: unknown[]; updatedAt?: Date }) {
  mockUseLiveQuery.mockImplementation(() => ({ data: state.data ?? [], error: undefined, updatedAt: state.updatedAt }));
}

beforeEach(() => jest.clearAllMocks());

it('subscribes to that one row, keyed on its id', async () => {
  stubQuery({ data: [row], updatedAt: ANSWERED });
  await renderHook(() => useDiveSite('s1'));
  expect(mockRowQuery).toHaveBeenCalledWith(db, 's1');
  // The deps: without them a reused screen would go on holding the first id's row.
  expect(mockUseLiveQuery).toHaveBeenCalledWith('the one-row query', ['s1']);
});

it('hands the row over once the read has answered', async () => {
  stubQuery({ data: [row], updatedAt: ANSWERED });
  expect((await renderHook(() => useDiveSite('s1'))).result.current).toBe(row);
});

it('reads a row this device does not hold, or has not read yet, as no site', async () => {
  stubQuery({ data: [], updatedAt: ANSWERED });
  expect((await renderHook(() => useDiveSite('gone'))).result.current).toBeNull();
  stubQuery({ data: [] });
  expect((await renderHook(() => useDiveSite('gone'))).result.current).toBeNull();
});

// #27's third review: `useLiveQuery` keeps the previous id's rows until the new query returns, so
// right after a plan's site is edited the read still holds the OLD site. That row is not an answer
// for the new id — the map would be pointed at the place the plan no longer goes.
it('does not hand over a row left from the id it was asked before', async () => {
  stubQuery({ data: [row], updatedAt: ANSWERED });
  const { result, rerender } = await renderHook(({ id }: { id: string }) => useDiveSite(id), {
    initialProps: { id: 's1' },
  });
  expect(result.current).toBe(row);
  await rerender({ id: 's2' });
  expect(mockUseLiveQuery).toHaveBeenLastCalledWith('the one-row query', ['s2']);
  expect(result.current).toBeNull();
});

// A dive with no site, or one that is not a plan, asks for nothing — even while the read still
// holds the row from when it was a plan with a site.
it('reads no site for no id', async () => {
  stubQuery({ data: [row], updatedAt: ANSWERED });
  const { result } = await renderHook(() => useDiveSite(null));
  expect(result.current).toBeNull();
  expect(mockRowQuery).toHaveBeenCalledWith(db, '');
});
