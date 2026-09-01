import { renderHook } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from './client';
import { gearPresetRowsQuery } from './gearPresets';
import { useGearPresets } from './useGearPresets';

/**
 * The hook's own wiring, which nothing else could reach: both screens that read it
 * `jest.mock` the whole module, so `error: rows.error` had no coverage anywhere — replacing
 * it with `undefined` left Settings (28 tests) and the editor (41) fully green while a diver
 * whose read failed was told they simply had no presets. That one line is the entire reason
 * the hook carries an `error` field: it is what tells "Couldn't load your presets" from "you
 * have none yet" on Settings, and from "may have been deleted" in the editor.
 *
 * `useLiveQuery` is replaced wholesale — it needs a real reactive database — and `./client`
 * with it, since importing it opens one. `gearPresetRowsQuery` is stubbed only so it can be
 * asked what it was handed; **`toGearPresets` stays real**, because it is the half of the
 * pipeline that has a rule in it (`comparePresets`), and stubbing it would leave this file
 * asserting against its own idea of what the hook returns.
 */
jest.mock('./client', () => ({ db: { theAppsOwnDatabase: true } }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: jest.fn() }));
jest.mock('./gearPresets', () => ({
  ...jest.requireActual('./gearPresets'),
  gearPresetRowsQuery: jest.fn(() => 'the live rows query'),
}));

const mockUseLiveQuery = useLiveQuery as unknown as jest.Mock;
const mockRowsQuery = gearPresetRowsQuery as unknown as jest.Mock;

let seq = 0;
const row = (over: Record<string, unknown> = {}) => ({
  id: `preset-${String(seq++).padStart(4, '0')}`,
  name: 'twin 12 steel',
  tanks: [],
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

/**
 * `mockImplementation`, never `mockReturnValue` — the real `useLiveQuery` hands back a fresh
 * object each render, and a stub modelling one frozen answer forever is the fiction that let
 * this repo ship a screen looping infinitely behind 537 green tests.
 *
 * **`data` defaults to `[]`, not to `undefined`, and `updatedAt` is what says whether the query
 * has answered.** That is not a convenience: it is what the real hook does. `useLiveQuery`
 * seeds its own state with `[]` for a `db.select()` builder and sets `updatedAt` only when rows
 * actually arrive (`isResolved`, db/liveQuery.ts). A stub handing back `data: undefined` for an
 * unresolved query — which this file did until M1f — models a state this app's reads never
 * reach, and modelling it is what let the "before the query has resolved" case below pass while
 * every screen holding this hook was in fact told it had no presets.
 */
function stubQuery(state: { data?: unknown[]; error?: Error; updatedAt?: Date }) {
  mockUseLiveQuery.mockImplementation(() => ({
    data: state.data ?? [],
    error: state.error,
    updatedAt: state.updatedAt,
  }));
}

/** A stand-in for the moment the rows landed. Any `Date` will do — `isResolved` reads its
 * presence, never its value — so one shared constant says "answered" everywhere below. */
const ANSWERED = new Date('2026-08-16T09:15:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
});

it('hands back the error the read failed with, rather than an empty logbook of presets', async () => {
  const failed = new Error('disk full');
  stubQuery({ error: failed });
  const { result } = await renderHook(() => useGearPresets());
  expect(result.current.error).toBe(failed);
  // ...and no presets, which is what makes the two answers distinguishable at all: a caller
  // seeing `[]` alone cannot tell a failed read from a first-time diver.
  expect(result.current.presets).toEqual([]);
});

it('reports no error at all when the read succeeded', async () => {
  stubQuery({ data: [row({ name: 'alu 80' })], updatedAt: ANSWERED });
  const { result } = await renderHook(() => useGearPresets());
  expect(result.current.error).toBeUndefined();
  expect(result.current.presets.map((p) => p.name)).toEqual(['alu 80']);
});

// An unanswered query is not an error and must not read as one — the first render of every
// screen holding this hook.
it('reads as an empty list, not a failure, before the query has answered', async () => {
  stubQuery({});
  const { result } = await renderHook(() => useGearPresets());
  expect(result.current.presets).toEqual([]);
  expect(result.current.error).toBeUndefined();
});

/**
 * `error` is not `useLiveQuery`'s own `error`, and this is the only place that can fail on it
 * (M1g): both screens that read this hook mock the whole module.
 *
 * That hook sets `error` in its failure paths and NEVER clears it, so a field forwarded raw
 * stands for the life of the component — through every later read that succeeds. Settings went
 * on saying "Couldn't load your presets" over a list it had; the editor, which dispatches on
 * this field to choose between its two sentences, went on picking the wrong one. The rule lives
 * in `useCurrentError` (db/liveQuery.ts) and its own suite covers its cases; this is the wiring.
 */
describe('a failure that is no longer what the read says', () => {
  it('stops reporting it once a later read succeeds', async () => {
    const failed = new Error('disk full');
    stubQuery({ error: failed });
    const { result, rerender } = await renderHook(() => useGearPresets());
    expect(result.current.error).toBe(failed);

    // The shape a recovered read really has: the same error object still in `useLiveQuery`'s
    // state, with rows and an `updatedAt` that arrived after it.
    stubQuery({ data: [row({ name: 'alu 80' })], error: failed, updatedAt: ANSWERED });
    await rerender(undefined);

    expect(result.current.error).toBeUndefined();
    expect(result.current.presets.map((p) => p.name)).toEqual(['alu 80']);
  });

  it('goes on reporting one that is still the last thing the read said', async () => {
    // A read that answered and THEN failed carries both fields at once, exactly as a recovered
    // one does, and this one is live. Two renders, because the first is answered before any
    // comparison is made.
    const failed = new Error('disk full');
    stubQuery({ data: [row({ name: 'alu 80' })], updatedAt: ANSWERED });
    const { result, rerender } = await renderHook(() => useGearPresets());
    expect(result.current.error).toBeUndefined();

    stubQuery({ data: [row({ name: 'alu 80' })], error: failed, updatedAt: ANSWERED });
    await rerender(undefined);
    expect(result.current.error).toBe(failed);

    await rerender(undefined);
    expect(result.current.error).toBe(failed);
  });
});

/**
 * M1f's own field. `presets` is `[]` in three quite different situations — nothing read yet, a
 * diver with no presets, a read that failed — and until `resolved` existed a caller could tell
 * only the third of them apart, by `error`. `GearPresetScreen` therefore said "may have been
 * deleted" about a preset that was there, on every single open.
 *
 * The four cases below are the four states `isResolved` can be asked about, and each of them
 * is a screen behaviour: stay silent, say "you have none", say "couldn't read them", and
 * (below) do not hang on a failure.
 */
describe('resolved', () => {
  it('is false while the query has not answered', async () => {
    stubQuery({});
    const { result } = await renderHook(() => useGearPresets());
    expect(result.current.resolved).toBe(false);
  });

  it('is true once the query has answered with no presets at all', async () => {
    // The distinction the whole field exists for: this and the case above hand back the same
    // empty `presets`, and Settings must say "save one from a dive" for exactly one of them.
    stubQuery({ data: [], updatedAt: ANSWERED });
    const { result } = await renderHook(() => useGearPresets());
    expect(result.current.resolved).toBe(true);
    expect(result.current.presets).toEqual([]);
  });

  it('is true once the query has answered with presets', async () => {
    stubQuery({ data: [row({ name: 'alu 80' })], updatedAt: ANSWERED });
    const { result } = await renderHook(() => useGearPresets());
    expect(result.current.resolved).toBe(true);
  });

  it('is true for a read that failed, so a screen waiting on it cannot hang', async () => {
    // `useLiveQuery` never sets `updatedAt` on a rejection, so a failed read stays unresolved
    // for ever under a `updatedAt`-only rule — and `GearPresetScreen`, which waits before it
    // consults `error`, would then never reach "Couldn't load your presets" at all.
    stubQuery({ error: new Error('disk full') });
    const { result } = await renderHook(() => useGearPresets());
    expect(result.current.resolved).toBe(true);
    expect(result.current.error).toBeDefined();
  });
});

// The rest of the pipeline, in one assertion: the rows go through `toGearPresets`, which
// applies `comparePresets`. Stubbed in an order that is neither the answer nor its reverse.
it('sorts what the query hands back, through the one comparator', async () => {
  stubQuery({
    data: [row({ name: 'twin 12 steel' }), row({ name: 'Alu 80 nitrox' }), row({ name: 'alu 80' })],
    updatedAt: ANSWERED,
  });
  const { result } = await renderHook(() => useGearPresets());
  expect(result.current.presets.map((p) => p.name)).toEqual(['alu 80', 'Alu 80 nitrox', 'twin 12 steel']);
});

// The wire itself: the app's own database, through the shared query rather than a second one
// written here — `listGearPresets` and this hook are built from the same two parts precisely
// so they cannot diverge.
it('reads through the shared query, against the app’s own database', async () => {
  stubQuery({ data: [], updatedAt: ANSWERED });
  await renderHook(() => useGearPresets());
  expect(mockRowsQuery).toHaveBeenCalledWith(db);
  expect(mockUseLiveQuery).toHaveBeenCalledWith('the live rows query');
});
