import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';

import {
  DEVICE_ONLY_COLUMNS,
  DEVICE_ONLY_TABLES,
  MIGRATIONS_DIR,
  parseMigrationSql,
  readMigrations,
  UNSYNCED_TABLES,
  type ParsedTable,
} from '../testing/migrationSql';
import * as localSchema from './schema';

/**
 * DESIGN.md §6 opens with **"The same schema lives in SQLite (Drizzle) and Postgres."**
 *
 * Nothing checked that. It is two hand-maintained files that agree today, which is §4.1's
 * defining defect stated as a design principle — and the failure mode is the quiet kind: a
 * column added to `src/db/schema.ts` in M3 and not to `supabase/migrations/` is a field
 * that syncs to nowhere, and it fails no test, no build and no lint. The diver's data is
 * simply on one device forever.
 *
 * So this file reads **both sides from their own source** and compares them:
 *
 *   - the Postgres side by parsing the migration SQL the owner actually pastes into
 *     Studio — the deployed artefact, not a description of it;
 *   - the SQLite side out of the live Drizzle table objects, via `getTableConfig`, which
 *     is the same metadata `drizzle-kit generate` emits migrations from.
 *
 * **Neither side is derived from the other**, which is the property that matters here.
 * This project's signature defect is a test whose two sides come from one source — M1j
 * found a sweep asserting `found === COLUMN` where `found` had been filtered from
 * `COLUMN`, green for two milestones and asserting nothing. A parity check built that way
 * would be worse than no parity check, because it would read finished.
 *
 * **Where the two legitimately differ, the difference is data with a reason attached**
 * (`POSTGRES_ONLY_COLUMNS` and the table lists below), never a loosened comparison. The
 * comparison is an exact set equality in both directions, so an exception that is added
 * without cause is as visible as one that is missing, and a stale exception naming a
 * column that no longer exists fails too. An exception list you have to edit deliberately
 * is the whole point of it.
 *
 * **The reader itself lives in `src/testing/migrationSql.ts`** (moved there by M2b, when
 * `src/db/syncRpcParity.test.ts` came to need the same statements). Its own fixtures —
 * "the SQL reader" below — moved with nothing else changed; a second copy of a parser both
 * parity checks lean on would be exactly the defect this file exists to name.
 *
 * ── What this file does NOT prove, stated plainly ──────────────────────────────────────
 *
 * **It does not prove the SQL runs.** No Postgres executes here — the migrations have
 * never been applied by anyone, by design (the credentials that could apply them must not
 * exist in this public repository). This checks that the two schemas *say* the same
 * thing; that the Postgres one is valid SQL against a real server is unverified, and the
 * first person to paste it into Studio is the one who finds out.
 *
 * It also does not compare column *types*. SQLite `text` legitimately faces `uuid`,
 * `jsonb`, `text` and `timestamptz`, so a type comparison needs a mapping table — a third
 * hand-maintained list, which is the thing this file exists to be suspicious of. The two
 * type facts that are genuinely load-bearing are asserted by name instead, under
 * "the guarantees the SQL text carries" below.
 */

// ──────────────────────────────────────────────────────────────────────────────────────
// The two sides, each read from its own source.
// ──────────────────────────────────────────────────────────────────────────────────────

const postgres = readMigrations();
const postgresTable = (name: string): ParsedTable => {
  const found = postgres.tables.find((table) => table.name === name);
  if (!found) throw new Error(`No create table for "${name}" in ${MIGRATIONS_DIR}`);
  return found;
};

/** Every Drizzle table declared in `schema.ts`, found by type rather than by a name list. */
const localTables = (Object.values(localSchema) as unknown[])
  .filter((value): value is SQLiteTable => is(value, SQLiteTable))
  .map((table) => getTableConfig(table));

const localTable = (name: string) => {
  const found = localTables.find((table) => table.name === name);
  if (!found) throw new Error(`No Drizzle table "${name}" in src/db/schema.ts`);
  return found;
};

// ──────────────────────────────────────────────────────────────────────────────────────
// The exceptions — data, with a reason each, because "where they differ" is a decision
// somebody made and not a tolerance.
// ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The tables §6 puts on both sides. These are the ones compared column for column.
 *
 * **The two community tables joined this list in M2d**, where they had been whole-table
 * Postgres-only exceptions since M2a. That exception said "the local mirror arrives with M2's
 * offline catalogue", and this is that: §5's "the compact site/center catalogue syncs to every
 * device, so autocomplete works fully offline" and §2.3's "the on-device copy of the community
 * catalogue" both require a local copy, and `pull_changes` has been returning one since M2b
 * with nowhere to put it. What was a table-shaped difference is now a column-shaped one — the
 * PostGIS point against the coordinate pair — which is the difference §6 already rules on.
 */
const SYNCED_TABLES = ['dives', 'gear_presets', 'dive_sites', 'dive_centers'] as const;

type SyncedTable = (typeof SYNCED_TABLES)[number];

/**
 * Tables the device has and the server does not. The list itself lives in
 * `src/testing/migrationSql.ts` (`DEVICE_ONLY_TABLES`), shared with `syncRpcParity.test.ts`
 * so that "local-only" and "never named by an RPC" cannot be two different answers — see
 * that constant for why, and the sync-RPC file for the other half of the check.
 */
const LOCAL_ONLY_TABLES: Record<string, string> = DEVICE_ONLY_TABLES;

const POSTGRES_ONLY_TABLES: Record<string, string> = {
  profiles: '§6: display_name + dives_before. A device has one diver, so nothing local mirrors it.',
  certifications: '§6 specifies it; M3 builds the wallet screen. No local table until then.',
  site_edits:
    "§5's review queue — \"everyone else taps *suggest a correction*, which lands in a review " +
    'queue" — created by M2c, which also found that §6\'s table list never mentioned it. ' +
    'Written by `suggest_site_edit`, read by an admin in Studio, and never synced: a ' +
    'suggestion is made online about a row the device already has. See UNSYNCED_TABLES.',
  site_duplicate_suspicions:
    "§5's \"flags likely duplicates for a one-tap merge by the creator\", created by M2q — " +
    'the place a SUSPICION lives, which §6 gave `dive_sites` no room for: `status` and ' +
    '`merged_into` describe a merge that has happened, and a suspicion says only that ' +
    'somebody should look. A pair per row rather than a column, because one site may be ' +
    'suspected of several and because the row IS the three states (absent · open · ' +
    'resolved). Server-only: a merge writes community columns no client may push, so a ' +
    'device copy could only display it. See UNSYNCED_TABLES.',
};

/**
 * Every column that references `auth.users`, and what an account deletion does to the rows
 * that carry it. §8 makes in-app deletion a hard App Store requirement and §5 says community
 * rows are never hard-deleted, and **this list is where those two are reconciled**: M2c's
 * `delete_account` is one `delete from auth.users`, so what survives a diver leaving is
 * decided here and nowhere else.
 *
 * Getting an entry wrong is silent in both directions. A personal table that stops cascading
 * keeps a departed diver's dives forever; a community table that starts cascading destroys
 * sites other divers' logbooks point at, and that one cannot be undone. So the check below is
 * exhaustive over the schema rather than a sample: a table added later with an `auth.users`
 * reference and no entry here fails until somebody decides which kind it is.
 */
const ACCOUNT_DELETION: Record<string, { readonly action: 'cascade' | 'set null'; readonly why: string }> = {
  'dives.user_id': { action: 'cascade', why: "A diver's dives are theirs alone (§5) and go with the account." },
  'gear_presets.user_id': { action: 'cascade', why: 'Private, as dives — one diver\'s named cylinder sets.' },
  'certifications.user_id': { action: 'cascade', why: 'Private, as dives — the §6 wallet is one person\'s cards.' },
  'profiles.id': {
    action: 'cascade',
    why: '§6 makes a profile BE the user, so it cannot outlive them; it also holds the only ' +
      'display name, which §8 counts as personal data.',
  },
  'dive_sites.created_by': {
    action: 'set null',
    why: '§5: "history never breaks". Other divers\' dives carry site_id references, and the ' +
      'row keeps its pin, its defaults and everyone\'s map marker. Authorship is severed, the ' +
      'site stays — and null matches no auth.uid(), so nobody may edit it through the app again.',
  },
  'dive_centers.created_by': { action: 'set null', why: 'As dive_sites.created_by — §5 covers "a site or center" in one sentence.' },
  'site_edits.suggested_by': {
    action: 'set null',
    why: 'A suggestion is about a SITE, not about its author, and an admin may already have ' +
      'acted on it. Severing the author is the reversible choice; deleting the queue is not.',
  },
};

const POSTGRES_ONLY_COLUMNS: Record<SyncedTable, Record<string, string>> = {
  dives: {
    user_id:
      '§6: "every column nullable except id, user_id, date". A device holds exactly one ' +
      "diver's logbook, so ownership is the server's question alone — it is what RLS keys " +
      'on, and it arrives on a local row only at §7\'s guest-to-account migration, which ' +
      'writes it into the pushed payload rather than into SQLite.',
  },
  gear_presets: {
    user_id: 'As dives.user_id — ownership is a server-side fact.',
  },
  dive_sites: {
    location:
      '§6: "SQLite has no point type … Postgres composes them into a PostGIS point — the ' +
      'sync payload carries the pair, and the server owns the geometry." The device holds ' +
      'the latitude/longitude pair below instead, which is the same rule a dive\'s own GPS ' +
      'point already follows, and `public.sync_site` is the one place the two forms meet.',
  },
  dive_centers: {
    location: 'As dive_sites.location — the point is the server\'s, the pair is the device\'s.',
  },
};

/**
 * Columns the device has and Postgres does not, and there are two kinds — which is the whole
 * reason this list carries reasons rather than a tolerance.
 *
 * `latitude`/`longitude` **do travel**: they are what `sync_site` renders `location` as, and
 * `syncRpcParity.test.ts` requires them on the wire (`PAYLOAD_EXTRAS`). `dirty` is the
 * opposite — it never leaves the device at all (`DEVICE_ONLY_COLUMNS`), and the assertion
 * below checks that every table §7 pushes carries it, so a table cannot quietly lose the flag
 * that is the only reason its rows ever go up.
 */
const LOCAL_ONLY_COLUMNS: Record<SyncedTable, Record<string, string>> = {
  dives: { dirty: DEVICE_ONLY_COLUMNS.dirty ?? '' },
  gear_presets: { dirty: DEVICE_ONLY_COLUMNS.dirty ?? '' },
  dive_sites: {
    latitude: '§6: the pair the device holds in place of the server\'s PostGIS point; it is on ' +
      'the wire either way, as `sync_site` renders it and `push_changes` reads it back.',
    longitude: 'As dive_sites.latitude — one point, two columns, both on the wire.',
    dirty: DEVICE_ONLY_COLUMNS.dirty ?? '',
  },
  dive_centers: {
    latitude: 'As dive_sites.latitude.',
    longitude: 'As dive_sites.longitude.',
    dirty: DEVICE_ONLY_COLUMNS.dirty ?? '',
  },
};

// ──────────────────────────────────────────────────────────────────────────────────────

describe('the SQL reader', () => {
  // The parity assertions are only worth their green if the thing feeding them can be
  // trusted, and a parser that quietly drops what it cannot read would make every
  // assertion below pass by agreeing that a column is absent from both sides. These
  // fixtures are what says it does not.
  it('reads a column set, ignoring comments and table-level constraints', () => {
    const parsed = parseMigrationSql(`
      -- a leading comment, with a ; semicolon in it
      create table if not exists public.thing (
        id uuid primary key default gen_random_uuid(),
        name text, -- trailing comment
        location extensions.geography(Point, 4326),
        tanks jsonb not null default '[]'::jsonb,
        constraint thing_name_unique unique (name)
      );
    `);

    expect(parsed.tables.map((table) => table.name)).toEqual(['thing']);
    expect(parsed.tables.flatMap((table) => table.columns.map((column) => column.name))).toEqual([
      'id',
      'name',
      'location',
      'tanks',
    ]);
  });

  it('reads NOT NULL, and reads a primary key as one', () => {
    const parsed = parseMigrationSql(
      'create table t (id uuid primary key, a text not null, b text, c text default null);',
    );
    const notNull = Object.fromEntries(
      parsed.tables.flatMap((table) => table.columns.map((c) => [c.name, c.notNull])),
    );
    expect(notNull).toEqual({ id: true, a: true, b: false, c: false });
  });

  it('keeps a comma inside parentheses out of the column split', () => {
    const parsed = parseMigrationSql('create table t (a extensions.geography(Point, 4326), b text);');
    expect(parsed.tables.flatMap((table) => table.columns.map((c) => c.name))).toEqual(['a', 'b']);
  });

  it('does not cut a statement on a semicolon inside a string or a function body', () => {
    const parsed = parseMigrationSql(`
      create table t (a text default 'x;y');
      create or replace function f() returns void language plpgsql as $$ begin raise notice 'hi;'; end; $$;
    `);
    expect(parsed.tables.map((table) => table.name)).toEqual(['t']);
    expect(parsed.tables.flatMap((table) => table.columns.map((c) => c.name))).toEqual(['a']);
  });

  it('throws on a statement it has not been taught rather than skipping it', () => {
    expect(() => parseMigrationSql('create materialized view v as select 1;')).toThrow(
      /has not been taught/,
    );
    expect(() => parseMigrationSql('alter table public.dives add column depth real;')).toThrow(
      /has not been taught/,
    );
  });

  it('throws on a column definition it cannot read rather than dropping the column', () => {
    expect(() => parseMigrationSql('create table t (a text, 99bottles text);')).toThrow(
      /Unreadable column definition/,
    );
  });

  it('allows the row-level-security alter forms and nothing else under alter table', () => {
    expect(() => parseMigrationSql('alter table public.dives enable row level security;')).not.toThrow();
    expect(() => parseMigrationSql('alter table public.dives owner to postgres;')).toThrow();
  });
});

describe('the migrations and src/db/schema.ts describe the same schema (DESIGN.md §6)', () => {
  it('classifies every table on both sides — a new one has to be placed deliberately', () => {
    expect(localTables.map((table) => table.name).sort()).toEqual(
      [...SYNCED_TABLES, ...Object.keys(LOCAL_ONLY_TABLES)].sort(),
    );
    expect(postgres.tables.map((table) => table.name).sort()).toEqual(
      [...SYNCED_TABLES, ...Object.keys(POSTGRES_ONLY_TABLES)].sort(),
    );
  });

  it.each(SYNCED_TABLES)('%s has the same columns in both schemas', (table) => {
    const local = localTable(table).columns;
    const remote = postgresTable(table).columns;

    const localNames = new Set(local.map((column) => column.name));
    const remoteNames = new Set(remote.map((column) => column.name));

    // Both directions, both exact. A column added to Postgres and not to Drizzle is a
    // column the app cannot write; one added to Drizzle and not to Postgres is a field
    // that syncs to nowhere. Neither is a tolerance, so neither is a subset check.
    expect([...remoteNames].filter((name) => !localNames.has(name)).sort()).toEqual(
      Object.keys(POSTGRES_ONLY_COLUMNS[table]).sort(),
    );
    expect([...localNames].filter((name) => !remoteNames.has(name)).sort()).toEqual(
      Object.keys(LOCAL_ONLY_COLUMNS[table]).sort(),
    );
  });

  it.each(SYNCED_TABLES)('%s agrees on which columns are NOT NULL', (table) => {
    const remote = new Map(postgresTable(table).columns.map((column) => [column.name, column.notNull]));
    const shared = localTable(table).columns.filter((column) => remote.has(column.name));

    // Non-empty by construction — the column-set assertion above would have failed first —
    // but stated so a parser that started returning nothing could not pass this vacuously.
    expect(shared.length).toBeGreaterThan(5);

    expect(shared.filter((column) => column.notNull !== remote.get(column.name)).map((c) => c.name)).toEqual(
      [],
    );
  });

  it('puts §7\'s dirty flag on every table it pushes, and on nothing the server has', () => {
    // The flag is the ONLY reason a row ever goes up (§7.1), so a synced table without one is
    // a table whose every edit stays on the phone — no error, no failing gate, no screen that
    // looks wrong. Derived from the schemas on both sides rather than listed, so a fifth
    // synced table is covered by the commit that adds it.
    const flagged = localTables
      .filter((table) => table.columns.some((column) => column.name in DEVICE_ONLY_COLUMNS))
      .map((table) => table.name)
      .sort();
    expect(flagged).toEqual([...SYNCED_TABLES].sort());
    // And the list's key is the name `schema.ts` actually declares the column by, rather than
    // a second spelling of it typed into a test.
    expect(Object.keys(DEVICE_ONLY_COLUMNS)).toContain(localSchema.DIRTY_COLUMN);
    // Floored, because an extractor that found nothing would make the line above compare two
    // empty lists if SYNCED_TABLES were ever emptied as well.
    expect(flagged.length).toBeGreaterThan(3);

    // NOT NULL, and that is not tidiness: a nullable flag is a third state nothing means, and
    // `dirty is null` matches neither `= 1` nor `= 0`, so such a row would never be picked up
    // by the push set and never be reported as unpushed either.
    const nullability = localTables.flatMap((table) =>
      table.columns
        .filter((column) => column.name in DEVICE_ONLY_COLUMNS)
        .map((column) => `${table.name}.${column.name}: notNull ${column.notNull}`),
    );
    expect(nullability.length).toBe(flagged.length);
    expect(nullability.filter((column) => !column.endsWith(': notNull true'))).toEqual([]);

    // And the server has none of it. A `dirty` column in Postgres would be one device's
    // bookkeeping stored where another device can read it; a `dirty` key in a push payload is
    // refused by `sync_reject_unknown_keys` and takes the diver's whole sync down with it.
    expect(
      postgres.tables.flatMap((table) =>
        table.columns.filter((column) => column.name in DEVICE_ONLY_COLUMNS).map((column) => `${table.name}.${column.name}`),
      ),
    ).toEqual([]);
  });

  it('every exception names a reason, so the list cannot rot into a tolerance', () => {
    const reasons = [
      ...Object.values(LOCAL_ONLY_TABLES),
      ...Object.values(POSTGRES_ONLY_TABLES),
      ...Object.values(DEVICE_ONLY_COLUMNS),
      ...Object.values(POSTGRES_ONLY_COLUMNS).flatMap((columns) => Object.values(columns)),
      ...Object.values(LOCAL_ONLY_COLUMNS).flatMap((columns) => Object.values(columns)),
    ];
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.filter((reason) => reason.trim().length < 20)).toEqual([]);
  });
});

describe('the guarantees the SQL text carries (DESIGN.md §5, §6, §10)', () => {
  const allTables = [...SYNCED_TABLES, ...Object.keys(POSTGRES_ONLY_TABLES)];
  /**
   * §6's three-timestamp rule is stated about **synced** tables, and until M2c every table
   * here was one. `site_edits` is not: it is written by an RPC and read by an admin, so a
   * `deleted_at` on it would claim a protocol it has no part in. The exclusion is shared
   * with `syncRpcParity.test.ts` (`UNSYNCED_TABLES`), and checked below rather than trusted —
   * a name on that list that is not a table here would quietly shrink the counts.
   */
  const syncedTables = allTables.filter((table) => !(table in UNSYNCED_TABLES));
  const columnDefinitions = postgres.tables.flatMap((table) =>
    table.columns.map((column) => ({ table: table.name, ...column })),
  );

  it('has no serial, no identity and no id-rewriting trigger — ids are the client\'s (§6)', () => {
    expect(
      columnDefinitions.filter((column) => /\b(smallserial|serial|bigserial)\b/.test(column.definition)),
    ).toEqual([]);
    expect(
      columnDefinitions.filter((column) => /generated\s+(always|by default)\s+as\s+identity/.test(column.definition)),
    ).toEqual([]);
    expect(postgres.statements.filter((statement) => /^create (or replace )?trigger\b/i.test(statement))).toEqual([]);
  });

  it('lets a client-supplied created_at and updated_at stand (§2.5, §6)', () => {
    // §2.5 uses created_at as a dive-ordering tier, so a trigger stamping it on write
    // would silently reorder a diver's dives on their first sync. §6 gives updated_at to
    // push_changes, and a trigger there would be a second owner for the same rule (§4.1)
    // — one the RPC could not override. `default now()` is the whole mechanism: a value
    // the client sends survives, and a row inserted without one still gets a timestamp.
    //
    // The counts below are over EVERY table, synced or not — `created_at` and `updated_at`
    // mean the same thing on the review queue as anywhere else — while the `deleted_at` count
    // is over the synced ones alone, since a tombstone is a §7 idea. Both are exact, and the
    // exclusion list is verified here so it cannot silently narrow either.
    expect(Object.keys(UNSYNCED_TABLES).filter((name) => !allTables.includes(name))).toEqual([]);
    expect(syncedTables.length).toBeGreaterThan(5);

    const timestamps = columnDefinitions.filter((column) =>
      ['created_at', 'updated_at'].includes(column.name),
    );
    expect(timestamps.length).toBe(allTables.length * 2);
    expect(timestamps.filter((column) => !/default now\(\)/.test(column.definition))).toEqual([]);

    // And they are real timestamps, on all three of the sync columns. Mutation-found: the
    // type allow-list one test down accepts `text` for the whole schema, so `created_at
    // text not null default now()` slipped through it — a column that would take the
    // client's ISO string and the server's `now()` in two different spellings and hand
    // §7's last-write-wins a string comparison between them.
    const syncColumns = columnDefinitions.filter((column) =>
      ['created_at', 'updated_at', 'deleted_at'].includes(column.name),
    );
    expect(syncColumns.length).toBe(allTables.length * 2 + syncedTables.length);
    expect(columnDefinitions.filter((column) => column.name === 'deleted_at').length).toBe(
      syncedTables.length,
    );
    expect(
      syncColumns
        .filter((column) => !/^timestamptz\b/.test(column.definition))
        .map((column) => `${column.table}.${column.name}: ${column.definition}`),
    ).toEqual([]);
  });

  it('stores an unknown vocabulary value rather than rejecting it (§10)', () => {
    // §10: a value from a client this build does not know is stored and flagged, never
    // refused. An enum type or a CHECK would make that a rejected push — and, under §7's
    // one transactional push, would take the diver's whole sync down for one strange chip.
    //
    // **The type allow-list is the assertion that carries this, and it replaced a weaker
    // one that read the same.** Banning `create type … as enum` was mutation-tested and
    // SURVIVED: retyping `entry` to an enum declared anywhere else — another migration,
    // another hand, a `create domain` — left the ban looking at a statement that was not
    // there. Pinning the types themselves cannot be got round that way, and it is not a
    // fourth copy of the vocabularies (which live in `src/domain/types.ts` and are named
    // nowhere here) — it is the claim that no column in this schema is of a type that can
    // refuse a value at all. It pins two more decisions while it is there: `date` and
    // `time_in` are `text` rather than `date`/`time`, because `domain/datetime.ts` stores
    // an uninterpretable date unchanged (§1) and §7 pushes in one transaction, so a `date`
    // column would take a diver's whole sync down for one typo; and every timestamp is
    // `timestamptz` so `push_changes` can restamp it with the server clock.
    const ALLOWED_TYPES =
      /^(uuid|text|integer|double precision|jsonb|timestamptz|extensions\.geography\(point, 4326\))(?=\s|$)/;

    expect(
      columnDefinitions
        .filter((column) => !ALLOWED_TYPES.test(column.definition))
        .map((column) => `${column.table}.${column.name}: ${column.definition}`),
    ).toEqual([]);
    expect(postgres.statements.filter((statement) => /create type .* as enum/i.test(statement))).toEqual([]);
    expect(columnDefinitions.filter((column) => /\bcheck\s*\(/.test(column.definition))).toEqual([]);
  });

  it('keeps tanks and equipment NOT NULL with an empty-array default (§6)', () => {
    const arrays = columnDefinitions.filter((column) => ['tanks', 'equipment'].includes(column.name));
    expect(arrays.map((column) => `${column.table}.${column.name}`).sort()).toEqual([
      'dives.equipment',
      'dives.tanks',
      'gear_presets.tanks',
    ]);
    for (const column of arrays) {
      expect(column.notNull).toBe(true);
      expect(column.definition).toMatch(/jsonb not null default '\[\]'::jsonb/);
    }
  });

  it('enables row-level security on every table, public ones included (§5, §8)', () => {
    for (const table of allTables) {
      expect(postgres.statements).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('revokes everything from both client roles before granting anything back (§5)', () => {
    for (const table of allTables) {
      expect(postgres.statements).toContain(`revoke all on table public.${table} from anon, authenticated`);
    }
  });

  it('grants no client role the right to hard-delete a row (§5, §7)', () => {
    // "Rows are never hard-deleted" (§5) and deletion propagates as a tombstone (§7), so
    // DELETE has no legitimate client caller. Guarded twice because it is the one failure
    // here that cannot be undone: no policy permits it, and the privilege is not granted.
    const grants = postgres.statements.filter((statement) => /^grant\b/i.test(statement));
    // Counted over TABLE grants alone. M2b's sync RPCs add `grant execute on function`
    // lines, which are a different object and are counted by src/db/syncRpcParity.test.ts;
    // an exact count over every `grant` in the tree would have turned red on a statement
    // that has nothing to do with hard-deleting a row. The DELETE sweep below stays over
    // ALL of them, because a `grant delete` anywhere is the thing being refused.
    expect(grants.filter((statement) => /\bon table\b/i.test(statement)).length).toBe(allTables.length);
    expect(grants.filter((statement) => /\bdelete\b/i.test(statement))).toEqual([]);
    expect(grants.filter((statement) => /\ball\b/i.test(statement))).toEqual([]);

    const policies = postgres.statements.filter((statement) => /^create policy\b/i.test(statement));
    expect(policies.filter((statement) => /\bfor delete\b/i.test(statement))).toEqual([]);
  });

  it('names authenticated on every policy and anon on none (§5)', () => {
    // A policy with no `to` clause applies to PUBLIC, which includes `anon` — the role the
    // publishable key in a downloadable app authenticates as. Every policy says who it is
    // for, out loud.
    const policies = postgres.statements.filter((statement) => /^create policy\b/i.test(statement));
    expect(policies.length).toBeGreaterThan(0);
    expect(policies.filter((statement) => !/\bto authenticated\b/i.test(statement))).toEqual([]);
    expect(policies.filter((statement) => /\banon\b/i.test(statement))).toEqual([]);
  });

  it('decides for every table what an account deletion does to it (§5, §8)', () => {
    // "History never breaks": a deleted account must not take the sites it contributed with
    // it, so created_by is nulled rather than cascaded — which is also why that column is
    // nullable while dives.user_id is not. M2c's `delete_account` is one `delete from
    // auth.users`, so THIS is the rule it fires: there is no second list of DELETE statements
    // in the RPC, deliberately (§4.1), which makes these seven definitions load-bearing.
    //
    // Read exhaustively out of the schema rather than from a hand list of tables. The version
    // this replaced named five tables and missed `profiles.id` entirely — its cascade could
    // have been dropped and nothing here would have noticed, leaving a departed diver's
    // display name behind for good.
    const references = columnDefinitions
      .filter((column) => /references auth\.users\b/.test(column.definition))
      .map((column) => ({ key: `${column.table}.${column.name}`, ...column }));

    expect(references.map((column) => column.key).sort()).toEqual(Object.keys(ACCOUNT_DELETION).sort());
    expect(references.length).toBeGreaterThan(6);

    for (const column of references) {
      const rule = ACCOUNT_DELETION[column.key];
      expect(rule).toBeDefined();
      expect(`${column.key}: ${column.definition}`).toContain(`on delete ${rule?.action}`);
      // A severed reference has to be able to hold a null, and an owning one must not: a
      // NOT NULL column with `on delete set null` is a delete that fails at runtime, and a
      // nullable ownership column is a private row belonging to nobody.
      expect(`${column.key}: notNull ${column.notNull}`).toBe(
        `${column.key}: notNull ${rule?.action === 'cascade'}`,
      );
      expect((rule?.why ?? '').trim().length).toBeGreaterThan(20);
    }
  });
});
