# Supabase — the Postgres half of Ponor

DESIGN.md §5, §6 and §7 in SQL. Six files, applied in order, on the project the owner owns.

Nothing in here has ever been run. **No one working in this repository has credentials for
the project and none will be added** — see [Keys](#keys-what-may-never-appear-here) below.
So these files are written to be pasted into the **Supabase Studio SQL editor** by hand;
the CLI is supported but not required, and nothing assumes a linked project.

## Applying them

Dashboard → **SQL Editor** → paste one file → Run. In this order:

| # | File | What it does |
|---|---|---|
| 1 | `migrations/20260902090000_extensions.sql` | `postgis` and `pg_trgm`, both into the `extensions` schema (§5) |
| 2 | `migrations/20260902090100_schema.sql` | The six tables of §6, plus the indexes §5 and §7 need |
| 3 | `migrations/20260902090200_rls.sql` | Row-Level Security on every table, and every policy |
| 4 | `migrations/20260902090300_sync_rpcs.sql` | `push_changes` and `pull_changes` — §7's whole protocol |
| 5 | `migrations/20260902090400_site_edits.sql` | The review queue §5 requires and §6 never listed, and its policies |
| 6 | `migrations/20260902090500_catalogue_rpcs.sql` | `search_sites`, `similar_sites`, `suggest_site_edit`, `delete_account` |

Order matters five times: file 2 uses the PostGIS type file 1 installs, file 3 alters the
tables file 2 creates, file 4's functions read those tables and the PostGIS functions from
file 1, file 5's table references `dive_sites` from file 2, and file 6 writes into file 5's
table and calls `public.sync_site` from file 4. Run each one whole — file 2 begins with a
`set search_path` that the statements after it rely on.

With the Supabase CLI instead: `supabase link --project-ref <ref>` then `supabase db push`.
The filenames are already in the CLI's `<timestamp>_name.sql` form and sort into that order.

### Re-running

Every statement is `create … if not exists`, `enable row level security` (idempotent), a
`drop policy if exists` immediately followed by its `create policy`, or a `create or replace
function`. **Pasting any file a second time is a no-op and cannot half-apply.**

The one thing `create or replace function` cannot do is change a **signature**: it refuses a
new argument name or type. If an argument is ever added to either RPC — the country scope
`pull_changes` is shaped for is the likely one — that migration has to `drop function` the old
signature and create the new one in the same file, which is atomic in a single transaction.

The one thing to know, because it is the opposite of what "idempotent" suggests: `create
table if not exists` does **not** alter a table that already exists. If you edit file 2
after applying it, re-running changes nothing. On a throwaway project, `drop table` the
six and start over. On a project with real dives in it, write a fourth file with the
`alter table` in it — and add the column to `src/db/schema.ts` in the same commit, or the
parity test below goes red, which is what it is for.

## What is deliberately not here

- **Anything that signs a user in.** Auth providers, redirect URLs, email templates: the
  owner's, by his own division of labour. All six of §5's RPCs now exist (files 4 and 6);
  none of them can be reached without a session, so nothing in this directory works until
  that half is configured.
- **A live search for dive *centres*.** §2.3 says "typing a site or center searches your own
  history first… live search adds anything newer when online", but §5's RPC list names only
  `search_sites`. Centres reach every device through `pull_changes` and autocomplete offline
  exactly as sites do; what they lack is the online supplement and the fuzzy duplicate check.
  A symmetric pair (`search_centers` / `similar_centers`) is about forty lines, and it is a
  §5 edit rather than an oversight — see the M2c report.
- **Diacritic folding on the server.** §10 puts it in M2, and `domain/search.ts` owns the
  client half. Trigram similarity is partly tolerant of it by accident and not by design, so
  `zelezna` may or may not find `Železná`. Doing it properly needs the `unaccent` extension
  plus an IMMUTABLE wrapper to index through — `unaccent(text)` is only STABLE — which is a
  third extension and a second GIN index, and belongs with the client work rather than here.
- **`dive_photos` and `dive_samples`.** §6 calls these *reserved* — named in the plan so
  nothing migrates painfully later, not built now. No table is created for either, and
  §0.4's rule that no profile curve is drawn without a real sample series is untouched by
  their absence. (`import_source` / `import_id` are the third item on that reserved list
  and are the exception: they are *columns on `dives`*, `src/db/schema.ts` has shipped
  them since M1, and leaving them out here would make the local schema unsyncable.)
- **A PostGIS point on `dives`.** §6 says Postgres composes the latitude/longitude pair
  into a point; nothing in v1 reads it — the personal map draws from the device's own rows
  — and a generated column with a PostGIS expression is precisely the statement most
  likely to fail on a server nobody here can test against. When something server-side
  needs it, one statement adds it:
  `alter table public.dives add column location extensions.geography(Point, 4326) generated always as (case when latitude is not null and longitude is not null then extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography end) stored;`
  — and the parity test will demand it be listed as a Postgres-only column with a reason.

## The two RLS decisions worth a second look

Both are the owner's to overturn; they are recorded here because a default nobody chose is
how a security model rots.

**An anonymous reader sees nothing.** `anon` — the role the publishable key in the shipped
app authenticates as — has every privilege revoked on all six tables and is named by no
policy. §5 says sites and centers are "readable by everyone", and this reads that as every
*user*: §1 makes an account the condition for syncing at all, the catalogue reaches a
device through `pull_changes`, and an account-less device never talks to the server. The
asymmetry decides it — opening this later is two statements, closing it after the
catalogue and its `created_by` column have been scraped is not possible at all. To open it:

```sql
grant select on table public.dive_sites to anon;
create policy dive_sites_select_anon on public.dive_sites for select to anon using (true);
```

**The creator may edit their own site; nobody else may.** §5 verbatim — everyone else taps
*suggest a correction*, which `suggest_site_edit` (file 6) routes into `site_edits` (file 5).
The admin half of that sentence needs no policy and no `is_admin` column: §5 makes Supabase
Studio the v1 admin, and Studio connects as the table owner, which bypasses RLS. That is
also why RLS is enabled but **not** `force`d — forcing it would lock the admin out of the
merge queue that §5 hands them.

**A suggestion is readable by its author and by nobody else** (M2c, and the one §6 never
specified because it never listed the table). Not by the site's creator, although §5 gives
them the site's facts: a suggestion carries free text from an identified diver, and routing
that to another diver is a moderation surface, which §9 defers as a class. The admin reads
the queue in Studio, as the owner, which needs no policy. The author's own read is granted
because §8 promises an export of what a diver has written and because it exposes nobody
else — which is why M2a's ratchet argument for `anon` does not reach it. There is no client
UPDATE at all, so a suggestion cannot be withdrawn in v1; the two statements that would
change that are written out at the bottom of file 5.

## Keys: what may never appear here

`.env` (gitignored) holds the project URL and the **anon / publishable** key, and nothing
else. `.env.example` says why, at length.

**This repository is public.** The `service_role` key and the direct database connection
string bypass RLS entirely — every dive of every user — and must never be written into a
file, a comment, a commit message or a report in this tree, not temporarily and not as an
example. If one is ever committed, deleting the line does not fix it: git keeps it.
Rotate the key in the dashboard.

## What file 4 assumes about the client

`push_changes` and `pull_changes` are §7 in Postgres, and two of their rules are contracts on
whatever calls them rather than on the SQL:

- **`last_pulled_at` is whatever the last response said**, never a value the phone computed.
  The response deliberately hands back a watermark a minute EARLIER than the server clock, so
  a push that was still committing when the pull ran is re-read next time instead of being
  skipped forever. Re-reading costs nothing: the client upserts by comparing `updated_at`.
- **A community row is only ever pushed by the person who created it.** RLS refuses an update
  to somebody else's site by raising, and §7's push is one transaction, so a dirty row nobody
  is allowed to write would freeze that device's sync. §5 already routes everyone else through
  *suggest a correction*.

`push_changes` also **raises** on a table or a column it does not recognise rather than
dropping it. That is deliberate: a field silently discarded would have the client clear its
dirty flag and lose the value permanently, while a refused push costs a diver nothing (§7:
sync failures never block logging) and tells the owner a migration is missing.

## What file 6 assumes about the client

- **A search result is a catalogue row, not a search artefact.** `search_sites` and
  `similar_sites` render rows with the same `public.sync_site` that `pull_changes` uses, so
  they merge into the device's copy by `id` with the client's existing writer and no second
  code path (§2.3: live search *supplements* the offline catalogue). But a search returns a
  filtered subset, so **a client must never advance `last_pulled_at` on the strength of one**
  — that watermark comes from a pull and from nothing else (§7.3).
- **`similar_sites` is called twice in a site's life**, and the second call must pass
  `p_exclude_id`. Before saving, there is nothing to exclude; after a site created offline has
  been pushed, the site itself is now in the catalogue and would come back as its own best
  duplicate. §5's "the server reruns the fuzzy check" is this function being called again, not
  `push_changes` doing it — push writes no flag, because there is no column to write one into.
- **A short query gets nothing back, by design.** Trigram similarity is near zero for two or
  three characters against a longer name. The device's own history and catalogue copy are §2.3's
  first answer; this one stays quiet until the query means something.
- **`delete_account` does not sign anybody out.** A JWT is stateless and stays valid until it
  expires, so the client signs out immediately after the call returns — and wipes the local
  database, for the reason §7.4 already gives for sign-out. It returns how many sites and
  centres the diver is leaving behind, so the confirmation screen can say so.

### The one statement worth testing on a throwaway account first

`delete_account` deletes a row from `auth.users`, which is owned by `supabase_auth_admin`.
That is why it is the **only** `security definer` function in this directory — and whether the
role that ran file 6 may delete from that table is a fact about the project, not about this
SQL. If it raises `permission denied for table users`, the function exists but §8's App Store
requirement is unmet, and finding that out from a reviewer would be an expensive way to learn
it. Sign up a throwaway account, call `select public.delete_account();` as that user, and
check that the diver's rows are gone and that any site they created is still there with
`created_by` null.

## The parity checks

`src/db/schemaParity.test.ts` reads the migration files above and `src/db/schema.ts` and
fails when they disagree about the columns of `dives` or `gear_presets`, in either
direction. It exists because §6 opens by claiming the two schemas are the same, and that
claim was previously checked by nobody.

`src/db/syncRpcParity.test.ts` does the same for file 4 against file 2: every column
`push_changes` writes must exist in the schema, every schema column must be written (bar a
short exception list with a reason each), and the guarantees §7 depends on that nothing else
could see — the ISO-Z timestamp spelling, `created_at` never restamped, `updated_at` never the
client's, tombstones never filtered out, `ST_MakePoint` given longitude before latitude — are
asserted by name. Both readers share `src/testing/migrationSql.ts`.

`src/db/catalogueRpcParity.test.ts` does it for file 6 against files 2 and 5, and is weighted
towards the three failures there that are silent: that `delete_account` writes exactly once
and what it writes is the auth user (so no community row can be destroyed, which cannot be
undone); that every table's `auth.users` reference is classified cascade-or-severed
deliberately, since that classification — not a list in the RPC — is what decides what an
account deletion takes; and that no catalogue function is `security definer`, which is how a
table with RLS quietly becomes public. It also pins what a suggestion may propose, against
`dive_sites`' own columns in both directions.

It also asserts the guarantees the SQL text carries that a column comparison cannot see:
no serial or identity anywhere (ids are the client's UUIDv7), no trigger stamping
`created_at` or `updated_at`, no enum or CHECK on a vocabulary column (§10: an unknown
value is stored and flagged, never rejected), `tanks`/`equipment` NOT NULL with a `'[]'`
default, RLS enabled on all six tables, and no client role granted DELETE.

**What neither proves:** that this SQL runs. It has never been executed against
Postgres — not here, not anywhere. The readers are strict on purpose (they throw on anything
they have not been taught rather than skipping it), but a reader is not a server, and the
first person to paste these files into Studio is the first person to find out whether they
are valid.

All six files have been through **libpg_query** — the real PostgreSQL grammar — including
the plpgsql bodies and every SQL fragment inside them, and all six parse. That was run from a
scratchpad and adds no dependency to this repository, so it is not part of `npm test`; it also
proves nothing beyond grammar. It cannot see a column that does not exist, a table that does
not exist, a latitude handed to `ST_MakePoint` where a longitude belongs, or a
`delete from public.dive_sites` in the one function that must never contain one — which is the
list the two RPC parity checks exist to cover.

Three things in file 6 are unprovable from here in particular and are marked where they occur:
the privilege on `auth.users` above; whether `extensions.st_dwithin` resolves its own `&&`
operator under an empty `search_path` (PostGIS 3 qualifies it internally, so it should — if it
raises `operator does not exist`, the fix is `set search_path = extensions` on the two
functions that call it); and that the `%` operator's cut-off is the session GUC
`pg_trgm.similarity_threshold`, which `public.name_match_floor()` is written to equal. If that
GUC is ever raised on this project, both search functions quietly return less, and the remedy
is `alter role authenticated set pg_trgm.similarity_threshold = 0.3;`.
