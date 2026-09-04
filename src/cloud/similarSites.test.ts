import { type SupabaseClient } from '@supabase/supabase-js';

import { type Suggestion } from '../domain/suggest';
import { SIMILAR_SITES_RPC, similarSites } from './similarSites';
import { connectCloud, readCloudCredentials, type Cloud } from './supabase';

/**
 * **§5's fuzzy duplicate check, on the client** — and the two things this file can prove.
 *
 * It proves the *client* behaves correctly against a server that answers the way
 * `supabase/migrations/20260902090500_catalogue_rpcs.sql` says `similar_sites` does, and it
 * proves what happens when there is no such server to answer at all. It proves nothing about
 * `pg_trgm`: **no round trip has ever been performed from this repository**, nobody here has
 * credentials for the owner's project and none will be added (`supabase/README.md`), and the
 * one rule this RPC exists for — trigram similarity against `public.name_match_floor()` — is
 * Postgres' own and cannot be modelled here without becoming the second implementation of it
 * that `domain/suggest.ts` refuses to write.
 *
 * That is why there is no fake `similar_sites` in `src/testing/` beside the fake sync server.
 * A fake that scored names by some rule of its own would agree with itself about the only
 * thing nobody here can check, and every test below would then be a statement about the fake.
 * What is faked instead is the *transport*: a stub `rpc` that answers with whatever shape a
 * given test is about.
 */

/** The rows `public.sync_site` renders, as this module reads them: the whole catalogue row
 * goes over the wire, and only these two are looked at. Written out rather than built from a
 * `DiveSite` fixture, so the payload here is a claim about the WIRE — a server's JSON, keyed
 * in SQL's own snake_case — rather than a re-spelling of the device's own row type. */
const SHARK_POINT = {
  id: 'site-shark-point',
  name: 'Shark Point',
  country: 'EG',
  latitude: 27.85,
  longitude: 34.31,
  salinity: 'salt',
  water_body: 'sea',
  entry: 'boat',
  max_depth_m: 30,
  created_by: 'someone',
  status: 'active',
  merged_into: null,
  created_at: '2026-08-16T00:00:00.000Z',
  updated_at: '2026-08-16T00:00:00.000Z',
  deleted_at: null,
};

const SHARK_BAY = { ...SHARK_POINT, id: 'site-shark-bay', name: 'Shark Bay' };

const picked = (value: string, id: string): Suggestion => ({ value, id });

/** A build that HAS a backend, wired to a stub whose answers each test decides. The union is
 * built by hand rather than through `connectCloud`, which would construct a real
 * `SupabaseClient` and with it a `GoTrueClient` reading storage on a timer. */
function withServer(rpc: jest.Mock): Cloud {
  return { configured: true, client: { rpc } as unknown as SupabaseClient };
}

/** One answer in the shape supabase-js hands back. */
const answered = (data: unknown) => jest.fn().mockResolvedValue({ data, error: null });

it('asks the RPC §5 names, with the name raw and the dive’s own pin beside it', async () => {
  const rpc = answered([SHARK_POINT]);
  await similarSites(withServer(rpc), '  Divoká Šárka  ', 27.85, 34.31);

  // The name goes over the wire UNTRIMMED and UNFOLDED. `public.name_fold` opens with `btrim`
  // and applies `unaccent`, and §2.3 states the rule for live search in so many words: "the
  // raw text goes over the wire: a client that pre-folded its query would fold twice and
  // diverge silently."
  expect(rpc).toHaveBeenCalledWith(SIMILAR_SITES_RPC, {
    p_name: '  Divoká Šárka  ',
    p_latitude: 27.85,
    p_longitude: 34.31,
  });
});

// §5: "proximity is a separator, not a ranking" — two "Blue Hole"s three thousand kilometres
// apart are two blue holes — so a dive that HAS a pin makes this a different, better question.
// A dive that has none asks the name alone, which the SQL handles by building no point at all.
it('hands over no point when the dive has none, rather than half of one', async () => {
  const rpc = answered([]);
  await similarSites(withServer(rpc), 'Kotelna', null, null);
  expect(rpc).toHaveBeenCalledWith(SIMILAR_SITES_RPC, {
    p_name: 'Kotelna',
    p_latitude: null,
    p_longitude: null,
  });
});

// The three the migration owns are not restated here: `p_radius_m` (25 km), `p_limit` (5) and
// `p_exclude_id`, which belongs to §5's OTHER caller — the recheck of a site that already
// exists. A client copy of any of them is a second place for a number to drift from (§4.1).
it('names only the arguments it has an opinion about', async () => {
  const rpc = answered([]);
  await similarSites(withServer(rpc), 'Kotelna', null, null);
  expect(Object.keys(rpc.mock.calls[0][1] as object).sort()).toEqual(['p_latitude', 'p_longitude', 'p_name']);
});

// The answer, read for the two things §2.3's one tap needs: a name to show and §6's id to pair
// the dive with. In the server's own order, which is by trigram score (`similar_sites` sorts).
it('reads back the name to show and the id to pair, in the order they arrived', async () => {
  const found = await similarSites(withServer(answered([SHARK_POINT, SHARK_BAY])), 'Sharks Point', null, null);
  expect(found).toEqual([picked('Shark Point', 'site-shark-point'), picked('Shark Bay', 'site-shark-bay')]);
});

// Trimmed, for M2o's own reason: the offer publishes a trimmed name so §6's snapshot and the
// row it points at are byte-identical, and picking an existing site has to leave the dive in
// exactly that state.
it('trims the catalogue’s spelling, so a picked name and its row are one string', async () => {
  const found = await similarSites(withServer(answered([{ ...SHARK_POINT, name: '  Shark Point  ' }])), 'x', null, null);
  expect(found).toEqual([picked('Shark Point', 'site-shark-point')]);
});

// **Half of §6's pair is what §10 spent this milestone making impossible** — a dive carrying
// one site's id under another's name — so a row that cannot supply both halves is dropped
// rather than shown. Every good row beside it survives, because one unreadable row must not
// cost the diver the question.
it('drops a row that cannot supply both halves, and keeps the ones that can', async () => {
  const rows = [
    { ...SHARK_POINT, id: null },
    { ...SHARK_POINT, id: '' },
    { ...SHARK_POINT, name: null },
    { ...SHARK_POINT, name: '   ' },
    { ...SHARK_POINT, name: 42 },
    'not a row',
    null,
    SHARK_BAY,
  ];
  const found = await similarSites(withServer(answered(rows)), 'Shark', null, null);
  expect(found).toEqual([picked('Shark Bay', 'site-shark-bay')]);
});

// **A newer server is not a broken check.** Deliberately NOT `fromWireRow` (cloud/sync.ts),
// which throws on a column it cannot find — right for a row on its way into a table, wrong
// here, where the row is never stored and a missing `max_depth_m` still answers "did you mean
// Shark Point?" perfectly well.
it('answers from a row that is missing every column but the two it reads', async () => {
  const found = await similarSites(withServer(answered([{ id: 'site-x', name: 'Kotelna' }])), 'Kotelna', null, null);
  expect(found).toEqual([picked('Kotelna', 'site-x')]);
});

// =========================================================================================
// The three ways the check cannot run — every one of which costs the check and nothing else
// =========================================================================================

/**
 * **The device with no server at all**, which is not the same thing as a stub that answers
 * and is the case §1 makes ordinary: "the whole app runs offline from on-device SQLite... an
 * account is only needed to back up, sync a second device, and contribute named sites."
 *
 * The `Cloud` here is the REAL unconfigured one, built by `readCloudCredentials({})` +
 * `connectCloud` out of an empty environment — not a hand-written literal that happens to say
 * `configured: false`. That is what makes this a statement about the union `supabase.ts`
 * actually produces.
 */
it('answers nothing at all in a build that has no backend', async () => {
  const noBackend = connectCloud(readCloudCredentials({}));
  expect(noBackend.configured).toBe(false);
  await expect(similarSites(noBackend, 'Kotelna', 27.85, 34.31)).resolves.toEqual([]);
});

/**
 * ...and the discriminant is what decides that, **not whether a client happens to be
 * reachable**. That is the whole reason `supabase.ts` made `Cloud` a union rather than a
 * nullable client: "`cloud.client` does not exist as a property until `cloud.configured` has
 * been narrowed to `true`".
 *
 * The cast is what makes the guard falsifiable rather than decorative. Without it, deleting
 * `if (!cloud.configured) return []` still produces `[]` — `undefined.rpc(...)` throws, the
 * `catch` swallows it, and the test above passes against a version with no guard in it at all.
 * A value shaped like an unconfigured cloud that nevertheless carries a client is the only
 * shape that can tell those two apart.
 */
it('never reaches a client an unconfigured cloud is carrying anyway', async () => {
  const rpc = answered([SHARK_POINT]);
  const lying = { configured: false, missing: [], client: { rpc } } as unknown as Cloud;
  await expect(similarSites(lying, 'Shark Point', null, null)).resolves.toEqual([]);
  expect(rpc).not.toHaveBeenCalled();
});

/**
 * **A configured build with no signal** — the boat, which is the case §5's whole offline-dedupe
 * paragraph is about. The call rejects; the check answers nothing and does not throw, because
 * a rejection escaping here would strand the row the diver pressed, mid-gesture, forever.
 */
it('answers nothing when the call cannot reach anything, and never throws', async () => {
  const rpc = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
  await expect(similarSites(withServer(rpc), 'Kotelna', null, null)).resolves.toEqual([]);
});

/**
 * A server that refused: RLS (§5 grants execute to `authenticated` alone, so a signed-out
 * caller is refused outright), an empty name, a project one migration behind.
 *
 * Asserted twice on purpose. The first case is the shape supabase-js really produces — no
 * rows, an error — and the second is the one that makes the check load-bearing: rows AND an
 * error together. Without it, deleting the error check leaves `data` at `null`, which the
 * array check then refuses, and the whole guard could be removed with nothing going red.
 */
it('believes no rows that arrived beside a refusal', async () => {
  const refused = jest.fn().mockResolvedValue({ data: null, error: { code: '42501' } });
  await expect(similarSites(withServer(refused), 'Kotelna', null, null)).resolves.toEqual([]);

  const both = jest.fn().mockResolvedValue({ data: [SHARK_POINT], error: { code: '28000' } });
  await expect(similarSites(withServer(both), 'Kotelna', null, null)).resolves.toEqual([]);
});

/**
 * `similar_sites` returns `coalesce(jsonb_agg(...), '[]'::jsonb)`, so an array is the only
 * thing it can answer with. Anything else is a server this build does not understand — and
 * mapping over it would throw out of a function that has promised not to, which is exactly
 * what this check is for and what makes it fail when it is removed.
 */
it('answers nothing to a response that is not a list of rows', async () => {
  for (const data of [null, undefined, {}, 'rows', 7]) {
    await expect(similarSites(withServer(answered(data)), 'Kotelna', null, null)).resolves.toEqual([]);
  }
});
