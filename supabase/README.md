# Supabase — the Postgres half of Ponor

DESIGN.md §5 and §6 in SQL. Three files, applied in order, on the project the owner owns.

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

Order matters twice: file 2 uses the PostGIS type file 1 installs, and file 3 alters the
tables file 2 creates. Run each one whole — file 2 begins with a `set search_path` that the
statements after it rely on.

With the Supabase CLI instead: `supabase link --project-ref <ref>` then `supabase db push`.
The filenames are already in the CLI's `<timestamp>_name.sql` form and sort into that order.

### Re-running

Every statement is `create … if not exists`, `enable row level security` (idempotent), or a
`drop policy if exists` immediately followed by its `create policy`. **Pasting any file a
second time is a no-op and cannot half-apply.**

The one thing to know, because it is the opposite of what "idempotent" suggests: `create
table if not exists` does **not** alter a table that already exists. If you edit file 2
after applying it, re-running changes nothing. On a throwaway project, `drop table` the
six and start over. On a project with real dives in it, write a fourth file with the
`alter table` in it — and add the column to `src/db/schema.ts` in the same commit, or the
parity test below goes red, which is what it is for.

## What is deliberately not here

- **The six RPCs** — `pull_changes`, `push_changes`, `search_sites`, `similar_sites`,
  `suggest_site_edit`, `delete_account` (§5). Next task. The schema is shaped for them:
  the `(user_id, updated_at)` indexes are the delta pull's access path, the trigram and
  GiST indexes are what `search_sites` and `similar_sites` run on, and no `updated_at`
  trigger exists because §6 gives that stamp to `push_changes` alone.
- **Anything that signs a user in.** Auth providers, redirect URLs, email templates: the
  owner's, by his own division of labour.
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
*suggest a correction*, which `suggest_site_edit` will route into a review queue. The
admin half of that sentence needs no policy and no `is_admin` column: §5 makes Supabase
Studio the v1 admin, and Studio connects as the table owner, which bypasses RLS. That is
also why RLS is enabled but **not** `force`d — forcing it would lock the admin out of the
merge queue that §5 hands them.

## Keys: what may never appear here

`.env` (gitignored) holds the project URL and the **anon / publishable** key, and nothing
else. `.env.example` says why, at length.

**This repository is public.** The `service_role` key and the direct database connection
string bypass RLS entirely — every dive of every user — and must never be written into a
file, a comment, a commit message or a report in this tree, not temporarily and not as an
example. If one is ever committed, deleting the line does not fix it: git keeps it.
Rotate the key in the dashboard.

## The parity check

`src/db/schemaParity.test.ts` reads the migration files above and `src/db/schema.ts` and
fails when they disagree about the columns of `dives` or `gear_presets`, in either
direction. It exists because §6 opens by claiming the two schemas are the same, and that
claim was previously checked by nobody.

It also asserts the guarantees the SQL text carries that a column comparison cannot see:
no serial or identity anywhere (ids are the client's UUIDv7), no trigger stamping
`created_at` or `updated_at`, no enum or CHECK on a vocabulary column (§10: an unknown
value is stored and flagged, never rejected), `tanks`/`equipment` NOT NULL with a `'[]'`
default, RLS enabled on all six tables, and no client role granted DELETE.

**What it does not prove:** that this SQL runs. It has never been executed against
Postgres — not here, not anywhere. The parser is strict on purpose (it throws on anything
it has not been taught rather than skipping it), but a parser is not a server, and the
first person to paste these files into Studio is the first person to find out whether they
are valid.
