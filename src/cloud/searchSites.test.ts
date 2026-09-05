import { type SupabaseClient } from '@supabase/supabase-js';

import { SEARCH_SITES_RPC, searchSites } from './searchSites';
import { type Cloud } from './supabase';

/**
 * **§2.3's live search for sites, on the client** — the first caller `public.search_sites` has
 * ever had, five milestones after it was written (M2j; a standing item in M3c's and M3e's
 * reports).
 *
 * The transport is `searchCatalogue`'s and `searchCenters.test.ts` exercises every branch of it;
 * what is asserted here is **the pair this module owns — which RPC is called and which table its
 * rows are read into** — plus the two behaviours a directory's screen depends on directly.
 *
 * What no test in this repository can prove is anything about `pg_trgm` or `public.name_fold`:
 * `similarSites.test.ts` records the whole argument and it applies unchanged — **no round trip has
 * ever been performed from this repository**, so what is faked is the *transport* and never the
 * rule.
 *
 * The row below is written out in SQL's own snake_case rather than built from a `DiveSite`
 * fixture, deliberately: the payload is a claim about the WIRE, and `public.sync_site` renders a
 * site with `latitude`/`longitude` where the table has a PostGIS point (§6).
 */
const KOTELNA = {
  id: 'site-kotelna',
  name: 'Kotelna',
  country: 'CZ',
  latitude: 49.75,
  longitude: 14.36,
  salinity: 'fresh',
  water_body: 'quarry',
  entry: 'shore',
  max_depth_m: 42,
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

it('asks the RPC §5 names, with the query raw', async () => {
  const rpc = answered([]);
  await searchSites(withServer(rpc), '  Železná  ');

  // **Untrimmed and unfolded.** `public.name_fold` opens with `btrim` and applies `unaccent`, and
  // §2.3 states the rule: "the raw text goes over the wire: a client that pre-folded its query
  // would fold twice and diverge silently." Accented on purpose — a lowercase ASCII query is
  // identical to its own fold and would let a client-side fold through unnoticed.
  expect(rpc).toHaveBeenCalledWith(SEARCH_SITES_RPC, { p_query: '  Železná  ' });
  expect(SEARCH_SITES_RPC).toBe('search_sites');
});

/**
 * **The rows come back in the SITES table's shape, which is the half this file exists to pin.**
 * The transport is generic over the table (`searchCatalogue`), so handing it `diveCenters` here
 * would still answer rows — with a `website` the response never carried and without the four
 * columns §6 gives a site. `fromWireRow` throws for a column it cannot find, so the wrong table is
 * an empty answer rather than a wrong one; either way this is the assertion that catches it.
 */
it('reads a row into the device’s own site shape, and carries no dirty flag', async () => {
  const rows = await searchSites(withServer(answered([KOTELNA])), 'Kotelna');
  expect(rows).toEqual([
    {
      id: 'site-kotelna',
      name: 'Kotelna',
      country: 'CZ',
      latitude: 49.75,
      longitude: 14.36,
      salinity: 'fresh',
      waterBody: 'quarry',
      entry: 'shore',
      maxDepthM: 42,
      createdBy: 'someone',
      status: 'active',
      mergedInto: null,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:00.000Z',
      deletedAt: null,
    },
  ]);
  // The flag is not merely absent from the type, it is absent from the value — `fromWireRow`
  // builds each object out of the table's own columns minus the flag, and `applyPulledRows` writes
  // it itself. A pulled row that arrived flagged would push itself straight back (§7.2).
  expect(Object.keys(rows[0] ?? {})).not.toContain('dirty');
});

/**
 * **An empty query is not sent at all**, and this is a rule about the server rather than about
 * politeness: `search_sites` raises `22023` when it is given neither a query nor a position, so
 * asking would be asking for an error. What a diver sees meanwhile is the whole catalogue, which
 * the device already has.
 */
it.each(['', '   ', '\n'])('does not ask at all for the query %p', async (query) => {
  const rpc = answered([KOTELNA]);
  expect(await searchSites(withServer(rpc), query)).toEqual([]);
  expect(rpc).not.toHaveBeenCalled();
});

// §1: the app runs offline, and a directory of sites must work at sea. Every way of failing
// answers the same empty list and the device's own rows are what the diver is reading. The other
// four ways are `searchCenters.test.ts`', through the same transport.
it('answers nothing when the call itself rejects', async () => {
  const rpc = jest.fn().mockRejectedValue(new Error('offline'));
  expect(await searchSites(withServer(rpc), 'Kotelna')).toEqual([]);
});
