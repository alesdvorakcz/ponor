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

/** `mockImplementation`, never `mockReturnValue` — the real `useLiveQuery` hands back a fresh
 * object each render, and a stub modelling one frozen answer forever is the fiction that let
 * this repo ship a screen looping infinitely behind 537 green tests. */
function stubQuery(state: { data?: unknown[]; error?: Error }) {
  mockUseLiveQuery.mockImplementation(() => ({ data: state.data, error: state.error }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('hands back the error the read failed with, rather than an empty logbook of presets', async () => {
  const failed = new Error('disk full');
  stubQuery({ data: undefined, error: failed });
  const { result } = await renderHook(() => useGearPresets());
  expect(result.current.error).toBe(failed);
  // ...and no presets, which is what makes the two answers distinguishable at all: a caller
  // seeing `[]` alone cannot tell a failed read from a first-time diver.
  expect(result.current.presets).toEqual([]);
});

it('reports no error at all when the read succeeded', async () => {
  stubQuery({ data: [row({ name: 'alu 80' })] });
  const { result } = await renderHook(() => useGearPresets());
  expect(result.current.error).toBeUndefined();
  expect(result.current.presets.map((p) => p.name)).toEqual(['alu 80']);
});

// `data` is `undefined` until the query first resolves, which is not an error and must not
// read as one — the first render of every screen holding this hook.
it('reads as an empty list, not a failure, before the query has resolved', async () => {
  stubQuery({ data: undefined });
  const { result } = await renderHook(() => useGearPresets());
  expect(result.current.presets).toEqual([]);
  expect(result.current.error).toBeUndefined();
});

// The rest of the pipeline, in one assertion: the rows go through `toGearPresets`, which
// applies `comparePresets`. Stubbed in an order that is neither the answer nor its reverse.
it('sorts what the query hands back, through the one comparator', async () => {
  stubQuery({ data: [row({ name: 'twin 12 steel' }), row({ name: 'Alu 80 nitrox' }), row({ name: 'alu 80' })] });
  const { result } = await renderHook(() => useGearPresets());
  expect(result.current.presets.map((p) => p.name)).toEqual(['alu 80', 'Alu 80 nitrox', 'twin 12 steel']);
});

// The wire itself: the app's own database, through the shared query rather than a second one
// written here — `listGearPresets` and this hook are built from the same two parts precisely
// so they cannot diverge.
it('reads through the shared query, against the app’s own database', async () => {
  stubQuery({ data: [] });
  await renderHook(() => useGearPresets());
  expect(mockRowsQuery).toHaveBeenCalledWith(db);
  expect(mockUseLiveQuery).toHaveBeenCalledWith('the live rows query');
});
