import { type SupabaseClient } from '@supabase/supabase-js';

import { SEARCH_CENTERS_RPC, searchCenters } from './searchCenters';
import { type Cloud } from './supabase';

/**
 * **§2.3's live search for centres, on the client** — the first caller `public.search_centers`
 * has ever had (it was written in M2j).
 *
 * What this file can prove is the client's side of the boundary: what is asked, when it is not
 * asked at all, what is refused, and what shape comes back. What it cannot prove is anything
 * about `pg_trgm` or `public.name_fold` — `similarSites.test.ts` records the whole argument, and
 * it applies unchanged: **no round trip has ever been performed from this repository**, so what
 * is faked is the *transport* and never the rule.
 *
 * The rows below are written out in SQL's own snake_case rather than built from a `DiveCenter`
 * fixture, deliberately: the payload is a claim about the WIRE, and `public.sync_site` renders a
 * centre with `latitude`/`longitude` where the table has a PostGIS point (§6).
 */
const PONORKA = {
  id: 'centre-ponorka',
  name: 'Ponorka',
  country: 'CZ',
  latitude: 50.08,
  longitude: 14.44,
  website: 'https://ponorka.example',
  created_by: 'someone',
  status: 'active',
  merged_into: null,
  created_at: '2026-08-16T00:00:00.000Z',
  updated_at: '2026-08-16T00:00:00.000Z',
  deleted_at: null,
};

function withServer(rpc: jest.Mock): Cloud {
  return { configured: true, client: { rpc } as unknown as SupabaseClient };
}

const answered = (data: unknown) => jest.fn().mockResolvedValue({ data, error: null });

const NO_BACKEND: Cloud = { configured: false, missing: ['EXPO_PUBLIC_SUPABASE_URL'] };

it('asks the RPC §5 names, with the query raw', async () => {
  const rpc = answered([]);
  await searchCenters(withServer(rpc), '  Ponorka  ');

  // **Untrimmed and unfolded.** `public.name_fold` opens with `btrim` and applies `unaccent`,
  // and §2.3 states the rule: "the raw text goes over the wire: a client that pre-folded its
  // query would fold twice and diverge silently."
  expect(rpc).toHaveBeenCalledWith(SEARCH_CENTERS_RPC, { p_query: '  Ponorka  ' });
});

// Only the query. A position would narrow the search to a radius, and taking one from the device
// would spend §3's one-and-only location permission on a directory (M2m) — which the Map tab
// itself is forbidden to do. `p_limit` is the function's own default rather than a second copy of
// a number the migration owns.
it('sends the query and nothing else', async () => {
  const rpc = answered([]);
  await searchCenters(withServer(rpc), 'Ponorka');
  expect(Object.keys((rpc.mock.calls[0]?.[1] ?? {}) as object)).toEqual(['p_query']);
});

/**
 * **An empty query is not sent at all**, and this is a rule about the server rather than about
 * politeness: `search_centers` raises `22023` when it is given neither a query nor a position, so
 * asking would be asking for an error. What a diver sees meanwhile is the whole catalogue, which
 * the device already has.
 */
it.each(['', '   ', '\n'])('does not ask at all for the query %p', async (query) => {
  const rpc = answered([PONORKA]);
  expect(await searchCenters(withServer(rpc), query)).toEqual([]);
  expect(rpc).not.toHaveBeenCalled();
});

/**
 * **A type-level guard, and this test says so rather than pretending otherwise.**
 *
 * Deleting `if (!cloud.configured) return []` leaves this file green — measured, not assumed:
 * the unconfigured branch has no `client`, so the call would throw and the module's own `catch`
 * would answer the same `[]`. What the line actually buys is that it **does not compile** without
 * it (`Property 'client' does not exist on type 'Cloud'`), which is `supabase.ts`'s whole design
 * and the same shape `db/catalogue.ts` records for `pickable`'s unreachable throw: a guard whose
 * value is that it cannot become reachable quietly. Written up here so the next reader does not
 * spend the mutation twice.
 */
it('does not ask when this build has no backend', async () => {
  expect(await searchCenters(NO_BACKEND, 'Ponorka')).toEqual([]);
});

/**
 * The rows come back keyed by the device's own column names, ready for `applyPulledDiveCenters`
 * — which is the whole design: `search_centers` renders with `public.sync_site`, the same
 * renderer `pull_changes` uses, so there is one reader and one writer for a catalogue row.
 */
it('reads a row into the device’s own shape, and carries no dirty flag', async () => {
  const rows = await searchCenters(withServer(answered([PONORKA])), 'Ponorka');
  expect(rows).toEqual([
    {
      id: 'centre-ponorka',
      name: 'Ponorka',
      country: 'CZ',
      latitude: 50.08,
      longitude: 14.44,
      website: 'https://ponorka.example',
      createdBy: 'someone',
      status: 'active',
      mergedInto: null,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:00.000Z',
      deletedAt: null,
    },
  ]);
  // The flag is not merely absent from the type, it is absent from the value — `fromWireRow`
  // builds each object out of the table's own columns minus the flag, and `applyPulledRows`
  // writes it itself. A pulled row that arrived flagged would push itself straight back (§7.2).
  expect(Object.keys(rows[0] ?? {})).not.toContain('dirty');
});

/**
 * **All or nothing when the response has no column to store.** `fromWireRow` throws for a row
 * missing a column, which is a statement about the server's shape rather than about one row —
 * dropping just the offending row would write a partial catalogue from a schema this build does
 * not understand.
 *
 * This is also where the strictness that would be *wrong* in `similarSites` is right here: that
 * module reads a row it will never store.
 */
it('discards the whole answer when a row is missing a column, rather than storing part of it', async () => {
  const { website, ...noWebsite } = PONORKA;
  expect(website).toBeDefined();
  expect(await searchCenters(withServer(answered([PONORKA, noWebsite])), 'Ponorka')).toEqual([]);
});

// A refusal is a refusal even when rows came with it — RLS said no (§5 grants this to
// `authenticated` alone), nobody is signed in, the server is a version behind. Believing rows
// that arrived beside an error would mean writing the catalogue from a response the server has
// disowned.
it('stores nothing from a response the server refused', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: [PONORKA], error: { message: 'no' } });
  expect(await searchCenters(withServer(rpc), 'Ponorka')).toEqual([]);
});

// `search_centers` returns `jsonb` and always an array — `coalesce(jsonb_agg(...), '[]')`.
it.each([[null], [{}], ['rows'], [undefined]])('answers nothing for a body shaped %p', async (data) => {
  expect(await searchCenters(withServer(answered(data)), 'Ponorka')).toEqual([]);
});

/**
 * **The array check is `Array.isArray` and not "can this be mapped", and until M3f nothing here
 * could tell the two apart.**
 *
 * Every body in the case above answers `[]` whether the check is there or not: `null.map` and
 * `'rows'.map` throw, and the reader's own `catch` returns the same empty list — so deleting the
 * guard left this file green, measured rather than assumed. The distinction is only visible for a
 * body that is not an array and *would* map, which is what this passes: without the guard those
 * rows come back raw, in the server's snake_case, and are handed to the catalogue as if they had
 * been read.
 *
 * Contrived as a payload and exact as a rule: `jsonb` cannot produce this, and what the guard
 * actually says is "anything that is not an array is a server this build does not understand" —
 * which is a statement about the shape, not about whether the next line happens to throw.
 */
it('refuses a body that is not an array even when it could be mapped', async () => {
  const mappable = { map: (fn: (row: unknown) => unknown) => [fn(PONORKA)] };
  expect(await searchCenters(withServer(answered(mappable)), 'Ponorka')).toEqual([]);
});

// §1: the app runs offline, and a directory of shops must work at sea. Every way of failing
// answers the same empty list and the device's own rows are what the diver is reading.
it('answers nothing when the call itself rejects', async () => {
  const rpc = jest.fn().mockRejectedValue(new Error('offline'));
  expect(await searchCenters(withServer(rpc), 'Ponorka')).toEqual([]);
});
