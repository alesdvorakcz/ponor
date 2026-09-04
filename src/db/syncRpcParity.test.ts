import {
  DEVICE_ONLY_COLUMNS,
  DEVICE_ONLY_TABLES,
  matchParen,
  parseFunctionSql,
  parseReads,
  parseUpserts,
  payloadKeys,
  qualifiedReferences,
  readMigrationFile,
  readMigrations,
  splitTopLevel,
  statementsOf,
  SYNC_SIDE_EFFECT_TABLES,
  UNSYNCED_TABLES,
  type ParsedFunction,
  type ParsedRead,
  type ParsedUpsert,
} from '../testing/migrationSql';

/**
 * DESIGN.md §7 is a protocol, and `supabase/migrations/20260902090300_sync_rpcs.sql` is that
 * protocol in Postgres. **It has never been run**, by anyone, and it cannot be from here —
 * the credentials that could run it must not exist in this public repository. So this file
 * is what stands in for a server, and it is written against a specific fact about §7:
 *
 * **every way this code fails, fails silently.** A timestamp in the wrong spelling, a
 * `created_at` restamped on push, a `where deleted_at is null` in the pull, a column left out
 * of an insert list, ST_MakePoint handed its pair backwards — none of them raise. Each one
 * just quietly produces the wrong winner, the wrong order, the wrong hemisphere, or a field
 * that never leaves the phone. `expo lint` and `tsc` cannot see any of it, and neither can a
 * reviewer reading a diff of four hundred lines of SQL.
 *
 * ── What this proves, and what it does not ────────────────────────────────────────────────
 *
 * It proves that the RPCs and `20260902090100_schema.sql` **agree about the same rows**, read
 * from their own sources: the column lists come out of the RPC migration, the columns they
 * are checked against come out of the schema migration, and neither is derived from the
 * other. That is the property M1j's `found === COLUMN` sweep lacked, green and vacuous for
 * two milestones, and the one M2a's own first two parity attempts lacked as well.
 *
 * It does not prove the SQL runs. It resolves no names against a live catalogue, checks no
 * privileges, and executes nothing. Grammar was checked separately with libpg_query
 * (scratchpad only, no repo dependency) — see the M2b report — and grammar is not semantics.
 *
 * One assertion below models an external system rather than reading it: `renderToChar` is a
 * model of the slice of Postgres `to_char` the ISO spelling uses. It proves the template in
 * the SQL renders what `Date.prototype.toISOString()` renders *if that model is right*. The
 * model throws on any template code it has not been taught, so an unmodelled code fails loud
 * rather than passing quietly, but it is still a model and it is named here as the one place
 * this file trusts something it cannot read.
 */

const RPC_FILE = '20260902090300_sync_rpcs.sql';

const rpc = parseFunctionSql(readMigrationFile(RPC_FILE));
const schema = readMigrations();

function fn(name: string): ParsedFunction {
  const found = rpc.functions.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No function ${name} in ${RPC_FILE}`);
  return found;
}

const push = fn('public.push_changes');
const pull = fn('public.pull_changes');
const isoZ = fn('public.iso_z');
const syncRow = fn('public.sync_row');
const syncSite = fn('public.sync_site');

/**
 * Every table the schema migrations declare that §7 syncs — the other side of every check
 * below. It was every table full stop until M2c added `site_edits`, §5's review queue, which
 * is written by an RPC and read by an admin and never travels; `UNSYNCED_TABLES` carries that
 * exclusion and its reason, shared with `schemaParity.test.ts` so the two cannot disagree.
 *
 * The exclusion is checked rather than trusted, immediately below: a name in that list that is
 * not a table here would silently shrink every `it.each` in this file.
 */
const SCHEMA_TABLES = schema.tables
  .map((table) => table.name)
  .filter((name) => !(name in UNSYNCED_TABLES))
  .sort();

function schemaColumns(table: string): string[] {
  const found = schema.tables.find((candidate) => candidate.name === table);
  if (!found) throw new Error(`No create table for "${table}" in the schema migration`);
  return found.columns.map((column) => column.name);
}

/**
 * The column that ties a row to an account, **derived from the schema migration** rather than
 * listed here: it is the one that references `auth.users`. `dives`, `gear_presets` and
 * `certifications` answer `user_id`; the two community tables answer `created_by`; `profiles`
 * answers `id`, because §6 makes a profile *be* the user. Deriving it is what lets one rule —
 * "the owner is the server's to decide, never the payload's" — be asserted once for six
 * tables that spell it three ways.
 */
function ownershipColumn(table: string): string {
  const found = schema.tables.find((candidate) => candidate.name === table);
  if (!found) throw new Error(`No create table for "${table}"`);
  const owners = found.columns.filter((column) => /references auth\.users\b/.test(column.definition));
  if (owners.length !== 1) {
    throw new Error(`${table} has ${owners.length} columns referencing auth.users, expected 1`);
  }
  const name = owners[0]?.name;
  if (name === undefined) throw new Error(`Unreadable ownership column on ${table}`);
  return name;
}

const upserts: ParsedUpsert[] = parseUpserts(push.body);
const pushRenders: ParsedRead[] = parseReads(push.body).filter((read) => read.source === 'upserted');
const pullReads: ParsedRead[] = parseReads(pull.body).filter((read) => read.source !== 'upserted');

function upsertFor(table: string): ParsedUpsert {
  const found = upserts.find((candidate) => candidate.table === table);
  if (!found) throw new Error(`push_changes has no upsert on ${table}`);
  return found;
}

/**
 * The one `begin … exception … end` block in `push_changes` (M2q), read as two regions: what it
 * guards, and what it does when that fails.
 *
 * Located by finding the handler and walking BACK to the nearest `begin`, rather than by
 * looking where this file expects the block to be. That is what makes "the block covers the
 * recheck and nothing else" falsifiable: widen it to the function's own `begin` and this
 * returns the whole body, upserts included, which is precisely the mutation the assertion is
 * about. Both throw rather than returning `''`, because an empty region would make every
 * `not.toContain` below pass for the wrong reason.
 */
function guardedBlock(): string {
  const handler = push.body.search(/\bexception\s+when\b/);
  if (handler === -1) throw new Error('push_changes has no exception block to read');
  const opened = push.body.lastIndexOf('begin', handler);
  if (opened === -1) throw new Error('an exception handler with no begin before it');
  return push.body.slice(opened, handler);
}

function exceptionHandler(): string {
  const handler = push.body.search(/\bexception\s+when\b/);
  if (handler === -1) throw new Error('push_changes has no exception block to read');
  const closed = push.body.indexOf('end;', handler);
  if (closed === -1) throw new Error('an exception handler with no end after it');
  return push.body.slice(handler, closed);
}

// ──────────────────────────────────────────────────────────────────────────────────────
// The exceptions — data with a reason each, in both directions, so that adding one costs a
// deliberate edit and leaving a stale one behind fails just as loudly as omitting a real one.
// ──────────────────────────────────────────────────────────────────────────────────────

/** Schema columns `push_changes` deliberately does not let a client write. */
const PUSH_WRITES_NEITHER: Record<string, Record<string, string>> = {
  dive_sites: {
    status:
      '§5 gives the merge queue to the ADMIN, worked in Supabase Studio: "an admin setting ' +
      '`status` to `merged` with `merged_into` pointing at the survivor". A device holding a ' +
      'stale catalogue copy must not undo that by pushing an unrelated edit to the same site, ' +
      "which is exactly what §7's whole-row last-write-wins would otherwise do — §7's LWW is " +
      'about one diver\'s own devices disagreeing, and this column has a third author. A new ' +
      "row still gets 'active' from the column default.",
    merged_into: 'As `status`: the other half of §5\'s admin merge, and meaningless without it.',
  },
  dive_centers: {
    status: 'As dive_sites.status — §5 covers "a site or center" in one sentence.',
    merged_into: 'As dive_sites.merged_into.',
  },
};

/**
 * Payload keys the community tables carry that are not columns of them. §6: SQLite has no
 * point type, so the wire carries the pair and Postgres owns the geometry.
 */
const PAYLOAD_EXTRAS: Record<string, Record<string, string>> = {
  dive_sites: {
    latitude: '§6: the sync payload carries the lat/long pair; `location` is composed here.',
    longitude: '§6: the sync payload carries the lat/long pair; `location` is composed here.',
  },
  dive_centers: {
    latitude: 'As dive_sites.latitude.',
    longitude: 'As dive_sites.longitude.',
  },
};

/**
 * Columns an upsert may set on INSERT and must never touch again. Derived per table rather
 * than listed, because each entry is a rule and not a preference:
 *
 *   · `id`           the conflict key, and §6's client-generated UUIDv7 — nothing may replace it.
 *   · `created_at`   §6: preserved, never regenerated. §2.5 orders same-day dives with neither
 *                    a time nor a hand-set order by it, so a push that moved it would silently
 *                    reorder a diver's day. The first insert fixes it; nothing later may.
 *   · the owner      a row cannot change hands, and RLS's `with check` says the same thing
 *                    from the other side.
 */
function insertOnlyColumns(table: string): string[] {
  return [...new Set(['id', 'created_at', ownershipColumn(table)])].sort();
}

// ──────────────────────────────────────────────────────────────────────────────────────
// A model of the one slice of Postgres `to_char` this file's ISO spelling uses.
// ──────────────────────────────────────────────────────────────────────────────────────

const pad = (value: number, width: number) => String(value).padStart(width, '0');

const TO_CHAR_FIELDS: readonly (readonly [string, (date: Date) => string])[] = [
  // Longest first: `HH24` must not be read as `HH` followed by `24`.
  ['HH24', (date) => pad(date.getUTCHours(), 2)],
  ['YYYY', (date) => pad(date.getUTCFullYear(), 4)],
  ['MM', (date) => pad(date.getUTCMonth() + 1, 2)],
  ['DD', (date) => pad(date.getUTCDate(), 2)],
  ['MI', (date) => pad(date.getUTCMinutes(), 2)],
  ['SS', (date) => pad(date.getUTCSeconds(), 2)],
  ['MS', (date) => pad(date.getUTCMilliseconds(), 3)],
];

/**
 * Renders a `to_char` template the way Postgres would, for the codes this file uses.
 *
 * **It throws on any code it has not been taught**, which is the property that makes it worth
 * having: a template switched to `US` (microseconds), `TZ` or `OF` (a timezone suffix
 * `toISOString()` never writes) fails here by name rather than silently rendering something
 * plausible. Quoted runs are literals, exactly as `to_char` treats them.
 */
export function renderToChar(template: string, date: Date): string {
  let out = '';
  let index = 0;

  while (index < template.length) {
    const rest = template.slice(index);

    if (rest.startsWith('"')) {
      const close = template.indexOf('"', index + 1);
      if (close === -1) throw new Error(`Unterminated literal in to_char template: ${template}`);
      out += template.slice(index + 1, close);
      index = close + 1;
      continue;
    }

    const field = TO_CHAR_FIELDS.find(([code]) => rest.startsWith(code));
    if (field) {
      out += field[1](date);
      index += field[0].length;
      continue;
    }

    const char = rest[0];
    if (char !== undefined && '-:./ '.includes(char)) {
      out += char;
      index += 1;
      continue;
    }

    throw new Error(`to_char template code this model has not been taught: "${rest.slice(0, 6)}"`);
  }

  return out;
}

// (`qualifiedReferences` and `payloadKeys` moved to src/testing/migrationSql.ts in M2c, when
// src/db/catalogueRpcParity.test.ts came to sweep §5's four RPCs the same way. Their mutation
// kills are re-proved there and in the M2c report — a shared extractor that could return `[]`
// would leave two sweeps green instead of one.)

// ──────────────────────────────────────────────────────────────────────────────────────

describe('the RPC reader', () => {
  // Every assertion below is only worth its green if the thing feeding it can be trusted, and
  // a reader that quietly skipped an upsert it could not parse would make "push carries every
  // column" pass by finding no columns at all. These fixtures are what says it does not.

  const FIXTURE = `
    -- a leading comment, with a ; semicolon and an 'apostrophe in it
    create or replace function public.f(a jsonb, b text default 'x')
      returns jsonb language plpgsql security invoker set search_path = ''
    as $$
    declare v_x int;
    begin
      -- a comment inside the body, with a ; and a 'quote
      insert into public.t as t (id, name) select incoming.id, incoming.name from incoming
        on conflict (id) do update set name = excluded.name returning t.*;
      select coalesce(jsonb_agg(public.sync_row(to_jsonb(d))), '[]'::jsonb) into v_rows
        from public.t as d where d.id = v_x;
      return '{}'::jsonb;
    end;
    $$;
    grant execute on function public.f(jsonb, text) to authenticated;
  `;

  it('reads a function whole, and strips comments from inside its body', () => {
    const parsed = parseFunctionSql(FIXTURE);
    expect(parsed.functions.map((f) => f.name)).toEqual(['public.f']);

    const only = parsed.functions[0];
    expect(only?.args).toBe("a jsonb, b text default 'x'");
    expect(only?.attributes).toContain('security invoker');
    // The comment's `;` and `'` did not end the statement or open a string, and the comment
    // itself is gone — a body left with `--` in it and its whitespace collapsed would have
    // swallowed the rest of the function into a comment.
    expect(only?.body).not.toContain('a comment inside the body');
    expect(only?.body).toContain('insert into public.t');
    expect(only?.body).toContain("return '{}'::jsonb;");
  });

  it('throws on a statement it has not been taught rather than skipping it', () => {
    expect(() => parseFunctionSql('create table t (a int);')).toThrow(/has not been taught/);
    expect(() => parseFunctionSql('drop function public.f(jsonb);')).toThrow(/has not been taught/);
  });

  it('throws on an unterminated body rather than returning half a function', () => {
    expect(() =>
      parseFunctionSql('create or replace function public.f() returns int as $$ select 1;'),
    ).toThrow(/Unterminated dollar-quoted body/);
  });

  it('zips an upsert column for value, and throws when the two disagree in length', () => {
    const upsert = parseUpserts(parseFunctionSql(FIXTURE).functions[0]?.body ?? '')[0];
    expect(upsert?.table).toBe('t');
    expect([...(upsert?.inserted.keys() ?? [])]).toEqual(['id', 'name']);
    expect(upsert?.inserted.get('name')).toBe('incoming.name');
    expect([...(upsert?.updated.keys() ?? [])]).toEqual(['name']);

    expect(() =>
      parseUpserts(
        'insert into public.t as t (id, name, extra) select incoming.id, incoming.name from ' +
          'incoming on conflict (id) do update set name = excluded.name returning t.*;',
      ),
    ).toThrow(/lists 3 columns and 2 values/);
  });

  it('throws on an insert shape it has not been taught rather than ignoring it', () => {
    expect(() =>
      parseUpserts('insert into public.t as t (id) select 1 from incoming returning t.*;'),
    ).toThrow(/not in the shape/);
  });

  it('models to_char only for the codes it has been taught, and throws on the rest', () => {
    const instant = new Date(Date.UTC(2026, 8, 2, 9, 5, 3, 40));
    expect(renderToChar('YYYY-MM-DD"T"HH24:MI:SS.MS"Z"', instant)).toBe('2026-09-02T09:05:03.040Z');
    expect(() => renderToChar('YYYY-MM-DD HH24:MI:SSOF', instant)).toThrow(/has not been taught/);
    expect(() => renderToChar('YYYY-MM-DD"T"HH24:MI:SS.US"Z"', instant)).toThrow(/has not been taught/);
  });
});

describe('the sync RPCs and the schema describe the same rows (DESIGN.md §6, §7)', () => {
  it('syncs every table the schema has but the ones deliberately kept out (§7)', () => {
    // The exclusion list is the one place a table can leave §7's protocol without any list in
    // this file changing, so it is checked from both ends: every name on it is a real table,
    // and no name on it is mentioned anywhere in the RPC file at all. Without the second half,
    // a `public.site_edits` read added to `pull_changes` would sync a queue nobody may read.
    const allTables = schema.tables.map((table) => table.name);
    expect(Object.keys(UNSYNCED_TABLES).filter((name) => !allTables.includes(name))).toEqual([]);
    expect(Object.values(UNSYNCED_TABLES).filter((reason) => reason.trim().length < 20)).toEqual([]);
    expect(SCHEMA_TABLES.length).toBe(allTables.length - Object.keys(UNSYNCED_TABLES).length);
    expect(SCHEMA_TABLES.length).toBeGreaterThan(5);

    // **The second half is narrowed by one list and not by a tolerance** (M2q). §5 puts the
    // duplicate recheck at the moment a site is pushed, so `push_changes` writes a table that
    // takes no part in the protocol — "unsynced" and "unmentioned" were one idea and are two
    // now. A table may be named here only if it is on BOTH lists, and what it may then do is
    // asserted in full further down: written, never read back, never in the response.
    expect(Object.keys(SYNC_SIDE_EFFECT_TABLES).filter((name) => !(name in UNSYNCED_TABLES))).toEqual([]);
    expect(
      Object.values(SYNC_SIDE_EFFECT_TABLES).filter((reason) => reason.trim().length < 20),
    ).toEqual([]);

    const unmentioned = Object.keys(UNSYNCED_TABLES).filter(
      (table) => !(table in SYNC_SIDE_EFFECT_TABLES),
    );
    expect(unmentioned.length).toBeGreaterThan(0);
    for (const table of unmentioned) {
      expect(rpc.statements.join(' ')).not.toContain(table);
    }
  });

  it('never names anything that exists only on the device (§6, §7.1)', () => {
    // The mirror of the exclusion above, and the same shape of check: `UNSYNCED_TABLES` is a
    // table the server HAS and the protocol skips, `DEVICE_ONLY_*` is a table or column the
    // server does not have at all — `settings`, `sync_state`, and the dirty flag.
    //
    // Naming one here is not a silent failure but a loud one, and that is precisely why it is
    // worth a check rather than a comment: `push_changes` refuses a key its table has no column
    // for (`sync_reject_unknown_keys`), and §7 pushes in ONE transaction, so a stray `dirty` in
    // a payload takes the diver's entire sync down until the client stops sending it.
    //
    // Read from the comment-stripped statements, so the sentence "do not mark a community row
    // dirty unless you created it" — which is in the push_changes header comment, and is the
    // client obligation this column exists to meet — does not fail its own rule.
    const body = rpc.statements.join(' ');
    expect(Object.keys(DEVICE_ONLY_TABLES).length + Object.keys(DEVICE_ONLY_COLUMNS).length).toBeGreaterThan(2);
    for (const name of [...Object.keys(DEVICE_ONLY_TABLES), ...Object.keys(DEVICE_ONLY_COLUMNS)]) {
      expect(body).not.toContain(name);
    }
    // No device-only table may be a Postgres table either — that would not be "device-only",
    // it would be a table both sides have and one side ignores, which is `UNSYNCED_TABLES`.
    const serverTables = schema.tables.map((table) => table.name);
    expect(Object.keys(DEVICE_ONLY_TABLES).filter((name) => serverTables.includes(name))).toEqual([]);

    // **A positive control, because the sweep above is an absence check and an absence check
    // over an empty haystack passes.** A name that IS in this file is found by the same
    // search, so a reader that returned nothing cannot make the loop green by giving it
    // nothing to look at.
    expect(body).toContain('push_changes');
    expect(body.length).toBeGreaterThan(2000);

    // **What this file cannot check, said out loud** (found by mutation, M43 in the M2d
    // report): whether the names on those lists are the REAL local table and column names. A
    // list whose key is misspelled is absent from this file too, so it passes here. Its
    // reality is proved once, in `src/db/schemaParity.test.ts`, which reads `src/db/schema.ts`
    // — the misspelling turns that file red. One list, verified where the other side is
    // visible, and used here; two copies of the verification would be the drift §4.1 names.
  });

  it('names the same six tables the schema does, in every list that names one', () => {
    // Seven independent lists inside the RPC file, each compared against the schema migration
    // rather than against each other: a table missing from any one of them is a table whose
    // rows never sync, and nothing else in this repository would notice.
    expect(upserts.map((upsert) => upsert.table).sort()).toEqual(SCHEMA_TABLES);
    expect(pullReads.map((read) => read.source).sort()).toEqual(SCHEMA_TABLES);

    for (const body of [push.body, pull.body]) {
      const payloadKeysOut = [...body.matchAll(/jsonb_build_object\('([a-z_]+)', v_rows\)/g)].map(
        (match) => match[1],
      );
      expect(payloadKeysOut.sort()).toEqual(SCHEMA_TABLES);
    }

    // The payload key each table's rows are actually READ from. A `v_changes->'divez'` here
    // pushes nothing at all and still answers `"dives": []`, which is indistinguishable from a
    // device that had nothing to send — so this is checked as a set and as a count.
    const payloadReads = [...push.body.matchAll(/v_changes->'([a-z_]+)'/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
    expect([...new Set(payloadReads)].sort()).toEqual(SCHEMA_TABLES);

    // Twice each: the unknown-key check, and the CTE that reads the rows. **`dive_sites` is
    // read a third time and that is M2q's arrival query** — the one that asks which of these
    // sites the catalogue does not already hold, before the upsert makes the answer "none".
    // Counted per table rather than as one total, so that a third read of some OTHER table
    // cannot hide inside a sum that happens to still add up.
    const readCounts = new Map<string, number>();
    for (const table of payloadReads) readCounts.set(table, (readCounts.get(table) ?? 0) + 1);
    expect(
      [...readCounts.entries()]
        .filter(([, count]) => count !== 2)
        .map(([table, count]) => `${table}: ${count}`),
    ).toEqual(['dive_sites: 3']);

    // The allow-list push refuses an unknown table against, and the per-table key checks.
    const allowList = /keys\.key not in \(([^)]*)\)/.exec(push.body)?.[1];
    expect(allowList).toBeDefined();
    expect(splitTopLevel(allowList ?? '').map((entry) => entry.replace(/'/g, '')).sort()).toEqual(
      SCHEMA_TABLES,
    );
    expect(
      [...push.body.matchAll(/sync_reject_unknown_keys\('([a-z_]+)'/g)].map((m) => m[1]).sort(),
    ).toEqual(SCHEMA_TABLES);
  });

  it.each(SCHEMA_TABLES)('push_changes carries every column of %s', (table) => {
    const inserted = [...upsertFor(table).inserted.keys()].sort();
    const expected = schemaColumns(table)
      .filter((column) => !(column in (PUSH_WRITES_NEITHER[table] ?? {})))
      .sort();

    // Exact, both ways. A schema column missing from the insert list is a field that never
    // syncs — which fails nothing at all and simply loses the diver's data. A column in the
    // insert list that the schema does not have is a runtime error on the one server nobody
    // here can reach.
    expect(inserted).toEqual(expected);
  });

  it.each(SCHEMA_TABLES)('push_changes updates every column of %s that it may (§6)', (table) => {
    const upsert = upsertFor(table);
    const expected = [...upsert.inserted.keys()]
      .filter((column) => !insertOnlyColumns(table).includes(column))
      .sort();

    // A column that arrives on create and is never updated again is the same silent loss as
    // one that never arrives — it just takes a second edit to show up.
    expect([...upsert.updated.keys()].sort()).toEqual(expected);
  });

  it('names no column, anywhere in either RPC, that the schema does not have', () => {
    const unknown: string[] = [];
    let checked = 0;
    const check = (where: string, table: string, columns: readonly string[]) => {
      const known = new Set([...schemaColumns(table), ...Object.keys(PAYLOAD_EXTRAS[table] ?? {})]);
      for (const column of columns) {
        checked += 1;
        if (!known.has(column)) unknown.push(`${where}: ${column}`);
      }
    };

    for (const upsert of upserts) {
      for (const [column, value] of upsert.inserted) {
        check(`insert ${upsert.table}`, upsert.table, [column]);
        check(
          `insert ${upsert.table}.${column}`,
          upsert.table,
          qualifiedReferences(value, 'incoming').filter((name) => name !== 'payload'),
        );
        // `payload->>'max_depth'` for `max_depth_m` inserts a null and raises nothing.
        check(`payload ${upsert.table}.${column}`, upsert.table, payloadKeys(value));
      }
      for (const [column, value] of upsert.updated) {
        check(`update ${upsert.table}`, upsert.table, [column]);
        check(`update ${upsert.table}.${column}`, upsert.table, qualifiedReferences(value, 'excluded'));
      }
    }

    for (const read of pullReads) {
      check(`pull ${read.source}`, read.source, [
        ...qualifiedReferences(read.render, read.alias),
        ...qualifiedReferences(read.where, read.alias),
      ]);
    }
    expect(pushRenders.length).toBe(upserts.length);
    pushRenders.forEach((render, index) => {
      const table = upserts[index]?.table;
      if (table === undefined) throw new Error('push render with no matching upsert');
      check(`push render ${table}`, table, qualifiedReferences(render.render, render.alias));
    });

    expect(unknown).toEqual([]);
    // A sweep that finds nothing to sweep passes for the wrong reason — this project's
    // most-repeated defect. Both extractors returning `[]` would leave `unknown` empty and
    // this test green; the floor is what says they did not. Roughly 300 references are read
    // today, so 250 is a floor rather than a restatement of the count.
    expect(checked).toBeGreaterThan(250);
  });

  it('reads a whole row rather than a column list, so a new column cannot go missing', () => {
    // `to_jsonb(row)` is what makes the OUTPUT side of both RPCs immune to the drift the
    // input side needs a test for: a column added to a table in a later migration is carried
    // by every payload with no edit at all. Asserted rather than trusted, because a later
    // "let's only send what we need" is exactly the change that would undo it silently.
    //
    // WHICH renderer is load-bearing too, and derived rather than listed: a community table
    // rendered by `sync_row` would ship `location` as PostGIS' own WKB hex and no
    // latitude/longitude at all — a catalogue that reaches the device with every pin missing,
    // raising nothing.
    const rendered = [
      ...pullReads.map((read) => [read, read.source] as const),
      ...pushRenders.map((read, index) => {
        const table = upserts[index]?.table;
        if (table === undefined) throw new Error('push render with no matching upsert');
        return [read, table] as const;
      }),
    ];
    for (const [read, table] of rendered) {
      const renderer = ownershipColumn(table) === 'created_by' ? 'sync_site' : 'sync_row';
      expect(read.render).toMatch(
        new RegExp(`^public\\.${renderer}\\(to_jsonb\\(${read.alias}\\)`),
      );
    }
    expect(rendered.length).toBe(SCHEMA_TABLES.length * 2);
    expect(rendered.filter(([, table]) => ownershipColumn(table) === 'created_by').length).toBe(4);
  });

  it('every exception names a reason, so neither list can rot into a tolerance', () => {
    const reasons = [
      ...Object.values(PUSH_WRITES_NEITHER).flatMap((columns) => Object.values(columns)),
      ...Object.values(PAYLOAD_EXTRAS).flatMap((columns) => Object.values(columns)),
    ];
    expect(reasons.length).toBe(8);
    expect(reasons.filter((reason) => reason.trim().length < 20)).toEqual([]);
  });
});

describe('the guarantees that fail without an error (DESIGN.md §6, §7)', () => {
  it('returns timestamps in the client\'s own toISOString() spelling (§7)', () => {
    // §7: "the client upserts by comparing updated_at", and that is a STRING comparison on a
    // SQLite text column. Postgres' own rendering — `2026-09-02 09:00:00+00` — sorts
    // differently from `2026-09-02T09:00:00.000Z`, and the failure is not an error: it is the
    // wrong device winning a conflict, on rows nobody is watching.
    //
    // The template comes out of the SQL; what it is checked against comes out of the client's
    // own `toISOString()`. Neither side is typed here.
    const template = /to_char\(ts at time zone 'UTC', '(.+)'\)/.exec(isoZ.body)?.[1];
    expect(template).toBeDefined();

    const instants = [
      new Date(Date.UTC(2026, 8, 2, 9, 0, 0, 0)),
      new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 7)),
      new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999)),
      new Date(Date.UTC(2027, 5, 5, 5, 5, 5, 40)),
      new Date(Date.UTC(1999, 9, 9, 19, 19, 19, 100)),
    ];
    expect(instants.length).toBeGreaterThan(4);
    for (const instant of instants) {
      expect(renderToChar(template ?? '', instant)).toBe(instant.toISOString());
    }

    // And every row on the wire goes through it, for all three sync columns.
    expect(payloadKeys(syncRow.body).sort()).toEqual(['created_at', 'deleted_at', 'updated_at']);
    expect([...syncRow.body.matchAll(/public\.iso_z\(/g)].length).toBe(3);
    // `sync_site` re-uses it rather than rendering a second way.
    expect(syncSite.body).toContain('public.sync_row(row_json)');
  });

  it('preserves created_at across a push and never regenerates it (§2.5, §6)', () => {
    for (const upsert of upserts) {
      // The payload's value stands, and only a row that sent none gets the server clock.
      expect(upsert.inserted.get('created_at')).toMatch(/^coalesce\(.*created_at.*, v_now\)$/);
      // And no push may ever move it again. An upsert with `created_at` in its `do update
      // set` is precisely the defect: it silently reorders a diver's day (§2.5) on the next
      // sync of a dive they edited.
      expect(upsert.updated.has('created_at')).toBe(false);
    }
    expect(upserts.length).toBe(SCHEMA_TABLES.length);
  });

  it('lets no client-supplied updated_at survive a push (§6, §7)', () => {
    expect(push.body).toMatch(/v_now timestamptz := now\(\)/);
    for (const upsert of upserts) {
      expect(upsert.inserted.get('updated_at')).toBe('v_now');
      expect(upsert.updated.get('updated_at')).toBe('v_now');
    }
    // The payload's own value is not read anywhere — not as a record field, not as a key.
    expect(push.body).not.toContain('incoming.updated_at');
    expect(push.body).not.toContain("->>'updated_at'");
    expect(upserts.length).toBe(SCHEMA_TABLES.length);
  });

  it('takes the owner from auth.uid() and never from the payload (§5, §7.4)', () => {
    // This is also the whole of §7.4's guest→account migration: the payload's owner is never
    // read, so "local rows get the new user_id and push" needs no case in push_changes at all.
    expect(push.body).toMatch(/v_uid uuid := \(select auth\.uid\(\)\)/);
    for (const upsert of upserts) {
      const owner = ownershipColumn(upsert.table);
      expect(upsert.inserted.get(owner)).toBe('v_uid');
      expect(upsert.updated.has(owner)).toBe(false);
    }
    // And neither RPC will do anything at all for a caller with no account.
    for (const body of [push.body, pull.body]) {
      expect(body).toMatch(/if v_uid is null then raise exception/);
    }
  });

  it('keeps ids the client\'s UUIDv7, so an offline row needs no re-mapping (§6)', () => {
    expect(rpc.statements.join(' ')).not.toMatch(/gen_random_uuid|uuid_generate/i);
    for (const upsert of upserts) {
      const expected = ownershipColumn(upsert.table) === 'id' ? 'v_uid' : /incoming\./;
      expect(upsert.inserted.get('id')).toEqual(
        expected instanceof RegExp ? expect.stringMatching(expected) : expected,
      );
      expect(upsert.updated.has('id')).toBe(false);
    }
  });

  it('sends tombstoned rows back rather than leaving them out (§6, §7)', () => {
    // A `deleted_at` row is something the other device has to be TOLD about. A `where
    // deleted_at is null` here looks exactly like "there was nothing to send", and a delete
    // on one device would never reach the other.
    for (const read of pullReads) {
      expect(read.where).not.toMatch(/deleted_at/);
      // §5's merge is delivered the same way: a `merged` or `hidden` site is a row the client
      // has to act on, so nothing filters on status either.
      expect(read.where).not.toMatch(/status/);
    }
    for (const upsert of upserts) {
      expect(upsert.inserted.has('deleted_at')).toBe(true);
      expect(upsert.updated.has('deleted_at')).toBe(true);
    }
    expect(pullReads.length).toBe(SCHEMA_TABLES.length);
  });

  it('hands back a watermark from the server clock, and an early one (§7.3)', () => {
    // §7.3: last_pulled_at comes from the server's response, never the phone's clock. And
    // `now()` is TRANSACTION START, so a push that began before this pull and commits after it
    // is invisible here while carrying an earlier stamp — returning `now()` would step the
    // watermark past rows that were never delivered, permanently. The overlap is what makes
    // that a re-read instead of a loss.
    expect(pull.body).toMatch(/v_now timestamptz := now\(\)/);
    expect(pull.body).toMatch(/v_overlap constant interval := interval '\d+ minutes?'/);
    expect(pull.body).toContain("'last_pulled_at', public.iso_z(v_now - v_overlap)");
    expect(pull.body).toContain("'server_time', public.iso_z(v_now)");

    // Every table is filtered by that watermark, and a first pull (no watermark) gets it all.
    for (const read of pullReads) {
      expect(read.where).toContain(
        `last_pulled_at is null or ${read.alias}.updated_at > last_pulled_at`,
      );
    }

    // push_changes returns no watermark. A client that stored one from a push would skip
    // everything ELSE that changed in the same window.
    expect(push.body).not.toContain("'last_pulled_at'");
  });

  it('reads a private table by its owner and the community tables by nobody (§5)', () => {
    for (const read of pullReads) {
      const owner = ownershipColumn(read.source);
      const isCommunity = owner === 'created_by';
      if (isCommunity) {
        expect(read.where).not.toContain('v_uid');
      } else {
        expect(read.where).toContain(`${read.alias}.${owner} = v_uid`);
      }
    }
    // Two community tables, four private ones — stated so this cannot pass by finding none.
    expect(pullReads.filter((read) => ownershipColumn(read.source) === 'created_by').length).toBe(2);
  });

  it('puts longitude on X and latitude on Y, in both directions (§6)', () => {
    // The classic silent PostGIS bug: every site quietly lands in the wrong hemisphere and
    // nothing raises. Asserted where the point is built and where it is taken apart again.
    const makePoints = [...push.body.matchAll(/st_makepoint\(/g)].map((match) => {
      const open = match.index + match[0].length - 1;
      return push.body.slice(open + 1, matchParen(push.body, open));
    });
    expect(makePoints.length).toBe(2);
    for (const args of makePoints) {
      const [x, y] = splitTopLevel(args);
      expect(x).toContain('longitude');
      expect(y).toContain('latitude');
    }
    expect(syncSite.body).toMatch(/'latitude', extensions\.st_y\(/);
    expect(syncSite.body).toMatch(/'longitude', extensions\.st_x\(/);
    // And a site with no pin must still reach the client: a STRICT function would return null
    // for the whole row instead of a row with two null coordinates.
    expect(syncSite.attributes).not.toMatch(/\bstrict\b/);
  });

  it('pushes in one transaction, with nothing that could swallow a row (§7)', () => {
    // §7 has no repair for a partial push — the client clears its dirty flags on the strength
    // of the response. A function body runs inside its caller's transaction, so this is free
    // PROVIDED no subtransaction can swallow the failure of a row the client is about to be
    // told was stored: `begin ... exception when others then ...` rolls back its own block,
    // carries on, and returns a success the client would believe.
    //
    // **This used to ban the `exception` keyword outright and now bans it around a row** (M2q).
    // §5's duplicate recheck is the one thing in here whose failure must NOT reach the caller
    // — it writes a flag the response never mentions, and letting it escape would cost a diver
    // their whole sync for a suspicion. So the block exists, once, and the assertions are that
    // it covers that statement and nothing else. A ban that could not be met would have been
    // met by deleting the guarantee instead, which is the worse of the two failures.
    expect(push.body).not.toMatch(/\b(commit|rollback|savepoint)\b/);
    expect([...push.body.matchAll(/\bexception\s+when\b/g)].length).toBe(1);

    const guarded = guardedBlock();
    expect(guarded).toContain('site_duplicate_suspicions');
    // One write inside the block, and it is not to any table §7 carries. Reading `dive_sites`
    // in there is the recheck's own business; writing one would be a row the response has
    // already promised. (`toEqual` on the write list rather than a `toContain`, so a second
    // insert smuggled in beside the first fails here.)
    expect(
      [...guarded.matchAll(/\b(?:insert into|update) (public\.[a-z_]+)/g)].map((match) => match[1]),
    ).toEqual(['public.site_duplicate_suspicions']);
    expect(guarded).not.toMatch(/\bdelete\b/);

    // `raise exception` is the opposite of that and must still be there.
    expect([...push.body.matchAll(/raise exception/g)].length).toBeGreaterThanOrEqual(2);
  });
});

describe("§5's second look at a site created offline (M2q)", () => {
  /**
   * §5: "When a site created offline is pushed, the server reruns the fuzzy check and flags
   * likely duplicates for a one-tap merge by the creator — admin merge is the backstop."
   *
   * Every assertion here fails in silence on the one server nobody in this repository can
   * reach. A recheck keyed on the wrong moment writes nothing and raises nothing; a conflict
   * clause that updates instead of doing nothing un-dismisses a suspicion the diver has
   * already answered, and does it on rows nobody is watching; a second copy of the similarity
   * rule gives a different answer from `search_sites` in the one direction — a duplicate not
   * flagged — that produces no error and no wrong row.
   */
  const SUSPICIONS = 'site_duplicate_suspicions';
  const statements = statementsOf(push.body);
  const naming = statements.filter((statement) => statement.includes(SUSPICIONS));

  /**
   * File 7's `create table`, read through the same parser everything else here is read
   * through rather than as raw file text — so an assertion about what the table says cannot be
   * satisfied by a sentence in a comment about what it says.
   */
  const createTable = (): string => {
    const found = schema.statements.find((statement) =>
      statement.startsWith(`create table if not exists public.${SUSPICIONS} (`),
    );
    if (found === undefined) throw new Error(`No create table for ${SUSPICIONS}`);
    return found;
  };

  it('records a suspicion in the one place there is to record one (§5)', () => {
    // The whole of what M2p found missing: the check existed and had nowhere to put its
    // answer. `site_duplicate_suspicions` is that place, and the columns are read from the
    // schema rather than restated — a name that is not a column of it inserts nothing and
    // raises on the server, which is the worst place to find out.
    expect(naming.length).toBe(1);
    const columns = /insert into public\.site_duplicate_suspicions \(([^)]*)\)/.exec(push.body)?.[1];
    expect(columns).toBeDefined();
    const inserted = splitTopLevel(columns ?? '');
    expect(inserted.length).toBeGreaterThan(3);
    expect(inserted.filter((column) => !schemaColumns(SUSPICIONS).includes(column))).toEqual([]);

    // And the ONE column it leaves alone is `status`, whose default is the whole vocabulary's
    // single owner. A push that wrote `'open'` here would be the word in two places, and the
    // second place would be the one that later wrote `'suspected'`.
    expect(schemaColumns(SUSPICIONS).filter((column) => !inserted.includes(column))).toEqual([
      'status',
    ]);
    expect(naming[0]).not.toContain('status');
  });

  it('runs when a site ARRIVES, and asks before the upsert makes that unanswerable', () => {
    // The trigger §5 names is a site created offline being *pushed*, not a dive edited near
    // one and not an edit to the site itself. The only moment "is this new to the catalogue"
    // can be answered is before the insert answers "no" for everything — so the order of these
    // two statements is the feature, and getting it wrong is a recheck that runs on nothing,
    // for ever, with a green suite and no error anywhere.
    const arriving = statements.findIndex((statement) => /into v_arriving\b/.test(statement));
    const inserted = statements.findIndex((statement) =>
      /insert into public\.dive_sites\b/.test(statement),
    );
    const recheck = statements.findIndex((statement) => statement.includes(SUSPICIONS));
    expect(arriving).toBeGreaterThan(-1);
    expect(inserted).toBeGreaterThan(-1);
    expect(arriving).toBeLessThan(inserted);
    expect(recheck).toBeGreaterThan(inserted);

    // What "arriving" means, in the SQL: a pushed id this server does not already hold. Not
    // "dirty", which is the device's own bookkeeping and would re-flag a retried push; not
    // every pushed row, which would re-flag a site every time its creator corrected its pin.
    expect(statements[arriving]).toContain('not exists');
    expect(statements[arriving]).toContain('from public.dive_sites as held');
    // The subquery's alias, which is not decoration: Postgres refuses a FROM subquery without
    // one. It is asserted here because it is the one thing in this statement the scratchpad
    // grammar check CANNOT see — libpg_query parses `from ( … ) where` happily and the refusal
    // comes at parse analysis, on the server (mutation-found, M2q).
    expect(statements[arriving]).toContain(') as pushed');
    expect(push.body).toContain("v_changes->'dive_sites'");
    expect(naming[0]).toContain('= any (v_arriving)');

    // A tombstoned arrival is not flagged — it is a site created and deleted before it ever
    // synced — and a name that folds to nothing is not asked about at all, because
    // `similar_sites` RAISES on one and would take every other arriving site's flags with it.
    expect(push.body).toContain('s.deleted_at is null');
    expect(push.body).toContain("nullif(public.name_fold(s.name), '') is not null");
  });

  it('asks similar_sites what a duplicate is, and answers nothing itself (§4.1)', () => {
    // §5 asks for this check twice in a site's life and file 6 makes it one function, so that
    // autocomplete cannot offer a site the dedupe check would refuse to warn about. A
    // `similarity(…) >= 0.3` written here would be that rule's second implementation, free to
    // drift in the direction nobody can observe — and `p_exclude_id` is why that function has
    // taken the argument since its first version: by the time this runs the site is in the
    // catalogue and is its own best match.
    expect(naming[0]).toContain('public.similar_sites(');
    expect(push.body).toContain('p_exclude_id => arrived.id');
    expect(push.body).toContain('p_name => arrived.name');
    // Filtered rather than asserted one `not.toContain` at a time, so the failure names which
    // rule was re-implemented — and so the haystack is the body rather than a message with the
    // needle already in it, which is a `not.toContain` that can never fail (found by this test
    // failing on its own first draft).
    expect(
      ['similarity(', 'name_match_floor', 'gin_trgm', 'unaccent', 'operator('].filter((rule) =>
        push.body.includes(rule),
      ),
    ).toEqual([]);
    // The fold it does call is the owner (file 6), used as the "would this raise" test and not
    // as a matcher, so there is still exactly one definition of how a name is read.
    expect([...push.body.matchAll(/public\.name_fold\(/g)].length).toBe(1);

    // Neither the radius nor the cap is restated here. Both are numbers file 6 owns and clamps
    // (M2p made the same call from the client end); a copy in this file is a second place for
    // them to drift from, and the argument list is the only place either would appear.
    expect(push.body).not.toContain('p_radius_m');
    expect(push.body).not.toContain('p_limit');

    // The pin travels with the question, so §5's "two Blue Holes 3 000 km apart are two blue
    // holes" separator has something to work with — and longitude/latitude go to the arguments
    // that carry those names, which is the one place this file's classic silent bug could hide
    // a second time.
    expect(push.body).toMatch(/p_latitude => extensions\.st_y\(/);
    expect(push.body).toMatch(/p_longitude => extensions\.st_x\(/);
  });

  it('never turns a dismissal back into a suspicion (§5, §10)', () => {
    // **The M1i defect, one feature along.** Three states — never suspected, suspected, looked
    // at and dismissed — and the third only survives if a rerun leaves an existing row alone.
    // `do update set status = 'open'` here is a memory that cannot hold a "no", which is
    // exactly what M1h's set-of-open-groups was and what §10 records the cost of.
    expect(naming[0]).toContain('on conflict (site_id, candidate_id) do nothing');
    expect(naming[0]).not.toContain('do update');

    // The pair is the conflict target because the pair is the primary key — read from the
    // schema, so a table re-keyed on a surrogate id (which would let the same pair exist
    // twice, dismissed and open at once, and would make `do nothing` infer nothing) fails
    // here rather than at 3 a.m. on the server.
    expect(createTable()).toContain('primary key (site_id, candidate_id)');
  });

  it('cannot cost a diver their sync, and says so where the owner can see it (§1, §7)', () => {
    // §7's push is how a device empties its dirty flags and §1 puts that above everything in
    // this file. A suspicion is the least important thing here: the site is stored either way,
    // §2.3's "a near-match is a suggestion and never a refusal" is the same rule one layer up,
    // and §5 names the backstop for a flag that never got written ("admin merge").
    const handler = exceptionHandler();
    expect(handler).toContain('raise warning');
    expect(handler).not.toContain('raise exception');
    expect(handler).not.toContain('return');
    // A WARNING reaches the project's log and never the client — the right audience for "the
    // flag you cannot see was not written". Silence here would be the same defect the M2p
    // report's blanket `try` was: a check that cannot be observed to have stopped working.
  });

  it('takes no part in §7\'s protocol, though §7\'s own RPC writes it', () => {
    // The narrowed half of the unsynced-table guard, stated in full. This table is written by
    // `push_changes` and is not part of the conversation: it is not in the allow-list of
    // tables a payload may name, it is never read back, it is not a key of the response, and
    // `pull_changes` does not know it exists. A device that received these rows could do
    // nothing with them — a merge writes community columns no client may push.
    expect(Object.keys(SYNC_SIDE_EFFECT_TABLES)).toEqual([SUSPICIONS]);
    expect(SCHEMA_TABLES).not.toContain(SUSPICIONS);
    expect(pull.body).not.toContain(SUSPICIONS);
    expect(push.body).not.toContain(`v_changes->'${SUSPICIONS}'`);
    expect(push.body).not.toContain(`jsonb_build_object('${SUSPICIONS}'`);
    expect(push.body).not.toContain(`sync_reject_unknown_keys('${SUSPICIONS}'`);
    expect(naming[0]).not.toContain(`from public.${SUSPICIONS}`);
    expect(parseReads(push.body).map((read) => read.source)).not.toContain(SUSPICIONS);

    // And it leaves `dive_sites` alone. A server-side write that advanced `updated_at` on the
    // row the client has just pushed is a change that client pulls straight back on the next
    // cycle (§7.2), on every site anybody ever creates — so the recheck reads that table and
    // writes only its own.
    expect(naming[0]).toMatch(/from public\.dive_sites as s\b/);
    expect(naming[0]).not.toMatch(/\bupdate public\.dive_sites\b/);
    expect([...push.body.matchAll(/\bupdate public\./g)]).toEqual([]);
  });

  it('is written into a table the schema really has, with the shape §5 needs (§6)', () => {
    // Everything above is about `push_changes`, and none of it would notice the table being
    // dropped, re-keyed, or given a `deleted_at` that put it back into §7's protocol.
    const table = createTable();
    expect(schemaColumns(SUSPICIONS).sort()).toEqual([
      'candidate_id',
      'created_at',
      'site_id',
      'status',
      'updated_at',
    ]);
    // Both halves of the pair point at a real site, and neither may take one with it: §5's
    // "rows are never hard-deleted", enforced here by an FK with no `on delete` action —
    // `site_edits.site_id` makes the same choice one table over.
    expect([...table.matchAll(/references public\.dive_sites \(id\)/g)].length).toBe(2);
    expect(table).not.toContain('on delete');
    // The three states live in `status`, which has a default and no CHECK (§10), so a build
    // that does not know a value stores it rather than refusing it.
    expect(table).toContain("status text not null default 'open'");

    // RLS, and the same three moves file 3 makes on every table.
    expect(schema.statements).toContain(`alter table public.${SUSPICIONS} enable row level security`);
    expect(schema.statements).toContain(
      `revoke all on table public.${SUSPICIONS} from anon, authenticated`,
    );
    expect(schema.statements.filter((statement) => /^grant\b/i.test(statement) && statement.includes(SUSPICIONS))).toEqual([
      `grant select, insert on table public.${SUSPICIONS} to authenticated`,
    ]);

    // Read by the creator of the site that arrived, and by nobody else: §5 gives the one-tap
    // merge to "the creator", and the creator of the CANDIDATE is not told that somebody
    // else's row may be a copy of theirs — `site_edits` keeps a suggestion away from a site's
    // creator on the same reasoning (§9 defers moderation surfaces as a class). A policy
    // loosened to `using (true)` would show every diver every suspicion and fail nothing else.
    const policies = schema.statements.filter(
      (statement) => /^create policy\b/i.test(statement) && statement.includes(SUSPICIONS),
    );
    expect(policies.length).toBe(2);
    expect(policies.filter((statement) => /\busing \(true\)/.test(statement))).toEqual([]);
    expect(
      policies.filter((statement) => !statement.includes('s.created_by = (select auth.uid())')),
    ).toEqual([]);
    // No UPDATE and no DELETE for a client: resolving a suspicion means writing community
    // columns file 4 refuses on push, so both halves belong to the merge task's own RPC.
    expect(policies.filter((statement) => /\bfor (update|delete)\b/i.test(statement))).toEqual([]);
  });
});

describe('who may call these, and as whom (DESIGN.md §5)', () => {
  it('runs as the caller, so RLS is what validates ownership (§7)', () => {
    for (const declared of rpc.functions) {
      expect(declared.attributes).toContain('security invoker');
      expect(declared.attributes).not.toContain('security definer');
      // Supabase's own linter calls a mutable search_path on a function a defect, and with an
      // empty one there is no schema left for a shadowing function to be planted in.
      expect(declared.attributes).toContain("set search_path = ''");
    }
    expect(rpc.functions.length).toBeGreaterThan(4);
  });

  it('revokes execute from PUBLIC and grants it to authenticated alone (§5)', () => {
    // A new function is executable by PUBLIC, which includes `anon` — the role the publishable
    // key inside a downloadable app authenticates as. File 3 revokes `anon` on every table and
    // names it in no policy; leaving EXECUTE open here would be that decision undone one level
    // down. The signature is derived from the declaration, so a renamed argument type cannot
    // leave a grant pointing at a function that no longer exists.
    const statements = rpc.statements.map((statement) => statement.toLowerCase());

    for (const declared of rpc.functions) {
      const types = splitTopLevel(declared.args)
        .map((arg) => arg.replace(/\s+default\s+.*$/i, '').trim().split(/\s+/).slice(1).join(' '))
        .join(', ');
      const signature = `${declared.name}(${types})`;
      expect(statements).toContain(`revoke all on function ${signature} from public`);
      expect(statements).toContain(`grant execute on function ${signature} to authenticated`);
    }

    const grants = statements.filter((statement) => statement.startsWith('grant '));
    expect(grants.length).toBe(rpc.functions.length);
    expect(grants.filter((statement) => /\banon\b/.test(statement))).toEqual([]);
  });
});
