import { type PushableTable } from '../db/dirty';
import { fromWireRow } from './sync';
import { type Cloud } from './supabase';

/**
 * **§2.3's live search, as transport** — the half `search_sites` and `search_centers` share
 * (`supabase/migrations/20260902090500_catalogue_rpcs.sql`).
 *
 * §2.3: *"Typing a site **or center** searches your own history first, then the on-device copy of
 * the community catalogue — both instant and fully offline. **Live search adds anything newer
 * when online.**"* Two RPCs answer that sentence and they are the same function over two tables:
 * the migration says `search_centers` is *"identical to `search_sites` except for the table it
 * reads"*, and both render their rows with `public.sync_site`, the same renderer `pull_changes`
 * uses. So the client's half is one function too — **generalised rather than written twice**
 * (M3f), on `withPoints`' own reasoning (domain/mapSites.ts): `dive_sites` and `dive_centers` are
 * the same table under two names, and forty lines of error handling copied per table is the
 * defect §4.1 opens with, in the form where a `catch` added to one copy and not the other fails
 * no gate.
 *
 * **What is NOT here is which RPC and which table**, and that is the half that may not be shared:
 * `cloud/searchSites.ts` and `cloud/searchCenters.ts` each name one RPC and one table, so a call
 * site cannot pair a site query with the centres table — and `cloud/similarSites.ts`' rule
 * (whatever calls an RPC owns it) keeps a named owner for each.
 *
 * ── The rows are stored, not merged on screen, and the SQL was designed for exactly that ──
 *
 * The migration is explicit: *"a row from here is byte-for-byte a row from `pull_changes` … It
 * also means these rows are safe to upsert by comparing `updated_at`, exactly like pulled ones."*
 * So the answer goes to `applyPulledDiveSites`/`applyPulledDiveCenters` (db/catalogue.ts →
 * `applyPulledRows`, db/dirty.ts) and the screen re-reads its own live query. The device answers
 * first and keeps answering; the server's job is to make the device's answer complete, not to
 * render a second list beside it. There is no merge-by-id on any screen, no "is this row local or
 * remote" state, and a place found online is still there the next time the diver is on a boat.
 *
 * Three consequences worth stating because each is a rule somewhere else:
 *
 *  · **The rows arrive clean.** `applyPulledRows` writes the flag itself and the pulled types have
 *    nowhere to carry one, so a searched row is never pushed back as this device's creation
 *    (§7.1). §7.4's adoption at sign-in is the one way that could go wrong — and it cannot,
 *    because these calls need an authenticated session (the SQL raises `28000` without one) and a
 *    guest therefore has nothing cached to adopt.
 *  · **The watermark is not touched.** Both functions return a filtered subset, and the migration
 *    is explicit that advancing `last_pulled_at` on the strength of one would step it past
 *    everything the filter excluded. Nothing here writes `sync_state`.
 *  · **`fromWireRow` is the reader, and its strictness is right here where it was wrong for
 *    `similar_sites`.** That module reads a row it will never store, so a response missing a
 *    column is still a good answer to *"did you mean Shark Point?"*. These rows go **into** a
 *    table, so a row missing a column is a partial row and refusing it is the point.
 *
 * ── Nothing here throws, and that is the contract ─────────────────────────────────────────
 *
 * §1: the app runs offline. Browsing the catalogue is a read of the device's own copy and must
 * work with no backend in the build, nobody signed in, no signal, or a server that refused —
 * every one of which answers the same empty list, and the device's own rows are what the diver
 * sees. **The swallow is specified rather than silent**, on `similarSites`' reasoning: there is
 * nothing the diver could do with the sentence, and a notice under a search field that fired on
 * every keystroke made out of signal is the dead control §0.6 objects to, wearing text.
 *
 * Nothing is logged, for `cloud/auth.ts`'s reason: §9's Sentry turns console output into
 * breadcrumbs, and a refusal from this call can echo the name that produced it.
 */

/**
 * The arguments both functions declare, spelled once so a typo cannot reach the call and the
 * response differently. **Only the query is sent**: `p_latitude`/`p_longitude`/`p_radius_m` narrow
 * the search to a point, and a directory has no point — asking the device for one would spend §3's
 * one-and-only location permission on a list (M2m), which the Map tab itself is forbidden to do.
 * `p_limit` is left to each function's own default rather than restated here, exactly as
 * `similarSites` leaves its three.
 */
interface SearchCatalogueArgs {
  readonly p_query: string;
}

/**
 * Asks `rpc` for the rows of `table` matching `query`, ready to be applied to the device's own
 * catalogue. Empty whenever the call could not be made or the answer could not be believed.
 *
 * `cloud` is passed rather than read from module scope so that **a build with no backend is an
 * argument a test can supply** — `similarSites`' own note, and the same reason.
 *
 * The name goes over the wire **raw**, exactly as §2.3 requires: the server folds it with
 * `public.name_fold`, and a client that pre-folded its query would fold twice and diverge
 * silently. An empty or whitespace-only query is not sent at all — both functions raise `22023`
 * when given neither a query nor a position, so asking would be asking for an error, and
 * "everything in the catalogue" is what the device already has on screen.
 */
export async function searchCatalogue(
  cloud: Cloud,
  rpc: string,
  table: PushableTable,
  query: string,
): Promise<Record<string, unknown>[]> {
  if (!cloud.configured) return [];
  if (query.trim() === '') return [];

  const args: SearchCatalogueArgs = { p_query: query };

  // **The `try` covers the call and nothing else, deliberately** — `similarSites` records the
  // whole argument: a block around the entire function makes every check below unfalsifiable,
  // because deleting one lands the failure in the same `catch` and produces the same `[]`. The
  // one exception is `fromWireRow` further down, which is a throwing reader by design and has its
  // own guarded block for that reason.
  let response: { data: unknown; error: unknown };
  try {
    response = await cloud.client.rpc(rpc, args);
  } catch {
    // No signal, a DNS failure, a client that rejected before it reached the network. See the
    // module docblock: none of these may cost the diver the directory they are looking at.
    return [];
  }

  // A refusal is a refusal even when rows came with it — RLS said no (§5 grants these functions to
  // `authenticated` alone), nobody is signed in, the server is a version behind. supabase-js nulls
  // `data` in every case it produces itself; storing rows that arrived beside an error would mean
  // writing the catalogue from a response the server has disowned.
  if (response.error !== null && response.error !== undefined) return [];

  // Both functions return `jsonb` and always an array — `coalesce(jsonb_agg(...), '[]')`. Anything
  // else is a server this build does not understand.
  if (!Array.isArray(response.data)) return [];

  try {
    // **All or nothing, not row by row.** `fromWireRow` throws when the response has no column to
    // store, which is a statement about the SERVER's shape rather than about one row — so dropping
    // the offending row would write a partial catalogue from a schema this build does not
    // understand. The whole answer is discarded instead and the device's own rows stand.
    return response.data.map((row) => fromWireRow(table, row));
  } catch {
    return [];
  }
}
