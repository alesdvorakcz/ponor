import fs from 'node:fs';
import path from 'node:path';

/**
 * How `supabase/migrations/` is read, for the two checks that read it.
 *
 * `src/db/schemaParity.test.ts` (M2a) ties the Postgres schema to `src/db/schema.ts`;
 * `src/db/syncRpcParity.test.ts` (M2b) ties §7's two sync RPCs to that same schema. Both need
 * to turn migration text into statements, and the second needs to reach inside a function
 * body as well. Two readers would be §4.1's defining defect installed in the one place this
 * project has explicitly built to distrust it — and the copy that got it wrong would be the
 * one nobody mutated. `src/testing/` is where §4.1 puts a guard shared by more than one test.
 *
 * ── The discipline, which is the whole reason these readers are hand-written ──────────────
 *
 * **Everything here throws on input it has not been taught.** A reader that skims for what it
 * recognises and shrugs at the rest fails in the one direction that matters here: a column,
 * a statement or an upsert it cannot read is one it silently reports as *absent*, and
 * "absent from both sides" is what a parity check calls agreement. So an unknown statement
 * head, an unreadable column, a block comment, an insert whose shape has changed — each is an
 * exception that turns the suite red and demands to be taught. That is the correct direction
 * for a check whose entire job is to notice that something changed.
 *
 * **What none of it proves is that the SQL runs.** No Postgres executes here; the migrations
 * have never been applied by anyone, by design (the credentials that could apply them must
 * not exist in this public repository). These readers check what the SQL *says*.
 */

// ──────────────────────────────────────────────────────────────────────────────────────
// One fact about the schema that both parity checks need
// ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Tables that exist on this server and take **no part in §7's sync**, with the reason each.
 *
 * It lives here rather than in either test because both need it and they would disagree:
 * `schemaParity` scopes §6's "all synced tables carry `created_at`, `updated_at` and
 * `deleted_at`" by it, and `syncRpcParity` scopes "`push_changes` carries every column of
 * every table" by it. Written twice, a table could be unsynced in one file and synced in the
 * other, and the check that mattered would be the one nobody edited (§4.1).
 *
 * Both readers assert that every key here is a real table in the migrations, so a stale entry
 * fails as loudly as a missing one — an exception list you have to edit deliberately.
 */
export const UNSYNCED_TABLES: Record<string, string> = {
  site_edits:
    "§5's review queue (M2c). A suggestion is made online by an RPC call, about a row the " +
    'device already has, and is read by an admin in Studio — so it is never pushed, never ' +
    'pulled, and has no SQLite counterpart. That is also why it carries no `deleted_at`: §6 ' +
    'gives the tombstone column to synced tables, and here `status` already says whether a ' +
    'suggestion is open, applied or rejected.',
};

/**
 * The other direction: what exists **only on the device** and must therefore never be named by
 * §7's RPCs, with the reason each. `UNSYNCED_TABLES` above is a table Postgres has that the
 * protocol skips; these are things Postgres does not have at all.
 *
 * Shared between the two parity checks for the same reason that list is: `schemaParity`
 * classifies them as local-only against `src/db/schema.ts`, and `syncRpcParity` asserts that
 * no RPC mentions them. Written twice, a column could be local in one file and on the wire in
 * the other, and the check that mattered would be the one nobody edited (§4.1). Both ends are
 * verified — every name here must really be absent from the Postgres schema, and really
 * present on the device.
 */
export const DEVICE_ONLY_TABLES: Record<string, string> = {
  settings:
    '§6, "Local only": units, locale, hidden groups and the dives_before offset. The one ' +
    'value that does travel — dives_before — syncs into profiles.dives_before, so the ' +
    'table itself has no server counterpart.',
  sync_state:
    '§6, "Local only", and M2d built it: where §7.3\'s pull watermark lives. It is the ' +
    "SERVER's timestamp kept on the device, so a copy of it on the server would be the " +
    'server storing what it already knows, per device, for no reader.',
};

/**
 * Columns that exist only on the device. One so far: §7.1's dirty flag.
 *
 * It is on every table §7 pushes and on no table in Postgres, and it must stay that way in
 * both directions. A `dirty` column on the server would be one device's bookkeeping visible
 * to another; a `dirty` key in a push payload is refused outright by
 * `sync_reject_unknown_keys`, which would take the diver's whole sync down.
 */
export const DEVICE_ONLY_COLUMNS: Record<string, string> = {
  dirty:
    "§7.1: \"rows flagged dirty go up … the client clears its flags\". Which rows this " +
    'device still owes the server is a fact about this device alone, and the server neither ' +
    'has the column nor would accept the key.',
};

// ──────────────────────────────────────────────────────────────────────────────────────
// Statements
// ──────────────────────────────────────────────────────────────────────────────────────

export interface ParsedColumn {
  readonly name: string;
  readonly notNull: boolean;
  /** Everything after the column name, lowercased — what the type/default assertions read. */
  readonly definition: string;
}

export interface ParsedTable {
  readonly name: string;
  readonly columns: readonly ParsedColumn[];
}

export interface ParsedSql {
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
  // Two heads are ignored here **so that the assertions in schemaParity.test.ts can be the
  // thing that rejects them**, rather than the parser throwing first. A guarantee whose
  // violation never reaches its own assertion is an assertion that can never fail — this
  // project's most-repeated defect, and it was in that file until it was mutation-tested. A
  // trigger and an enum type both parse cleanly now and are refused by name.
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
 * the sync RPCs arrive as both contain characters that a naive split would cut a statement
 * in half on.
 */
export function splitStatements(sql: string): string[] {
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
// Files
// ──────────────────────────────────────────────────────────────────────────────────────

export const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');

export function migrationFiles(): string[] {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  if (files.length === 0) throw new Error(`No .sql files in ${MIGRATIONS_DIR}`);
  return files;
}

/** Every migration, parsed and concatenated in the order the owner applies them. */
export function readMigrations(): ParsedSql {
  const tables: ParsedTable[] = [];
  const statements: string[] = [];
  for (const file of migrationFiles()) {
    const parsed = parseMigrationSql(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    tables.push(...parsed.tables);
    statements.push(...parsed.statements);
  }
  return { tables, statements };
}

export function readMigrationFile(name: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
}

// ──────────────────────────────────────────────────────────────────────────────────────
// Function bodies — what §7's two RPCs actually are
// ──────────────────────────────────────────────────────────────────────────────────────
//
// `splitStatements` above deliberately copies a `$$ … $$` body through **whole**, comments
// and all, and then collapses its whitespace. That is right for the schema check, which only
// ever reads statement heads — and useless here, because a collapsed body turns every `--`
// comment inside it into a swallow-the-rest-of-the-line hazard. So the function reader below
// scans with the same rules and strips comments *inside* bodies too.

export interface ParsedFunction {
  /** `public.push_changes`. */
  readonly name: string;
  /** The declared argument list, whitespace-collapsed and lowercased. */
  readonly args: string;
  /** Everything between the argument list and the opening `$$`, lowercased and collapsed. */
  readonly attributes: string;
  /** The body, comments stripped, whitespace collapsed. */
  readonly body: string;
}

/**
 * Strips `--` comments everywhere — including inside a `$$ … $$` body, which is what makes
 * this different from `splitStatements` — and splits on `;` outside strings and bodies.
 *
 * Assumes ordinary `'…'` literals with `''` doubling. `E'…'` backslash escapes are not
 * taught, and neither are nested dollar-quote tags; both throw rather than being guessed at.
 */
function splitStatementsStrippingBodyComments(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let index = 0;
  let dollarTag: string | null = null;

  while (index < sql.length) {
    const rest = sql.slice(index);
    const char = sql[index];

    if (char === "'") {
      // Copy the literal through, honouring '' as an escaped quote.
      let end = index + 1;
      for (;;) {
        const close = sql.indexOf("'", end);
        if (close === -1) throw new Error('Unterminated string literal');
        if (sql[close + 1] === "'") {
          end = close + 2;
          continue;
        }
        end = close + 1;
        break;
      }
      current += sql.slice(index, end);
      index = end;
      continue;
    }

    if (/^[eE]'/.test(rest)) throw new Error('E\'\' string literals are not taught to this reader');

    const dollar = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      if (dollarTag === null) {
        dollarTag = tag;
      } else if (dollarTag === tag) {
        dollarTag = null;
      } else {
        throw new Error(`Nested dollar-quote tag ${tag} is not taught to this reader`);
      }
      current += tag;
      index += tag.length;
      continue;
    }

    if (rest.startsWith('--')) {
      const newline = sql.indexOf('\n', index);
      index = newline === -1 ? sql.length : newline;
      // Keep a space so `end -- note\n$$` does not become `end$$`.
      current += ' ';
      continue;
    }

    if (rest.startsWith('/*')) throw new Error('Block comments are not taught to this reader');

    if (char === ';' && dollarTag === null) {
      statements.push(current);
      current = '';
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  if (dollarTag !== null) throw new Error(`Unterminated dollar-quoted body opened with ${dollarTag}`);
  if (current.trim() !== '') throw new Error(`Trailing SQL with no terminating ";": ${current.trim()}`);

  return statements.map((statement) => statement.replace(/\s+/g, ' ').trim()).filter((s) => s !== '');
}

/** Index of the paren matching the `(` at `open`, ignoring parens inside `'…'`. */
export function matchParen(text: string, open: number): number {
  if (text[open] !== '(') throw new Error(`Expected "(" at ${open} in: ${text.slice(open, open + 40)}`);
  let depth = 0;
  let index = open;
  while (index < text.length) {
    const char = text[index];
    if (char === "'") {
      const close = text.indexOf("'", index + 1);
      if (close === -1) throw new Error('Unterminated string literal');
      index = close + 1;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  throw new Error(`Unbalanced parentheses from ${open} in: ${text.slice(open, open + 60)}`);
}

/** Splits on commas at paren depth 0, ignoring commas inside `'…'`. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (char === "'") {
      const close = text.indexOf("'", index + 1);
      if (close === -1) throw new Error('Unterminated string literal');
      current += text.slice(index, close + 1);
      index = close + 1;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  parts.push(current.trim());

  return parts.filter((part) => part !== '');
}

/**
 * Reads a migration made of `create or replace function` statements, plus the `grant` and
 * `revoke` lines that decide who may call them. Anything else throws.
 */
export interface ParsedFunctionSql {
  readonly functions: readonly ParsedFunction[];
  readonly statements: readonly string[];
}

export function parseFunctionSql(sql: string): ParsedFunctionSql {
  const statements = splitStatementsStrippingBodyComments(sql);
  const functions: ParsedFunction[] = [];

  for (const statement of statements) {
    const lower = statement.toLowerCase();

    if (/^(grant|revoke)\b/.test(lower)) continue;

    if (!/^create or replace function\b/.test(lower)) {
      throw new Error(`Statement the RPC reader has not been taught: ${statement.slice(0, 120)}`);
    }

    const header = /^create or replace function\s+(public\.[a-z_][a-z0-9_]*)\s*\(/i.exec(statement);
    const name = header?.[1];
    if (header === null || name === undefined) {
      throw new Error(`Unreadable create function header: ${statement.slice(0, 120)}`);
    }

    const open = statement.indexOf('(', header[0].length - 1);
    const close = matchParen(statement, open);
    const args = statement.slice(open + 1, close).trim().toLowerCase();

    const afterArgs = statement.slice(close + 1);
    const tag = /\$[A-Za-z_]*\$/.exec(afterArgs);
    if (tag === null) throw new Error(`Function ${name} has no dollar-quoted body`);
    const bodyStart = tag.index + tag[0].length;
    const bodyEnd = afterArgs.indexOf(tag[0], bodyStart);
    if (bodyEnd === -1) throw new Error(`Function ${name} has an unterminated body`);

    functions.push({
      name: name.toLowerCase(),
      args,
      attributes: afterArgs.slice(0, tag.index).trim().toLowerCase(),
      body: afterArgs.slice(bodyStart, bodyEnd).trim(),
    });
  }

  if (functions.length === 0) throw new Error('No create function statements found');

  return { functions, statements };
}

// ──────────────────────────────────────────────────────────────────────────────────────
// Upserts, read as data rather than as text
// ──────────────────────────────────────────────────────────────────────────────────────

export interface ParsedUpsert {
  readonly table: string;
  /** The alias the `returning` clause names, so the caller can check what is rendered. */
  readonly alias: string;
  /** Column name → the expression that supplies it on INSERT, in declaration order. */
  readonly inserted: ReadonlyMap<string, string>;
  /** Column name → the expression that supplies it in `do update set`. */
  readonly updated: ReadonlyMap<string, string>;
}

/**
 * The one insert shape this reader has been taught, spelled out so that changing it is a
 * deliberate act rather than a silent loss of coverage:
 *
 *   insert into public.<table> as <alias> ( <columns> )
 *   select <values> from incoming
 *   on conflict (id) do update set <assignments>
 *   returning <alias>.*
 *
 * Every other shape throws. The column list and the value list are **zipped**, and a length
 * mismatch throws too — a values list one item short of its column list is a real Postgres
 * error, but it is also the kind of edit that would otherwise quietly shift every assertion
 * about "which expression fills which column" by one.
 */
export function parseUpserts(body: string): ParsedUpsert[] {
  const upserts: ParsedUpsert[] = [];
  const INSERT = /insert into public\.([a-z_][a-z0-9_]*) as ([a-z_][a-z0-9_]*) \(/gi;

  for (let match = INSERT.exec(body); match !== null; match = INSERT.exec(body)) {
    const table = match[1];
    const alias = match[2];
    if (table === undefined || alias === undefined) throw new Error('Unreadable insert header');

    const open = match.index + match[0].length - 1;
    const close = matchParen(body, open);
    const columns = splitTopLevel(body.slice(open + 1, close));

    const rest = body.slice(close + 1);
    const CLAUSES = / select (.+?) from incoming on conflict \(id\) do update set (.+?) returning /i.exec(rest);
    if (CLAUSES === null) {
      throw new Error(`Upsert on ${table} is not in the shape the RPC reader has been taught`);
    }
    const valuesText = CLAUSES[1];
    const updatesText = CLAUSES[2];
    if (valuesText === undefined || updatesText === undefined) throw new Error('Unreadable upsert clauses');

    const values = splitTopLevel(valuesText);
    if (values.length !== columns.length) {
      throw new Error(
        `Upsert on ${table} lists ${columns.length} columns and ${values.length} values`,
      );
    }

    const inserted = new Map<string, string>();
    columns.forEach((column, index) => {
      const value = values[index];
      if (value === undefined) throw new Error(`Missing value for ${table}.${column}`);
      inserted.set(column, value);
    });

    const updated = new Map<string, string>();
    for (const assignment of splitTopLevel(updatesText)) {
      const parts = /^([a-z_][a-z0-9_]*) = (.+)$/is.exec(assignment);
      const column = parts?.[1];
      const expression = parts?.[2];
      if (column === undefined || expression === undefined) {
        throw new Error(`Unreadable "do update set" assignment on ${table}: ${assignment}`);
      }
      updated.set(column, expression);
    }

    upserts.push({ table, alias, inserted, updated });
  }

  return upserts;
}

// ──────────────────────────────────────────────────────────────────────────────────────
// Reading the names a function body uses
// ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Column references of the form `<qualifier>.<name>`, ignoring `public.`-style schema names.
 *
 * Shared by both RPC parity checks (M2c moved it here from `syncRpcParity.test.ts`) because
 * each of them sweeps a function body for the columns it names and compares them against the
 * schema migration. Two copies would be two answers to "what does this body reference", and
 * the copy that quietly returned fewer would leave its sweep green — which is why both callers
 * also floor the number of references they checked.
 */
export function qualifiedReferences(text: string, qualifier: string): string[] {
  const pattern = new RegExp(`\\b${qualifier}\\.([a-z_][a-z0-9_]*)`, 'g');
  return [...text.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

/** JSON keys read out of a raw payload row, as `payload->>'key'`. */
export function payloadKeys(text: string): string[] {
  return [...text.matchAll(/->>'([a-z_][a-z0-9_]*)'/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/**
 * The same text with every `'…'` literal emptied, so an assertion about SQL *syntax* cannot be
 * fooled by SQL *data*. The case it exists for: `raise exception 'no site %', p_id` puts a bare
 * `%` in a body that must not contain a bare `%` operator, and `'active'` puts a status value in
 * a body being searched for column names.
 */
export function withoutLiterals(text: string): string {
  return text.replace(/'(?:[^']|'')*'/g, "''");
}

export interface ParsedRead {
  /** The table read from, or `upserted` for the CTE that `push_changes` renders. */
  readonly source: string;
  readonly alias: string;
  /** What each row is rendered by — the whole `jsonb_agg(...)` argument. */
  readonly render: string;
  /** The `where` clause, or `''` where there is none. */
  readonly where: string;
}

/**
 * The one shape either RPC is allowed to turn rows into a payload with:
 *
 *   select coalesce(jsonb_agg( <render> ), '[]'::jsonb) into v_rows
 *   from public.<table> as <alias> where <condition>;
 *
 * — or `from upserted as <alias>`, which is how `push_changes` renders what it just wrote.
 * Read as data so the assertions can be about *what is rendered* and *what is filtered*,
 * rather than about whether some substring happens to appear somewhere in the file.
 * A `coalesce(jsonb_agg(...))` written any other way is simply not found, which is why the
 * tests also count these against the number of tables rather than sampling them.
 */
export function parseReads(body: string): ParsedRead[] {
  const reads: ParsedRead[] = [];
  const READ =
    /select coalesce\(jsonb_agg\((.+?)\), '\[\]'::jsonb\) into v_rows from (public\.[a-z_][a-z0-9_]*|upserted) as ([a-z_][a-z0-9_]*)(.*?);/gis;

  for (let match = READ.exec(body); match !== null; match = READ.exec(body)) {
    const render = match[1];
    const source = match[2];
    const alias = match[3];
    const tail = match[4] ?? '';
    if (render === undefined || source === undefined || alias === undefined) {
      throw new Error('Unreadable row rendering');
    }
    const where = /^\s*where\s+(.*)$/is.exec(tail)?.[1] ?? '';
    reads.push({ source: source.replace(/^public\./, ''), alias, render: render.trim(), where: where.trim() });
  }

  return reads;
}
