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
  const { result } = await renderHook(() => useDiveSite('s1'));
  expect(result.current).toEqual({ site: row, resolved: true });
});

it('says a row this device does not hold is not there — once it has looked', async () => {
  stubQuery({ data: [], updatedAt: ANSWERED });
  expect((await renderHook(() => useDiveSite('gone'))).result.current).toEqual({ site: null, resolved: true });
  stubQuery({ data: [] });
  expect((await renderHook(() => useDiveSite('gone'))).result.current).toEqual({ site: null, resolved: false });
});

// A dive with no site, or one that is not a plan, asks for nothing: no row, and nothing to wait for.
it('reads no site for no id, and has nothing to wait for', async () => {
  stubQuery({ data: [row] });
  const { result } = await renderHook(() => useDiveSite(null));
  expect(result.current).toEqual({ site: null, resolved: true });
  expect(mockRowQuery).toHaveBeenCalledWith(db, '');
});
