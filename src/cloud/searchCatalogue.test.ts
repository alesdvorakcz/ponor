import { type SupabaseClient } from '@supabase/supabase-js';

import { diveSites } from '../db/schema';
import { searchCatalogue } from './searchCatalogue';
import { type Cloud } from './supabase';

/**
 * **The one argument `searchCatalogue` gained for the site picker's *Near me* list** — the point
 * and radius `search_sites`/`search_centers` already accept, and the empty query they accept
 * beside a point (`supabase/migrations/20260902090500_catalogue_rpcs.sql`). `searchSites.test.ts`
 * and `searchCenters.test.ts` cover the rest of the transport; this file pins only what the
 * point changes on the wire.
 */
function withServer(rpc: jest.Mock): Cloud {
  return { configured: true, client: { rpc } as unknown as SupabaseClient };
}

const answered = (data: unknown) => jest.fn().mockResolvedValue({ data, error: null });

const POINT = { latitude: 43.06, longitude: 16.18 };

it('sends the point and radius when asked near a point', async () => {
  const rpc = answered([]);
  await searchCatalogue(withServer(rpc), 'search_sites', diveSites, 'vis', {
    point: POINT,
    radiusM: 50000,
  });

  expect(rpc).toHaveBeenCalledWith('search_sites', {
    p_query: 'vis',
    p_latitude: 43.06,
    p_longitude: 16.18,
    p_radius_m: 50000,
  });
});

it('searches with an empty query near a point', async () => {
  const rpc = answered([]);
  await searchCatalogue(withServer(rpc), 'search_sites', diveSites, '  ', {
    point: POINT,
    radiusM: 50000,
  });

  // `null`, not the blank string: the SQL treats a null query plus a position as "everything
  // around here", and a blank one would be folded and matched against names.
  expect(rpc).toHaveBeenCalledWith('search_sites', {
    p_query: null,
    p_latitude: 43.06,
    p_longitude: 16.18,
    p_radius_m: 50000,
  });
});

it('without a point still refuses an empty query', async () => {
  const rpc = answered([]);
  expect(await searchCatalogue(withServer(rpc), 'search_sites', diveSites, '  ')).toEqual([]);
  expect(rpc).not.toHaveBeenCalled();
});
