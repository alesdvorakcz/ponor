-- Ponor · M2q · 7 of 7 — where a duplicate SUSPICION lives, which §6 had nowhere to put
--
-- §5: "When a site created offline is pushed, the server reruns the fuzzy check and **flags
-- likely duplicates** for a one-tap merge by the creator — admin merge is the backstop."
-- Every word of that existed except the flag. `similar_sites` (file 6) is the check; file 4
-- now reruns it on arrival; and this file is the only thing either of them can write the
-- answer into.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS A TABLE AND NOT A COLUMN ON `dive_sites`, WHICH IS THE DECISION OF THIS FILE
--
-- The obvious shape is `possible_duplicate_of uuid` beside `merged_into`. Four things are
-- wrong with it, and the first two are the ones this project has already paid for once each.
--
-- 1. A SUSPICION IS ABOUT A PAIR, AND ONE SITE MAY BE SUSPECTED OF SEVERAL. `similar_sites`
--    returns up to five candidates. A single column keeps the last one written and loses the
--    rest silently — the same shape as §10's `manual_order` written onto the dragged row
--    alone: a real value, in a real column, answering a question nobody asked.
--
-- 2. THE FEATURE NEEDS THREE STATES AND A NULLABLE COLUMN HAS TWO. *Never suspected*,
--    *suspected*, and *looked at and dismissed* are three different things, and the diver has
--    to be able to reach the third: clear the column on dismissal and the next recheck flags
--    it again for ever; leave it set and the flag can never be made to go away. §10 records
--    the same defect shipped in M1h's form-group memory, where a *set of open ids* made
--    "I closed this" and "I have never touched this" the same absent row, and it was broken
--    in the one direction nothing tested. **Here the three states are the row itself**:
--
--        no row for the pair    →  never suspected
--        status = 'open'        →  suspected, nobody has looked
--        status = 'dismissed'   →  looked at, and these are not the same place
--        status = 'merged'      →  looked at, and they were (the merge did the rest)
--
--    Absence is a state rather than a missing value, which is what a column cannot do: a
--    dismissal is a ROW, so `on conflict … do nothing` in file 4 is the whole of "a rerun
--    never resurrects a dismissal". A column would have needed a second column beside it to
--    say the same thing, and the two could disagree.
--
-- 3. A COLUMN ON `dive_sites` IS BROADCAST TO EVERY DEVICE. `pull_changes` renders that table
--    with `to_jsonb(row)` — deliberately, so a new column can never go missing from the
--    payload — so a suspicion column would arrive in every diver's catalogue copy, and
--    `src/db/schema.ts` would have to carry it to receive it. A moderation artefact about one
--    diver's site is not part of the compact catalogue §5 syncs to everyone.
--
-- 4. IT WOULD PUT §7's PUSH IN THE BUSINESS OF WRITING A `dive_sites` COLUMN IT DOES NOT OWN.
--    File 4 refuses `status` and `merged_into` on push for exactly that reason. Writing a row
--    HERE touches no `dive_sites` row at all, so `dive_sites.updated_at` does not move — and
--    that is not tidiness: §7's last-write-wins is keyed on that column, and a server-side
--    write advancing it on a row the client has just pushed is a change the client pulls back
--    on the next cycle, for no reason, on every site anybody ever creates.
--
-- The cost of a table is a table: one more thing in the catalogue, and a merge screen that
-- reads two objects instead of one. That is the cheaper side, and it is cheapest today —
-- the owner's project holds test data and can still be dropped.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- WHAT THIS TABLE IS NOT
--
-- It is not `status`/`merged_into`. Those describe a merge that HAS HAPPENED — an admin (§5)
-- or, later, the creator, setting a survivor. A suspicion says *somebody should look*, and
-- the row it is about is perfectly usable meanwhile: a site that looks like a duplicate is
-- still that diver's site, still syncs, and still fills in a dive.
--
-- It is not a queue of things the app must show. §5 gives the creator a one-tap merge and
-- names the admin as the backstop, and the admin's half needs nothing here: Studio connects
-- as the table owner and bypasses RLS, exactly as it does for `site_edits`.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- THE PAIR HAS A DIRECTION, AND IT IS "site_id ARRIVED, candidate_id WAS ALREADY HERE"
--
-- `site_id` is the row the server has just been handed and whose creator is the one asked;
-- `candidate_id` is the existing catalogue row it may be a second copy of. That direction is
-- what a merge needs — the newcomer is the row that would be marked `merged` with
-- `merged_into` pointing at the survivor — and it is why the primary key is the ordered pair
-- rather than an unordered one.
--
-- **The mirror pair can exist, in exactly one case, and it is not a defect.** If two sites
-- arrive in the SAME push and resemble each other, each is a newcomer to the other and both
-- rows are written. That can only happen to one diver's own two sites — a site that was
-- already in the catalogue never "arrives" again — so both questions are asked of the person
-- who can answer them, and each is a real question about which of their two rows survives.
-- Collapsing them would need a key over the unordered pair (`least`/`greatest`), which throws
-- away which row is the newcomer, and the newcomer is the half a merge acts on.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- THIS TABLE TAKES NO PART IN §7's SYNC, exactly as `site_edits` does not. It is written by
-- `push_changes` as a side effect, read by the creator and by an admin in Studio, and it has
-- no SQLite counterpart: a merge cannot be performed offline anyway — it writes `status` and
-- `merged_into` on a community row, which no client may push (file 4) — so a device holding a
-- copy of this table could do nothing with it but display it. That is why it carries
-- `created_at` and `updated_at` and **no `deleted_at`**: §6 gives the three-timestamp rule to
-- *synced* tables, and a tombstone here would claim a protocol this table has no part in.
-- Both parity checks are told so by name, with the reason attached.
--
-- Re-running this file is a no-op: `create table if not exists`, `create index if not
-- exists`, an idempotent `enable row level security`, and each policy dropped by name before
-- it is created. The flip side is the one every file here carries: `if not exists` does not
-- ALTER a table that already exists, so editing this file after applying it changes nothing
-- on re-run.

-- Both foreign keys are real ones and neither carries an `on delete` action, which is the
-- same choice `site_edits.site_id` makes and for the same two reasons: a suspicion pointing
-- at nothing is junk in a queue a human reads, and refusing to let anyone hard-delete a site
-- that has suspicions on it is one more guard on §5's "rows are never hard-deleted" — after
-- the missing DELETE policy, the missing DELETE privilege, and `delete_account` touching
-- neither community table. Neither reference is to `auth.users`: who may see a suspicion
-- follows from `dive_sites.created_by` and is not copied here, because a second copy of "who
-- owns this site" is a second answer the day one of them is severed (§5's departed diver).
--
-- `status` is plain `text` with no CHECK and no enum, per §6 and §10: a value a build does not
-- know is stored, never rejected. Its vocabulary is open · dismissed · merged, mirroring
-- `site_edits`' open · applied · rejected one table over. The default is what `push_changes`
-- relies on — it writes no status at all, so the word `'open'` lives here and nowhere else.
--
-- **No score and no rank, deliberately.** `similar_sites` does not return its similarity score
-- (file 6 keeps the ranking CTE out of the rendered row on purpose, so a search artefact
-- cannot be stored as a catalogue row), so a score column here could only be filled by
-- computing similarity a second time — §4.1's defining defect, in the one rule this milestone
-- has spent its length keeping single. Five rows about one site is a list a screen shows
-- whole; if the merge screen ever wants the server's own ordering, that is an `alter table`
-- and a `with ordinality`, and it is written down here rather than guessed at now.
create table if not exists public.site_duplicate_suspicions (
  site_id uuid not null references public.dive_sites (id),
  candidate_id uuid not null references public.dive_sites (id),
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, candidate_id)
);

-- The primary key above is the access path for "what was flagged about this site", which is
-- the creator's screen and the RLS policy's own lookup, and it is the arbiter `on conflict
-- (site_id, candidate_id) do nothing` infers in file 4 — the one line that makes a dismissal
-- permanent. These two are the other directions anyone asks from:
--
--   · the admin's backstop queue: everything still open, oldest first (§5, Studio);
--   · "what has been flagged as a duplicate of THIS site", which is the question a merge asks
--     about a survivor, and which the primary key cannot answer from its second column.
create index if not exists site_duplicate_suspicions_status_created_at_idx
  on public.site_duplicate_suspicions (status, created_at);
create index if not exists site_duplicate_suspicions_candidate_id_idx
  on public.site_duplicate_suspicions (candidate_id);

-- ─── Row-Level Security ──────────────────────────────────────────────────────────────
-- The same three moves file 3 makes on every table: enable RLS, revoke everything from both
-- client roles, then grant back only what a policy will also allow. `anon` is named by no
-- policy and granted nothing, as everywhere else.
--
-- WHO MAY READ ONE: the creator of the site that arrived, and nobody else. §5 gives the
-- one-tap merge to "the creator", and that is the whole of the audience — the creator of the
-- CANDIDATE is not told that somebody else's row may be a copy of theirs, on the same
-- reasoning `site_edits` uses to keep a suggestion away from the site's creator: routing one
-- diver's claim about another diver's row is a moderation surface, and §9 defers that class.
-- The admin reads the table in Studio, as the owner, which needs no policy.
--
-- The predicate is `dive_sites.created_by` rather than a column here, so that a suspicion's
-- audience follows the site's ownership automatically — including §5's departed diver, whose
-- `created_by` becomes null, which matches no `auth.uid()`: their sites become community
-- records that only the admin acts on, and so do the suspicions about them.
--
-- INSERT is granted because `push_changes` is `security invoker` (§7: "RLS validates
-- ownership") and therefore writes these rows as the diver whose push produced them. The
-- policy is the same predicate, so a caller can only ever file a suspicion against a site
-- they created — junk in their own queue at worst, never in anybody else's.
--
-- There is no UPDATE policy and no UPDATE privilege, which is the `site_edits` position and
-- the same deliberate one: resolving a suspicion means merging two community rows, and a
-- merge writes `status` and `merged_into` on `dive_sites`, which no client may write from
-- here. Both halves belong to the merge task, in one RPC, and the two statements that would
-- open the dismissal half alone are written out at the bottom of this file rather than
-- guessed at now. Until then the third state is reached where §5 puts the backstop: Studio.

alter table public.site_duplicate_suspicions enable row level security;
revoke all on table public.site_duplicate_suspicions from anon, authenticated;
grant select, insert on table public.site_duplicate_suspicions to authenticated;

drop policy if exists site_duplicate_suspicions_select_creator on public.site_duplicate_suspicions;
create policy site_duplicate_suspicions_select_creator on public.site_duplicate_suspicions
  for select to authenticated
  using (
    exists (
      select 1
        from public.dive_sites as s
       where s.id = site_duplicate_suspicions.site_id
         and s.created_by = (select auth.uid())
    )
  );

drop policy if exists site_duplicate_suspicions_insert_creator on public.site_duplicate_suspicions;
create policy site_duplicate_suspicions_insert_creator on public.site_duplicate_suspicions
  for insert to authenticated
  with check (
    exists (
      select 1
        from public.dive_sites as s
       where s.id = site_duplicate_suspicions.site_id
         and s.created_by = (select auth.uid())
    )
  );

-- ─── What the merge task inherits, and what it has to add ────────────────────────────
--
-- The state is here; the act is not. A one-tap merge (§5) is one RPC, and it needs three
-- things this file deliberately does not do:
--
--   1. `dive_sites.status = 'merged'` and `merged_into` on the newcomer — which file 3's
--      UPDATE policy allows only its creator, and which file 4 refuses on push precisely so
--      that a stale device cannot undo it. An RPC is where that write belongs.
--   2. This row's own `status`, set in the same statement, so a resolved suspicion cannot
--      outlive the merge that resolved it.
--   3. The dives that point at the merged site. §6 stores a `site_name` snapshot so history
--      never breaks, so nothing is *required* — but a merge that leaves `site_id` pointing at
--      a merged row is a decision, not a default, and it is the merge task's to take.
--
-- To let a diver DISMISS one without merging anything, which is the half that needs no
-- community write at all, is exactly two statements:
--
--   grant update on table public.site_duplicate_suspicions to authenticated;
--   create policy site_duplicate_suspicions_dismiss_own on public.site_duplicate_suspicions
--     for update to authenticated
--     using (exists (select 1 from public.dive_sites as s
--                     where s.id = site_duplicate_suspicions.site_id
--                       and s.created_by = (select auth.uid()))
--            and status = 'open')
--     with check (exists (select 1 from public.dive_sites as s
--                          where s.id = site_duplicate_suspicions.site_id
--                            and s.created_by = (select auth.uid())));
--
-- Note what the `using` clause has to say and why, which is `site_edits`' note one table over:
-- without `status = 'open'` a diver could rewrite a suspicion an admin had already acted on.
-- What it cannot say is *which* status the row may become — a `with check` sees the whole new
-- row, so pinning the vocabulary there would put the word `'dismissed'` in a policy as well as
-- in this table's default. That is the argument for doing the dismissal in the merge RPC
-- instead, where one function owns both outcomes and this table keeps one writer.
