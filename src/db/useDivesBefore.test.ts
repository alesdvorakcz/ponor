import { renderHook } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from './client';
import { divesBeforeQuery } from './settings';
import { useDivesBefore } from './useDivesBefore';

/**
 * The hook's own wiring, which nothing else could reach: the one screen that reads it
 * (`SettingsScreen`) `jest.mock`s the whole module, so both fields it returns were completely
 * undefended — replacing `resolved: isResolved(rows)` with `true` left all 34 Settings tests
 * green while the field went straight back to showing a `0` nobody had entered and overwriting
 * whatever was typed over it.
 *
 * That is the third time this repo has found the same gap (`useGearPresets.test.ts`'s own
 * docblock records the first, `useDives.hook.test.ts` the second), and it is structural rather
 * than careless: a hook whose only consumer mocks it has no test that can fail on it unless one
 * is written here.
 *
 * Same shape as its two siblings. `useLiveQuery` is replaced wholesale (it needs a reactive
 * native database) and `./client` with it, since importing that opens one; `divesBeforeQuery` is
 * stubbed only so it can be asked what it was handed. **`readDivesBefore` and `isDiveCount` stay
 * real**, because they are the halves with the rules in them — what a stored string parses to,
 * and what counts as a dive count — and stubbing them would leave this file asserting against
 * its own idea of the answer.
 */
jest.mock('./client', () => ({ db: { theAppsOwnDatabase: true } }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: jest.fn() }));
jest.mock('./settings', () => ({
  ...jest.requireActual('./settings'),
  divesBeforeQuery: jest.fn(() => 'the dives_before query'),
}));

const mockUseLiveQuery = useLiveQuery as unknown as jest.Mock;
const mockQuery = divesBeforeQuery as unknown as jest.Mock;

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

/** The stored row, as `readDivesBefore` reads it — a text column, which is the whole reason
 * that function exists rather than a cast. */
const storedRow = (value: unknown) => [{ key: 'dives_before', value }];

beforeEach(() => {
  jest.clearAllMocks();
});

it('reads through the shared query, against the app’s own database', async () => {
  stubQuery({ updatedAt: ANSWERED });
  await renderHook(() => useDivesBefore());
  expect(mockQuery).toHaveBeenCalledWith(db);
  expect(mockUseLiveQuery).toHaveBeenCalledWith('the dives_before query');
});

/**
 * M1f, and the field this hook needed most of the three that got one. `count` reads 0 before the
 * read has answered, and 0 is also the honest answer for a diver who never answered the
 * onboarding question — so Settings showed a `0` nobody had entered, in the field the diver
 * types into, and then replaced whatever they typed over it when the real value landed.
 *
 * The first two cases below are that pair: identical `count`, different `resolved`. Nothing but
 * this field can tell them apart.
 */
describe('resolved', () => {
  it('is false while the query has not answered', async () => {
    stubQuery({});
    const { result } = await renderHook(() => useDivesBefore());
    expect(result.current.resolved).toBe(false);
    // ...and `count` is the 0 that made the two indistinguishable, which is what makes the
    // field load-bearing rather than decorative.
    expect(result.current.count).toBe(0);
  });

  it('is true once the query has answered with no stored row, which honestly means zero', async () => {
    stubQuery({ data: [], updatedAt: ANSWERED });
    const { result } = await renderHook(() => useDivesBefore());
    expect(result.current.resolved).toBe(true);
    expect(result.current.count).toBe(0);
  });

  it('is true for a read that failed, so a screen waiting on it cannot hang', async () => {
    // `useLiveQuery` never sets `updatedAt` on a rejection, so a failed read would stay
    // unresolved for ever under an `updatedAt`-only rule — and this screen's count field would
    // then never fill in at all.
    stubQuery({ error: new Error('disk full') });
    const { result } = await renderHook(() => useDivesBefore());
    expect(result.current.resolved).toBe(true);
  });
});

/**
 * `count`'s own three answers, none of which had a test that could fail on them either. The
 * distinction between the last two is the whole reason this hook does not simply return a
 * number: `getDivesBefore`'s docblock (db/settings.ts) records that returning 0 for a corrupt
 * stored value would misnumber the entire logbook by the diver's history with nothing on screen
 * to give it away.
 */
describe('count', () => {
  it('reports a stored count as the number it is', async () => {
    stubQuery({ data: storedRow('247'), updatedAt: ANSWERED });
    const { result } = await renderHook(() => useDivesBefore());
    expect(result.current.count).toBe(247);
  });

  it('reports an absent row as zero — a diver who never answered the question', async () => {
    stubQuery({ data: [], updatedAt: ANSWERED });
    const { result } = await renderHook(() => useDivesBefore());
    expect(result.current.count).toBe(0);
  });

  it('reports a stored value that is not a count as null, never as a plausible zero', async () => {
    stubQuery({ data: storedRow('-3'), updatedAt: ANSWERED });
    const { result } = await renderHook(() => useDivesBefore());
    expect(result.current.count).toBeNull();
  });
});
