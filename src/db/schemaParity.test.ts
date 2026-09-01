import fs from 'node:fs';
import path from 'node:path';

import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';

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
// A deliberately strict SQL reader.
//
// A regex that skims for `create table` and shrugs at everything else is the thing the
// brief warns against, and it fails in the one direction that matters: a column it cannot
// read is a column it silently reports as absent, and "absent from both sides" is what
// this file calls agreement. So the reader **throws on anything it does not understand** —
// an unknown statement, an unreadable column, a comment style it has not been taught. A
// migration written in a shape this parser has not seen turns the suite red and demands
// to be taught, which is the correct direction for a check whose whole job is to notice
// that something changed.
// ──────────────────────────────────────────────────────────────────────────────────────

interface ParsedColumn {
  readonly name: string;
  readonly notNull: boolean;
  /** Everything after the column name, lowercased — what the type/default assertions read. */
  readonly definition: string;
}

interface ParsedTable {
  readonly name: string;
  readonly columns: readonly ParsedColumn[];
}

interface ParsedSql {
  readonly tables: readonly ParsedTable[];
  /** Every statement, comments stripped and whitespace collapsed. */
  readonly statements: readonly string[];
}

/**
 * Statement heads this schema legitimately contains and that say nothing about a column
 * set. Anything not on this list throws — including `alter table ... add column`, which is
 * exactly the shape a future migration would drift through, and which this parser must be
 * taught to fold into the column set before it can be used.
 */
const IGNORED_STATEMENT_HEADS = [
  'set ',
  'create schema ',
  'create extension ',
  'create index ',
  'create unique index ',
  'create policy ',
  'drop policy ',
  // Two heads are ignored here **so that the assertions below can be the thing that
  // rejects them**, rather than the parser throwing first. A guarantee whose violation
  // never reaches its own assertion is an assertion that can never fail — this project's
  // most-repeated defect, and it was in this file until it was mutation-tested. A trigger
  // and an enum type both parse cleanly now and are refused by name, under "the guarantees
  // the SQL text carries".
  'create trigger ',
  'create or replace trigger ',
  'create type ',
  'create or replace function ',
  'create function ',
  'grant ',
  'revoke ',
  'comment on ',
];

/** The only `alter table` forms that are not a column-set change. */
const ALLOWED_ALTER_TABLE = /^alter table \S+ (enable|disable|force|no force) row level security$/;

/**
 * Strips `--` comments and splits on `;`, both **outside** string and dollar-quoted
 * literals. The quote-awareness is not decoration: `'[]'::jsonb` and the `$$ … $$` bodies
 * the sync RPCs will arrive as in the next task both contain characters that a naive split
 * would cut a statement in half on.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let index = 0;

  while (index < sql.length) {
    const rest = sql.slice(index);

    // A dollar-quoted body ($$ … $$ or $tag$ … $tag$) is copied through whole.
    const dollar = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, index + tag.length);
      if (end === -1) throw new Error(`Unterminated dollar-quoted string opened with ${tag}`);
      current += sql.slice(index, end + tag.length);
      index = end + tag.length;
      continue;
    }

    const char = sql[index];

    if (char === "'") {
      const end = sql.indexOf("'", index + 1);
      if (end === -1) throw new Error('Unterminated string literal');
      current += sql.slice(index, end + 1);
      index = end + 1;
      continue;
    }

    if (char === '"') {
      const end = sql.indexOf('"', index + 1);
      if (end === -1) throw new Error('Unterminated quoted identifier');
      current += sql.slice(index, end + 1);
      index = end + 1;
      continue;
    }

    if (rest.startsWith('--')) {
      const newline = sql.indexOf('\n', index);
      index = newline === -1 ? sql.length : newline;
      continue;
    }

    if (rest.startsWith('/*')) {
      throw new Error('Block comments are not supported by the schema-parity parser');
    }

    if (char === ';') {
      statements.push(current);
      current = '';
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  if (current.trim() !== '') throw new Error(`Trailing SQL with no terminating ";": ${current.trim()}`);

  return statements.map((statement) => statement.replace(/\s+/g, ' ').trim()).filter((s) => s !== '');
}

/** Splits a `create table` body on commas at paren depth 0 — `geography(Point, 4326)` stays whole. */
function splitColumnDefinitions(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of body) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** Table-level constraints, which are not columns and must not be counted as one. */
const TABLE_CONSTRAINT_HEADS = /^(constraint|primary key|foreign key|unique|check|exclude|like)\b/;

const COLUMN_NAME = /^("?)([a-z_][a-z0-9_]*)\1\s+(.+)$/is;

function parseCreateTable(statement: string): ParsedTable {
  const header = /^create table (?:if not exists )?(?:public\.)?("?)([a-z_][a-z0-9_]*)\1 \(/i.exec(statement);
  const tableName = header?.[2];
  if (tableName === undefined) throw new Error(`Unreadable create table header: ${statement.slice(0, 80)}`);

  const open = statement.indexOf('(');
  const close = statement.lastIndexOf(')');
  if (close <= open) throw new Error(`Unbalanced parentheses in: ${statement.slice(0, 80)}`);

  const columns: ParsedColumn[] = [];
  for (const definition of splitColumnDefinitions(statement.slice(open + 1, close))) {
    if (TABLE_CONSTRAINT_HEADS.test(definition.toLowerCase())) continue;

    const match = COLUMN_NAME.exec(definition);
    const name = match?.[2];
    const remainder = match?.[3];
    if (name === undefined || remainder === undefined) {
      throw new Error(`Unreadable column definition: ${definition}`);
    }

    const rest = remainder.toLowerCase();
    columns.push({
      name: name.toLowerCase(),
      // A primary key is NOT NULL in Postgres whether or not the words are written, and
      // Drizzle reports the SQLite side the same way — so reading only `not null` here
      // would report every `id` column as a mismatch and teach the next reader to loosen
      // the comparison.
      notNull: /\bnot\s+null\b/.test(rest) || /\bprimary\s+key\b/.test(rest),
      definition: rest,
    });
  }

  if (columns.length === 0) throw new Error(`No columns parsed from: ${statement.slice(0, 80)}`);

  return { name: tableName.toLowerCase(), columns };
}

export function parseMigrationSql(sql: string): ParsedSql {
  const statements = splitStatements(sql);
  const tables: ParsedTable[] = [];

  for (const statement of statements) {
    const lower = statement.toLowerCase();

    if (/^create table\b/.test(lower)) {
      tables.push(parseCreateTable(statement));
      continue;
    }
    if (/^alter table\b/.test(lower)) {
      if (ALLOWED_ALTER_TABLE.test(lower)) continue;
      throw new Error(`alter table form the parity parser has not been taught: ${statement}`);
    }
    if (IGNORED_STATEMENT_HEADS.some((head) => lower.startsWith(head))) continue;

    throw new Error(`Statement the parity parser has not been taught: ${statement.slice(0, 120)}`);
  }

  return { tables, statements };
}

// ──────────────────────────────────────────────────────────────────────────────────────
// The two sides, each read from its own source.
// ──────────────────────────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');

function readMigrations(): ParsedSql {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) throw new Error(`No .sql files in ${MIGRATIONS_DIR}`);

  const tables: ParsedTable[] = [];
  const statements: string[] = [];
  for (const file of files) {
    const parsed = parseMigrationSql(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    tables.push(...parsed.tables);
    statements.push(...parsed.statements);
  }
  return { tables, statements };
}

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

/** The tables §6 puts on both sides. These are the ones compared column for column. */
const SYNCED_TABLES = ['dives', 'gear_presets'] as const;

type SyncedTable = (typeof SYNCED_TABLES)[number];

const LOCAL_ONLY_TABLES: Record<string, string> = {
  settings:
    '§6, "Local only": units, locale, hidden groups and the dives_before offset. The one ' +
    'value that does travel — dives_before — syncs into profiles.dives_before, so the ' +
    'table itself has no server counterpart. §6 names `sync_state` in the same breath and ' +
    'it does not exist locally yet; when it does it belongs on this list, never in Postgres.',
};

const POSTGRES_ONLY_TABLES: Record<string, string> = {
  profiles: '§6: display_name + dives_before. A device has one diver, so nothing local mirrors it.',
  dive_sites:
    '§5/§6: the community catalogue, server-authoritative — which is why its coordinates are ' +
    'one PostGIS `location` where a dive keeps a latitude/longitude pair. The local mirror ' +
    'arrives with M2\'s offline catalogue; today no SQLite table faces this one.',
  dive_centers: 'As dive_sites: community, server-authoritative, no local mirror yet.',
  certifications: '§6 specifies it; M3 builds the wallet screen. No local table until then.',
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
};

/** Nothing yet. A local column with no Postgres counterpart is a row that syncs to nowhere. */
const LOCAL_ONLY_COLUMNS: Record<SyncedTable, Record<string, string>> = {
  dives: {},
  gear_presets: {},
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

  it('every exception names a reason, so the list cannot rot into a tolerance', () => {
    const reasons = [
      ...Object.values(LOCAL_ONLY_TABLES),
      ...Object.values(POSTGRES_ONLY_TABLES),
      ...Object.values(POSTGRES_ONLY_COLUMNS).flatMap((columns) => Object.values(columns)),
      ...Object.values(LOCAL_ONLY_COLUMNS).flatMap((columns) => Object.values(columns)),
    ];
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.filter((reason) => reason.trim().length < 20)).toEqual([]);
  });
});

describe('the guarantees the SQL text carries (DESIGN.md §5, §6, §10)', () => {
  const allTables = [...SYNCED_TABLES, ...Object.keys(POSTGRES_ONLY_TABLES)];
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
    expect(syncColumns.length).toBe(allTables.length * 3);
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
    expect(grants.length).toBe(allTables.length);
    expect(grants.filter((statement) => /\bdelete\b/i.test(statement))).toEqual([]);

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

  it('lets a community row outlive the account that created it (§5)', () => {
    // "History never breaks": a deleted account must not take the sites it contributed
    // with it, so created_by is nulled rather than cascaded — which is also why that
    // column is nullable while dives.user_id is not.
    for (const table of ['dive_sites', 'dive_centers']) {
      const createdBy = postgresTable(table).columns.find((column) => column.name === 'created_by');
      expect(createdBy?.definition).toMatch(/on delete set null/);
      expect(createdBy?.notNull).toBe(false);
    }
    for (const table of ['dives', 'gear_presets', 'certifications']) {
      const userId = postgresTable(table).columns.find((column) => column.name === 'user_id');
      expect(userId?.definition).toMatch(/on delete cascade/);
      expect(userId?.notNull).toBe(true);
    }
  });
});
