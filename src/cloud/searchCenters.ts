import { type PulledCenter } from '../db/catalogue';
import { diveCenters } from '../db/schema';
import { searchCatalogue } from './searchCatalogue';
import { type Cloud } from './supabase';

/**
 * **DESIGN.md §2.3's live search, for centres** — the one caller of `public.search_centers`
 * (`supabase/migrations/20260902090500_catalogue_rpcs.sql`), and therefore the owner of that call
 * (`cloud/similarSites.ts` states the rule: whatever calls an RPC owns it, and `cloud/` holds the
 * client). That function was written in M2j and **had never had a caller** until M3c.
 *
 * **The transport is `searchCatalogue`** (cloud/searchCatalogue.ts), shared with `searchSites`
 * since M3f: the migration calls `search_centers` *"identical to `search_sites` except for the
 * table it reads"*, both render with `public.sync_site`, and the client's forty lines of "what may
 * be believed and what may not" are one answer for both. That module carries the whole contract —
 * the raw query, the untouched watermark, the clean rows, the all-or-nothing read, and the promise
 * that nothing here throws.
 *
 * **What this file owns is the pair that must not be shared**: the RPC's name and the table its
 * rows are read into. Those travel together, so no call site can ask `search_centers` for rows and
 * read them as sites.
 */
export const SEARCH_CENTERS_RPC = 'search_centers';

/**
 * Asks the server for centres matching `query`, as rows ready to be applied to the device's own
 * catalogue. Empty whenever the check could not run — see `searchCatalogue` for every way that
 * happens and why none of them is reported.
 */
export async function searchCenters(cloud: Cloud, query: string): Promise<PulledCenter[]> {
  return (await searchCatalogue(cloud, SEARCH_CENTERS_RPC, diveCenters, query)) as PulledCenter[];
}
