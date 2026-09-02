-- Ponor · M2b · 4 of 4 — the two sync RPCs of DESIGN.md §7
--
-- §7 is four sentences and a protocol. This file is the protocol:
--
--   push_changes(changes)          dirty rows go up in ONE transactional call; RLS validates
--                                  ownership; the server stamps updated_at; canonical rows
--                                  come back and the client clears its flags.
--   pull_changes(last_pulled_at)   the user's changed rows plus the compact community
--                                  catalogue, with the next watermark from the SERVER clock.
--
-- **None of this has ever been run against Postgres.** Nobody working in this repository has
-- credentials for the project and none will be added (supabase/README.md, "Keys"). What is
-- checked offline is the grammar (libpg_query) and the agreement between these functions and
-- the schema in file 2 (src/db/syncRpcParity.test.ts). Neither is a server.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- THE FOUR RULES THIS FILE EXISTS TO GET RIGHT. Every one of them fails SILENTLY — nothing
-- raises, a diver just quietly ends up with the wrong data on one of their devices.
--
-- 1. TIMESTAMPS GO OUT IN THE CLIENT'S OWN ISO-Z SPELLING. §7: "the client upserts by
--    comparing updated_at", and that comparison is a STRING comparison on a SQLite `text`
--    column written by `new Date().toISOString()`. PostgREST would render a `timestamptz` as
--    `2026-09-02 09:00:00+00`, which sorts differently from `2026-09-02T09:00:00.000Z` — so
--    last-write-wins would compare two spellings of one instant and the wrong device would
--    win. `public.iso_z` is the ONE place that spelling is written down, and
--    `public.sync_row` is the one place a row is rendered for the wire; every table in both
--    RPCs goes through them.
--
-- 2. created_at IS PRESERVED, NEVER REGENERATED (§6). §2.5 uses it as the ordering tier for
--    same-day dives with neither a time nor a hand-set order, so a push that restamps it
--    silently reorders a diver's day. It therefore appears in every INSERT column list (a
--    new row keeps the value the device wrote) and in NO `do update set` clause at all — the
--    first insert fixes it and no later push can move it.
--
-- 3. updated_at IS THE SERVER'S, ALWAYS (§6, §7). The client's value is advisory and never
--    survives: every insert and every update writes `v_now`, the transaction clock. There is
--    no trigger doing this — §6 gives the stamp to push_changes and a trigger would be a
--    second owner for one rule (§4.1), one this function could not override.
--
-- 4. TOMBSTONES ARE ROWS, NOT ABSENCES. A `deleted_at` row is something the other device has
--    to be TOLD about, so no query in this file filters on `deleted_at`. A `where deleted_at
--    is null` anywhere below would mean a delete on one device never reaches the other, and
--    would look exactly like "there was nothing to send".
-- ─────────────────────────────────────────────────────────────────────────────────────────
--
-- ONE TRANSACTION, BY CONSTRUCTION. §7 says the push is one transactional call and has no
-- repair for a partial one — the client would clear flags for rows the server never took.
-- A Postgres function body runs inside its caller's transaction, and PostgREST wraps one
-- request in one transaction, so this is free PROVIDED nothing in here opens a
-- subtransaction that can swallow a failure. That is why `push_changes` contains no
-- `exception` block: an `exception when others then` would roll back its own block, carry
-- on, and return a success the client would believe.
--
-- SECURITY INVOKER, DELIBERATELY. §7 says "RLS validates ownership", so these run as the
-- caller and every policy in file 3 applies to every statement below. `security definer`
-- would make ownership this file's problem instead of the database's — one missed `where
-- user_id =` and a diver reads somebody else's logbook. Nothing here needs it. Execute is
-- revoked from PUBLIC (which is how `anon` loses it) and granted to `authenticated` alone,
-- matching file 3's stance that an account is the condition for talking to this server.
--
-- `set search_path = ''` on every function, with `public.`, `auth.` and `extensions.` names
-- spelled out. Unqualified names below are `pg_catalog` built-ins, which Postgres searches
-- implicitly even when the path is empty, so there is nowhere for a shadowing function to be
-- planted.
--
-- RE-RUNNING: every statement is `create or replace` / `revoke` / `grant`, so pasting this
-- file again is a no-op. The one thing it cannot do is change a function's SIGNATURE —
-- `create or replace` refuses a new argument name or type. If an argument is ever added
-- (see the country-scope note on `pull_changes`), that migration needs `drop function` first.


-- ─── iso_z — the one place the client's timestamp spelling is written ─────────────────────
--
-- `new Date().toISOString()` and nothing else. `MS` is milliseconds, zero-padded to three,
-- which is what JavaScript emits; it TRUNCATES Postgres' microseconds, and truncating
-- downwards is the safe direction for a watermark (a row is re-sent, never skipped).
--
-- `stable`, not `immutable`: `to_char(timestamp, text)` is itself stable.
create or replace function public.iso_z(ts timestamptz)
  returns text
  language sql
  stable
  strict
  parallel safe
  security invoker
  set search_path = ''
as $$
  select to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;


-- ─── sync_row — the one place a synced row is rendered for the wire ───────────────────────
--
-- Takes `to_jsonb(row)` and re-spells the three sync timestamps. Taking the WHOLE row rather
-- than a column list is the point: a column added to a table in a later migration is carried
-- by both RPCs with no edit here, so a field cannot go missing from the payload — which is
-- the failure that loses data while failing nothing. The columns are named on the way IN
-- (push's insert lists) and that list is what src/db/syncRpcParity.test.ts ties to the
-- schema.
--
-- The round-trip through text is exact: `to_jsonb` renders a `timestamptz` as ISO 8601
-- regardless of DateStyle, and parsing that back loses nothing.
create or replace function public.sync_row(row_json jsonb)
  returns jsonb
  language sql
  stable
  strict
  parallel safe
  security invoker
  set search_path = ''
as $$
  select row_json || jsonb_build_object(
    'created_at', public.iso_z((row_json->>'created_at')::timestamptz),
    'updated_at', public.iso_z((row_json->>'updated_at')::timestamptz),
    'deleted_at', public.iso_z((row_json->>'deleted_at')::timestamptz)
  );
$$;


-- ─── sync_site — the one place a PostGIS point becomes the pair SQLite can hold ───────────
--
-- §6: "SQLite has no point type, so a dive's optional exact position is two nullable columns
-- on the device. Postgres composes them into a PostGIS point — the sync payload carries the
-- pair, and the server owns the geometry." `dive_sites` and `dive_centers` are where that
-- lands, because they are the tables that actually have the point. Handing the client
-- `location` as PostGIS renders it would send WKB hex, which no device can read.
--
-- ST_X is LONGITUDE and ST_Y is LATITUDE, the mirror of the ST_MakePoint(long, lat) in
-- push_changes. Swapping either pair puts every site in the wrong hemisphere and raises
-- nothing at all, so both halves are asserted in src/db/syncRpcParity.test.ts.
--
-- Emphatically NOT `strict`: a site with no pin has a null `location`, and a strict function
-- would return null for the entire row rather than a row with two null coordinates — i.e.
-- every unpinned site would vanish from the catalogue.
create or replace function public.sync_site(row_json jsonb, geo extensions.geography)
  returns jsonb
  language sql
  stable
  parallel safe
  security invoker
  set search_path = ''
as $$
  select (public.sync_row(row_json) - 'location'::text) || jsonb_build_object(
    'latitude', extensions.st_y(geo::extensions.geometry),
    'longitude', extensions.st_x(geo::extensions.geometry)
  );
$$;


-- ─── sync_reject_unknown_keys — a newer client's new field must not vanish ────────────────
--
-- `jsonb_populate_record` ignores a key it has no column for, silently. That is the good
-- behaviour for a value (§10: a vocabulary value this build does not know is stored and
-- flagged, not rejected) and the wrong one for a COLUMN: a device running a build whose
-- schema migration has not been applied here would push a field, be told the push succeeded,
-- clear its dirty flag, and lose that field forever.
--
-- So an unrecognised key raises. It costs the diver their sync until the migration lands —
-- which §7 and §10 both say is survivable, since a sync failure never blocks logging — and
-- it costs them nothing permanent. `p_extra` names keys that are legitimately not columns:
-- the latitude/longitude pair the community tables carry instead of their PostGIS point.
create or replace function public.sync_reject_unknown_keys(p_table text, p_rows jsonb, p_extra text[] default '{}')
  returns void
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_unknown text;
begin
  select string_agg(distinct keys.key, ', ' order by keys.key)
    into v_unknown
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as rows_(value),
         jsonb_object_keys(rows_.value) as keys(key)
   where keys.key <> all (p_extra)
     and not exists (
       select 1
         from pg_catalog.pg_attribute a
        where a.attrelid = ('public.' || p_table)::regclass
          and a.attnum > 0
          and not a.attisdropped
          and a.attname = keys.key
     );

  if v_unknown is not null then
    raise exception 'push_changes: public.% has no column %', p_table, v_unknown
      using errcode = '42703';
  end if;
end;
$$;


-- ─── push_changes ────────────────────────────────────────────────────────────────────────
--
-- `changes` is `{ "<table>": [ row, … ], … }` — the same shape both RPCs return, so the
-- client has ONE writer for canonical rows instead of one per direction (§4.1).
--
-- WHAT THE CLIENT DOES NOT GET TO DECIDE, and why each one is taken off it:
--   · user_id / created_by / profiles.id  — always `auth.uid()`. This is also the whole of
--     §7.4's guest→account migration: local rows carry no user_id column at all
--     (src/db/schema.ts), so "local rows get the new user_id and push" is a client-side
--     re-flagging of every row, and push needs no case for it. A stale or forged owner in
--     the payload cannot do anything, because the payload's is never read.
--   · updated_at — always `v_now` (rule 3 above).
--   · created_at — the payload's on insert, untouchable afterwards (rule 2).
--   · dive_sites.status / merged_into and the same pair on dive_centers — §5 makes the merge
--     queue the ADMIN's, worked in Studio: "an admin setting status to merged with
--     merged_into pointing at the survivor". A device holding a stale catalogue copy must not
--     be able to undo that by pushing an unrelated edit to the same site, which is what
--     whole-row last-write-wins would otherwise do. §7's LWW is about one diver's own devices
--     disagreeing; these two columns have a third author. New rows get `status = 'active'`
--     from the column default.
--
-- TWO OBLIGATIONS THIS PUTS ON THE CLIENT, because RLS enforces them by raising rather than
-- by ignoring, and §7's push is one transaction — so either one failing takes the diver's
-- whole sync down until the row stops being dirty:
--   · Do not mark a community row dirty unless you created it. `dive_sites`/`dive_centers`
--     are readable by every signed-in user but updatable only by their creator (§5), and an
--     `on conflict do update` on somebody else's site is refused by the UPDATE policy. §5
--     already says everyone else taps *suggest a correction*; this is that sentence with
--     teeth.
--   · A dive with no `date` cannot be pushed. The column is NOT NULL in both schemas (§6),
--     so this is the same rule the device already enforces, arriving one layer down.
--
-- WHAT IT DELIBERATELY DOES NOT DO: it does not decide whether a row really changed. §6 gives
-- that rule to the client ("a write changing nothing must not advance updated_at") and
-- db/gearPresets.ts already owns it; a second opinion here would be §4.1's defect.
-- It also returns no watermark: a client that stored one from a push would skip everything
-- ELSE that changed in the same window. Watermarks come from pull_changes alone (§7.3).
create or replace function public.push_changes(changes jsonb)
  returns jsonb
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_changes jsonb := coalesce(changes, '{}'::jsonb);
  v_out jsonb := '{}'::jsonb;
  v_rows jsonb;
  v_unknown text;
begin
  if v_uid is null then
    raise exception 'push_changes: no authenticated user' using errcode = '28000';
  end if;

  -- A table this server has never heard of is the same failure as an unknown column, one
  -- level up, and it is refused for the same reason: silently dropping it would have the
  -- client clear flags for rows that were never stored.
  select string_agg(distinct keys.key, ', ' order by keys.key)
    into v_unknown
    from jsonb_object_keys(v_changes) as keys(key)
   where keys.key not in ('dives', 'gear_presets', 'certifications', 'profiles', 'dive_sites', 'dive_centers');
  if v_unknown is not null then
    raise exception 'push_changes: unknown table %', v_unknown using errcode = '42P01';
  end if;

  -- ── dives ──────────────────────────────────────────────────────────────────────────────
  perform public.sync_reject_unknown_keys('dives', v_changes->'dives');

  with incoming as (
    select * from jsonb_populate_recordset(null::public.dives, coalesce(v_changes->'dives', '[]'::jsonb))
  ),
  upserted as (
    insert into public.dives as t (
      id, user_id, status, date, time_in, manual_order, duration_min, title, notes, rating,
      site_id, site_name, center_id, center_name, entry, salinity, water_body,
      latitude, longitude, max_depth_m, avg_depth_m, water_temp_c, air_temp_c,
      visibility, visibility_m, waves, current, surge, weather, tanks,
      suit, suit_thickness_mm, equipment, weights_kg, weights_feel, buddy, guide,
      import_source, import_id, created_at, updated_at, deleted_at
    )
    select
      incoming.id, v_uid, coalesce(incoming.status, 'logged'), incoming.date, incoming.time_in,
      incoming.manual_order, incoming.duration_min, incoming.title, incoming.notes, incoming.rating,
      incoming.site_id, incoming.site_name, incoming.center_id, incoming.center_name,
      incoming.entry, incoming.salinity, incoming.water_body,
      incoming.latitude, incoming.longitude, incoming.max_depth_m, incoming.avg_depth_m,
      incoming.water_temp_c, incoming.air_temp_c, incoming.visibility, incoming.visibility_m,
      incoming.waves, incoming.current, incoming.surge, incoming.weather,
      coalesce(incoming.tanks, '[]'::jsonb), incoming.suit, incoming.suit_thickness_mm,
      coalesce(incoming.equipment, '[]'::jsonb), incoming.weights_kg, incoming.weights_feel,
      incoming.buddy, incoming.guide, incoming.import_source, incoming.import_id,
      coalesce(incoming.created_at, v_now), v_now, incoming.deleted_at
    from incoming
    on conflict (id) do update set
      status = excluded.status, date = excluded.date, time_in = excluded.time_in,
      manual_order = excluded.manual_order, duration_min = excluded.duration_min,
      title = excluded.title, notes = excluded.notes, rating = excluded.rating,
      site_id = excluded.site_id, site_name = excluded.site_name,
      center_id = excluded.center_id, center_name = excluded.center_name,
      entry = excluded.entry, salinity = excluded.salinity, water_body = excluded.water_body,
      latitude = excluded.latitude, longitude = excluded.longitude,
      max_depth_m = excluded.max_depth_m, avg_depth_m = excluded.avg_depth_m,
      water_temp_c = excluded.water_temp_c, air_temp_c = excluded.air_temp_c,
      visibility = excluded.visibility, visibility_m = excluded.visibility_m,
      waves = excluded.waves, current = excluded.current, surge = excluded.surge,
      weather = excluded.weather, tanks = excluded.tanks, suit = excluded.suit,
      suit_thickness_mm = excluded.suit_thickness_mm, equipment = excluded.equipment,
      weights_kg = excluded.weights_kg, weights_feel = excluded.weights_feel,
      buddy = excluded.buddy, guide = excluded.guide,
      import_source = excluded.import_source, import_id = excluded.import_id,
      updated_at = v_now, deleted_at = excluded.deleted_at
    returning t.*
  )
  select coalesce(jsonb_agg(public.sync_row(to_jsonb(u))), '[]'::jsonb) into v_rows from upserted as u;
  v_out := v_out || jsonb_build_object('dives', v_rows);

  -- ── gear_presets ───────────────────────────────────────────────────────────────────────
  perform public.sync_reject_unknown_keys('gear_presets', v_changes->'gear_presets');

  with incoming as (
    select * from jsonb_populate_recordset(null::public.gear_presets, coalesce(v_changes->'gear_presets', '[]'::jsonb))
  ),
  upserted as (
    insert into public.gear_presets as t (
      id, user_id, name, tanks, created_at, updated_at, deleted_at
    )
    select
      incoming.id, v_uid, incoming.name, coalesce(incoming.tanks, '[]'::jsonb),
      coalesce(incoming.created_at, v_now), v_now, incoming.deleted_at
    from incoming
    on conflict (id) do update set
      name = excluded.name, tanks = excluded.tanks,
      updated_at = v_now, deleted_at = excluded.deleted_at
    returning t.*
  )
  select coalesce(jsonb_agg(public.sync_row(to_jsonb(u))), '[]'::jsonb) into v_rows from upserted as u;
  v_out := v_out || jsonb_build_object('gear_presets', v_rows);

  -- ── certifications ─────────────────────────────────────────────────────────────────────
  perform public.sync_reject_unknown_keys('certifications', v_changes->'certifications');

  with incoming as (
    select * from jsonb_populate_recordset(null::public.certifications, coalesce(v_changes->'certifications', '[]'::jsonb))
  ),
  upserted as (
    insert into public.certifications as t (
      id, user_id, agency, course, card_number, issued_on, expires_on,
      created_at, updated_at, deleted_at
    )
    select
      incoming.id, v_uid, incoming.agency, incoming.course, incoming.card_number,
      incoming.issued_on, incoming.expires_on,
      coalesce(incoming.created_at, v_now), v_now, incoming.deleted_at
    from incoming
    on conflict (id) do update set
      agency = excluded.agency, course = excluded.course, card_number = excluded.card_number,
      issued_on = excluded.issued_on, expires_on = excluded.expires_on,
      updated_at = v_now, deleted_at = excluded.deleted_at
    returning t.*
  )
  select coalesce(jsonb_agg(public.sync_row(to_jsonb(u))), '[]'::jsonb) into v_rows from upserted as u;
  v_out := v_out || jsonb_build_object('certifications', v_rows);

  -- ── profiles ───────────────────────────────────────────────────────────────────────────
  -- `id` IS the auth user id (§6), so it is both the conflict key and the ownership column:
  -- the payload's id is not read at all and a diver can only ever write their own row.
  perform public.sync_reject_unknown_keys('profiles', v_changes->'profiles');

  with incoming as (
    select * from jsonb_populate_recordset(null::public.profiles, coalesce(v_changes->'profiles', '[]'::jsonb))
  ),
  upserted as (
    insert into public.profiles as t (
      id, display_name, dives_before, created_at, updated_at, deleted_at
    )
    select
      v_uid, incoming.display_name, incoming.dives_before,
      coalesce(incoming.created_at, v_now), v_now, incoming.deleted_at
    from incoming
    on conflict (id) do update set
      display_name = excluded.display_name, dives_before = excluded.dives_before,
      updated_at = v_now, deleted_at = excluded.deleted_at
    returning t.*
  )
  select coalesce(jsonb_agg(public.sync_row(to_jsonb(u))), '[]'::jsonb) into v_rows from upserted as u;
  v_out := v_out || jsonb_build_object('profiles', v_rows);

  -- ── dive_sites ─────────────────────────────────────────────────────────────────────────
  -- The two community tables are read key by key out of the raw payload rather than through
  -- `jsonb_populate_recordset`, because their point is one PostGIS `location` where SQLite
  -- holds a latitude/longitude pair (§6) — there is no composite mapping that could do it.
  --
  -- ST_MakePoint takes (X, Y) = (LONGITUDE, LATITUDE). Getting that pair backwards is the
  -- classic silent PostGIS bug — every dive site quietly lands in the wrong hemisphere and
  -- nothing errors — so the order is asserted in src/db/syncRpcParity.test.ts, here and in
  -- the ST_X/ST_Y that take it apart again in pull_changes.
  perform public.sync_reject_unknown_keys('dive_sites', v_changes->'dive_sites', array['latitude', 'longitude']);

  with incoming as (
    select value as payload from jsonb_array_elements(coalesce(v_changes->'dive_sites', '[]'::jsonb))
  ),
  upserted as (
    insert into public.dive_sites as t (
      id, name, country, location, salinity, water_body, entry, max_depth_m,
      created_by, created_at, updated_at, deleted_at
    )
    select
      (incoming.payload->>'id')::uuid, incoming.payload->>'name', incoming.payload->>'country',
      case
        when incoming.payload->>'latitude' is not null and incoming.payload->>'longitude' is not null
        then extensions.st_setsrid(extensions.st_makepoint(
               (incoming.payload->>'longitude')::double precision,
               (incoming.payload->>'latitude')::double precision), 4326)::extensions.geography
      end,
      incoming.payload->>'salinity', incoming.payload->>'water_body', incoming.payload->>'entry',
      (incoming.payload->>'max_depth_m')::double precision,
      v_uid, coalesce((incoming.payload->>'created_at')::timestamptz, v_now), v_now,
      (incoming.payload->>'deleted_at')::timestamptz
    from incoming
    on conflict (id) do update set
      name = excluded.name, country = excluded.country, location = excluded.location,
      salinity = excluded.salinity, water_body = excluded.water_body, entry = excluded.entry,
      max_depth_m = excluded.max_depth_m,
      updated_at = v_now, deleted_at = excluded.deleted_at
    returning t.*
  )
  select coalesce(jsonb_agg(public.sync_site(to_jsonb(u), u.location)), '[]'::jsonb) into v_rows from upserted as u;
  v_out := v_out || jsonb_build_object('dive_sites', v_rows);

  -- ── dive_centers ───────────────────────────────────────────────────────────────────────
  perform public.sync_reject_unknown_keys('dive_centers', v_changes->'dive_centers', array['latitude', 'longitude']);

  with incoming as (
    select value as payload from jsonb_array_elements(coalesce(v_changes->'dive_centers', '[]'::jsonb))
  ),
  upserted as (
    insert into public.dive_centers as t (
      id, name, country, location, website,
      created_by, created_at, updated_at, deleted_at
    )
    select
      (incoming.payload->>'id')::uuid, incoming.payload->>'name', incoming.payload->>'country',
      case
        when incoming.payload->>'latitude' is not null and incoming.payload->>'longitude' is not null
        then extensions.st_setsrid(extensions.st_makepoint(
               (incoming.payload->>'longitude')::double precision,
               (incoming.payload->>'latitude')::double precision), 4326)::extensions.geography
      end,
      incoming.payload->>'website',
      v_uid, coalesce((incoming.payload->>'created_at')::timestamptz, v_now), v_now,
      (incoming.payload->>'deleted_at')::timestamptz
    from incoming
    on conflict (id) do update set
      name = excluded.name, country = excluded.country, location = excluded.location,
      website = excluded.website,
      updated_at = v_now, deleted_at = excluded.deleted_at
    returning t.*
  )
  select coalesce(jsonb_agg(public.sync_site(to_jsonb(u), u.location)), '[]'::jsonb) into v_rows from upserted as u;
  v_out := v_out || jsonb_build_object('dive_centers', v_rows);

  return jsonb_build_object('server_time', public.iso_z(v_now), 'changes', v_out);
end;
$$;


-- ─── pull_changes ────────────────────────────────────────────────────────────────────────
--
-- Returns `{ server_time, last_pulled_at, changes: { "<table>": [ row, … ] } }`.
--
-- THE WATERMARK IS THE SERVER'S AND IT IS DELIBERATELY EARLY. §7.3: last_pulled_at comes from
-- the server's response, never the phone's clock — divers change time zones constantly. But
-- `now()` alone is not safe as a watermark, and the reason is the one the brief asks about:
-- `now()` is TRANSACTION START. A push that began before this pull and commits after it
-- stamped its rows with a time earlier than this pull's `now()`, and this pull cannot see
-- them — its snapshot was taken before that commit. Returning `now()` would step the
-- watermark past rows that were never delivered, and they would never be delivered again.
--
-- So the watermark handed back is `now()` minus an overlap window, and the next pull re-reads
-- that window. Re-reading is free: the client upserts by comparing updated_at (§7), so a row
-- it already has is a no-op. One minute is far longer than any push can take — Supabase caps
-- `authenticated` statements in the single-digit seconds — and the only thing that could
-- outrun it is a writing transaction held open for over a minute, which nothing in this
-- schema can do. `server_time` is the un-shifted clock, reported so the shift is visible
-- rather than looking like a bug.
--
-- WHAT COMES BACK: the caller's own rows from the four private tables, and the WHOLE
-- community catalogue changed since the watermark (§5/§7: all of it while the community is
-- young, country-scoped once it isn't). Tombstoned, `merged` and `hidden` rows are all
-- included, which is deliberate and is file 3's stated reading of the SELECT policy: a pull
-- has to deliver a merge and a deletion for the client to act on, and which rows a diver is
-- SHOWN is the client's question.
--
-- ON GROWING A COUNTRY SCOPE WITHOUT A FLAG DAY: nothing about the RESPONSE changes — a
-- narrower catalogue is fewer rows in the same array, so no client release has to land with a
-- server one. The scope arrives as a second argument with a default (`countries text[]
-- default null`), which PostgREST resolves by name, so a client that does not send it keeps
-- working unchanged. The only care needed is that `create or replace` cannot add an argument:
-- that migration must `drop function public.pull_changes(timestamptz)` and create the new
-- signature in the same file, which is atomic.
--
-- `volatile` rather than `stable`, although this function writes nothing: supabase-js calls
-- an RPC with POST, and volatility is what decides which verbs PostgREST will accept. The
-- honest marking would be `stable`; the safe one is the default, and being wrong here is a
-- sync that 404s rather than a sync that lies.
create or replace function public.pull_changes(last_pulled_at timestamptz default null)
  returns jsonb
  language plpgsql
  volatile
  security invoker
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_overlap constant interval := interval '1 minute';
  v_out jsonb := '{}'::jsonb;
  v_rows jsonb;
begin
  if v_uid is null then
    raise exception 'pull_changes: no authenticated user' using errcode = '28000';
  end if;

  select coalesce(jsonb_agg(public.sync_row(to_jsonb(d))), '[]'::jsonb) into v_rows
    from public.dives as d
   where d.user_id = v_uid
     and (last_pulled_at is null or d.updated_at > last_pulled_at);
  v_out := v_out || jsonb_build_object('dives', v_rows);

  select coalesce(jsonb_agg(public.sync_row(to_jsonb(g))), '[]'::jsonb) into v_rows
    from public.gear_presets as g
   where g.user_id = v_uid
     and (last_pulled_at is null or g.updated_at > last_pulled_at);
  v_out := v_out || jsonb_build_object('gear_presets', v_rows);

  select coalesce(jsonb_agg(public.sync_row(to_jsonb(c))), '[]'::jsonb) into v_rows
    from public.certifications as c
   where c.user_id = v_uid
     and (last_pulled_at is null or c.updated_at > last_pulled_at);
  v_out := v_out || jsonb_build_object('certifications', v_rows);

  select coalesce(jsonb_agg(public.sync_row(to_jsonb(p))), '[]'::jsonb) into v_rows
    from public.profiles as p
   where p.id = v_uid
     and (last_pulled_at is null or p.updated_at > last_pulled_at);
  v_out := v_out || jsonb_build_object('profiles', v_rows);

  select coalesce(jsonb_agg(public.sync_site(to_jsonb(s), s.location)), '[]'::jsonb) into v_rows
    from public.dive_sites as s
   where last_pulled_at is null or s.updated_at > last_pulled_at;
  v_out := v_out || jsonb_build_object('dive_sites', v_rows);

  select coalesce(jsonb_agg(public.sync_site(to_jsonb(dc), dc.location)), '[]'::jsonb) into v_rows
    from public.dive_centers as dc
   where last_pulled_at is null or dc.updated_at > last_pulled_at;
  v_out := v_out || jsonb_build_object('dive_centers', v_rows);

  return jsonb_build_object(
    'server_time', public.iso_z(v_now),
    'last_pulled_at', public.iso_z(v_now - v_overlap),
    'changes', v_out
  );
end;
$$;


-- ─── privileges ──────────────────────────────────────────────────────────────────────────
--
-- A new function is executable by PUBLIC in Postgres, which includes `anon` — the role the
-- publishable key inside a downloadable app authenticates as. File 3 revokes `anon` on every
-- table and names it in no policy; leaving it EXECUTE here would be that decision undone at a
-- different level. Revoke first, then grant the one role §1 says can talk to this server at
-- all. (Studio connects as the owner, which needs no grant.)
revoke all on function public.iso_z(timestamptz) from public;
revoke all on function public.sync_row(jsonb) from public;
revoke all on function public.sync_site(jsonb, extensions.geography) from public;
revoke all on function public.sync_reject_unknown_keys(text, jsonb, text[]) from public;
revoke all on function public.push_changes(jsonb) from public;
revoke all on function public.pull_changes(timestamptz) from public;

grant execute on function public.iso_z(timestamptz) to authenticated;
grant execute on function public.sync_row(jsonb) to authenticated;
grant execute on function public.sync_site(jsonb, extensions.geography) to authenticated;
grant execute on function public.sync_reject_unknown_keys(text, jsonb, text[]) to authenticated;
grant execute on function public.push_changes(jsonb) to authenticated;
grant execute on function public.pull_changes(timestamptz) to authenticated;
