-- Ponor · M2a · 2 of 3 — the six tables of DESIGN.md §6
--
-- §6 opens with "the same schema lives in SQLite (Drizzle) and Postgres". That sentence
-- is a claim about two hand-maintained files, which is §4.1's defining defect waiting to
-- happen, so it is checked: `src/db/schemaParity.test.ts` reads THIS FILE and
-- `src/db/schema.ts` and fails on drift in either direction. If you add a column below,
-- add it there too or that test goes red — which is the entire point of it.
--
-- Everything here is `create ... if not exists`, so the file is safe to re-run. Note the
-- flip side, stated because a half-applied schema is a bad first experience with a
-- database nobody can inspect from a laptop: `if not exists` does NOT alter a table that
-- already exists. Editing this file after applying it changes nothing on re-run — on a
-- throwaway project drop the tables and start over, on a real one write a new migration.
--
-- The one line below that depends on the session `search_path` is the GiST index on
-- `dive_sites.location`: its default operator class lives in `extensions`. The `set` on
-- the next line covers it, and Supabase's roles already point there anyway. The PostGIS
-- and pg_trgm names used in column and index definitions are schema-qualified outright,
-- so they do not depend on it at all.

set search_path = public, extensions;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Conventions that hold for every table below, each of them a rule from §6 rather than
-- a house style:
--
-- IDS ARE CLIENT-GENERATED UUIDv7 (§6), because offline creation must never need
-- re-mapping. So: `uuid` columns with `default gen_random_uuid()` as a *fallback* for a
-- row inserted server-side, and nothing anywhere that overwrites an id the client chose.
-- There is no serial, no identity and no id-rewriting trigger in this schema, and the
-- parity test asserts that rather than trusting this paragraph.
--
-- EVERY COLUMN IS NULLABLE except the ones §6 exempts — a diver who surfaces knowing
-- only that they dived today must still be able to save (§1). The exceptions are
-- `id`, `user_id`, `date`, the two timestamps, and the columns whose empty value already
-- means "not recorded": `tanks` and `equipment` (`'[]'`, §6's stated one exception),
-- `dives.status` (`'logged'`), `gear_presets.name`, and the community `status`
-- (`'active'`). Each of those five mirrors a NOT NULL that `src/db/schema.ts` already
-- has, which is what "the same schema" means.
--
-- CALENDAR DATES AND CLOCK TIMES ARE `text`, NOT `date`/`time`, and this is the one
-- place the Postgres column type is chosen against the obvious answer. Two reasons, both
-- load-bearing. (1) `domain/datetime.ts` is the single owner of a `YYYY-MM-DD` /`HH:MM`
-- string and its write boundary deliberately "canonicalises what it can and stores the
-- rest unchanged", because §1 says logging a dive is never blocked — so a device really
-- can hold `date = 'sometime in June'`, and §7 pushes rows in ONE transactional call, so
-- a `date` column would reject that row and take the diver's entire push down with it,
-- permanently. (2) `time` would round-trip `'09:30'` back as `'09:30:00'`, a different
-- string than the one the client wrote, silently changing the stored shape of every
-- timed dive that has been through the server.
--
-- TIMESTAMPS ARE `timestamptz`, and the asymmetry with the line above is deliberate.
-- `created_at`/`updated_at` are written by `new Date().toISOString()` alone (db/dives.ts
-- is the only writer), which cannot produce a malformed value the way a diver's typing
-- can — so the §1 argument does not reach them, and a real timestamp type is what lets
-- `push_changes` restamp with `now()` (§7) and §5's Studio usage views count dives per
-- week without casting. It leaves one obligation on the next task: PostgREST renders
-- `timestamptz` as `...+00:00` while the client writes `...Z`, and §7's client-side
-- "upsert by comparing updated_at" is a string comparison, so the RPCs must return these
-- columns in the client's own ISO-Z spelling.
--
-- CLOSED VOCABULARIES ARE PLAIN `text` WITH NO CHECK CONSTRAINT AND NO ENUM. §10 rules
-- that a value from a client this build does not know is "stored and flagged, not
-- rejected" — it is already how the app treats `entry`, `weather`, `rating` and the 0-3
-- scales, and §10 spells out the sync case it exists for. A Postgres enum makes that
-- impossible without a migration deployed *before* the client that sends the new value,
-- and a CHECK turns a widened scale from a newer build into a rejected push. The
-- vocabularies live in `src/domain/types.ts` and are enforced where a diver can see the
-- result, not here. This is the same ruling that already keeps `rating` and the
-- condition scales CHECK-free in SQLite.
-- ─────────────────────────────────────────────────────────────────────────────────────

-- One row per dive; private to its owner. Mirrors `dives` in src/db/schema.ts column for
-- column, plus `user_id`, which exists only here because a device has exactly one diver.
--
-- `site_id` and `center_id` carry NO foreign key, deliberately. §6 stores a `site_name`
-- snapshot beside each precisely so a reference that does not resolve costs nothing, and
-- §7 pushes dives and offline-created sites in one transaction — an FK would let a
-- missing or not-yet-inserted community row reject the diver's own dive. It would also
-- make Postgres disagree with SQLite about what a valid row is, which is the drift the
-- parity test exists to catch.
--
-- `latitude`/`longitude` stay two columns, per §6: SQLite has no point type, and the
-- sync payload carries the pair. No PostGIS geometry is composed from them yet — see
-- supabase/README.md for what that would take and why nothing in v1 needs it.
--
-- There is deliberately no `dive_number`: numbers are computed from chronology plus the
-- `dives_before` offset (§2.5). Do not add one.
create table if not exists public.dives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'logged',
  date text not null,
  time_in text,
  manual_order integer,
  duration_min integer,
  title text,
  notes text,
  rating integer,
  site_id uuid,
  site_name text,
  center_id uuid,
  center_name text,
  entry text,
  salinity text,
  water_body text,
  latitude double precision,
  longitude double precision,
  max_depth_m double precision,
  avg_depth_m double precision,
  water_temp_c double precision,
  air_temp_c double precision,
  visibility text,
  visibility_m double precision,
  waves integer,
  current integer,
  surge integer,
  weather text,
  tanks jsonb not null default '[]'::jsonb,
  suit text,
  suit_thickness_mm double precision,
  equipment jsonb not null default '[]'::jsonb,
  weights_kg double precision,
  weights_feel text,
  buddy text,
  guide text,
  import_source text,
  import_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Community dive sites. Server-authoritative, which is why this table gets the single
-- PostGIS `location` §6 gives it while a dive keeps its pair.
--
-- `status` is active·merged·hidden (§6) and `merged_into` names the survivor: §5's whole
-- repair model is an admin setting those two, never a delete. Rows are never hard-deleted
-- here, so the self-reference is safe and worth having.
--
-- `created_by` is this table's ownership column — it is what RLS keys on, and what makes
-- "the creator edits its facts, everyone else suggests a correction" (§5) enforceable. It
-- defaults to `auth.uid()` so a client need not send it, and it is nullable on purpose:
-- `on delete set null` is what lets a site outlive the account that created it, which
-- §5's "history never breaks" requires and a NOT NULL column could not express.
create table if not exists public.dive_sites (
  id uuid primary key default gen_random_uuid(),
  name text,
  country text,
  location extensions.geography(Point, 4326),
  salinity text,
  water_body text,
  entry text,
  max_depth_m double precision,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  status text not null default 'active',
  merged_into uuid references public.dive_sites (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Community dive centers. Same model as sites, same ownership and merge rules.
--
-- `merged_into` is here although §6's field list for this table omits it: §5's community
-- paragraph covers "a site or center" in one sentence, and a `status` that can read
-- `merged` with nowhere to point is a state that cannot be repaired. Reported for §6.
create table if not exists public.dive_centers (
  id uuid primary key default gen_random_uuid(),
  name text,
  country text,
  location extensions.geography(Point, 4326),
  website text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  status text not null default 'active',
  merged_into uuid references public.dive_centers (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Named cylinder sets, private. Cylinders and gas and nothing else (§10) — the suit,
-- hood, gloves, boots and weights this table once carried are filled by carry-over
-- instead, and a preset holding them too would be a second, staler source.
--
-- The table keeps the name `gear_presets` because §6 and §7 both name it that and
-- §7 pushes it by that name.
create table if not exists public.gear_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  tanks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- The certification wallet (§6), private. Manual entry — no agency exposes a public API.
-- Card photos join with v1.1 photos, so there is no path column here yet.
--
-- `issued_on`/`expires_on` are `text` for the reason the header block gives for
-- `dives.date`: every calendar date in this app is a `YYYY-MM-DD` string owned by
-- `domain/datetime.ts`, and one column type for all of them is one rule.
--
-- No local counterpart exists yet — this table lands with M3's wallet screen. It is
-- created now because §6 specifies it and a table is cheap; the parity test knows it as
-- a Postgres-only table with that reason attached.
create table if not exists public.certifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  agency text,
  course text,
  card_number text,
  issued_on text,
  expires_on text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- One row per account (§6). `id` IS the auth user's id rather than a separate key with a
-- `user_id` beside it: a profile is the user, and two ids would be two answers to the
-- same question. That is also why it carries no `default gen_random_uuid()` — an invented
-- id here would be a profile belonging to nobody.
--
-- `dives_before` is the offset §2.5's numbering starts from; the local `settings` table
-- holds the device's copy and syncs it here.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  dives_before integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Indexes. Two jobs only, both named by DESIGN.md.
--
-- The `(owner, updated_at)` indexes are what makes §7's delta pull a range scan instead
-- of a table scan: `pull_changes(last_pulled_at)` asks each table for one user's rows
-- changed since a watermark, and that is exactly this key.
--
-- The trigram and GiST indexes are §5's "the map and the dedupe are features of the
-- database, not app code" — `search_sites` and `similar_sites` are file 6's RPCs, and
-- without these they would be sequential scans over the whole catalogue.
-- ─────────────────────────────────────────────────────────────────────────────────────

create index if not exists dives_user_id_updated_at_idx on public.dives (user_id, updated_at);
create index if not exists gear_presets_user_id_updated_at_idx on public.gear_presets (user_id, updated_at);
create index if not exists certifications_user_id_updated_at_idx on public.certifications (user_id, updated_at);

create index if not exists dive_sites_updated_at_idx on public.dive_sites (updated_at);
create index if not exists dive_centers_updated_at_idx on public.dive_centers (updated_at);

create index if not exists dive_sites_name_trgm_idx on public.dive_sites using gin (name extensions.gin_trgm_ops);
create index if not exists dive_centers_name_trgm_idx on public.dive_centers using gin (name extensions.gin_trgm_ops);

create index if not exists dive_sites_location_idx on public.dive_sites using gist (location);
create index if not exists dive_centers_location_idx on public.dive_centers using gist (location);
