import { readMigrations } from './migrationSql';

/**
 * **A fake `push_changes`/`pull_changes`, because there is no real one anybody here can reach.**
 *
 * Nobody working in this repository has credentials for the owner's Supabase project, none
 * will be added (`supabase/README.md`), and **no round trip has ever been performed from this
 * tree**. So the client half of DESIGN.md §7 is exercised against this, and what that proves is
 * exactly and only: *the client behaves correctly against a server that behaves the way
 * `supabase/migrations/20260902090300_sync_rpcs.sql` says it does.* Whether Postgres agrees is
 * still unknown to everyone.
 *
 * Shared from `src/testing/` (§4.1) rather than written per test file, for that directory's
 * stated reason — a fake that is wrong in one copy and right in four others is worse than no
 * fake, and both `cloud/sync.test.ts` and `cloud/localLogbook.test.ts` drive one.
 *
 * ── What it models, and why each of these and not others ──────────────────────────────────
 *
 * Only the behaviours the client's correctness actually turns on, each named in the SQL:
 *
 * · **The ISO-Z spelling.** `public.iso_z` renders `YYYY-MM-DDTHH:MM:SS.mmmZ`, which is
 *   `Date.prototype.toISOString()` — so this uses `toISOString()`. §7.2's comparison is a
 *   string comparison and the whole protocol rests on both sides spelling an instant alike.
 * · **`updated_at` is the server's, always.** Every push restamps it. That is the single most
 *   important thing to model, because it is what makes a naive client clear no flag at all —
 *   and what lets the server's echo of a row outrank an edit made on the phone after the push
 *   went out.
 * · **`created_at` is preserved and never regenerated** (§2.5, §6): the payload's on first
 *   insert, untouchable afterwards.
 * · **The owner columns are the server's.** `user_id` / `created_by` come from `auth.uid()`
 *   and the payload's are never read, which is why the device has no such column at all.
 * · **`status` / `merged_into` are refused from a client** (§5's merge queue is the admin's).
 * · **The watermark is deliberately a minute early** (§7.3, M2b), and `server_time` is the
 *   un-shifted clock beside it.
 * · **Tombstones travel as rows.** Nothing filters `deleted_at`.
 * · **Every column is rendered, including the nulls**, because `to_jsonb(row)` does.
 * · **`certifications` and `profiles` come back too**, empty, because the real `pull_changes`
 *   returns six keys and the device has tables for four of them.
 *
 * What it does not model: RLS, transactions, the unknown-key refusal, PostGIS. Those are the
 * server's own correctness and are checked by reading the SQL (`src/db/syncRpcParity.test.ts`).
 *
 * ── Where its column lists come from, and why not from `src/db/schema.ts` ─────────────────
 *
 * From the **Postgres migrations**, parsed. That is the point of it: the client's own wire
 * mapping is derived from the Drizzle schema, so a fake that took its keys from the same place
 * would agree with the client by construction and could not catch the mapping losing a column.
 * Two sources, or the check is a mirror.
 */

/** The one difference between a Postgres row and what `public.sync_site` puts on the wire.
 * §6: SQLite has no point type, so the server's `location` travels as the pair. */
const LOCATION_COLUMN = 'location';
const COORDINATE_COLUMNS = ['latitude', 'longitude'] as const;

/** Tables whose point is decomposed on the wire — the two the community catalogue is made of. */
const GEOGRAPHIC_TABLES = new Set(['dive_sites', 'dive_centers']);

/** Columns the server sets from `auth.uid()` and never reads from a payload (M2b). */
const OWNER_COLUMNS: Record<string, string> = {
  dives: 'user_id',
  gear_presets: 'user_id',
  certifications: 'user_id',
  dive_sites: 'created_by',
  dive_centers: 'created_by',
};

/** Columns §5 gives to the admin, which `push_changes` will not take from a device. */
const ADMIN_COLUMNS = ['status', 'merged_into'];

/** The six tables both RPCs name. */
export const SERVER_TABLES = [
  'dives',
  'gear_presets',
  'certifications',
  'profiles',
  'dive_sites',
  'dive_centers',
] as const;

export type ServerTable = (typeof SERVER_TABLES)[number];

const schema = readMigrations();

/**
 * The columns a row of this table carries **on the wire**, read out of the Postgres migrations
 * and adjusted by the one documented substitution above.
 *
 * Throws on a table it cannot find rather than returning an empty list: a silently empty column
 * set would make every row in this fake `{}` and every assertion built on one vacuous.
 */
export function wireColumnsOf(table: string): string[] {
  const found = schema.tables.filter((candidate) => candidate.name === table);
  const last = found.at(-1);
  if (last === undefined) throw new Error(`fakeSyncServer: no table ${table} in the migrations`);
  const columns = last.columns.map((column) => column.name);
  if (columns.length < 5) throw new Error(`fakeSyncServer: ${table} parsed as ${columns.length} columns`);
  if (!GEOGRAPHIC_TABLES.has(table)) return columns;
  return [...columns.filter((column) => column !== LOCATION_COLUMN), ...COORDINATE_COLUMNS];
}

export interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface RpcCall {
  readonly rpc: string;
  readonly args: Record<string, unknown>;
}

/** A row as it travels: every column of the table, nulls included. */
export type WireRow = Record<string, unknown>;

export class FakeSyncServer {
  /** Every call made to it, in order — what a test asserts a client did rather than inferred. */
  readonly calls: RpcCall[] = [];

  /** Set to make the next call fail the way PostgREST does: `{ data: null, error }`. */
  refusal: { readonly message: string; readonly code?: string } | null = null;

  private readonly stored = new Map<string, Map<string, WireRow>>();
  private clock: number;
  private readonly uid = '11111111-1111-7111-8111-111111111111';

  /**
   * `startAt` is the server's clock, and it is a knob because **§7's outcome genuinely depends
   * on whose clock is ahead** and a test should be able to say which case it is in. The default
   * is a fixed instant in the past, which is the useful one: a watermark taken from it cannot
   * be confused with one this machine's `Date.now()` produced.
   */
  constructor(options: { readonly startAt?: string } = {}) {
    this.clock = Date.parse(options.startAt ?? '2026-09-02T09:00:00.000Z');
    if (Number.isNaN(this.clock)) throw new Error(`fakeSyncServer: unreadable startAt`);
  }

  /** Moves the server's clock on, so a later stamp really is later. Milliseconds. */
  tick(ms = 1000): void {
    this.clock += ms;
  }

  /** The stamp the next write would carry, in the client's own spelling. */
  now(): string {
    return new Date(this.clock).toISOString();
  }

  /** Puts a row on the server without a push — the other device, or an older sync. */
  seed(table: ServerTable, row: WireRow): WireRow {
    const full = this.blank(table);
    for (const [key, value] of Object.entries(row)) full[key] = value;
    full.updated_at ??= this.now();
    full.created_at ??= this.now();
    const id = String(full.id);
    this.table(table).set(id, full);
    return full;
  }

  /** What the server holds, for an assertion about what a push actually stored. */
  rows(table: ServerTable): WireRow[] {
    return [...this.table(table).values()];
  }

  row(table: ServerTable, id: string): WireRow | undefined {
    return this.table(table).get(id);
  }

  /** The RPC surface, shaped like `supabase-js`'s `.rpc()` answer. */
  async call(rpc: string, args: Record<string, unknown>): Promise<RpcResult> {
    this.calls.push({ rpc, args: { ...args } });
    if (this.refusal !== null) {
      const error = this.refusal;
      this.refusal = null;
      return { data: null, error };
    }
    this.tick();
    if (rpc === 'push_changes') return { data: this.push(args.changes), error: null };
    if (rpc === 'pull_changes') return { data: this.pull(args.last_pulled_at), error: null };
    return { data: null, error: { message: `no function ${rpc}`, code: '42883' } };
  }

  private table(name: string): Map<string, WireRow> {
    let rows = this.stored.get(name);
    if (rows === undefined) {
      rows = new Map();
      this.stored.set(name, rows);
    }
    return rows;
  }

  private blank(table: string): WireRow {
    const row: WireRow = {};
    for (const column of wireColumnsOf(table)) row[column] = null;
    return row;
  }

  private push(changes: unknown): unknown {
    const now = this.now();
    const incoming = (changes ?? {}) as Record<string, unknown>;
    const out: Record<string, WireRow[]> = {};

    for (const table of SERVER_TABLES) {
      const rows = incoming[table];
      const taken: WireRow[] = [];
      if (Array.isArray(rows)) {
        for (const raw of rows as WireRow[]) {
          const id = table === 'profiles' ? this.uid : String(raw.id);
          const existing = this.table(table).get(id);
          const stored = existing ?? this.blank(table);
          for (const [key, value] of Object.entries(raw)) {
            // What a client does not get to decide (M2b), each refused here as the SQL does.
            if (key === 'created_at' || key === 'updated_at' || key === 'id') continue;
            if (ADMIN_COLUMNS.includes(key) && existing !== undefined) continue;
            if (!(key in stored)) continue;
            stored[key] = value;
          }
          stored.id = id;
          stored.created_at = existing?.created_at ?? raw.created_at ?? now;
          stored.updated_at = now;
          const owner = OWNER_COLUMNS[table];
          if (owner !== undefined) stored[owner] = this.uid;
          this.table(table).set(id, stored);
          taken.push({ ...stored });
        }
      }
      out[table] = taken;
    }

    return { server_time: now, changes: out };
  }

  private pull(lastPulledAt: unknown): unknown {
    const now = this.now();
    const since = typeof lastPulledAt === 'string' ? lastPulledAt : null;
    const out: Record<string, WireRow[]> = {};

    for (const table of SERVER_TABLES) {
      out[table] = this.rows(table)
        // §7.2's comparison, on the server's side of it: a plain string comparison in the
        // ISO-Z spelling, and nothing filtering `deleted_at`.
        .filter((row) => since === null || String(row.updated_at) > since)
        .map((row) => ({ ...row }));
    }

    return {
      server_time: now,
      // §7.3, M2b: deliberately a minute behind the clock, so a push that committed after this
      // pull took its snapshot is re-read next time rather than skipped for ever.
      last_pulled_at: new Date(this.clock - 60_000).toISOString(),
      changes: out,
    };
  }
}

/** The fake dressed as the one method `cloud/sync.ts` calls on a Supabase client. */
export function fakeSupabaseClient(server: FakeSyncServer) {
  return {
    rpc: (rpc: string, args: Record<string, unknown>) => server.call(rpc, args),
  };
}
