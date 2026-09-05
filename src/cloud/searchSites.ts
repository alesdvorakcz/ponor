import { type PulledSite } from '../db/catalogue';
import { diveSites } from '../db/schema';
import { searchCatalogue } from './searchCatalogue';
import { type Cloud } from './supabase';

/**
 * **DESIGN.md §2.3's live search, for sites** — the one caller of `public.search_sites`
 * (`supabase/migrations/20260902090500_catalogue_rpcs.sql`), and therefore the owner of that call
 * (`cloud/similarSites.ts` states the rule: whatever calls an RPC owns it, and `cloud/` holds the
 * client).
 *
 * **This closes the oldest open item in the catalogue's SQL.** `search_sites` is the function §5's
 * RPC list opens with, it has existed since M2j, and it has **never had a caller** — a standing
 * note in M3c's report and again in M3e's. §2.3's *"live search adds anything newer when online"*
 * has been half true since: the device's own copy was the whole of the answer for sites, which is
 * fully offline-correct and silently misses every site added since this phone last pulled. The
 * sites directory (`/sites`, M3f) is where it finally gets one.
 *
 * **The transport is `searchCatalogue`** (cloud/searchCatalogue.ts), shared with `searchCenters`:
 * the migration calls the centres function *"identical to `search_sites` except for the table it
 * reads"*, both render with `public.sync_site`, and the client's rules about what may be believed
 * are one answer for both. That module carries the whole contract — the raw query, the untouched
 * watermark, the clean rows, the all-or-nothing read, and the promise that nothing here throws.
 *
 * **What this file owns is the pair that must not be shared**: the RPC's name and the table its
 * rows are read into. Those travel together, so no call site can ask `search_sites` for rows and
 * read them as centres.
 */
export const SEARCH_SITES_RPC = 'search_sites';

/**
 * Asks the server for sites matching `query`, as rows ready to be applied to the device's own
 * catalogue. Empty whenever the check could not run — see `searchCatalogue` for every way that
 * happens and why none of them is reported.
 */
export async function searchSites(cloud: Cloud, query: string): Promise<PulledSite[]> {
  return (await searchCatalogue(cloud, SEARCH_SITES_RPC, diveSites, query)) as PulledSite[];
}
