-- Ponor · M2c · 6 of 6 — the four remaining RPCs of DESIGN.md §5
--
--   search_sites(...)       §2.3's ONLINE SUPPLEMENT to on-device autocomplete, and §5's
--                           "sites near me". Fuzzy name match (pg_trgm) and/or a radius
--                           around a point (PostGIS), best first, capped.
--   similar_sites(...)      §5's dedupe: "before saving a new entry, a fuzzy check suggests
--                           near-matches", and the same check re-run against a site that has
--                           just been pushed. One function, both callers — see below.
--   suggest_site_edit(...)  §5's "everyone else taps *suggest a correction*", landing in the
--                           review queue file 5 creates.
--   delete_account()        §8's in-app account deletion, "a hard App Store requirement".
--
-- **None of this has ever been run against Postgres.** Nobody working in this repository has
-- credentials for the project and none will be added (supabase/README.md, "Keys"). Grammar
-- is checked offline with libpg_query, and what these functions NAME is tied to the schema by
-- src/db/catalogueRpcParity.test.ts. Neither is a server, and three things in this file are
-- unprovable from here in particular; they are called out where they occur.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- WHY THE FIRST THREE ARE `security invoker` AND THE FOURTH IS NOT.
--
-- `dive_sites` is a community table with RLS on it, and M2a took a deliberate decision about
-- who may read it: signed-in users, never `anon`, on the reasoning that opening it later is
-- two statements and closing it after a scrape is impossible. **A `security definer` function
-- over that table is how that decision quietly reverses**: the function would run as its
-- owner, RLS would not apply to it, and every row would be readable by anyone who could call
-- it. So the three catalogue functions run as the caller, file 3's SELECT policy applies to
-- every statement in them, and the decision stays where M2a put it.
--
-- `delete_account` is the exception and it is the only one. It has to delete a row from
-- `auth.users`, which no client role may touch, so it runs as its owner — and everything
-- that follows from that is treated as a hazard rather than a convenience:
--   · it takes NO ARGUMENTS AT ALL, so there is no parameter through which another diver's
--     account could be named. The account it deletes is `auth.uid()` and can be nothing else.
--   · every statement in it carries `= v_uid` in its own `where`, because RLS is not there to
--     add one. A count with a missing `where` would report the whole catalogue back to the
--     caller; a DELETE with one missing would be somebody else's logbook.
--   · it contains exactly one statement that writes anything, and that statement names
--     `auth.users`. What happens to the other seven tables is decided by their foreign keys
--     in file 2, not by a list here — see the block above the function.
--
-- Every function is `set search_path = ''` with `public.`, `auth.` and `extensions.` names
-- spelled out; unqualified names are `pg_catalog` built-ins, which are searched implicitly
-- even then. Execute is revoked from PUBLIC (which is how `anon` loses it) and granted to
-- `authenticated` alone, matching file 3 and file 4.
--
-- `volatile` on all five, as in file 4, and for the same reason: volatility decides which
-- HTTP verbs PostgREST accepts, and supabase-js calls an RPC with POST. The honest marking
-- for the two read-only ones would be `stable`; the safe one is the default, and being wrong
-- here is a call that 404s rather than a call that lies.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- WHAT THE `extensions` SCHEMA COSTS, since M2a installed both extensions into it (file 1)
-- and this is the first file that actually uses them.
--
-- A FUNCTION is easy: `extensions.similarity(...)`, `extensions.st_dwithin(...)`, qualified
-- outright. An OPERATOR is not, and this is the trap worth naming: `name % query` resolves
-- through the `search_path`, and the `search_path` here is EMPTY. A bare `%` would not
-- resolve at all — the failure is loud, at create time, but only if someone runs the file —
-- so pg_trgm's operator is written the long way, `operator(extensions.%)`. That form is what
-- lets the GIN trigram indexes M2a built (`dive_sites_name_trgm_idx`) actually be used;
-- `similarity(...) >= floor` alone cannot use an index.
--
-- The `%` operator's own cut-off is the session GUC `pg_trgm.similarity_threshold`, whose
-- default is 0.3 — and `public.name_match_floor()` below is written to be exactly that
-- number, so the index pre-filter and this file's contract agree. If that GUC is ever RAISED
-- on this project, the pre-filter narrows past the floor and both functions quietly return
-- less; the remedy is one line (`alter role authenticated set pg_trgm.similarity_threshold =
-- 0.3;`). Deliberately not set inside these functions: a `SET pg_trgm.*` in a function
-- definition depends on the extension's GUC being registered when the statement is parsed,
-- and that is precisely the kind of thing nobody here can test.
--
-- The PostGIS half has the same shape and one unverifiable point. `extensions.st_dwithin` is
-- called qualified, but PostGIS's own SQL body then resolves the `&&` index operator itself;
-- PostGIS 3 schema-qualifies those internally, so this should hold under an empty
-- `search_path`. **This is the statement to watch when the file is first pasted in.** If it
-- raises `operator does not exist`, the one-word fix is `set search_path = extensions` on the
-- two functions that call it — still a pinned path, still not the mutable one Supabase's
-- linter flags.


-- ─── name_match_floor — the one place the fuzzy cut-off is written down ───────────────────
--
-- §4.1: one owner per rule. This number decides two different things — which sites `search_
-- sites` offers a diver who is typing, and which sites `similar_sites` calls a possible
-- duplicate — and if the two ever disagreed, autocomplete would offer a site that the dedupe
-- check would then refuse to warn about. That is a silent, confusing failure and it is one
-- literal apart, which is exactly the shape of drift §4.1 exists to name.
--
-- 0.3 because that is pg_trgm's own `similarity_threshold` default, so this floor and the
-- `operator(extensions.%)` pre-filter agree by construction rather than by coincidence. Note
-- what trigram similarity does NOT do: two or three characters share almost no trigrams with
-- a longer name, so a diver who has typed `sh` gets nothing back from here. That is correct
-- and is why §2.3 makes the on-device history and catalogue the FIRST answer and this one a
-- supplement — a supplement that stays quiet until the query is long enough to mean something.
create or replace function public.name_match_floor()
  returns double precision
  language sql
  immutable
  parallel safe
  security invoker
  set search_path = ''
as $$
  select 0.3::double precision;
$$;


-- ─── search_sites — §2.3's live supplement, and §5's "sites near me" ──────────────────────
--
-- §2.3: "Typing a site or center searches your own history first, then the on-device copy of
-- the community catalogue — both instant and fully offline. **Live search adds anything newer
-- when online.**" So this SUPPLEMENTS the device's own answer and never replaces it, and the
-- consequence for the return shape is the whole design of it: the client has to be able to
-- merge these rows into what it already holds, by `id`, without a second code path.
--
-- **So a row from here is byte-for-byte a row from `pull_changes`** — same `public.sync_site`
-- renderer, same latitude/longitude pair in place of the PostGIS point, same ISO-Z timestamp
-- spelling (§7). One writer for a catalogue row on the client, not one per source (§4.1). It
-- also means these rows are safe to upsert by comparing `updated_at`, exactly like pulled
-- ones — and that the client must NOT advance `last_pulled_at` on the strength of a search,
-- which returns a filtered subset and would step the watermark past everything it filtered out.
--
-- WHAT IT WILL NOT SHOW, and the contrast with `pull_changes` is deliberate. A pull delivers
-- tombstoned, `merged` and `hidden` rows because the device has to be TOLD about them. A
-- search offers a diver something to pick, so it offers only `status = 'active'` rows that are
-- not tombstoned — offering a merged duplicate would re-create the duplicate an admin has just
-- merged away.
--
-- THE TWO CRITERIA ARE INDEPENDENT AND AT LEAST ONE IS REQUIRED. A query filters by name; a
-- position filters by radius (and excludes sites with no pin, which cannot be near anything).
-- Both given means both apply, ranked by name first and distance second. Neither given raises
-- rather than returning the catalogue: a function that answers "everything" to an empty
-- question is a mistake waiting for a caller with an empty text field.
create or replace function public.search_sites(
  p_query text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_radius_m double precision default 50000,
  p_limit integer default 20
)
  returns jsonb
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_point extensions.geography;
  v_radius_m double precision := least(greatest(coalesce(p_radius_m, 50000), 0), 500000);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_rows jsonb;
begin
  -- §1 makes an account the condition for talking to this server at all, and file 3 names
  -- `anon` in no policy. Refusing outright rather than returning an empty array means a
  -- mis-granted EXECUTE shows up as an error instead of as an empty catalogue.
  if v_uid is null then
    raise exception 'search_sites: no authenticated user' using errcode = '28000';
  end if;

  if p_latitude is not null and p_longitude is not null then
    -- ST_MakePoint takes (X, Y) = (LONGITUDE, LATITUDE), as in file 4. Backwards is the
    -- classic silent PostGIS bug: every result comes from the wrong hemisphere and nothing
    -- raises, so the order is asserted in src/db/catalogueRpcParity.test.ts.
    v_point := extensions.st_setsrid(
      extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography;
  end if;

  if v_query is null and v_point is null then
    raise exception 'search_sites: needs a query, a position, or both' using errcode = '22023';
  end if;

  -- The CTE picks and ranks ids; the join renders whole rows. Splitting it that way is what
  -- keeps `to_jsonb(s)` the PURE table row — a CTE that carried the score would put it in the
  -- payload, and the client would be storing a search artefact in its catalogue copy.
  with matches as (
    select s.id as site_id,
           case
             when v_query is null then null
             else extensions.similarity(s.name, v_query)::double precision
           end as score,
           case
             when v_point is null or s.location is null then null
             else extensions.st_distance(s.location, v_point)
           end as distance_m
      from public.dive_sites as s
     where s.deleted_at is null
       and s.status = 'active'
       and (
         v_query is null
         or (
           s.name is not null
           and s.name operator(extensions.%) v_query
           and extensions.similarity(s.name, v_query) >= public.name_match_floor()
         )
       )
       and (
         v_point is null
         or (s.location is not null and extensions.st_dwithin(s.location, v_point, v_radius_m))
       )
     order by score desc nulls last, distance_m asc nulls last, s.id
     limit v_limit
  )
  select coalesce(
           jsonb_agg(public.sync_site(to_jsonb(s), s.location)
                     order by m.score desc nulls last, m.distance_m asc nulls last, s.id),
           '[]'::jsonb)
    into v_rows
    from matches as m
    join public.dive_sites as s on s.id = m.site_id;

  return v_rows;
end;
$$;


-- ─── similar_sites — §5's dedupe, for both of its callers ─────────────────────────────────
--
-- §5 asks for this twice and it is worth being explicit that it is ONE function:
--
--   (a) "Before saving a new entry, a fuzzy check suggests near-matches: *Did you mean Shark
--       Point?*" — the site does not exist yet, so there is nothing to exclude.
--   (b) "When a site created offline is pushed, the server reruns the fuzzy check and flags
--       likely duplicates for a one-tap merge by the creator" — the site now DOES exist, and a
--       naive call would return it as its own best duplicate.
--
-- **The two callers want the same matching and differ only in what counts as "itself"**, so
-- this takes `p_exclude_id`, defaulting to null. That argument exists from day one on purpose:
-- `create or replace function` cannot add an argument later (it refuses a changed signature),
-- so a version without it would have to be dropped and recreated in a migration of its own.
--
-- Note what (b) means and does not mean. `push_changes` does not call this — §5's "the server
-- reruns the fuzzy check" is satisfied by a server function the CLIENT calls after a
-- successful push, not by push doing it. Doing it inside push would need somewhere to write
-- the flag, and there is no such column; adding one would put §7's push in the business of
-- writing an admin-owned field, which is the one thing file 4 deliberately refuses.
--
-- PROXIMITY IS A SEPARATOR, NOT A RANKING. Two sites called "Blue Hole" three thousand
-- kilometres apart are not duplicates, they are two blue holes. So when BOTH the proposed site
-- and a candidate carry a pin and they are further apart than the radius, the candidate is not
-- offered. When either has no pin, the name decides alone — which is the common case, since
-- §2.3 lets a diver create a site with a name and nothing else.
create or replace function public.similar_sites(
  p_name text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_radius_m double precision default 25000,
  p_exclude_id uuid default null,
  p_limit integer default 5
)
  returns jsonb
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_point extensions.geography;
  v_radius_m double precision := least(greatest(coalesce(p_radius_m, 25000), 0), 500000);
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 25);
  v_rows jsonb;
begin
  if v_uid is null then
    raise exception 'similar_sites: no authenticated user' using errcode = '28000';
  end if;

  if v_name is null then
    raise exception 'similar_sites: a name is required' using errcode = '22023';
  end if;

  if p_latitude is not null and p_longitude is not null then
    v_point := extensions.st_setsrid(
      extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography;
  end if;

  with matches as (
    select s.id as site_id,
           extensions.similarity(s.name, v_name)::double precision as score
      from public.dive_sites as s
     where s.deleted_at is null
       and s.status = 'active'
       and s.name is not null
       and (p_exclude_id is null or s.id <> p_exclude_id)
       and s.name operator(extensions.%) v_name
       and extensions.similarity(s.name, v_name) >= public.name_match_floor()
       and (
         v_point is null
         or s.location is null
         or extensions.st_dwithin(s.location, v_point, v_radius_m)
       )
     order by score desc, s.id
     limit v_limit
  )
  select coalesce(
           jsonb_agg(public.sync_site(to_jsonb(s), s.location) order by m.score desc, s.id),
           '[]'::jsonb)
    into v_rows
    from matches as m
    join public.dive_sites as s on s.id = m.site_id;

  return v_rows;
end;
$$;


-- ─── suggest_site_edit — §5's other half of "one canonical record per site" ───────────────
--
-- §5: "the creator and the admin edit its facts (pin, entry, salinity, site depth); everyone
-- else taps *suggest a correction*, which lands in a review queue." File 3 enforces the first
-- clause by refusing an UPDATE from anyone but the creator; this is the second clause, and it
-- is why that refusal is not a dead end.
--
-- WHAT A SUGGESTION MAY PROPOSE is an allow-list, not a deny-list, and that direction is the
-- point: a column added to `dive_sites` in a later migration is NOT suggestible until someone
-- decides it should be. The list is the facts §5 names plus the two the site's identity needs
-- — and it deliberately excludes `status` and `merged_into` (§5 gives those to the admin, and
-- file 4 already refuses to let a client push them), `created_by` (ownership is never a
-- client's to propose), and the three bookkeeping timestamps. `latitude`/`longitude` are on it
-- although they are not columns of the table: §6 puts the pair on the wire and the point in
-- the database, so the pair is what a diver can actually propose. src/db/catalogueRpcParity
-- .test.ts checks this list against the schema in BOTH directions — every entry is a real
-- editable fact, and every column that is not on it is one somebody deliberately kept off.
--
-- A suggestion needs a `fields` entry or a `note`, and may have both. Requiring structured
-- fields would block the diver who can only say what is wrong — "the pin is on the far side of
-- the jetty" — and §1's rule is that the app never stands between a person and recording
-- something.
--
-- It returns the new row's id and nothing else. There is no reason to hand back a row the
-- client already has in its hand, and a timestamp going out would have to be re-spelled
-- through §7's `iso_z`; not returning one keeps that rule where it belongs.
create or replace function public.suggest_site_edit(
  p_site_id uuid,
  p_fields jsonb default '{}'::jsonb,
  p_note text default null
)
  returns jsonb
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_fields jsonb := coalesce(p_fields, '{}'::jsonb);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_allowed constant text[] := array[
    'name', 'country', 'latitude', 'longitude', 'salinity', 'water_body', 'entry', 'max_depth_m'
  ];
  v_unknown text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'suggest_site_edit: no authenticated user' using errcode = '28000';
  end if;

  if jsonb_typeof(v_fields) <> 'object' then
    raise exception 'suggest_site_edit: fields must be a JSON object' using errcode = '22023';
  end if;

  if v_fields = '{}'::jsonb and v_note is null then
    raise exception 'suggest_site_edit: a suggestion needs a field or a note' using errcode = '22023';
  end if;

  select string_agg(distinct k.key, ', ' order by k.key)
    into v_unknown
    from jsonb_object_keys(v_fields) as k(key)
   where k.key <> all (v_allowed);

  if v_unknown is not null then
    raise exception 'suggest_site_edit: % is not a fact a suggestion may propose', v_unknown
      using errcode = '42703';
  end if;

  -- The site has to exist and be worth correcting. A suggestion against a merged or hidden
  -- row is work an admin cannot act on: the row it names is not the one anybody sees.
  if not exists (
    select 1
      from public.dive_sites as s
     where s.id = p_site_id
       and s.status = 'active'
       and s.deleted_at is null
  ) then
    raise exception 'suggest_site_edit: no active site %', p_site_id using errcode = '23503';
  end if;

  -- `suggested_by` is written here rather than left to the column default so that the value
  -- the INSERT policy checks and the value this function intends are the same expression.
  insert into public.site_edits (site_id, suggested_by, fields, note)
    values (p_site_id, v_uid, v_fields, v_note)
    returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;


-- ─── delete_account — §8's App Store requirement, and the one that cannot be undone ───────
--
-- §8: "in-app account deletion via `delete_account` — a hard App Store requirement". §5: community
-- rows are "never hard-deleted". **Those two pull in opposite directions and resolving them is
-- what this function is.**
--
-- WHAT GOES: everything that is the diver's own. Their dives, their gear presets, their
-- certifications, their profile — and the `auth.users` row itself, which is where §8's "PII is
-- an email address, nothing more" actually lives. Deleting the personal rows but leaving the
-- account would leave the only PII in the system behind and would not be account deletion at all.
--
-- WHAT STAYS: the sites and centres they contributed. Those are not theirs. Other divers' dives
-- carry `site_id` references to them, and §6's name snapshot softens that without removing it — a
-- site row that vanishes takes its pin, its defaults and everyone's map marker with it. §5's
-- "history never breaks" is that sentence.
--
-- HOW BOTH HAPPEN AT ONCE, AND WHY THERE IS NO LIST HERE: the whole policy is already written in
-- file 2's foreign keys, and this function's single DELETE sets it off.
--
--     dives.user_id            references auth.users on delete CASCADE    → goes
--     gear_presets.user_id     references auth.users on delete CASCADE    → goes
--     certifications.user_id   references auth.users on delete CASCADE    → goes
--     profiles.id              references auth.users on delete CASCADE    → goes
--     dive_sites.created_by    references auth.users on delete SET NULL   → stays, unowned
--     dive_centers.created_by  references auth.users on delete SET NULL   → stays, unowned
--     site_edits.suggested_by  references auth.users on delete SET NULL   → stays, unowned
--
-- A list of DELETE statements here would be a second copy of that policy (§4.1), and the copy
-- that got it wrong would be this one — running as its owner, with no RLS underneath to catch a
-- missing `where`. src/db/schemaParity.test.ts requires every one of those seven columns to be
-- classified deliberately as cascade or set-null, so a table added in a later migration whose
-- rows are personal cannot silently survive an account deletion.
--
-- WHAT "SEVERED" MEANS FOR `created_by`, AND WHAT A RE-CREATED ACCOUNT COULD THEN EDIT — the
-- question worth answering out loud, because the answer is surprising and permanent. It becomes
-- NULL. File 3's UPDATE policy reads `created_by = auth.uid()`, and null equals nothing, so
-- **those sites become editable by nobody through the app, ever again — including by the same
-- person if they sign up afresh.** A new account is a new `auth.users.id`; there is nothing that
-- reconnects it. That is the right outcome rather than a regrettable one: a contributed site with
-- no owner is a community record, and §5's route to changing a community record you do not own is
-- `suggest_site_edit`, one function up. Deleting an account moves your sites from "yours to edit"
-- to "everyone's to suggest corrections to", and the admin in Studio remains able to change them.
--
-- A TOMBSTONE USER was the alternative — reassigning `created_by` to a "Ponor community" account
-- — and it is worse in every direction: it needs a real row in `auth.users`, which means a real
-- email address (fake PII, in a schema whose entire PII claim is one line of §8) and a login that
-- must never be signable into, and it produces the SAME outcome, since nobody can authenticate as
-- it either. Null is that outcome with nothing extra to secure.
--
-- WHAT THIS DOES NOT DO, stated so it is not mistaken for done:
--   · It does not sign the caller out. A JWT is stateless and stays valid until it expires, so
--     the client must sign out immediately after this returns. Supabase's own cascades take the
--     refresh tokens and sessions with the user row, so it cannot be renewed.
--   · It does not touch the device. §7.4 already says signing out wipes the local logbook; the
--     same erase has to follow a deletion, on every device, or the dives are still on a phone.
--   · It does not anonymise the free text in a suggestion's `note`. The row survives with its
--     author severed, which is the reversible choice — a note can be cleared later, a deleted
--     queue cannot be recovered — and it is flagged in the M2c report as the owner's to settle.
--
-- **THE ONE STATEMENT NOBODY HERE CAN VERIFY** is the DELETE itself. `auth.users` is owned by
-- `supabase_auth_admin`, and whether the role that runs this migration may delete from it is a
-- fact about the project, not about this SQL. If it raises `permission denied for table users`,
-- the function is created but unusable and §8's requirement is unmet — so it is worth finding out
-- deliberately, on a throwaway account, rather than from a reviewer. supabase/README.md says how.
create or replace function public.delete_account()
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_dive_sites_kept bigint;
  v_dive_centers_kept bigint;
begin
  if v_uid is null then
    raise exception 'delete_account: no authenticated user' using errcode = '28000';
  end if;

  -- Counted BEFORE the delete, while `created_by` still says so, and scoped by hand because
  -- this function runs as its owner and RLS adds no `where` of its own. They are returned so
  -- the app can tell a departing diver what it is leaving behind — "3 sites you added stay in
  -- the community catalogue" — which turns §5's promise into something they can see.
  select count(*) into v_dive_sites_kept
    from public.dive_sites as s where s.created_by = v_uid;

  select count(*) into v_dive_centers_kept
    from public.dive_centers as c where c.created_by = v_uid;

  -- The only statement in this function that writes anything, and the only one that names a
  -- table outside `public`. Everything in the block above happens because of it.
  delete from auth.users as u where u.id = v_uid;

  if not found then
    raise exception 'delete_account: no such account' using errcode = '28000';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'dive_sites_kept', v_dive_sites_kept,
    'dive_centers_kept', v_dive_centers_kept
  );
end;
$$;


-- ─── privileges ──────────────────────────────────────────────────────────────────────────
--
-- A new function is executable by PUBLIC, which includes `anon` — the role the publishable key
-- inside a downloadable app authenticates as. Revoke first, then grant the one role §1 says can
-- talk to this server at all. It matters most for the two that are not read-only: an anonymous
-- caller who could reach `delete_account` would be reaching a `security definer` function, and
-- an anonymous caller who could reach `suggest_site_edit` would be an unauthenticated writer
-- into a queue a human reads.
revoke all on function public.name_match_floor() from public;
revoke all on function public.search_sites(text, double precision, double precision, double precision, integer) from public;
revoke all on function public.similar_sites(text, double precision, double precision, double precision, uuid, integer) from public;
revoke all on function public.suggest_site_edit(uuid, jsonb, text) from public;
revoke all on function public.delete_account() from public;

grant execute on function public.name_match_floor() to authenticated;
grant execute on function public.search_sites(text, double precision, double precision, double precision, integer) to authenticated;
grant execute on function public.similar_sites(text, double precision, double precision, double precision, uuid, integer) to authenticated;
grant execute on function public.suggest_site_edit(uuid, jsonb, text) to authenticated;
grant execute on function public.delete_account() to authenticated;
