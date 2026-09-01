import { renderHook } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from './client';
import { openFormGroupsQuery } from './settings';
import { useOpenFormGroups } from './useOpenFormGroups';

/**
 * The hook's own wiring, which nothing else can reach — the fourth time this repo has written
 * this file for this reason, and the third docblock to say so out loud.
 * `useGearPresets.test.ts` records the first, `useDives.hook.test.ts` the second and
 * `useDivesBefore.test.ts` the third: **a hook whose only consumer `jest.mock`s the whole module
 * has no test anywhere that can fail on it** unless one is written here. `DiveFormScreen`
 * mocks this one exactly as it mocks the other three, so without this file `resolved:
 * isResolved(rows)` could be replaced by `true` with every one of the form's tests green — and
 * the form would then write a remembered-group set composed from an answer nobody had, erasing
 * whatever the row really held.
 *
 * Same shape as its three siblings. `useLiveQuery` is replaced wholesale (it needs a reactive
 * native database) and `./client` with it, since importing that opens one; `openFormGroupsQuery`
 * is stubbed only so it can be asked what it was handed. **`readOpenFormGroups` stays real**,
 * because it is the half with the rules in it — what a stored string parses to, and what is
 * kept out of it — and stubbing it would leave this file asserting against its own idea of the
 * answer. `db/settings.test.ts` exercises that function against a real database.
 */
jest.mock('./client', () => ({ db: { theAppsOwnDatabase: true } }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: jest.fn() }));
jest.mock('./settings', () => ({
  ...jest.requireActual('./settings'),
  openFormGroupsQuery: jest.fn(() => 'the form_groups_open query'),
}));

const mockUseLiveQuery = useLiveQuery as unknown as jest.Mock;
const mockQuery = openFormGroupsQuery as unknown as jest.Mock;

/** A stand-in for the moment the rows landed. Any `Date` will do — `isResolved` reads its
 * presence, never its value. */
const ANSWERED = new Date('2026-08-16T09:15:00.000Z');

/**
 * `mockImplementation`, never `mockReturnValue`, and `data` defaulting to `[]` rather than
 * `undefined`: the real `useLiveQuery` hands back a fresh object every render and seeds `data`
 * with `[]` from the first one for a `db.select()` builder (`isResolved`, db/liveQuery.ts).
 */
function stubQuery(state: { data?: unknown[]; error?: Error; updatedAt?: Date }) {
  mockUseLiveQuery.mockImplementation(() => ({
    data: state.data ?? [],
    error: state.error,
    updatedAt: state.updatedAt,
  }));
}

/** The stored row, as `readOpenFormGroups` reads it — a text column holding JSON, which is why
 * that function parses rather than casts. */
const storedRow = (value: unknown) => [{ key: 'form_groups_open', value }];

beforeEach(() => {
  jest.clearAllMocks();
});

it('reads through the shared query, against the app’s own database', async () => {
  stubQuery({ updatedAt: ANSWERED });
  await renderHook(() => useOpenFormGroups());
  expect(mockQuery).toHaveBeenCalledWith(db);
  expect(mockUseLiveQuery).toHaveBeenCalledWith('the form_groups_open query');
});

/**
 * The pair nothing else can tell apart: an empty `remembered` is what "the diver has decided
 * about nothing" and "nobody has looked yet" both read as, and the dive form composes its WRITE
 * out of that map. A form that could not tell them apart would store a memory built on the
 * second while believing the first, deleting whatever was really there.
 */
describe('resolved', () => {
  it('is false while the query has not answered, over the same empty list as a real answer', async () => {
    stubQuery({});
    const { result } = await renderHook(() => useOpenFormGroups());
    expect(result.current.resolved).toBe(false);
    expect(result.current.remembered).toEqual({});
  });

  it('is true once the query has answered with no stored row, which honestly means none', async () => {
    stubQuery({ data: [], updatedAt: ANSWERED });
    const { result } = await renderHook(() => useOpenFormGroups());
    expect(result.current.resolved).toBe(true);
    expect(result.current.remembered).toEqual({});
  });

  it('is true for a read that failed, so nothing waiting on it can hang', async () => {
    // `useLiveQuery` never sets `updatedAt` on a rejection, so a failed read would stay
    // unresolved for ever under an `updatedAt`-only rule — and this form would then never
    // remember a group the diver opened, for the rest of the session, with nothing to say so.
    stubQuery({ error: new Error('disk full') });
    const { result } = await renderHook(() => useOpenFormGroups());
    expect(result.current.resolved).toBe(true);
  });
});

it('reports both kinds of decision, through the reader that owns what a stored row means', async () => {
  stubQuery({ data: storedRow(JSON.stringify({ conditions: true, times: false })), updatedAt: ANSWERED });
  const { result } = await renderHook(() => useOpenFormGroups());
  expect(result.current.remembered).toEqual({ conditions: true, times: false });
});

it('reports a row it cannot read as no memory, rather than failing the render that holds a form', async () => {
  // §2.2's defaults are what an empty memory degrades to, and §1 is why that is the whole answer
  // here: a display preference may not take a form down, and a diver who loses this loses one tap.
  stubQuery({ data: storedRow('not JSON at all'), updatedAt: ANSWERED });
  const { result } = await renderHook(() => useOpenFormGroups());
  expect(result.current.remembered).toEqual({});
  expect(result.current.resolved).toBe(true);
});
