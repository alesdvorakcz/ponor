import { renderHook } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { diveCenterRowQuery } from './catalogue';
import { db } from './client';
import { useDiveCenter } from './useDiveCenter';

/**
 * **One catalogue centre, live, by id** (#36) — the read the dive form's *Centre* row captions with,
 * `useDiveSite`'s twin for the other table. `useLiveQuery` is faked as in `useDiveSite.test.ts`:
 * what this hook owns is which query it subscribes to, what the subscription depends on, and how a
 * row or no row becomes its answer.
 */

jest.mock('./client', () => ({ db: { theAppsOwnDatabase: true } }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: jest.fn() }));
jest.mock('./catalogue', () => ({
  ...jest.requireActual('./catalogue'),
  diveCenterRowQuery: jest.fn(() => 'the one-row query'),
}));

const mockUseLiveQuery = useLiveQuery as unknown as jest.Mock;
const mockRowQuery = diveCenterRowQuery as unknown as jest.Mock;

const ANSWERED = new Date('2026-08-16T09:15:00.000Z');
const row = { id: 'c1', name: 'Aqua Divers', country: 'EG', dirty: false };

function stubQuery(state: { data?: unknown[]; updatedAt?: Date }) {
  mockUseLiveQuery.mockImplementation(() => ({ data: state.data ?? [], error: undefined, updatedAt: state.updatedAt }));
}

beforeEach(() => jest.clearAllMocks());

it('subscribes to that one row, keyed on its id', async () => {
  stubQuery({ data: [row], updatedAt: ANSWERED });
  await renderHook(() => useDiveCenter('c1'));
  expect(mockRowQuery).toHaveBeenCalledWith(db, 'c1');
  // The deps: without them a reused screen would go on holding the first id's row.
  expect(mockUseLiveQuery).toHaveBeenCalledWith('the one-row query', ['c1']);
});

it('hands the row over once the read has answered', async () => {
  stubQuery({ data: [row], updatedAt: ANSWERED });
  expect((await renderHook(() => useDiveCenter('c1'))).result.current).toBe(row);
});

it('reads a row this device does not hold, or has not read yet, as no centre', async () => {
  stubQuery({ data: [], updatedAt: ANSWERED });
  expect((await renderHook(() => useDiveCenter('gone'))).result.current).toBeNull();
  stubQuery({ data: [] });
  expect((await renderHook(() => useDiveCenter('gone'))).result.current).toBeNull();
});

// `useLiveQuery` keeps the previous id's rows until the new query returns, so right after a new
// centre is picked the read still holds the OLD centre. That row is not an answer for the new id —
// the row would be captioned with the shop the dive is no longer with.
it('does not hand over a row left from the id it was asked before', async () => {
  stubQuery({ data: [row], updatedAt: ANSWERED });
  const { result, rerender } = await renderHook(({ id }: { id: string }) => useDiveCenter(id), {
    initialProps: { id: 'c1' },
  });
  expect(result.current).toBe(row);
  await rerender({ id: 'c2' });
  expect(mockUseLiveQuery).toHaveBeenLastCalledWith('the one-row query', ['c2']);
  expect(result.current).toBeNull();
});

// A dive with no centre asks for nothing — even while the read still holds the row from before.
it('reads no centre for no id', async () => {
  stubQuery({ data: [row], updatedAt: ANSWERED });
  const { result } = await renderHook(() => useDiveCenter(null));
  expect(result.current).toBeNull();
  expect(mockRowQuery).toHaveBeenCalledWith(db, '');
});
