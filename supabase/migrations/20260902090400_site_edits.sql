-- Ponor · M2c · 5 of 6 — the review queue DESIGN.md §5 requires and §6 never listed
--
-- §5: "the creator and the admin edit its facts (pin, entry, salinity, site depth);
-- everyone else taps *suggest a correction*, which lands in a **review queue**." That
-- queue is a table, `suggest_site_edit` is the only thing that writes to it, and **§6's
-- table list does not mention it** — M2a created six tables and none of them is this one.
-- So it is a gap in the plan rather than an omission from the schema, and the M2c report
-- says what §6 should be given to say about it. The four questions that gap left open are
-- answered here, in the order a reader will ask them:
--
-- 1. WHO MAY READ A SUGGESTION. Its author, and nobody else. Not the site's creator —
--    although §5 gives them the site's facts — because a suggestion carries free text from
--    an identified diver, and routing that to another diver is a moderation surface (a
--    report button, a block list, an abuse path). §9 defers exactly that class of feature
--    ("linked buddies and site comments bring App Store moderation duties, so they wait").
--    §5 already names the v1 reviewer and it is not the creator: "Admin in v1 is Supabase
--    Studio. The merge and suggestion queues are just tables to review there." Studio
--    connects as the table owner and bypasses RLS, so the admin half needs no policy.
--
--    The author's own read is granted because §8 promises a full data export of what a
--    diver has written, and because it leaks nothing about anybody else — which is why
--    M2a's ratchet argument for `anon` (open later, never close again) does not reach it.
--
-- 2. HOW IT IS RESOLVED. An admin sets `status`, in Studio, exactly as §5's merge queue
--    works one table over. There is no client path to `update` — no policy grants it, and
--    UPDATE is not granted to either client role — so a suggestion is immutable once sent,
--    including to its author. Letting an author withdraw one is two statements and is
--    written out at the bottom of this file rather than guessed at now.
--
-- 3. WHETHER RESOLUTION IS A STATUS OR A DELETE. A status. §5's "rows are never hard-
--    deleted" is stated about the community tables, and the reason there is referential
--    (a dive carries `site_id`); nothing at all references a suggestion, so that reason
--    does not transfer. The reason that does: a resolved queue with no history cannot
--    answer "was this already asked and refused?", so the same wrong pin is reported by
--    five divers and refused five times. `status` is open · applied · rejected, mirroring
--    the vocabulary shape of the community `status`, and it is plain `text` with no CHECK
--    for §10's reason (a value a build does not know is stored, never rejected).
--
-- 4. WHAT HAPPENS TO A SUGGESTION WHEN ITS AUTHOR DELETES THEIR ACCOUNT. The row stays and
--    `suggested_by` becomes null, by the same `on delete set null` the community tables
--    use, for the same reason: the row is about a *site*, not about its author. See file 6
--    for what `delete_account` does and does not remove.
--
-- THIS TABLE TAKES NO PART IN §7's SYNC. It is not pushed, not pulled, and has no SQLite
-- counterpart: a suggestion is made online, by an RPC call, about a row the device already
-- has. That is why it carries `created_at` and `updated_at` but **no `deleted_at`** — §6
-- gives the three-timestamp rule to *synced* tables, and a tombstone column here would
-- claim a protocol this table has no part in and add a second way to say what `status`
-- already says. Both parity checks are told this table is unsynced, by name and with the
-- reason attached, so it cannot drift into the protocol unnoticed.
--
-- Re-running this file is a no-op: `create table if not exists`, `create index if not
-- exists`, an idempotent `enable row level security`, and each policy dropped by name
-- before it is created. The flip side is M2a's: `if not exists` does not ALTER a table
-- that already exists, so editing this file after applying it changes nothing on re-run.

-- `site_id` carries a real foreign key, unlike `dives.site_id`, and the asymmetry is
-- deliberate. §6 gives a dive a `site_name` snapshot precisely so a dangling reference
-- costs nothing, and §7 pushes a dive and an offline-created site in one transaction where
-- an FK could reject the diver's own dive. Neither applies here: a suggestion is created
-- online, one call, after the site exists, and a suggestion pointing at nothing is junk in
-- the admin's queue. With no `on delete` action it also refuses to let anyone hard-delete a
-- site that has suggestions on it — a fourth guard on §5's "rows are never hard-deleted",
-- after the missing DELETE policy, the missing DELETE privilege, and `delete_account`
-- touching neither community table.
--
-- `fields` is the structured half of a suggestion: `{"max_depth_m": 32, "entry": "boat"}`,
-- the proposed values keyed by the `dive_sites` column they belong to. `suggest_site_edit`
-- refuses any key outside the facts §5 names, so a client cannot propose `status`,
-- `merged_into` or `created_by` and have an admin apply it by reflex. `note` is the free
-- text half — "the pin is on the wrong side of the jetty" — and one of the two must be
-- present, because a diver who can only describe the problem must still be able to report
-- it (§1: never block the person trying to record something).
create table if not exists public.site_edits (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.dive_sites (id),
  suggested_by uuid default auth.uid() references auth.users (id) on delete set null,
  fields jsonb not null default '{}'::jsonb,
  note text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The admin's queue is "everything still open, oldest first"; the site index answers "what
-- has been said about this site" while reviewing one; the author index is the access path
-- of the SELECT policy below, which is the only read a client can perform at all.
create index if not exists site_edits_status_created_at_idx on public.site_edits (status, created_at);
create index if not exists site_edits_site_id_idx on public.site_edits (site_id);
create index if not exists site_edits_suggested_by_idx on public.site_edits (suggested_by);

-- ─── Row-Level Security ──────────────────────────────────────────────────────────────
-- The same three moves file 3 makes on every other table: enable RLS, revoke everything
-- from both client roles, then grant back only what a policy will also allow. `anon` is
-- named by no policy and granted nothing, as everywhere else — the publishable key ships
-- inside a downloadable app and an anonymous caller has no business in a review queue.
--
-- SELECT and INSERT only. There is no UPDATE policy (resolution is the admin's, in Studio)
-- and no DELETE policy or privilege (§5, §7: nothing in this schema is hard-deleted by a
-- client), so the two statements that are missing are as deliberate as the two that are here.

alter table public.site_edits enable row level security;
revoke all on table public.site_edits from anon, authenticated;
grant select, insert on table public.site_edits to authenticated;

-- Your own suggestions, and only ever your own. A site's creator sees nothing here; see
-- decision 1 in the header for why that is a decision rather than an oversight.
drop policy if exists site_edits_select_own on public.site_edits;
create policy site_edits_select_own on public.site_edits
  for select to authenticated
  using (suggested_by = (select auth.uid()));

-- Pins the author to the inserter, so nobody can file a suggestion under someone else's
-- name — which matters because that column is what the SELECT policy trusts, and because
-- an admin reads these to decide whether to change a public record.
drop policy if exists site_edits_insert_own on public.site_edits;
create policy site_edits_insert_own on public.site_edits
  for insert to authenticated
  with check (suggested_by = (select auth.uid()));

-- To let an author withdraw a suggestion later — the one opening this file's decisions
-- leave obvious — is exactly two statements, and they belong in a migration of their own
-- rather than commented-in here:
--
--   grant update on table public.site_edits to authenticated;
--   create policy site_edits_withdraw_own on public.site_edits
--     for update to authenticated
--     using (suggested_by = (select auth.uid()) and status = 'open')
--     with check (suggested_by = (select auth.uid()));
--
-- Note what that `using` clause has to say and why: without `status = 'open'` an author
-- could rewrite a suggestion an admin had already acted on, and without the `with check`
-- they could hand it to somebody else. Both halves are the same shape as file 3's.
