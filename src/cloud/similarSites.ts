import { type Suggestion } from '../domain/suggest';
import { type Cloud } from './supabase';

/**
 * **DESIGN.md §5's fuzzy duplicate check, on the client** — the one caller of
 * `public.similar_sites` (`supabase/migrations/20260902090500_catalogue_rpcs.sql`), and
 * therefore the owner of that call (§4.1: whatever calls an RPC owns it, and `cloud/` holds
 * the client).
 *
 * §2.3: *"Before saving a new entry, a fuzzy check suggests near-matches: **Did you mean Shark
 * Point?** One tap picks the existing site instead."* This is the asking half. What is done
 * with the answer is `DiveFormScreen`'s, and what counts as a near-match once the device's own
 * catalogue has had its say is `domain/suggest.ts`'s `nearMatches`.
 *
 * ── **No round trip has ever been performed from this repository** ────────────────────────
 *
 * Nobody working here has credentials for the owner's Supabase project and none will be added
 * (`supabase/README.md`), so what this module's tests exercise is a hand-written `rpc` stub
 * answering in the shape the SQL renders. There is deliberately **no fake `similar_sites`** in
 * `src/testing/` alongside the fake sync server: that fake models rules a client's correctness
 * turns on, and the only rule that matters here is `pg_trgm`'s trigram similarity, which
 * cannot be modelled in JavaScript without becoming the second implementation this whole
 * design refuses (see `nearMatches`). A fake that scored names by some other rule would be
 * agreeing with itself about the one thing nobody here can check.
 *
 * ── **Nothing here throws, and that is the contract** ─────────────────────────────────────
 *
 * §1: *"the whole app runs offline from on-device SQLite"*, and §5's own offline-dedupe
 * paragraph exists because a site created on a boat is the ordinary case. So the check needs
 * the network and **creating a site does not**: every way of failing to ask — no backend in
 * this build, nobody signed in, no signal, a server that refused — answers the same empty
 * list, and the site the diver asked for is created.
 *
 * **The swallow is specified rather than silent.** What a failure costs is exactly the check
 * and nothing else, and the diver is told nothing, for two reasons that both come from §0.6.
 * There is nothing they could do with the sentence: they are on a boat, the duplicate they may
 * have just created is §5's server-side recheck and the admin merge queue to resolve, and a
 * message with no gesture under it is the dead control §0.6 objects to four separate times,
 * wearing text. And it would appear on **every** site added out of signal, for ever, under the
 * app's most-used gesture — which is the receipt M2o already declined for the success case.
 * §10's rule that a local save failure is shown and a sync failure is not comes down here too.
 *
 * Nothing is logged, for `cloud/auth.ts`'s reason: §9's Sentry turns console output into
 * breadcrumbs, and a refusal from this call can echo the name that produced it.
 */
export const SIMILAR_SITES_RPC = 'similar_sites';

/**
 * The arguments the SQL declares, spelled once so a typo cannot reach the call and the
 * response differently. **Only the three this app has an opinion about are sent**:
 * `p_radius_m`, `p_exclude_id` and `p_limit` are left to the function's own defaults, because
 * restating 25 000 m or 5 here would be a second copy of a number the migration owns — and
 * `p_exclude_id` is for §5's *other* caller, the recheck of a site that already exists.
 */
interface SimilarSitesArgs {
  readonly p_name: string;
  readonly p_latitude: number | null;
  readonly p_longitude: number | null;
}

/**
 * One row of the answer, read for the two things the one tap needs.
 *
 * **Deliberately not `fromWireRow` (cloud/sync.ts), and the difference is the direction.**
 * That reader is for a row on its way into a table, so a column missing from the payload is a
 * device running a schema this server has never heard of and it throws rather than writing a
 * partial row. Here the row is never stored: it is a name to show and an id to pair a dive
 * with (§6), and a response that is missing, say, `max_depth_m` is still a perfectly good
 * answer to *"did you mean Shark Point?"*. Refusing it would turn a newer server into a
 * broken duplicate check.
 *
 * A row that cannot supply both halves is dropped instead, because half of the pair is what
 * §10 spent this milestone making impossible: a dive carrying one site's id under another's
 * name. Names are trimmed for the same reason the offer publishes a trimmed one (M2o) — the
 * dive's `site_name` snapshot and the row it points at should be one string.
 */
function candidateFrom(row: unknown): Suggestion | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
  const fields = row as Record<string, unknown>;
  const id = fields.id;
  const name = fields.name;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof name !== 'string') return null;
  const value = name.trim();
  if (value === '') return null;
  return { value, id };
}

/**
 * Asks the server which existing sites a proposed name might be a duplicate of.
 *
 * `cloud` is passed rather than read from module scope so that **a build with no backend is an
 * argument a test can supply**, not a property of whether the machine running the suite
 * happens to have `EXPO_PUBLIC_SUPABASE_URL` set. That distinction is the whole of `supabase.ts`'s
 * own rule reaching one module further out, and it is the case a fake server can say nothing
 * about: a stub that answers is still a server.
 *
 * **The pin is handed over whenever the dive has one**, because a name check across the whole
 * world and a name check within the function's own radius are different questions — §5 calls
 * proximity a *separator*, not a ranking, and two "Blue Hole"s three thousand kilometres apart
 * are two blue holes. Both coordinates or neither: the SQL only builds a point when both are
 * present, and `siteFactsFrom` (domain/diveFormSchema.ts) already guarantees the pair cannot
 * come apart.
 *
 * The name goes over the wire **raw**, exactly as §2.3 requires of live search: the server
 * folds it with `public.name_fold`, and a client that pre-folded its query would fold twice
 * and diverge silently.
 */
export async function similarSites(
  cloud: Cloud,
  name: string,
  latitude: number | null,
  longitude: number | null,
): Promise<Suggestion[]> {
  if (!cloud.configured) return [];

  const args: SimilarSitesArgs = { p_name: name, p_latitude: latitude, p_longitude: longitude };

  // **The `try` covers the call and nothing else, deliberately.** A block wrapped round the
  // whole function would be a blanket that makes every check below unfalsifiable — delete one
  // and the failure it exists for lands in the same `catch` and produces the same `[]`, so no
  // test could tell the guarded version from the unguarded one. `db/catalogue.ts` records the
  // identical shape for `pickable`'s unreachable throw: what a guard buys is that it cannot
  // become reachable quietly. Everything after this block is pure and cannot throw, which is
  // what keeps the module's "nothing here throws" contract true without a blanket.
  let response: { data: unknown; error: unknown };
  try {
    response = await cloud.client.rpc(SIMILAR_SITES_RPC, args);
  } catch {
    // A device with no signal, a DNS failure, a client that rejected before it reached the
    // network. See the module docblock: none of these may cost the diver the site they asked
    // to add, and none of them is a sentence worth putting on the form.
    return [];
  }

  // A refusal is a refusal even when rows came with it — RLS said no (§5 gives this function
  // to `authenticated` alone), the name was empty, the server is a version behind. supabase-js
  // nulls `data` in every case it produces itself; believing rows that arrived beside an error
  // would mean deciding what a duplicate is from a response the server has disowned.
  if (response.error !== null && response.error !== undefined) return [];

  // `similar_sites` returns `jsonb` and always an array — `coalesce(jsonb_agg(...), '[]')`.
  // Anything else is a server this build does not understand, and mapping over it would throw
  // out of a function that has promised not to.
  if (!Array.isArray(response.data)) return [];

  return response.data
    .map(candidateFrom)
    .filter((candidate): candidate is Suggestion => candidate !== null);
}
