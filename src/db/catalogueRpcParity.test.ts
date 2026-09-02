import {
  parseFunctionSql,
  qualifiedReferences,
  readMigrationFile,
  readMigrations,
  splitTopLevel,
  withoutLiterals,
  type ParsedFunction,
} from '../testing/migrationSql';

/**
 * DESIGN.md §5's four remaining RPCs, in `supabase/migrations/20260902090500_catalogue_rpcs.sql`,
 * against the schema they run on. **None of it has ever been executed** — the credentials that
 * could run it must not exist in this public repository — so this file is what stands in for a
 * server, exactly as `syncRpcParity.test.ts` does for §7.
 *
 * The three guarantees worth the most of this file, because each fails in silence:
 *
 *   1. **`delete_account` leaves the community catalogue standing.** §5: rows are never
 *      hard-deleted, because other divers' dives carry `site_id` references to them. This one
 *      is unrecoverable when it goes wrong — a site row that vanishes takes its pin, its
 *      defaults and everyone's map marker with it, and no backup of one user's deletion exists.
 *   2. **`delete_account` removes everything personal.** The other direction of the same
 *      function, and §8 makes it a hard App Store requirement rather than a nicety. It fires
 *      through the schema's own foreign keys, so the two halves of the check live in two files:
 *      the DML shape here, and the cascade/set-null classification in `schemaParity.test.ts`.
 *   3. **The catalogue functions do not widen M2a's RLS decision.** A `security definer`
 *      function over a table with RLS runs as its owner and RLS does not apply — which is
 *      precisely how "the catalogue is readable by signed-in users" quietly becomes "the
 *      catalogue is readable by anyone who can call this". M2a decided that the other way on
 *      the reasoning that closing it after a scrape is impossible.
 *
 * ── What this proves, and what it does not ────────────────────────────────────────────────
 *
 * It proves that these functions and `20260902090100_schema.sql` agree about the same rows,
 * read from their own sources: the column references come out of the function bodies, the
 * columns they are checked against come out of the schema migration, and neither is derived
 * from the other.
 *
 * It does not prove the SQL runs. No name is resolved against a live catalogue, no privilege
 * is checked, and no RLS interaction is validated. Grammar was checked separately with
 * libpg_query in three layers — outer statements, `language sql` bodies, and every SQL
 * fragment inside the plpgsql ones (scratchpad only, no repo dependency; see the M2c report).
 * Grammar is not semantics: it parses `delete from public.dive_sites` as happily as it parses
 * the statement that belongs there, which is the list below's whole reason for existing.
 */

const CATALOGUE_FILE = '20260902090500_catalogue_rpcs.sql';
const SYNC_FILE = '20260902090300_sync_rpcs.sql';

const rpc = parseFunctionSql(readMigrationFile(CATALOGUE_FILE));
const sync = parseFunctionSql(readMigrationFile(SYNC_FILE));
const schema = readMigrations();

function fn(name: string): ParsedFunction {
  const found = rpc.functions.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No function ${name} in ${CATALOGUE_FILE}`);
  return found;
}

const floor = fn('public.name_match_floor');
const search = fn('public.search_sites');
const similar = fn('public.similar_sites');
const suggest = fn('public.suggest_site_edit');
const deleteAccount = fn('public.delete_account');

/** The two that read the community catalogue, and therefore carry guarantee 3. */
const CATALOGUE_READS = [search, similar];

function schemaColumns(table: string): string[] {
  const found = schema.tables.find((candidate) => candidate.name === table);
  if (!found) throw new Error(`No create table for "${table}" in the schema migration`);
  return found.columns.map((column) => column.name);
}

/**
 * Which tables an account deletion severs rather than removes, **read out of the schema** —
 * the columns whose `auth.users` reference is `on delete set null`. `schemaParity.test.ts`
 * classifies every such column deliberately, with a reason; this reads the result of that
 * classification so the two files cannot disagree about which rows must survive.
 */
const COMMUNITY_TABLES = schema.tables
  .filter((table) =>
    table.columns.some(
      (column) =>
        /references auth\.users\b/.test(column.definition) && /on delete set null/.test(column.definition),
    ),
  )
  .map((table) => table.name)
  .sort();

// ──────────────────────────────────────────────────────────────────────────────────────
// What each alias in each body is, so that a column sweep can be exact rather than a guess.
// Declared per function, and exhaustive: an alias that appears in a body and is on neither
// list fails, which is what stops the sweep quietly ignoring a table it does not know.
// ──────────────────────────────────────────────────────────────────────────────────────

const TABLE_ALIASES: Record<string, Record<string, string>> = {
  'public.name_match_floor': {},
  'public.search_sites': { s: 'dive_sites' },
  'public.similar_sites': { s: 'dive_sites' },
  'public.suggest_site_edit': { s: 'dive_sites' },
  'public.delete_account': { s: 'dive_sites', c: 'dive_centers' },
};

const OTHER_ALIASES: Record<string, Record<string, string>> = {
  'public.name_match_floor': {},
  'public.search_sites': {
    m: 'the `matches` CTE, whose columns are site_id/score/distance_m — a ranking, not a row.',
  },
  'public.similar_sites': { m: 'the `matches` CTE, as in search_sites.' },
  'public.suggest_site_edit': {
    k: '`jsonb_object_keys(v_fields) as k(key)` — the payload\'s own keys, checked against the ' +
      'allow-list rather than against a table.',
  },
  'public.delete_account': {
    u: '`auth.users`, Supabase\'s own table. Its columns are not in these migrations and this ' +
      'repository must never assume more about it than `id`.',
  },
};

/** Schemas, as opposed to row aliases. Their names are checked by their own test below. */
const SCHEMA_QUALIFIERS = ['public', 'auth', 'extensions', 'pg_catalog'];

/** Every `<qualifier>.<name>` in a body, literals emptied first so data cannot look like code. */
function qualifiers(body: string): string[] {
  return [...withoutLiterals(body).matchAll(/\b([a-z_][a-z0-9_]*)\.[a-z_][a-z0-9_]*/g)].flatMap(
    (match) => (match[1] === undefined ? [] : [match[1]]),
  );
}

/**
 * PostGIS and pg_trgm names used here. Under `set search_path = ''` an unqualified one cannot
 * resolve at all, so this list is what the "everything is schema-qualified" sweep is over.
 */
const EXTENSION_FUNCTIONS = [
  'similarity',
  'st_setsrid',
  'st_makepoint',
  'st_dwithin',
  'st_distance',
];

/** Statements of a plpgsql body, split outside literals. */
function statementsOf(body: string): string[] {
  return withoutLiterals(body)
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter((statement) => statement !== '');
}

// ──────────────────────────────────────────────────────────────────────────────────────

describe('§5\'s six RPCs, and which of them run as whom', () => {
  it('defines the four §5 names this file owns, and no undeclared extra', () => {
    // §5 lists exactly six RPCs. Four are here; `push_changes` and `pull_changes` are file 4's.
    // Asserting the whole set means a fifth function added to this file has to be named on
    // purpose — and `name_match_floor` is exactly such a deliberate addition (§4.1: the fuzzy
    // cut-off is a rule with two readers, so it gets one owner).
    expect(rpc.functions.map((declared) => declared.name).sort()).toEqual([
      'public.delete_account',
      'public.name_match_floor',
      'public.search_sites',
      'public.similar_sites',
      'public.suggest_site_edit',
    ]);

    const defined = [...rpc.functions, ...sync.functions].map((declared) =>
      declared.name.replace(/^public\./, ''),
    );
    const DESIGN_5 = [
      'delete_account',
      'pull_changes',
      'push_changes',
      'search_sites',
      'similar_sites',
      'suggest_site_edit',
    ];
    expect(DESIGN_5.filter((name) => !defined.includes(name))).toEqual([]);
  });

  it('reads the catalogue as the CALLER, so M2a\'s RLS decision still decides (§5)', () => {
    // THE guarantee of this file's third kind. `dive_sites` is readable by signed-in users and
    // by nobody else (file 3); a `security definer` function over it runs as its owner, RLS
    // does not apply, and the catalogue is then readable by anyone who can call the function —
    // which is the decision M2a deliberately took the other way, on the grounds that opening it
    // later is two statements and closing it after a scrape is not possible at all.
    for (const declared of [...CATALOGUE_READS, suggest, floor]) {
      expect(`${declared.name}: ${declared.attributes}`).toContain('security invoker');
      expect(`${declared.name}: ${declared.attributes}`).not.toContain('security definer');
    }
    expect(CATALOGUE_READS.length).toBe(2);

    // And `delete_account` is the ONE exception, stated from both ends so neither a lost
    // `definer` there nor a stray one anywhere else can pass.
    expect(deleteAccount.attributes).toContain('security definer');
    expect(
      rpc.functions
        .filter((declared) => declared.attributes.includes('security definer'))
        .map((declared) => declared.name),
    ).toEqual(['public.delete_account']);

    // Supabase's own linter calls a mutable search_path on a function a defect, and it matters
    // most on the definer: with an empty path there is no schema left for a shadowing function
    // to be planted in and then run with the owner's privileges.
    for (const declared of rpc.functions) {
      expect(`${declared.name}: ${declared.attributes}`).toContain("set search_path = ''");
    }
  });

  it('revokes execute from PUBLIC and grants it to authenticated alone (§5)', () => {
    // A new function is executable by PUBLIC, which includes `anon` — the role the publishable
    // key inside a downloadable app authenticates as. It matters twice over here: `anon`
    // reaching `delete_account` would be an anonymous caller reaching a `security definer`
    // function, and `anon` reaching `suggest_site_edit` would be an unauthenticated writer into
    // a queue a human reads. The signature is derived from each declaration, so a renamed
    // argument type cannot leave a grant pointing at a function that no longer exists.
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

  it('will do nothing at all for a caller with no account (§1, §5)', () => {
    // File 3 names `anon` in no policy, so a mis-granted EXECUTE would otherwise show up as an
    // empty catalogue rather than as an error — and an empty catalogue is what a young
    // community looks like, so nobody would notice.
    for (const declared of [...CATALOGUE_READS, suggest, deleteAccount]) {
      expect(`${declared.name}: ${declared.body}`).toMatch(/if v_uid is null then raise exception/);
      expect(declared.body).toMatch(/v_uid uuid := \(select auth\.uid\(\)\)/);
    }
  });
});

describe('delete_account — what goes, what stays (DESIGN.md §5, §8)', () => {
  it('names no account but the caller\'s own', () => {
    // The single strongest defence available: there is no parameter to pass somebody else's id
    // through. A `p_user_id uuid` here would be one forged request away from deleting another
    // diver's logbook, and this function runs as its owner with no RLS underneath it.
    expect(deleteAccount.args).toBe('');
    expect(deleteAccount.body).toMatch(/v_uid uuid := \(select auth\.uid\(\)\)/);
  });

  it('writes exactly once, and what it writes is the auth user (§8)', () => {
    // §8 makes in-app deletion a hard App Store requirement, and the email address in
    // `auth.users` is the whole of what §8 calls PII. Deleting the diver's rows but leaving the
    // account would be the one thing that is not account deletion.
    //
    // ONE statement, because everything else follows from the schema's foreign keys rather than
    // from a list here (§4.1). A second copy of that policy in this function is the copy that
    // would drift, and it would drift while running as its owner.
    const dml = statementsOf(deleteAccount.body).filter((statement) =>
      /^(insert|update|delete)\b/.test(statement),
    );
    expect(dml).toEqual(['delete from auth.users as u where u.id = v_uid']);
  });

  it('destroys no community row — the failure that cannot be undone (§5)', () => {
    // §5: "rows are never hard-deleted". Other divers' dives carry `site_id` references, and
    // §6's name snapshot softens that without removing it: a deleted site takes its pin, its
    // defaults and everyone's map marker with it. The tables are read from the schema — they
    // are the ones whose `auth.users` reference is `on delete set null` — so this cannot pass
    // by checking a table that no longer needs checking.
    expect(COMMUNITY_TABLES).toEqual(['dive_centers', 'dive_sites', 'site_edits']);

    const statements = statementsOf(deleteAccount.body);
    const dml = statements.filter((statement) => /^(insert|update|delete|truncate)\b/.test(statement));
    expect(dml.length).toBeGreaterThan(0);
    for (const table of COMMUNITY_TABLES) {
      expect(dml.filter((statement) => statement.includes(table))).toEqual([]);
    }
    // And the whole file, not only this function: nothing here hard-deletes a community row.
    expect(
      rpc.functions.flatMap((declared) =>
        statementsOf(declared.body).filter(
          (statement) =>
            /^delete\b/.test(statement) && COMMUNITY_TABLES.some((table) => statement.includes(table)),
        ),
      ),
    ).toEqual([]);
  });

  it('scopes every statement it runs to the caller, because RLS is not there to (§5)', () => {
    // A `security definer` function is the one place in this schema where a missing `where` is
    // not caught by a policy. The count that reports "3 sites you added stay in the catalogue"
    // would report the entire catalogue instead — and it is returned to the caller.
    const reads = statementsOf(deleteAccount.body).filter(
      (statement) => /\bfrom public\./.test(statement) || /^delete\b/.test(statement),
    );
    expect(reads.length).toBeGreaterThan(2);
    expect(reads.filter((statement) => !statement.includes('v_uid'))).toEqual([]);

    // Both counts are of the caller's own contributions, by the ownership column the community
    // tables actually use.
    expect(deleteAccount.body).toMatch(/from public\.dive_sites as s where s\.created_by = v_uid/);
    expect(deleteAccount.body).toMatch(/from public\.dive_centers as c where c\.created_by = v_uid/);
  });

  it('counts what it keeps before the delete, not after (§5)', () => {
    // `created_by` is null a moment later, so the same two counts run after the DELETE would
    // both answer zero — and the app would tell a departing diver their sites were gone.
    const statements = statementsOf(deleteAccount.body);
    const deleteIndex = statements.findIndex((statement) => /^delete\b/.test(statement));
    const countIndexes = statements
      .map((statement, index) => (/count\(\*\)/.test(statement) ? index : -1))
      .filter((index) => index !== -1);
    expect(countIndexes.length).toBe(2);
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(countIndexes.filter((index) => index > deleteIndex)).toEqual([]);
  });
});

describe('search_sites and similar_sites (DESIGN.md §2.3, §5)', () => {
  it('hands back a row in pull_changes\' own shape, so the client has one writer (§4.1)', () => {
    // §2.3 makes live search a SUPPLEMENT to the device's own catalogue copy — "live search
    // adds anything newer when online" — so these rows have to merge into rows the device
    // already holds, by id. Rendering them with `public.sync_site` is what makes that free: the
    // same PostGIS point becomes the same latitude/longitude pair, and the same three
    // timestamps come back in §7's ISO-Z spelling, which the client's upsert compares as text.
    //
    // `sync_row` instead of `sync_site` would ship `location` as PostGIS' own WKB hex and no
    // coordinates at all — every pin missing, raising nothing. That is the mutation this kills.
    for (const declared of CATALOGUE_READS) {
      expect(`${declared.name}: ${declared.body}`).toContain(
        'public.sync_site(to_jsonb(s), s.location)',
      );
      expect(declared.body).not.toMatch(/public\.sync_row\(to_jsonb\(/);
      // Rendered from the table row itself rather than from the ranking CTE, so a score cannot
      // leak into a row the client is about to store as a catalogue entry.
      expect(declared.body).toMatch(/join public\.dive_sites as s on s\.id = m\.site_id/);
    }
  });

  it('offers only rows a diver could pick — the opposite of what a pull delivers (§5, §7)', () => {
    // The contrast is deliberate and both halves matter. `pull_changes` sends tombstoned,
    // `merged` and `hidden` rows because the device has to be TOLD about them. A search offers
    // something to choose, so offering a merged duplicate would re-create the duplicate an
    // admin has just merged away — and offering a tombstoned site would resurrect it.
    for (const declared of CATALOGUE_READS) {
      expect(`${declared.name}: ${declared.body}`).toContain('s.deleted_at is null');
      expect(`${declared.name}: ${declared.body}`).toContain("s.status = 'active'");
    }
    // The site a suggestion names has to be one an admin can act on, for the same reason.
    expect(suggest.body).toContain("s.status = 'active'");
    expect(suggest.body).toContain('s.deleted_at is null');
  });

  it('writes the fuzzy cut-off exactly once, for both of its readers (§4.1)', () => {
    // The number decides two different things — which sites autocomplete offers, and which
    // count as possible duplicates — and one literal apart the two would disagree: a site
    // offered by search that the dedupe check then refuses to warn about. §4.1's defining
    // defect, in the two functions that would show it least.
    for (const declared of CATALOGUE_READS) {
      expect(`${declared.name}: ${declared.body}`).toContain('public.name_match_floor()');
      expect(withoutLiterals(declared.body)).not.toMatch(/>=\s*0?\.\d/);
    }
    expect([...floor.body.matchAll(/0\.\d+/g)].length).toBe(1);
    expect(floor.attributes).toContain('immutable');
  });

  it('writes pg_trgm\'s operator the only way an empty search_path can resolve it (§5)', () => {
    // M2a installed both extensions into the `extensions` schema, and these functions pin
    // `search_path` to nothing. A FUNCTION can be qualified outright; an OPERATOR resolves
    // through the search_path, so a bare `name % query` would not resolve at all. Writing it
    // the long way is also what lets M2a's GIN trigram indexes be used — `similarity(...) >=
    // floor` alone cannot use one, and would leave those indexes dead.
    // Swept over the WHOLE file rather than over the two functions that use the operator,
    // because the guarantee is about the file: no operator anywhere in it may resolve through
    // a search_path that is empty. That is also what makes `withoutLiterals` load-bearing —
    // `raise exception 'suggest_site_edit: % is not a fact…'` puts a `%` in a body that must
    // contain no bare one, and a stripper that stopped stripping would fail here rather than
    // leaving this assertion quietly true of nothing (mutation-found).
    const whole = withoutLiterals(rpc.functions.map((declared) => declared.body).join('\n'));
    expect([...whole.matchAll(/operator\(extensions\.%\)/g)].length).toBe(2);
    expect(whole.replace(/operator\(extensions\.%\)/g, '')).not.toContain('%');

    // Every PostGIS and pg_trgm name is schema-qualified, everywhere in the file.
    for (const name of EXTENSION_FUNCTIONS) {
      expect(`${name}: ${whole}`).not.toMatch(new RegExp(`(?<!extensions\\.)\\b${name}\\(`));
    }
    expect(whole).toContain('extensions.similarity(');
    expect(whole).toContain('extensions.st_dwithin(');
  });

  it('puts longitude on X and latitude on Y (§6)', () => {
    // The classic silent PostGIS bug, in the two functions that would show it as "no results
    // near me" rather than as an error. Asserted where each point is built, the same way
    // syncRpcParity asserts it for push_changes.
    const points = [...withoutLiterals(rpc.functions.map((f) => f.body).join('\n'))
      .matchAll(/st_makepoint\(([^)]*)\)/g)]
      .flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
    expect(points.length).toBe(2);
    for (const args of points) {
      const [x, y] = splitTopLevel(args);
      expect(x).toContain('longitude');
      expect(y).toContain('latitude');
    }
  });

  it('lets similar_sites exclude a row, so §5\'s two callers are one function', () => {
    // §5 asks for the fuzzy check twice: before a new site is saved (nothing to exclude), and
    // again when a site created offline has been pushed (the site now exists and would come
    // back as its own best duplicate). The argument has to exist from the first version —
    // `create or replace function` refuses a changed signature, so adding it later means
    // dropping and recreating the function in a migration of its own.
    expect(similar.args).toContain('p_exclude_id uuid default null');
    expect(similar.body).toContain('p_exclude_id is null or s.id <> p_exclude_id');
    // And `push_changes` is not the caller: §7's push stays a protocol and writes no flag.
    expect(readMigrationFile(SYNC_FILE)).not.toContain('similar_sites');
  });

  it('caps what one call can ask for, in both directions (§5)', () => {
    // A limit and a radius a client chooses are a cost the server pays. Neither is a secrecy
    // boundary — `pull_changes` hands a signed-in device the whole catalogue by design — so
    // these are clamps rather than refusals, and they are stated so a later "just pass it
    // through" is a deliberate act.
    for (const declared of CATALOGUE_READS) {
      expect(`${declared.name}: ${declared.body}`).toMatch(
        /v_limit integer := least\(greatest\(coalesce\(p_limit/,
      );
      expect(`${declared.name}: ${declared.body}`).toMatch(
        /v_radius_m double precision := least\(greatest\(coalesce\(p_radius_m/,
      );
    }
    // An empty question gets an error rather than the catalogue.
    expect(search.body).toMatch(/if v_query is null and v_point is null then\s*raise exception/);
    expect(similar.body).toMatch(/if v_name is null then\s*raise exception/);
  });
});

describe('suggest_site_edit and the review queue (DESIGN.md §5)', () => {
  /** The allow-list, read out of the SQL rather than restated here. */
  const allowed = splitTopLevel(
    /v_allowed constant text\[\] := array\[([\s\S]*?)\]/.exec(suggest.body)?.[1] ?? '',
  ).map((entry) => entry.replace(/'/g, '').trim());

  /**
   * Everything a suggestion may NOT propose, with the reason each. Together with `allowed`
   * this has to account for every column of `dive_sites` — so a column added there later
   * lands on one list or the other by a deliberate edit, and cannot default into being
   * suggestible.
   */
  const REFUSED: Record<string, string> = {
    id: 'Identity. A suggestion proposes facts about a site, never which site it is.',
    location: '§6 puts the pair on the wire and the point in the database, so `latitude` and ' +
      '`longitude` are what a diver can actually propose; the geometry is composed server-side.',
    created_by: 'Ownership is never a client\'s to propose — it is what file 3\'s UPDATE policy trusts.',
    status: '§5 gives the merge queue to the admin. A suggestion an admin applies by reflex must ' +
      'not be able to hide a site or mark it merged; file 4 refuses the same two columns on push.',
    merged_into: 'As `status` — the other half of §5\'s admin merge, and meaningless without it.',
    created_at: 'Bookkeeping (§6), owned by the server.',
    updated_at: 'Bookkeeping (§6): §7 gives this stamp to push_changes alone.',
    deleted_at: 'A tombstone is §7\'s, not a fact about a site anyone would correct.',
  };

  it('may propose exactly the facts §5 names, and every column is accounted for', () => {
    // Two-sided and exact. An allow-list entry that is not a column of `dive_sites` (bar the
    // coordinate pair) would be a suggestion nobody could ever apply; a column on neither list
    // is one that quietly became suggestible when somebody added it.
    expect(allowed.length).toBeGreaterThan(5);
    expect([...allowed, ...Object.keys(REFUSED)].sort()).toEqual(
      [...schemaColumns('dive_sites'), 'latitude', 'longitude'].sort(),
    );
    expect(allowed.filter((key) => key in REFUSED)).toEqual([]);
    // Named outright as well as implied, because these three are the ones an applied
    // suggestion could do real damage with.
    expect(allowed.filter((key) => ['status', 'merged_into', 'created_by'].includes(key))).toEqual([]);
    expect(Object.values(REFUSED).filter((reason) => reason.trim().length < 20)).toEqual([]);

    // And the list is enforced rather than decorative.
    expect(suggest.body).toContain('where k.key <> all (v_allowed)');
    expect(suggest.body).toMatch(/if v_unknown is not null then\s*raise exception/);
  });

  it('files a suggestion under its author and nobody else (§5)', () => {
    // The INSERT policy checks `suggested_by = auth.uid()`; writing `v_uid` here rather than
    // leaning on the column default means the value the policy checks and the value this
    // function intends are the same expression.
    expect(suggest.body).toContain('insert into public.site_edits (site_id, suggested_by, fields, note)');
    expect(suggest.body).toContain('values (p_site_id, v_uid, v_fields, v_note)');
  });

  it('takes a note or a field, and refuses neither-of-them (§1)', () => {
    // A diver who can only describe the problem must still be able to report it: §1's rule is
    // that the app never stands between a person and recording something. An empty suggestion
    // is the one thing an admin cannot act on at all.
    expect(suggest.body).toMatch(/if v_fields = '\{\}'::jsonb and v_note is null then\s*raise exception/);
    expect(suggest.body).toMatch(/if jsonb_typeof\(v_fields\) <> 'object' then\s*raise exception/);
  });

  it('keeps the queue readable by its author and by nobody else (§5, §9)', () => {
    // The decision M2c had to take because §6 never listed this table: the site's CREATOR does
    // not read suggestions on their site, although §5 gives them its facts. A suggestion
    // carries free text from an identified diver, and routing that to another diver is a
    // moderation surface — §9 defers exactly that class of feature. §5's v1 reviewer is the
    // admin in Studio, which connects as the table owner and needs no policy.
    //
    // Read from the migration text, so a policy loosened to `using (true)` fails here even
    // though every other assertion in this file would still pass.
    const policies = schema.statements.filter(
      (statement) => /^create policy\b/i.test(statement) && /public\.site_edits\b/.test(statement),
    );
    expect(policies.length).toBe(2);
    expect(policies.filter((statement) => /\bfor select\b/i.test(statement))).toEqual([
      'create policy site_edits_select_own on public.site_edits for select to authenticated ' +
        'using (suggested_by = (select auth.uid()))',
    ]);
    expect(policies.filter((statement) => /\bfor (update|delete)\b/i.test(statement))).toEqual([]);

    // A client may add to the queue and read its own rows. It may not change one — resolution
    // is the admin's — and it may not delete one, which is §5 and §7's rule everywhere else.
    const grants = schema.statements.filter(
      (statement) => /^grant\b/i.test(statement) && /public\.site_edits\b/.test(statement),
    );
    expect(grants).toEqual(['grant select, insert on table public.site_edits to authenticated']);
  });
});

describe('the names these functions use exist (DESIGN.md §6)', () => {
  it('names no column, anywhere in this file, that the schema does not have', () => {
    const unknown: string[] = [];
    let checked = 0;

    for (const declared of rpc.functions) {
      const bound = TABLE_ALIASES[declared.name];
      const other = OTHER_ALIASES[declared.name];
      if (bound === undefined || other === undefined) {
        throw new Error(`No alias declaration for ${declared.name}`);
      }
      const body = withoutLiterals(declared.body);

      // Every alias in the body is either bound to a table or declared as something else.
      // Without this, an unbound alias would simply not be swept and its columns never checked.
      for (const qualifier of qualifiers(declared.body)) {
        if (SCHEMA_QUALIFIERS.includes(qualifier)) continue;
        if (qualifier in bound || qualifier in other) continue;
        unknown.push(`${declared.name}: undeclared alias "${qualifier}"`);
      }

      for (const [alias, table] of Object.entries(bound)) {
        const known = new Set([...schemaColumns(table), 'latitude', 'longitude']);
        for (const column of qualifiedReferences(body, alias)) {
          checked += 1;
          if (!known.has(column)) unknown.push(`${declared.name}: ${table}.${column}`);
        }
      }
    }

    expect(unknown).toEqual([]);
    // A sweep that finds nothing to sweep passes for the wrong reason — this project's
    // most-repeated defect. 34 references are read today; 25 is a floor rather than a
    // restatement of the count, and an extractor that returned `[]` fails on it.
    expect(checked).toBeGreaterThan(25);
  });

  it('names no table or function, in any schema, that does not exist', () => {
    // `public.dive_site` instead of `public.dive_sites` is a runtime error on the one server
    // nobody here can reach, and `public.sync_sites` instead of `public.sync_site` would take
    // the whole migration with it. Both sides are read: the names come out of these bodies, and
    // what they are checked against comes out of the schema migration and file 4.
    const known = new Set([
      ...schema.tables.map((table) => table.name),
      ...[...rpc.functions, ...sync.functions].map((declared) => declared.name.replace(/^public\./, '')),
    ]);
    const referenced = rpc.functions.flatMap((declared) =>
      qualifiedReferences(withoutLiterals(declared.body), 'public'),
    );
    expect([...new Set(referenced)].filter((name) => !known.has(name)).sort()).toEqual([]);
    expect(referenced.length).toBeGreaterThan(9);

    // `auth` is Supabase's own schema and is not in these migrations, so what may be assumed
    // about it is listed rather than checked — and kept to the two names that are unavoidable.
    const authNames = rpc.functions.flatMap((declared) =>
      qualifiedReferences(withoutLiterals(declared.body), 'auth'),
    );
    expect([...new Set(authNames)].sort()).toEqual(['uid', 'users']);
  });

  it('every alias declaration names a real table and a reason (§4.1)', () => {
    // The alias lists are what makes the sweep above exact, so a stale entry there is a sweep
    // that checks a table nothing references any more.
    const tables = new Set(schema.tables.map((table) => table.name));
    const declaredNames = rpc.functions.map((declared) => declared.name).sort();
    expect(Object.keys(TABLE_ALIASES).sort()).toEqual(declaredNames);
    expect(Object.keys(OTHER_ALIASES).sort()).toEqual(declaredNames);

    for (const [name, aliases] of Object.entries(TABLE_ALIASES)) {
      for (const [alias, table] of Object.entries(aliases)) {
        expect(`${name}: ${alias} -> ${table}, a table the schema has: ${tables.has(table)}`).toContain(
          'a table the schema has: true',
        );
        expect(qualifiedReferences(withoutLiterals(fn(name).body), alias).length).toBeGreaterThan(0);
      }
    }
    for (const reasons of Object.values(OTHER_ALIASES)) {
      expect(Object.values(reasons).filter((reason) => reason.trim().length < 20)).toEqual([]);
    }
  });

  it('leaves the id of a suggestion to the column default (§6)', () => {
    // §6: ids are client-generated UUIDv7 so that an offline row never needs re-mapping. A
    // suggestion cannot be made offline — it is an RPC call — so its id comes from the table's
    // own default and this file generates none, which keeps one owner for that rule.
    expect(rpc.statements.join(' ')).not.toMatch(/gen_random_uuid|uuid_generate/i);
  });
});
