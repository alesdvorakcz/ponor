-- Ponor · M2a · 3 of 3 — Row-Level Security
--
-- DESIGN.md §5 does not call RLS a feature; it calls it *the security model*: "dives are
-- readable and writable only by their owner; sites and centers are readable by everyone",
-- and §8 repeats "RLS on every table". So this file is written out explicitly rather than
-- left to a project-creation toggle nobody can read back from here — whatever was picked
-- in the dashboard, running this makes the SQL the authority.
--
-- Every statement is safe to re-run: `enable row level security` is idempotent, and each
-- policy is dropped by name before it is created.
--
-- Three decisions are taken here rather than assumed, each with its reasoning:
--
-- 1. AN ANONYMOUS READER SEES NOTHING. AT ALL. `anon` — the role the publishable key
--    authenticates as, and that key ships inside a downloadable app — has every privilege
--    revoked on every table and is named by no policy. §5's "readable by everyone" is
--    read as every *user* rather than every *stranger*, and the contrast it draws is with
--    "only by their owner" one clause earlier. Nothing in v1 needs otherwise: §1 makes an
--    account the condition for syncing at all, the catalogue reaches a device through §7's
--    `pull_changes`, and a device with no account never talks to the server. The asymmetry
--    that decides it is that loosening this later is one `grant` plus one `create policy`,
--    while tightening it after the catalogue and its `created_by` column have been
--    scraped is not a thing that can be done. If the owner wants an open catalogue, the
--    exact two statements are in supabase/README.md.
--
-- 2. A CREATOR MAY EDIT THE SITE THEY CREATED; NOBODY ELSE MAY. That is §5 verbatim —
--    "the creator and the admin edit its facts, everyone else taps *suggest a
--    correction*" — and `suggest_site_edit` (file 6) is what the everyone-else half routes
--    through, landing a suggestion in `public.site_edits` (file 5) rather than an UPDATE.
--
-- 3. NOTHING IS EVER HARD-DELETED, AND THAT IS ENFORCED TWICE. §5 says community rows are
--    never hard-deleted and §7 says deletion propagates as a tombstone, so `deleted_at`
--    is an UPDATE and DELETE has no legitimate client caller anywhere in this schema.
--    There is therefore no `for delete` policy on any table (RLS denies what no policy
--    permits) *and* the DELETE privilege is revoked from both client roles. Two
--    independent guards, because this one is unrecoverable when it fails.
--
-- RLS is deliberately NOT forced (`force row level security`). §5 makes Supabase Studio
-- the v1 admin, and Studio connects as the table owner, which bypasses RLS — that is the
-- admin model. It is why the merge queue needs no `is_admin` column and no admin policy:
-- setting `status = 'merged'` is something a human does in Studio, not something the app
-- can be tricked into.

-- ─── profiles — one row, the diver's own ─────────────────────────────────────────────
-- Read, create and edit your own profile. `id` IS the auth user id, so the check is the
-- identity itself. No delete: an account is removed by §5's `delete_account` RPC (file 6),
-- which is `security definer` and deletes one row from `auth.users` — this table then goes
-- by the cascade below, not by a client DELETE.

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ─── dives — private, §5's "only by their owner" ─────────────────────────────────────
-- The `with check` on UPDATE is not redundant with the `using`: `using` decides which
-- rows you may touch, `with check` decides what they may become, and without it a diver
-- could hand one of their dives to another `user_id` — writing into an account whose
-- owner never consented and cannot see it arrive.

alter table public.dives enable row level security;
revoke all on table public.dives from anon, authenticated;
grant select, insert, update on table public.dives to authenticated;

drop policy if exists dives_select_own on public.dives;
create policy dives_select_own on public.dives
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists dives_insert_own on public.dives;
create policy dives_insert_own on public.dives
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists dives_update_own on public.dives;
create policy dives_update_own on public.dives
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ─── gear_presets — private, identical model to dives ────────────────────────────────

alter table public.gear_presets enable row level security;
revoke all on table public.gear_presets from anon, authenticated;
grant select, insert, update on table public.gear_presets to authenticated;

drop policy if exists gear_presets_select_own on public.gear_presets;
create policy gear_presets_select_own on public.gear_presets
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists gear_presets_insert_own on public.gear_presets;
create policy gear_presets_insert_own on public.gear_presets
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists gear_presets_update_own on public.gear_presets;
create policy gear_presets_update_own on public.gear_presets
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ─── certifications — private, identical model to dives ──────────────────────────────

alter table public.certifications enable row level security;
revoke all on table public.certifications from anon, authenticated;
grant select, insert, update on table public.certifications to authenticated;

drop policy if exists certifications_select_own on public.certifications;
create policy certifications_select_own on public.certifications
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists certifications_insert_own on public.certifications;
create policy certifications_insert_own on public.certifications
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists certifications_update_own on public.certifications;
create policy certifications_update_own on public.certifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ─── dive_sites — community ──────────────────────────────────────────────────────────
-- SELECT is unfiltered for a signed-in reader, including `merged` and `hidden` rows and
-- tombstoned ones: §7's pull has to deliver a merge and a deletion for the client to act
-- on, and a policy that hid them would leave every device holding the row forever. Which
-- rows a diver is *shown* is the client's question, not the database's.
--
-- INSERT is open to any signed-in user (§5) but pins `created_by` to the inserter, so
-- nobody can file a site under someone else's name — which matters because that column
-- is what the UPDATE policy trusts.

alter table public.dive_sites enable row level security;
revoke all on table public.dive_sites from anon, authenticated;
grant select, insert, update on table public.dive_sites to authenticated;

drop policy if exists dive_sites_select_signed_in on public.dive_sites;
create policy dive_sites_select_signed_in on public.dive_sites
  for select to authenticated
  using (true);

drop policy if exists dive_sites_insert_own on public.dive_sites;
create policy dive_sites_insert_own on public.dive_sites
  for insert to authenticated
  with check (created_by = (select auth.uid()));

-- The `with check` half stops a creator handing their site to somebody else — or, more
-- usefully, stops them clearing `created_by` to null and locking themselves out.
drop policy if exists dive_sites_update_creator on public.dive_sites;
create policy dive_sites_update_creator on public.dive_sites
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

-- ─── dive_centers — community, identical model to dive_sites ─────────────────────────

alter table public.dive_centers enable row level security;
revoke all on table public.dive_centers from anon, authenticated;
grant select, insert, update on table public.dive_centers to authenticated;

drop policy if exists dive_centers_select_signed_in on public.dive_centers;
create policy dive_centers_select_signed_in on public.dive_centers
  for select to authenticated
  using (true);

drop policy if exists dive_centers_insert_own on public.dive_centers;
create policy dive_centers_insert_own on public.dive_centers
  for insert to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists dive_centers_update_creator on public.dive_centers;
create policy dive_centers_update_creator on public.dive_centers
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));
