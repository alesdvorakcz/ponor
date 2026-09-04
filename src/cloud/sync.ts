import type { SupabaseClient } from '@supabase/supabase-js';
import { getTableColumns, getTableName } from 'drizzle-orm';

import {
  applyPulledDiveCenters,
  applyPulledDiveSites,
  clearDiveCenterDirtyFlags,
  clearDiveSiteDirtyFlags,
  countPendingDiveCenters,
  countPendingDiveSites,
  diveCenterMergeTargets,
  diveSiteMergeTargets,
  pendingDiveCenters,
  pendingDiveSites,
} from '../db/catalogue';
import {
  applyPulledCertifications,
  clearCertificationDirtyFlags,
  countPendingCertifications,
  pendingCertifications,
} from '../db/certifications';
import type { PushableTable, PushedRow } from '../db/dirty';
import {
  applyPulledDives,
  clearDiveDirtyFlags,
  countPendingDives,
  pendingDives,
  repointDivesToSurvivors,
} from '../db/dives';
import {
  applyPulledGearPresets,
  clearGearPresetDirtyFlags,
  countPendingGearPresets,
  pendingGearPresets,
} from '../db/gearPresets';
import { certifications, diveCenters, diveSites, dives, gearPresets } from '../db/schema';
import { getLastPulledAt, recordPull } from '../db/syncState';
import type { Db } from '../db/types';

/**
 * **DESIGN.md §7's protocol, on the client: one push, then one pull.**
 *
 * `supabase/migrations/20260902090300_sync_rpcs.sql` is the other half of this file and was
 * written first; every rule below is the client's side of a sentence stated there. §4.1 makes
 * this module the owner of *a sync cycle* — what goes up, what comes down, in what order, and
 * what is written down afterwards. It owns no row: every write goes through `db/dives.ts`,
 * `db/gearPresets.ts`, `db/catalogue.ts` and `db/syncState.ts`, which own their tables.
 *
 * ── **No round trip has ever been performed from this repository** ────────────────────────
 *
 * Nobody working here has credentials for the owner's Supabase project and none will be added
 * (`supabase/README.md`). What the tests below this file exercise is a **fake** RPC pair — a
 * hand-written `push_changes`/`pull_changes` that answers in the shape the SQL renders — plus
 * a real in-memory SQLite database with the real migrations on it. So the *client* is
 * executed, thoroughly; the agreement between the two halves is checked by reading the SQL
 * (`sync.parity.test.ts`, `src/db/syncRpcParity.test.ts`); and whether Postgres accepts any of
 * it is still unknown to everyone. The first person to sign in is the first to find out.
 *
 * ── The five ways this fails, none of which raises anything ───────────────────────────────
 *
 * 1. **A timestamp respelled on the way in or out.** §7.2: the upsert compares `updated_at` as
 *    a *string*, and `public.iso_z` exists so both sides spell an instant the same way. A
 *    `new Date(value).toISOString()` anywhere between the socket and SQLite would look like a
 *    tidy-up and would decide conflicts by string order over two different spellings — the
 *    wrong device winning, quietly, on rows nobody is watching. **This module contains no
 *    `Date` at all**, and `sync.test.ts` asserts that against the file's own source, because
 *    it is a property of the text rather than of any one call.
 * 2. **A watermark the client invented.** §7.3: `last_pulled_at` is whatever the response
 *    said. The server deliberately hands back a stamp a minute behind its own clock (M2b), so
 *    "correcting" it — rounding it, re-parsing it, replacing it with `Date.now()` — steps the
 *    watermark past rows that were never delivered, and they are then skipped on every future
 *    pull, permanently.
 * 3. **A pulled row that arrives dirty**, which pushes itself straight back for ever. The
 *    types the repositories take (`PulledDive`, `PulledSite`, …) have nowhere to say it and
 *    `applyPulledRows` writes `false` regardless; this file strips the column on the way in as
 *    well, so it cannot even be carried.
 * 4. **A flag cleared for a row the server never took, or for one edited mid-push.** Both are
 *    the diver's data stranded on one phone. The first is why only ids the response actually
 *    returned are cleared; the second is `clearDirtyFlags`' whole reason for taking the clock
 *    the row was pushed at (db/dirty.ts).
 * 5. **`created_at` rewritten**, which reorders same-day untimed dives (§2.5). The server
 *    never restamps it and neither does this — the wire mapping below copies every column
 *    verbatim rather than choosing a few.
 *
 * ── One rule that is not about correctness ────────────────────────────────────────────────
 *
 * §1: "sync failures never block logging." A cycle that fails throws, leaves every flag where
 * it was, leaves the watermark where it was, and is retried by whatever called it. Nothing
 * here catches its own errors to keep a screen quiet — that decision belongs to the caller,
 * and §7.5's triggers and pending indicator are the task after this one.
 */

/** The two RPCs §5 lists, named once so a typo cannot reach two call sites differently. */
export const PUSH_RPC = 'push_changes';
export const PULL_RPC = 'pull_changes';

/**
 * A table the protocol carries, and the four things a cycle does with it — read the push set,
 * clear the flags afterwards, apply what came back, and count what is still owed.
 *
 * Every one of them is a function belonging to the table's own repository (§4.1); this file
 * holds the *list*, not the implementations, so another synced table is one entry here and no
 * new writer anywhere. M3b's `certifications` was the first to arrive after that was written,
 * and it was one entry plus its repository, exactly as claimed.
 */
interface SyncedTable {
  readonly table: PushableTable;
  readonly pending: (db: Db) => Promise<readonly object[]>;
  readonly clear: (db: Db, pushed: readonly PushedRow[]) => Promise<string[]>;
  readonly apply: (db: Db, rows: readonly Record<string, unknown>[]) => Promise<string[]>;
  readonly countPending: (db: Db) => Promise<number>;
}

/**
 * Builds one entry, and holds **the only cast in this module**.
 *
 * The cast is the network boundary itself and cannot be removed by being more careful: what
 * comes back from an RPC is JSON, so a `readonly PulledDive[]` is a claim about a value this
 * process has never been able to check. Putting it here, once, keeps every repository's
 * signature honest — `applyPulledDives` really does take dives — and keeps the unchecked step
 * in the one place a reader is looking for it.
 *
 * It is also narrower than it looks. `fromWireRow` builds each object out of the table's own
 * columns and nothing else, so the one property that would be *dangerous* to inherit from a
 * server — `dirty` — is not merely absent from the type, it is absent from the value; and
 * `applyPulledRows` writes the flag itself in any case.
 */
function synced<Pending extends object, Pulled extends object>(spec: {
  readonly table: PushableTable;
  readonly pending: (db: Db) => Promise<readonly Pending[]>;
  readonly clear: (db: Db, pushed: readonly PushedRow[]) => Promise<string[]>;
  readonly apply: (db: Db, rows: readonly Pulled[]) => Promise<string[]>;
  readonly countPending: (db: Db) => Promise<number>;
}): SyncedTable {
  return {
    table: spec.table,
    pending: spec.pending,
    clear: spec.clear,
    apply: (db, rows) => spec.apply(db, rows as readonly Pulled[]),
    countPending: spec.countPending,
  };
}

/**
 * The five tables §7.1 pushes and §7.2 pulls: "dives, presets, and any sites or centers
 * created offline", §6's certification wallet, plus the community catalogue coming the other
 * way.
 *
 * **`certifications` was the fifth and joined in M3b**, when the device got a table to put one
 * in. `push_changes` has upserted it since M2a and `pull_changes` has returned it since M2b,
 * so the gap was on this side alone: `readChangeSet` ignores any table this list does not
 * name, so a diver's cards were quietly dropped on arrival and never went up.
 *
 * `profiles` is the one key both RPCs still return that nothing here stores — §6 keeps
 * `dives_before` in the local `settings` table instead, and there is no other profile field a
 * device reads. Ignoring it is the deliberate direction: a server that grows a table must not
 * break a device that has not grown it.
 */
export const SYNCED_TABLES: readonly SyncedTable[] = [
  synced({
    table: dives,
    pending: pendingDives,
    clear: clearDiveDirtyFlags,
    apply: applyPulledDives,
    countPending: countPendingDives,
  }),
  synced({
    table: gearPresets,
    pending: pendingGearPresets,
    clear: clearGearPresetDirtyFlags,
    apply: applyPulledGearPresets,
    countPending: countPendingGearPresets,
  }),
  synced({
    table: certifications,
    pending: pendingCertifications,
    clear: clearCertificationDirtyFlags,
    apply: applyPulledCertifications,
    countPending: countPendingCertifications,
  }),
  synced({
    table: diveSites,
    pending: pendingDiveSites,
    clear: clearDiveSiteDirtyFlags,
    apply: applyPulledDiveSites,
    countPending: countPendingDiveSites,
  }),
  synced({
    table: diveCenters,
    pending: pendingDiveCenters,
    clear: clearDiveCenterDirtyFlags,
    apply: applyPulledDiveCenters,
    countPending: countPendingDiveCenters,
  }),
];

/**
 * The flag's property name, which is also the one column that must never appear in a payload.
 *
 * `push_changes` refuses an unrecognised key outright (`sync_reject_unknown_keys`), so sending
 * it would not be untidy, it would be the diver's entire sync failing on every attempt until
 * the build changed. Excluded from both directions from one constant.
 */
const DIRTY_KEY = 'dirty' satisfies keyof PushableTable;

/** The wire name of a table — `dives`, `gear_presets`, … — read off the schema rather than
 * written down again, so the key in a payload cannot drift from the table it came from. */
export function wireTableName(table: PushableTable): string {
  return getTableName(table);
}

/**
 * The columns a row travels as: every column the table has except the flag, keyed by its
 * **SQL** name, which is what both RPCs speak.
 *
 * Derived from the table rather than listed, for `applyPulledRows`' reason in M2b's words — "a
 * helper is only a single owner if its output cannot lose a column". A hand-written list is
 * one edit away from a column that is stored on the device, shown on screen, and silently
 * never sent; nothing about that fails a gate, and the diver finds out on their second phone.
 */
function wireColumns(table: PushableTable): readonly (readonly [string, string])[] {
  return Object.entries(getTableColumns(table))
    .filter(([property]) => property !== DIRTY_KEY)
    .map(([property, column]) => [property, column.name] as const);
}

/**
 * A local row as `push_changes` wants it.
 *
 * **The whole row goes up, minus the flag** — including the columns the server refuses to take
 * from a client (`status` and `merged_into` on the community tables, `created_by`, and the
 * `updated_at` it always overwrites). That is deliberate and it is the safe direction of a
 * choice with two silent failure modes. Sending a column the server ignores costs nothing:
 * `sync_reject_unknown_keys` accepts any real column name and `push_changes` simply does not
 * read those. Sending *too few* is data loss — and a client-side list of "what the server will
 * read" would be a second copy of a rule the SQL owns (§4.1), wrong the day the server starts
 * reading one more.
 */
export function toWireRow(table: PushableTable, row: object): Record<string, unknown> {
  const source = row as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  for (const [property, column] of wireColumns(table)) payload[column] = source[property];
  return payload;
}

/**
 * A row from either RPC's response, as the table's repository wants it.
 *
 * Three properties, each of which is a silent failure if it goes:
 *
 * · **Values are copied, never converted.** A timestamp arrives in the spelling `iso_z` chose
 *   and is written in that spelling; §7.2's comparison is between the two, so anything that
 *   re-rendered one of them would be deciding conflicts by the shape of a string rather than
 *   by the instant it names.
 * · **The flag is not a column that can arrive.** It is not in `wireColumns`, so a payload
 *   claiming `dirty: true` — a confused server, a hand-edited fixture — has nowhere to land.
 * · **A missing column throws rather than being written as absent.** Every RPC response is
 *   `to_jsonb(row)`, which emits every column including the nulls, so a key that is not there
 *   means the device is running a schema this server has never heard of. Silently leaving it
 *   out would insert a partial row or, worse, leave an existing column at whatever it was
 *   while the rest of the row moved on. Failing is loud, costs the diver their sync and not
 *   their logbook (§1), and is fixed by a migration.
 *
 * Keys the table has no column for are dropped, which is the *opposite* rule and is the
 * matching direction of the same asymmetry: a field this build cannot store is a feature it
 * does not have, and the server still holds it.
 */
export function fromWireRow(table: PushableTable, payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(`${wireTableName(table)}: a row in the response is not an object`);
  }
  const source = payload as Record<string, unknown>;
  const row: Record<string, unknown> = {};
  for (const [property, column] of wireColumns(table)) {
    if (!(column in source)) {
      throw new Error(`${wireTableName(table)}: the response has no ${column} to store`);
    }
    row[property] = source[column];
  }
  return row;
}

/** The id of a row that came back, or a refusal: it is what a flag is cleared against and what
 * an upsert keys on, and neither has any meaning for a row that cannot say which one it is. */
function rowId(table: PushableTable, row: Record<string, unknown>): string {
  const id = row.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`${wireTableName(table)}: a row in the response has no id`);
  }
  return id;
}

/**
 * The `changes` object both RPCs return, read into the tables this device actually has.
 *
 * Unknown table names are ignored rather than refused — see `SYNCED_TABLES`. A `changes` that
 * is not an object at all is refused, because that is not a newer server, it is a response
 * this client cannot act on, and acting on it as if it were empty would report a successful
 * sync that moved nothing.
 */
function readChangeSet(payload: unknown): Map<string, Record<string, unknown>[]> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('sync: the response carried no changes object');
  }
  const changes = payload as Record<string, unknown>;
  const byTable = new Map<string, Record<string, unknown>[]>();

  for (const synced of SYNCED_TABLES) {
    const name = wireTableName(synced.table);
    const rows = changes[name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new Error(`sync: ${name} in the response is not a list`);
    byTable.set(
      name,
      rows.map((row) => fromWireRow(synced.table, row)),
    );
  }

  return byTable;
}

/** The envelope of a response, before anything inside it has been believed. */
function readEnvelope(data: unknown, rpc: string): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${rpc}: the server answered with no object`);
  }
  return data as Record<string, unknown>;
}

/**
 * Calls one RPC and hands back its envelope, or throws.
 *
 * **The server's own error text is not in the message.** `cloud/auth.ts` states the rule and
 * the reason — nothing this app throws or renders is built out of what a server wrote, because
 * a validation error can echo the input that produced it and §9's Sentry will one day be
 * reading these. The original travels on `cause`, where a debugger can reach it and a message
 * string cannot.
 */
async function call(
  client: SupabaseClient,
  rpc: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await client.rpc(rpc, args);
  if (error !== null && error !== undefined) {
    throw new Error(`${rpc}: the server refused the call`, { cause: error });
  }
  return readEnvelope(data, rpc);
}

/**
 * Writes canonical rows into the tables they belong to, and reports how many landed.
 *
 * **One writer for both directions**, which is what the RPCs' shared response shape was built
 * for (M2b: "the same shape both RPCs return, so the client has ONE writer for canonical rows
 * instead of one per direction"). A push's answer and a pull's answer are the same thing — the
 * server's copy of a row — and a second path for one of them is a second set of rules about
 * flags and clocks, differing exactly where nobody looks.
 *
 * The count is rows *written*, not rows delivered: `applyPulledRows` declines a row that is
 * older than the local copy or that this device still owes the server, and both of those are
 * ordinary, correct outcomes rather than failures.
 */
async function applyChanges(db: Db, changes: Map<string, Record<string, unknown>[]>): Promise<number> {
  let written = 0;
  for (const synced of SYNCED_TABLES) {
    const rows = changes.get(wireTableName(synced.table));
    if (rows === undefined || rows.length === 0) continue;
    written += (await synced.apply(db, rows)).length;
  }
  return written;
}

/** What a cycle moved. Both halves are rows, not tables, and both can legitimately be 0. */
export interface SyncReport {
  /** Rows the server acknowledged taking — the ones whose flags were then cleared. */
  readonly pushed: number;
  /** Rows written locally out of the pull. */
  readonly pulled: number;
}

/**
 * §7.1: "rows flagged dirty go up in one transactional `push_changes` call… the server stamps
 * `updated_at` and returns canonical rows; the client clears its flags."
 *
 * Returns how many rows the server acknowledged. **Zero dirty rows means no call at all** —
 * there is nothing to be transactional about, and a device with a full logbook and nothing
 * pending should cost a diver on a boat no round trip.
 *
 * ── The order of the last three steps is the whole safety argument ────────────────────────
 *
 * *Read the push set first, and remember each row's clock as it was read.* That value, not the
 * one the server sends back, is what `clearDirtyFlags` compares against: the server restamps
 * `updated_at`, so clearing against the canonical row would match nothing and no flag would
 * ever clear — every row re-pushed on every cycle, for ever, with nothing raised.
 *
 * *Clear only what came back.* A row the response does not mention was not stored, whatever
 * else happened, and its flag stays. Nothing in the SQL can produce that today; what it costs
 * to defend against is one `Set`, and what it costs not to is a dive that exists on one phone.
 *
 * *Then write the canonical rows.* After the clear, not before: `applyPulledRows` refuses to
 * overwrite a row this device still owes the server, so a dive edited while the push was in
 * flight keeps both its flag and the diver's edit, and every other row takes the server's
 * clock — which is what stops the next pull's overlap window from having anything to do.
 */
export async function pushPendingRows(db: Db, client: SupabaseClient): Promise<number> {
  const changes: Record<string, Record<string, unknown>[]> = {};
  const sent = new Map<string, PushedRow[]>();

  for (const synced of SYNCED_TABLES) {
    const rows = await synced.pending(db);
    if (rows.length === 0) continue;
    const name = wireTableName(synced.table);
    const payload = rows.map((row) => toWireRow(synced.table, row));
    changes[name] = payload;
    sent.set(
      name,
      payload.map((row) => ({
        id: rowId(synced.table, row),
        updatedAt: pushedClock(synced.table, row),
      })),
    );
  }

  if (sent.size === 0) return 0;

  const envelope = await call(client, PUSH_RPC, { changes });
  const canonical = readChangeSet(envelope.changes);

  let acknowledged = 0;
  for (const synced of SYNCED_TABLES) {
    const name = wireTableName(synced.table);
    const wentUp = sent.get(name);
    if (wentUp === undefined) continue;
    const cameBack = new Set((canonical.get(name) ?? []).map((row) => rowId(synced.table, row)));
    const took = wentUp.filter((row) => cameBack.has(row.id));
    acknowledged += took.length;
    await synced.clear(db, took);
  }

  await applyChanges(db, canonical);
  return acknowledged;
}

/**
 * The clock a row was pushed at, read off the payload that was actually sent.
 *
 * Taken from the payload rather than from the local row so that the value `clearDirtyFlags`
 * compares against is byte-for-byte the value that went up: one string, produced once. A row
 * whose `updated_at` is not a string cannot be pushed at all — the column is NOT NULL on both
 * sides (§6) and last-write-wins is keyed on it, so a row without one is a row that could
 * never win or lose a conflict.
 */
function pushedClock(table: PushableTable, row: Record<string, unknown>): string {
  const clock = row[table.updatedAt.name];
  if (typeof clock !== 'string' || clock === '') {
    throw new Error(`${wireTableName(table)}: a row waiting to go up has no ${table.updatedAt.name}`);
  }
  return clock;
}

/**
 * **Makes a merge reach the dives that pointed at the folded row** (§5) — the step this file
 * was missing, and the only thing a cycle does that §7 does not describe.
 *
 * `domain/merges.ts` decides where a merged row sends a dive, `db/catalogue.ts` reads the rows,
 * `db/dives.ts` writes the dives; this composes the three, which is exactly this module's job
 * (§4.1: it owns a *cycle*, and owns no row).
 *
 * ── Three properties, in the order they can go wrong ──────────────────────────────────────
 *
 * **It runs after the whole change set is applied, not inside it.** A pull can carry the merged
 * site *and* a newer copy of a dive that points at it, and `applyChanges` writes the dives
 * first (`SYNCED_TABLES`' order). Repointing before that would hand the server's copy the last
 * word and undo the repair silently, on the one cycle where it mattered most.
 *
 * **The rewrite deliberately makes the dive dirty, and that cannot fight the pull that caused
 * it.** §7.2's third rule (`applyPulledRows`, db/dirty.ts) refuses to write a pulled row over
 * one this device still owes — so the repaired dive is safe from the server's stale copy until
 * it has gone up, which is precisely the state M2g built that rule for. It cannot collide with
 * a push either: `syncNow` pushes first, and even a hypothetical rewrite landing mid-push would
 * keep its flag, because `clearDirtyFlags` clears only rows whose clock has not moved since.
 *
 * **It runs on every pull, not only the one that delivered the merge.** It is idempotent —
 * `repointDivesToSurvivors` writes only where a dive actually moves — so it costs a device that
 * has never seen a merge two indexed reads and nothing else, and it self-heals if the pull that
 * carried the merge was interrupted before it got here. A one-shot repair keyed on what arrived
 * would have exactly one chance to run and would fail silently for ever after.
 *
 * **It is not in `SyncReport`**, and that is a decision rather than an omission: the report says
 * what the *protocol* moved — rows up, rows down — and a repointed dive is this device's own new
 * write, which shows up where every other unsent write does, in §7.5's pending count.
 */
export async function followCatalogueMerges(db: Db): Promise<number> {
  const [sites, centers] = await Promise.all([
    diveSiteMergeTargets(db),
    diveCenterMergeTargets(db),
  ]);
  return (await repointDivesToSurvivors(db, { sites, centers })).length;
}

/**
 * §7.2: "`pull_changes(last_pulled_at)` returns the user's changed rows plus the compact
 * community catalogue. The client upserts by comparing `updated_at`; tombstoned rows are
 * removed locally."
 *
 * Returns how many rows were written locally.
 *
 * **The watermark is the server's word, stored unread** (§7.3, and `db/syncState.ts` owns what
 * that means). It is handed back exactly as it arrived: not parsed, not rounded, not replaced
 * by this phone's clock, and not "corrected" for the minute the server deliberately holds it
 * behind itself (M2b). A watermark this client invented is the one failure in the protocol
 * with no repair — rows older than it are skipped on every future pull, on that device, for
 * ever.
 *
 * **Rows are written before the watermark moves.** If applying them fails the watermark stays
 * where it was and the next pull asks for the same window again, which §7 makes free because
 * the upsert is idempotent. The other order trades a free repetition for a permanent hole.
 *
 * **A merge is followed in the same place** (`followCatalogueMerges`), and it is put before the
 * watermark for the paragraph above's reason rather than for one of its own: a failure there
 * costs a repetition rather than a hole. **What actually makes that safe is not the ordering**
 * — it is that the repair runs on every pull and is idempotent, so either order self-heals —
 * **but that no arrangement of rows can make it fail at all.** `resolveMergeTargets` is total
 * over any graph a server can send, cycles included, which is what stops a merge from being
 * able to stall a device's watermark for ever. That, and not the ordering, is the guarantee
 * worth defending, and §1 is why: a merge arriving mid-sync may not cost the diver their sync.
 *
 * **A tombstone is a row, and it is written like any other row.** §6 hard-deletes nothing: a
 * pulled `deleted_at` lands in the column, and `liveRows`/`pickable` — the filter every read
 * of every soft-deleted table already applies — is what removes it from the diver's logbook.
 * Deleting it outright would throw away the fact that it was deleted, which is the only thing
 * standing between a re-created row and the next device that has not heard yet.
 */
export async function pullChanges(db: Db, client: SupabaseClient): Promise<number> {
  const lastPulledAt = await getLastPulledAt(db);
  const envelope = await call(client, PULL_RPC, { last_pulled_at: lastPulledAt });

  const written = await applyChanges(db, readChangeSet(envelope.changes));
  await followCatalogueMerges(db);

  const watermark = envelope.last_pulled_at;
  if (typeof watermark !== 'string') {
    throw new Error(`${PULL_RPC}: the server returned no watermark`);
  }
  await recordPull(db, watermark);

  return written;
}

/**
 * One cycle: push, then pull (§7.1 before §7.2, and §4.1 makes this the one place that order
 * is decided).
 *
 * Push first because the two are not symmetrical. A push that goes second would send rows the
 * pull had just overwritten, and — worse — the pull would be comparing this device's unsent
 * edits against the server's copy of the state they were edited from, which is the conflict
 * `applyPulledRows`' third rule exists to refuse. Pushing first empties the dirty set, so the
 * pull that follows is comparing settled rows against settled rows.
 *
 * Throws on the first failure and does not swallow it: §1 makes a sync failure something the
 * logbook survives, not something the app pretends did not happen. A failed push leaves every
 * flag set and never reaches the pull; a failed pull leaves the watermark where it was.
 */
export async function syncNow(db: Db, client: SupabaseClient): Promise<SyncReport> {
  const pushed = await pushPendingRows(db, client);
  const pulled = await pullChanges(db, client);
  return { pushed, pulled };
}

/**
 * How many rows across the whole device the server has not acknowledged.
 *
 * **The gate on §7.4's wipe** (`cloud/localLogbook.ts`), and the reason it is a question asked
 * of the database rather than a number a push handed back: sign-out promises the logbook comes
 * back on the next sign-in, which is true of a pushed row and false of a dirty one, and the
 * erase must be able to check that for itself. A push that threw, a push that half-succeeded,
 * a device that has been at sea for a month and a build with no backend configured at all all
 * answer the same way here — with the rows.
 *
 * Summed across every table in `SYNCED_TABLES` on purpose: a per-table check would let a
 * diver's dives be erased because their *presets* were the thing that had not gone up. It is
 * the list rather than a count for the same reason — a table added to the protocol and left
 * out of this sum would be rows the wipe never noticed were still owed.
 */
export async function countUnsyncedRows(db: Db): Promise<number> {
  let pending = 0;
  for (const synced of SYNCED_TABLES) pending += await synced.countPending(db);
  return pending;
}
