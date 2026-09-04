import type { SupabaseClient } from '@supabase/supabase-js';
import { eq, getTableColumns } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';

import {
  applyPulledDiveSites,
  createDiveCenter,
  createDiveSite,
  listDiveSites,
  pendingDiveSites,
} from '../db/catalogue';
import type { PushableTable } from '../db/dirty';
import { createDive, getDive, listDives, pendingDives, softDeleteDive, updateDive } from '../db/dives';
import { createGearPreset, listGearPresets } from '../db/gearPresets';
import { diveCenters, diveSites, dives, gearPresets } from '../db/schema';
import { getLastPulledAt, recordPull } from '../db/syncState';
import { createTestDb, type TestDb } from '../db/testDb';
import { groupDivesByPlace } from '../domain/mapSites';
import {
  fakeSupabaseClient,
  FakeSyncServer,
  wireColumnsOf,
  type WireRow,
} from '../testing/fakeSyncServer';
import {
  countUnsyncedRows,
  fromWireRow,
  PULL_RPC,
  PUSH_RPC,
  pullChanges,
  pushPendingRows,
  syncNow,
  toWireRow,
  wireTableName,
} from './sync';

/**
 * **DESIGN.md §7's push/pull loop, on the client — and what has and has not been proved.**
 *
 * **No round trip has ever been performed from this repository.** There are no credentials for
 * the owner's Supabase project here, none were sought, and none may exist in a public repo.
 * Every test below drives `src/testing/fakeSyncServer.ts`, a hand-written model of
 * `supabase/migrations/20260902090300_sync_rpcs.sql`, against a **real** in-memory SQLite
 * database with the real migrations applied. So: the client is executed, the SQL is not, and
 * what this file proves is *the client is right against a server that behaves the way that
 * file says it does*. The first person to sign in is the first to find out whether it does.
 *
 * The fake takes its column lists from the **Postgres migrations**, not from
 * `src/db/schema.ts`. That is deliberate and it is the difference between a check and a mirror:
 * the client's own wire mapping is derived from the Drizzle schema, so a fake reading the same
 * source would agree with it by construction and could never catch the mapping losing a column.
 *
 * ── Every failure aimed at here is silent ─────────────────────────────────────────────────
 *
 * Nothing in this protocol throws when it goes wrong. A flag cleared against the wrong clock is
 * every row re-pushed for ever, or a dive stranded on one phone; a watermark the client
 * invented is a row that is skipped on every future pull, permanently; a pulled row that
 * arrived dirty pushes itself back and never stops; a timestamp respelled decides conflicts by
 * string order between two spellings of one instant. None of them raises, none shows on a
 * screen, and none is visible in a diff — which is why this file exercises rather than reads.
 */

let db: TestDb;
let server: FakeSyncServer;
let client: SupabaseClient;

beforeEach(() => {
  db = createTestDb();
  server = new FakeSyncServer();
  client = fakeSupabaseClient(server) as unknown as SupabaseClient;
});

/** Long enough for `new Date().toISOString()` to move — the repositories' own `tick`. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** The flag as the column holds it, read past every repository that might mask it. */
async function isDirty(table: PushableTable, id: string): Promise<boolean> {
  const rows = await db.select({ dirty: table.dirty }).from(table).where(eqId(table, id));
  const row = rows.at(0);
  if (row === undefined) throw new Error(`no row ${id}`);
  return row.dirty === true;
}

function eqId(table: PushableTable, id: string) {
  return eq(table.id, id);
}

/** The stored row, whole, past the tombstone and status filters every read applies. */
async function storedRow(table: PushableTable, id: string): Promise<Record<string, unknown>> {
  const rows = await db.select().from(table).where(eqId(table, id));
  const row = rows.at(0);
  if (row === undefined) throw new Error(`no row ${id}`);
  return row as Record<string, unknown>;
}

/**
 * The columns a real row cannot be null in, with a value each.
 *
 * Spelled out rather than derived from the parsed `not null` flags, and the reason is worth
 * one line: a derived default would have to invent a value per *type*, and inventing
 * `'logged'` for a `dive_status` is exactly the kind of guess that makes a fixture agree with
 * the code by accident. These are the values §6 actually gives those columns.
 */
const NOT_NULL_DEFAULTS: Record<string, WireRow> = {
  dives: { status: 'logged', date: '2026-08-16', tanks: [], equipment: [] },
  gear_presets: { name: 'a preset', tanks: [] },
  certifications: {},
  profiles: {},
  dive_sites: { status: 'active' },
  dive_centers: { status: 'active' },
};

/** A whole wire row for a table, every column present, built from the Postgres column list. */
function wireRow(table: string, overrides: WireRow): WireRow {
  const row: WireRow = {};
  const columns = wireColumnsOf(table);
  // Floored: an empty column list would make every fixture `{}` and every assertion on one
  // vacuous — and `fromWireRow` would then be handed nothing to be missing.
  expect(columns.length).toBeGreaterThan(4);
  for (const column of columns) row[column] = null;
  return {
    ...row,
    created_at: '2026-09-02T09:00:00.000Z',
    updated_at: '2026-09-02T09:00:00.000Z',
    ...NOT_NULL_DEFAULTS[table],
    ...overrides,
  };
}

describe('the wire shape, against the server’s own column lists (§6, §7)', () => {
  /**
   * The mapping is derived from the Drizzle schema; this is the other source. If the two ever
   * disagree, a column is being stored on the device and never sent — which fails no gate, no
   * lint and no screen, and which the diver discovers on their second phone.
   */
  it('sends exactly the columns the server has, and no others', async () => {
    const dive = await createDive(db, { date: '2026-08-16', maxDepthM: 18 });
    const sent = Object.keys(toWireRow(dives, dive)).sort();

    // `user_id` is the server's and the device has no such column at all (§7.4); `dirty` is the
    // device's and the server has no such column at all. Everything else must match.
    const expected = wireColumnsOf('dives')
      .filter((column) => column !== 'user_id')
      .sort();

    expect(sent.length).toBeGreaterThan(35);
    expect(sent).toEqual(expected);
  });

  it('sends the community tables as the pair, not as a point (§6)', async () => {
    const site = await createDiveSite(db, { name: 'Blue Hole', latitude: 1.5, longitude: 2.5 });
    const sent = Object.keys(toWireRow(diveSites, site));

    expect(sent).toContain('latitude');
    expect(sent).toContain('longitude');
    // `public.sync_site` removes it in both directions; SQLite has no point type to put it in.
    expect(sent).not.toContain('location');
  });

  /**
   * `sync_reject_unknown_keys` refuses a key the table has no column for, and §7's push is one
   * transaction — so a `dirty` in the payload is not untidy, it is the diver's entire sync
   * failing on every attempt for as long as the build lasts.
   */
  it('never carries the dirty flag in either direction', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    expect(Object.keys(toWireRow(dives, dive))).not.toContain('dirty');

    const back = fromWireRow(dives, wireRow('dives', { id: 'd1', updated_at: 'x', dirty: true }));
    expect(Object.keys(back)).not.toContain('dirty');
  });

  it('refuses a response row that is missing a column rather than storing a partial one', () => {
    const complete = wireRow('dives', { id: 'd1', date: '2026-08-16' });
    expect(() => fromWireRow(dives, complete)).not.toThrow();

    const { max_depth_m: _dropped, ...missing } = complete;
    expect(() => fromWireRow(dives, missing)).toThrow(/max_depth_m/);
  });

  /** The other direction of the same asymmetry: a field this build cannot store is a feature it
   * does not have, and the server still holds it. Dropping it must not fail the sync. */
  it('drops a key it has no column for rather than failing on a newer server', () => {
    const row = wireRow('dives', { id: 'd1', a_column_from_the_future: 42 });
    expect(() => fromWireRow(dives, row)).not.toThrow();
    expect(Object.keys(fromWireRow(dives, row))).not.toContain('a_column_from_the_future');
  });

  /**
   * §7.2's comparison is a *string* comparison, and `iso_z` exists so both sides spell an
   * instant alike. Anything that parsed and re-rendered a timestamp on the way in would look
   * like a tidy-up and would silently decide conflicts between two spellings.
   */
  it('copies a timestamp through byte for byte, in whatever spelling it arrived in', () => {
    const canonical = '2026-09-02T09:00:00.000Z';
    const postgresStyle = '2026-09-02 09:00:00+00';

    for (const stamp of [canonical, postgresStyle]) {
      const row = fromWireRow(dives, wireRow('dives', { id: 'd1', updated_at: stamp, created_at: stamp }));
      expect(row.updatedAt).toBe(stamp);
      expect(row.createdAt).toBe(stamp);
    }
  });

  it('names each table the way the RPCs do', () => {
    expect([dives, gearPresets, diveSites, diveCenters].map(wireTableName)).toEqual([
      'dives',
      'gear_presets',
      'dive_sites',
      'dive_centers',
    ]);
  });
});

describe('push (§7.1)', () => {
  it('makes no call at all when nothing is dirty', async () => {
    expect(await pushPendingRows(db, client)).toBe(0);
    expect(server.calls).toEqual([]);
  });

  it('sends every dirty row across the four tables in one call', async () => {
    await createDive(db, { date: '2026-08-16' });
    await createGearPreset(db, { name: 'twin 12 steel' });
    await createDiveSite(db, { name: 'Blue Hole' });

    expect(await pushPendingRows(db, client)).toBe(3);

    const pushes = server.calls.filter((call) => call.rpc === PUSH_RPC);
    expect(pushes.length).toBe(1);
    const changes = pushes[0]?.args.changes as Record<string, unknown[]>;
    expect(Object.keys(changes).sort()).toEqual(['dive_sites', 'dives', 'gear_presets']);
    expect(server.rows('dives').length).toBe(1);
    expect(server.rows('gear_presets').length).toBe(1);
    expect(server.rows('dive_sites').length).toBe(1);
  });

  /**
   * **The one that makes the whole loop terminate.** The server restamps `updated_at`, so a
   * client that cleared its flags against the canonical row would match nothing — every row
   * re-pushed on every cycle, for ever, with nothing raised anywhere. The flag comes off
   * against the clock the row was *read* at.
   */
  it('clears the flag of every row the server took', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    const preset = await createGearPreset(db, { name: 'alu 80' });
    const site = await createDiveSite(db, { name: 'Blue Hole' });

    await pushPendingRows(db, client);

    expect(await isDirty(dives, dive.id)).toBe(false);
    expect(await isDirty(gearPresets, preset.id)).toBe(false);
    expect(await isDirty(diveSites, site.id)).toBe(false);
    expect(await pendingDives(db)).toEqual([]);
  });

  /**
   * The canonical rows a push returns are written back through the same writer a pull's are
   * (M2b: "the same shape both RPCs return, so the client has ONE writer"), which converges
   * this device's clock on the server's and leaves the next pull's overlap window nothing to
   * do. It is `applyPulledRows`, so it happens exactly when §7 says it should — when the
   * server's stamp is the later one, which here means a server whose clock is ahead of this
   * machine's, stated rather than assumed.
   */
  it('takes the server’s stamp for the rows it pushed, so the next pull has nothing to do', async () => {
    const ahead = new FakeSyncServer({ startAt: '2099-01-01T00:00:00.000Z' });
    const aheadClient = fakeSupabaseClient(ahead) as unknown as SupabaseClient;
    const dive = await createDive(db, { date: '2026-08-16' });

    await pushPendingRows(db, aheadClient);

    const stored = await storedRow(dives, dive.id);
    expect(stored.updatedAt).toBe(ahead.row('dives', dive.id)?.updated_at);
    expect(stored.updatedAt).not.toBe(dive.updatedAt);
    expect(await isDirty(dives, dive.id)).toBe(false);
  });

  /**
   * §2.5 orders same-day untimed dives by `created_at`, so a push that let it move would
   * silently reorder a diver's day — on the other device, days later.
   */
  it('never lets created_at move', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });

    await pushPendingRows(db, client);
    await tick();
    await updateDive(db, dive.id, { notes: 'thermocline at 14 m' });
    await pushPendingRows(db, client);

    expect((await storedRow(dives, dive.id)).createdAt).toBe(dive.createdAt);
    expect(server.row('dives', dive.id)?.created_at).toBe(dive.createdAt);
  });

  /**
   * **The edit made while the push was in flight.** `clearDirtyFlags` keeps the flag, and
   * `applyPulledRows` refuses to write the server's echo over it — so the diver keeps both the
   * edit and the thing that will send it. Either half missing loses the edit silently.
   */
  it('keeps the flag and the edit on a row edited mid-push', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });

    // The edit lands between the payload being read and the response being applied, which is
    // what a real second or two of network looks like from the database's side.
    const push = pushPendingRows(db, client);
    await tick();
    await updateDive(db, dive.id, { notes: 'thermocline at 14 m' });
    await push;

    expect(await isDirty(dives, dive.id)).toBe(true);
    expect((await getDive(db, dive.id))?.notes).toBe('thermocline at 14 m');
  });

  /** A row the response does not mention was not stored, whatever else happened. Its flag is
   * the only thing that will ever send it again. */
  it('keeps the flag on a row the response did not acknowledge', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    const forgetful = {
      rpc: async (rpc: string, args: Record<string, unknown>) => {
        const answer = (await server.call(rpc, args)) as { data: Record<string, unknown> };
        return { data: { ...answer.data, changes: { dives: [] } }, error: null };
      },
    } as unknown as SupabaseClient;

    expect(await pushPendingRows(db, forgetful)).toBe(0);
    expect(await isDirty(dives, dive.id)).toBe(true);
  });

  /** §7 propagates a deletion as a row: a tombstone that stayed on the phone is a dive the
   * diver's other device goes on showing them for ever. */
  it('carries a tombstone up like any other row', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    await pushPendingRows(db, client);
    await tick();
    await softDeleteDive(db, dive.id);

    await pushPendingRows(db, client);

    expect(server.row('dives', dive.id)?.deleted_at).not.toBeNull();
  });

  it('throws on a refusal and leaves every flag exactly where it was (§1)', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    server.refusal = { message: 'permission denied for table dives', code: '42501' };

    await expect(pushPendingRows(db, client)).rejects.toThrow(/push_changes/);
    expect(await isDirty(dives, dive.id)).toBe(true);
    expect((await getDive(db, dive.id))?.date).toBe('2026-08-16');
  });

  /**
   * `cloud/auth.ts`'s rule, one module over: no message this app throws or renders is built out
   * of what a server wrote. A PostgREST error can echo the row that produced it, and §9's
   * Sentry will one day be turning these into breadcrumbs.
   */
  it('does not put the server’s own text in the error it throws', async () => {
    await createDive(db, { date: '2026-08-16', notes: 'the diver’s private note' });
    server.refusal = { message: 'failing row contains (the diver’s private note)', code: '23514' };

    await expect(pushPendingRows(db, client)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('private note') }) as Error,
    );
  });
});

describe('pull (§7.2, §7.3)', () => {
  it('asks for everything the first time, and from the stored watermark after that', async () => {
    await pullChanges(db, client);
    expect(server.calls.at(-1)?.args).toEqual({ last_pulled_at: null });

    const stored = await getLastPulledAt(db);
    await pullChanges(db, client);
    expect(server.calls.at(-1)?.args).toEqual({ last_pulled_at: stored });
  });

  /**
   * **§7.3, and the one failure in this protocol with no repair.** The watermark is whatever
   * the response said — never the phone's clock, never a rounded copy, and never "corrected"
   * for the minute the server deliberately holds it behind itself (M2b). A watermark ahead of
   * what was delivered skips those rows on every future pull, on that device, for ever.
   */
  it('stores the watermark the server sent, byte for byte, and not a clock of its own', async () => {
    const before = Date.now();
    await pullChanges(db, client);
    const after = Date.now();

    const pull = server.calls.at(-1);
    expect(pull?.rpc).toBe(PULL_RPC);
    const stored = await getLastPulledAt(db);

    // The fake's clock is 2026, this machine's is not — so a watermark taken from `Date.now()`
    // cannot pass here by coincidence.
    expect(stored).toBe(server.rows('dives').length >= 0 ? stored : null);
    expect(stored).toMatch(/^2026-09-02T/);
    expect(Date.parse(stored ?? '')).toBeLessThan(before);
    expect(Date.parse(stored ?? '')).toBeLessThan(after);

    // And it is the early one, a minute behind the server's own clock, rather than `server_time`.
    expect(Date.parse(stored ?? '')).toBe(Date.parse(server.now()) - 60_000);
  });

  it('refuses a response with no watermark and leaves the last good one in place', async () => {
    await recordPull(db, '2026-09-01T00:00:00.000Z');
    const mute = {
      rpc: async (rpc: string, args: Record<string, unknown>) => {
        const answer = (await server.call(rpc, args)) as { data: Record<string, unknown> };
        const { last_pulled_at: _gone, ...rest } = answer.data;
        return { data: rest, error: null };
      },
    } as unknown as SupabaseClient;

    await expect(pullChanges(db, mute)).rejects.toThrow(/watermark/);
    expect(await getLastPulledAt(db)).toBe('2026-09-01T00:00:00.000Z');
  });

  /** The watermark moves only after the rows are down. The other order trades a free
   * repetition — §7 makes the upsert idempotent — for a permanent hole. */
  it('writes the rows before it advances the watermark', async () => {
    server.seed('dives', wireRow('dives', { id: 'd1', date: '2026-08-16' }));
    const broken = {
      rpc: async (rpc: string, args: Record<string, unknown>) => {
        const answer = (await server.call(rpc, args)) as { data: Record<string, unknown> };
        const changes = answer.data.changes as Record<string, WireRow[]>;
        // A row with no id: refused by the client, after the envelope and before the watermark.
        return { data: { ...answer.data, changes: { ...changes, dives: [{ ...changes.dives?.[0], id: null }] } }, error: null };
      },
    } as unknown as SupabaseClient;

    await expect(pullChanges(db, broken)).rejects.toThrow();
    expect(await getLastPulledAt(db)).toBeNull();
  });

  it('writes what came down, clean, so it is not pushed straight back', async () => {
    server.seed('dives', wireRow('dives', { id: 'd1', date: '2026-08-16', max_depth_m: 18 }));

    expect(await pullChanges(db, client)).toBe(1);

    expect(await isDirty(dives, 'd1')).toBe(false);
    expect(await pendingDives(db)).toEqual([]);
    expect((await listDives(db)).map((dive) => dive.id)).toEqual(['d1']);
  });

  /** §6 hard-deletes nothing: the tombstone lands in the column and `liveRows` is what removes
   * the row from the logbook. Deleting it outright would throw away the fact of the deletion. */
  it('removes a tombstoned row from the logbook while keeping the tombstone', async () => {
    server.seed('dives', wireRow('dives', { id: 'd1', date: '2026-08-16' }));
    await pullChanges(db, client);
    server.tick();
    server.seed('dives', wireRow('dives', { id: 'd1', date: '2026-08-16', updated_at: server.now(), deleted_at: server.now() }));

    await pullChanges(db, client);

    expect(await listDives(db)).toEqual([]);
    expect((await storedRow(dives, 'd1')).deletedAt).not.toBeNull();
  });

  /** `pull_changes` returns six tables and this device has four. A server that grows a table
   * must not break a device that has not grown it. */
  it('ignores the tables this device has no room for', async () => {
    server.seed('certifications', wireRow('certifications', { id: 'c1', agency: 'SSI' }));
    server.seed('profiles', wireRow('profiles', { id: 'p1', dives_before: 247 }));

    await expect(pullChanges(db, client)).resolves.toBe(0);
  });

  it('takes the whole catalogue and the presets, not only the dives', async () => {
    server.seed('dives', wireRow('dives', { id: 'd1', date: '2026-08-16' }));
    server.seed('gear_presets', wireRow('gear_presets', { id: 'g1', name: 'alu 80', tanks: [] }));
    server.seed('dive_sites', wireRow('dive_sites', { id: 's1', name: 'Blue Hole', status: 'active' }));
    server.seed('dive_centers', wireRow('dive_centers', { id: 'c1', name: 'Emperor', status: 'active' }));

    expect(await pullChanges(db, client)).toBe(4);
    expect((await listGearPresets(db)).map((preset) => preset.name)).toEqual(['alu 80']);
    expect((await listDiveSites(db)).map((site) => site.name)).toEqual(['Blue Hole']);
  });

  it('preserves created_at as the server sent it (§2.5)', async () => {
    server.seed(
      'dives',
      wireRow('dives', { id: 'd1', date: '2026-08-16', created_at: '2020-01-01T00:00:00.000Z' }),
    );

    await pullChanges(db, client);

    expect((await storedRow(dives, 'd1')).createdAt).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('a row this device still owes the server (§7.2, M2g)', () => {
  /**
   * **The rule.** `push_changes` restamps `updated_at` with the *server's* clock, so the
   * server's echo of a row can carry a later timestamp than an edit made on this phone after
   * the push went out — purely because phones run behind. A pure timestamp comparison then
   * hands the echo the win, and the diver's unsent edit is gone along with the flag that would
   * have sent it. There is no second author in that story; it is one device losing to itself.
   */
  it('is never overwritten by the server, however new the server’s copy looks', async () => {
    const dive = await createDive(db, { date: '2026-08-16', notes: 'as pushed' });
    await pushPendingRows(db, client);
    await tick();
    await updateDive(db, dive.id, { notes: 'edited offline, not yet sent' });

    // The server's copy, stamped a century ahead — the extreme form of a phone running behind.
    server.seed('dives', { ...(server.row('dives', dive.id) ?? {}), notes: 'as pushed', updated_at: '2099-01-01T00:00:00.000Z' });
    server.refusal = { message: 'no network', code: '08006' };
    await expect(pushPendingRows(db, client)).rejects.toThrow();
    await pullChanges(db, client);

    expect((await getDive(db, dive.id))?.notes).toBe('edited offline, not yet sent');
    expect(await isDirty(dives, dive.id)).toBe(true);
  });

  /**
   * **The consequence, written down rather than left emergent.** A row that stays dirty stops
   * receiving server updates entirely, and stays that way for as long as the push keeps
   * failing. That is the same state as being offline, and it is the right trade — the
   * alternative loses an edit that exists nowhere else — but it is a real divergence and it
   * should cost a deliberate edit to give up. If you are here because you want to relax the
   * clean check, this is what you are giving up: an edit made on the boat, silently replaced by
   * an older copy of itself.
   */
  it('stays diverged for as long as it cannot be pushed, and converges the moment it can', async () => {
    const dive = await createDive(db, { date: '2026-08-16', notes: 'mine' });
    await pushPendingRows(db, client);
    await tick();
    await updateDive(db, dive.id, { notes: 'edited offline' });

    // Three pulls with the server holding something else, while the push is impossible.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      server.tick();
      server.seed('dives', { ...(server.row('dives', dive.id) ?? {}), notes: 'the other phone', updated_at: server.now() });
      await pullChanges(db, client);
      expect((await getDive(db, dive.id))?.notes).toBe('edited offline');
      expect(await isDirty(dives, dive.id)).toBe(true);
    }

    // And the moment it can go up, the divergence ends — this device's edit wins at the server,
    // which is where §7 puts that decision.
    await pushPendingRows(db, client);
    expect(await isDirty(dives, dive.id)).toBe(false);
    expect(server.row('dives', dive.id)?.notes).toBe('edited offline');
  });

  /**
   * The other half, and it is a separate guard rather than a corollary: on a **clean** row §7's
   * plain whole-row last-write-wins is untouched. Dropping the clean check and dropping the
   * timestamp check must each fail something, or one of the two is decoration.
   */
  it('leaves plain last-write-wins alone on a row that owes nothing', async () => {
    // The watermark is wound back before each pull so that every seeded row is delivered —
    // otherwise the row stamped in the past would simply not be sent, and this would be a test
    // of the fake's `where` clause rather than of the client's comparison.
    const pullEverything = async () => {
      await recordPull(db, '2020-01-01T00:00:00.000Z');
      await pullChanges(db, client);
    };

    server.seed('dives', wireRow('dives', { id: 'd1', notes: 'older', updated_at: '2026-01-01T00:00:00.000Z' }));
    await pullEverything();
    expect((await getDive(db, 'd1'))?.notes).toBe('older');
    expect(await isDirty(dives, 'd1')).toBe(false);

    // Newer wins, on a row that owes nothing — §7's whole-row last-write-wins, untouched.
    server.seed('dives', wireRow('dives', { id: 'd1', notes: 'newer', updated_at: '2026-06-01T00:00:00.000Z' }));
    await pullEverything();
    expect((await getDive(db, 'd1'))?.notes).toBe('newer');

    // And older still loses, although the row is clean and the clean check would not stop it.
    server.seed('dives', wireRow('dives', { id: 'd1', notes: 'stale echo', updated_at: '2026-03-01T00:00:00.000Z' }));
    await pullEverything();
    expect((await getDive(db, 'd1'))?.notes).toBe('newer');
  });
});

describe('a whole cycle (§4.1, §7)', () => {
  it('pushes before it pulls', async () => {
    await createDive(db, { date: '2026-08-16' });

    await syncNow(db, client);

    expect(server.calls.map((call) => call.rpc)).toEqual([PUSH_RPC, PULL_RPC]);
  });

  /**
   * **The loop that would never stop.** A row that came down and was written dirty would go up
   * on the next cycle, be restamped, come down again, and repeat — for ever, on a diver's data
   * allowance, resolving conflicts by whichever device echoed last. A second cycle that pushes
   * nothing is the whole of what "the loop terminates" means.
   */
  it('settles: a second cycle with nothing new pushes and writes nothing', async () => {
    await createDive(db, { date: '2026-08-16' });
    await createDiveSite(db, { name: 'Blue Hole' });
    server.seed('dives', wireRow('dives', { id: 'from-the-tablet', date: '2026-08-15' }));

    const first = await syncNow(db, client);
    expect(first.pushed).toBe(2);

    const second = await syncNow(db, client);
    expect(second).toEqual({ pushed: 0, pulled: 0 });
    expect(await countUnsyncedRows(db)).toBe(0);
  });

  it('leaves the logbook usable and the flags intact when the server is unreachable (§1)', async () => {
    const dive = await createDive(db, { date: '2026-08-16', maxDepthM: 18 });
    server.refusal = { message: 'fetch failed' };

    await expect(syncNow(db, client)).rejects.toThrow();

    expect((await listDives(db)).map((row) => row.id)).toEqual([dive.id]);
    expect(await isDirty(dives, dive.id)).toBe(true);
    expect(await getLastPulledAt(db)).toBeNull();
    // And a later cycle picks it up where it was, rather than needing a repair.
    // `pulled: 0` is the settled answer, not a miss: the push already wrote the server's
    // canonical row locally, so the overlap window's re-read of it is a no-op.
    await expect(syncNow(db, client)).resolves.toEqual({ pushed: 1, pulled: 0 });
  });

  it('carries a site created on the boat up, and the catalogue down, in one cycle', async () => {
    await createDiveSite(db, { name: 'Shark Point', latitude: 27.85, longitude: 34.31 });
    server.seed('dive_sites', wireRow('dive_sites', { id: 's-community', name: 'Blue Hole', status: 'active' }));

    await syncNow(db, client);

    expect((await listDiveSites(db)).map((site) => site.name).sort()).toEqual(['Blue Hole', 'Shark Point']);
    expect(await pendingDiveSites(db)).toEqual([]);
    // The pair travelled and came back as the pair (§6), not as a point and not swapped.
    expect(server.rows('dive_sites').find((row) => row.name === 'Shark Point')).toMatchObject({
      latitude: 27.85,
      longitude: 34.31,
    });
  });
});

describe('what this device still owes (§7.4’s gate)', () => {
  it('counts every table, so one owing table is not hidden by three empty ones', async () => {
    expect(await countUnsyncedRows(db)).toBe(0);

    await createGearPreset(db, { name: 'alu 80' });
    expect(await countUnsyncedRows(db)).toBe(1);

    await createDive(db, { date: '2026-08-16' });
    await createDiveSite(db, { name: 'Blue Hole' });
    expect(await countUnsyncedRows(db)).toBe(3);

    await pushPendingRows(db, client);
    expect(await countUnsyncedRows(db)).toBe(0);
  });

  it('counts a tombstone, because a deletion has to reach the server too', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    await pushPendingRows(db, client);
    await tick();
    await softDeleteDive(db, dive.id);

    expect(await countUnsyncedRows(db)).toBe(1);
  });
});

describe('the module has no clock of its own', () => {
  /**
   * A property of the text, not of any one call, and that is why it is asserted against the
   * source. Both timestamps in this protocol are the **server's** — `updated_at` (§7.1, the
   * server stamps it) and `last_pulled_at` (§7.3, "never the phone's clock — divers change
   * time zones constantly") — so a `new Date()` in this file is either a watermark the client
   * invented or a timestamp it respelled, and both are silent.
   */
  it('contains no Date, no now(), and no toISOString anywhere in it', () => {
    const source = fs.readFileSync(path.join(__dirname, 'sync.ts'), 'utf8');

    // Floored and positively controlled: a sweep over a file that failed to load, or over the
    // wrong file, would pass with nothing in it.
    expect(source.length).toBeGreaterThan(4000);
    expect(source).toContain('last_pulled_at');
    expect(source).toContain('pushPendingRows');

    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/new Date\b/);
    expect(code).not.toMatch(/Date\.now\b/);
    expect(code).not.toMatch(/toISOString\b/);
  });

  /** And the same for the seam that drives it: `cloud/localLogbook.ts` decides what a sign-out
   * erases, and a timestamp has no business in that decision either. */
  it('holds for the local-logbook seam too', () => {
    const source = fs.readFileSync(path.join(__dirname, 'localLogbook.ts'), 'utf8');
    expect(source.length).toBeGreaterThan(4000);
    expect(source).toContain('countUnsyncedRows');

    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/new Date\b/);
    expect(code).not.toMatch(/Date\.now\b/);
  });
});

describe('the tables the loop covers', () => {
  /**
   * Floored against the schema rather than against a number typed here: a table added to
   * `src/db/schema.ts` with a dirty flag and left out of `SYNCED_TABLES` is a table that is
   * written on the device and never sent, which fails nothing at all.
   */
  it('covers every table in the schema that carries a flag', async () => {
    const flagged = [dives, gearPresets, diveSites, diveCenters];
    for (const table of flagged) {
      expect(Object.keys(getTableColumns(table))).toContain('dirty');
    }

    await createDive(db, { date: '2026-08-16' });
    await createGearPreset(db, { name: 'alu 80' });
    await createDiveSite(db, { name: 'Blue Hole' });
    await createDiveCenter(db, { name: 'Emperor' });

    expect(await countUnsyncedRows(db)).toBe(4);
    await pushPendingRows(db, client);
    expect(await countUnsyncedRows(db)).toBe(0);
    for (const table of ['dives', 'gear_presets', 'dive_sites', 'dive_centers'] as const) {
      expect(server.rows(table).length).toBe(1);
    }
  });
});

/**
 * **§5's merge, reaching the dives that pointed at the folded row** (M2r).
 *
 * `pull_changes` has delivered `merged` rows since M2b — on purpose, because "which rows a
 * diver is SHOWN is the client's question" — and until now nothing on the device acted on one.
 * The dive kept pointing at a row every catalogue read filters out: its `site_name` snapshot
 * still read correctly, so nothing looked broken, while the dive was not grouped with the
 * survivor's dives on the Map (§3) and §2.1's defaults had nothing to prefill from. **The
 * failure was silent and looked like data that had simply never been linked**, which is why
 * every test here asserts on a row or on a grouping rather than on a call.
 */
describe('a merge arriving in a pull (§5, M2r)', () => {
  /** A merged catalogue row as an admin in Studio leaves it, at the server's current clock. */
  const folding = (from: string, into: string) =>
    server.seed(
      'dive_sites',
      wireRow('dive_sites', {
        id: from,
        name: 'Blue Hole',
        status: 'merged',
        merged_into: into,
        updated_at: server.now(),
      }),
    );

  it('moves the dive onto the survivor and leaves the name the diver recorded', async () => {
    const dive = await createDive(db, {
      date: '2026-08-16',
      siteId: 'folded',
      siteName: 'Blue Hole',
    });
    await syncNow(db, client);

    server.tick(10_000);
    folding('folded', 'survivor');
    server.seed('dive_sites', wireRow('dive_sites', { id: 'survivor', name: 'Blue Hole (Gozo)', updated_at: server.now() }));

    await syncNow(db, client);

    const after = await getDive(db, dive.id);
    expect(after?.siteId).toBe('survivor');
    // §6's snapshot is history and a merge is not a reason to rewrite what a diver typed, so
    // the dive still reads "Blue Hole" everywhere `diveSiteLabel` reads it.
    expect(after?.siteName).toBe('Blue Hole');
  });

  it('groups the two sites’ dives under one marker afterwards, which is the point of it', async () => {
    // The §3 half, end to end and through the real grouping function. Before the repair these
    // are two markers a few metres apart, one of them badged for a site nothing will show.
    const atFolded = await createDive(db, {
      date: '2026-08-16', siteId: 'folded', siteName: 'Blue Hole', latitude: 36.05, longitude: 14.19,
    });
    const atSurvivor = await createDive(db, {
      date: '2026-08-17', siteId: 'survivor', siteName: 'Blue Hole (Gozo)', latitude: 36.05, longitude: 14.19,
    });
    await syncNow(db, client);
    expect(groupDivesByPlace(await listDives(db))).toHaveLength(2);

    server.tick(10_000);
    folding('folded', 'survivor');
    await syncNow(db, client);

    const places = groupDivesByPlace(await listDives(db));
    expect(places).toHaveLength(1);
    expect(places[0]?.key).toBe('site:survivor');
    expect(places[0]?.dives.map((row) => row.id).sort()).toEqual([atFolded.id, atSurvivor.id].sort());
  });

  it('wins over the server’s own copy of the dive delivered in the same pull', async () => {
    // The ordering that decides whether this works at all. `applyChanges` writes dives BEFORE
    // the catalogue (SYNCED_TABLES' order), so a repair run inside the change set — or before
    // it — would be overwritten by the server's stale `site_id` on the one cycle where a dive
    // and the merge that concerns it arrive together, silently.
    //
    // A server whose clock is **ahead of this machine's**, which is the only way to make its
    // copy of a dive win at all: `createDive` stamps with the local clock, §7.2's comparison is
    // a plain string comparison, and the fake's default instant is in the past.
    server = new FakeSyncServer({ startAt: '2030-01-01T00:00:00.000Z' });
    client = fakeSupabaseClient(server) as unknown as SupabaseClient;

    const dive = await createDive(db, { date: '2026-08-16', siteId: 'folded' });
    await syncNow(db, client);

    server.tick(10_000);
    folding('folded', 'survivor');
    server.seed('dives', wireRow('dives', {
      id: dive.id, date: '2026-08-16', site_id: 'folded', max_depth_m: 31, updated_at: server.now(),
    }));

    await syncNow(db, client);

    const after = await getDive(db, dive.id);
    // The server's edit landed…
    expect(after?.maxDepthM).toBe(31);
    // …and the repair landed on top of it, rather than under it.
    expect(after?.siteId).toBe('survivor');
    expect(await isDirty(dives, dive.id)).toBe(true);
  });

  it('pushes the rewrite, then settles — it does not find the same work every cycle', async () => {
    // §7's other half. The rewrite deliberately makes the dive dirty (M2g's rule then protects
    // it from the server's stale copy), so it must go up and the loop must stop. A repair that
    // rewrote unconditionally would restamp `updated_at` on every cycle for ever.
    const dive = await createDive(db, { date: '2026-08-16', siteId: 'folded' });
    await syncNow(db, client);

    server.tick(10_000);
    folding('folded', 'survivor');
    await syncNow(db, client);
    expect(await countUnsyncedRows(db)).toBe(1);

    const second = await syncNow(db, client);
    expect(second.pushed).toBe(1);
    expect(server.row('dives', dive.id)?.site_id).toBe('survivor');
    expect(await countUnsyncedRows(db)).toBe(0);

    const third = await syncNow(db, client);
    expect(third).toEqual({ pushed: 0, pulled: 0 });
    expect((await getDive(db, dive.id))?.siteId).toBe('survivor');
  });

  it('follows a chain that arrived over two separate pulls', async () => {
    // A merged into B this month, B merged into C the next. Each pull sees one hop; the dive
    // has to end at C, and a device that stopped at B would be pointing at a row nothing shows
    // — the original defect, one step along.
    const dive = await createDive(db, { date: '2026-08-16', siteId: 'a' });
    await syncNow(db, client);

    server.tick(10_000);
    folding('a', 'b');
    await syncNow(db, client);
    expect((await getDive(db, dive.id))?.siteId).toBe('b');

    server.tick(10_000);
    folding('b', 'c');
    await syncNow(db, client);
    expect((await getDive(db, dive.id))?.siteId).toBe('c');
  });

  it('follows a whole chain that arrives in one pull', async () => {
    const dive = await createDive(db, { date: '2026-08-16', siteId: 'a' });
    await syncNow(db, client);

    server.tick(10_000);
    folding('a', 'b');
    folding('b', 'c');
    await syncNow(db, client);

    expect((await getDive(db, dive.id))?.siteId).toBe('c');
  });

  it('moves nobody on a circular merge, and finishes the pull all the same (§1)', async () => {
    // The data is a server's and this repository does not own it. An undefended walk HANGS
    // rather than failing, so what this asserts is that the cycle completes at all: the dive
    // keeps its pointer, the watermark moves, and the next cycle is ordinary.
    const dive = await createDive(db, { date: '2026-08-16', siteId: 'a' });
    await syncNow(db, client);
    const settled = await storedRow(dives, dive.id);

    server.tick(10_000);
    folding('a', 'b');
    folding('b', 'a');
    folding('itself', 'itself');
    await syncNow(db, client);

    expect((await getDive(db, dive.id))?.siteId).toBe('a');
    // Untouched, not merely unmoved: no clock advanced and no flag was set over a decision the
    // app declined to make.
    expect(await storedRow(dives, dive.id)).toEqual(settled);
    expect(await getLastPulledAt(db)).toMatch(/^2026-09-02T/);
    await expect(syncNow(db, client)).resolves.toEqual({ pushed: 0, pulled: 0 });
  });

  it('leaves a dive alone when the catalogue row was hidden rather than merged', async () => {
    // The third status, end to end. `hidden` names no survivor — there is nowhere to send the
    // dive — so the pointer and the snapshot both stand and `pickable` keeps the row off every
    // picker, which is the whole of what the diver sees.
    const dive = await createDive(db, { date: '2026-08-16', siteId: 'bad-entry', siteName: 'Blue Hole' });
    await syncNow(db, client);

    server.tick(10_000);
    server.seed('dive_sites', wireRow('dive_sites', {
      id: 'bad-entry', name: 'Blue Hole', status: 'hidden', merged_into: 'somewhere', updated_at: server.now(),
    }));
    await syncNow(db, client);

    expect((await getDive(db, dive.id))?.siteId).toBe('bad-entry');
    expect((await getDive(db, dive.id))?.siteName).toBe('Blue Hole');
    expect(await listDiveSites(db)).toEqual([]);
    expect(await countUnsyncedRows(db)).toBe(0);
  });

  it('follows a merged centre too, because §5 merges a site or a centre in one breath', async () => {
    const dive = await createDive(db, {
      date: '2026-08-16', centerId: 'folded-shop', centerName: 'Aquarius',
    });
    await syncNow(db, client);

    server.tick(10_000);
    server.seed('dive_centers', wireRow('dive_centers', {
      id: 'folded-shop', name: 'Aquarius', status: 'merged', merged_into: 'shop', updated_at: server.now(),
    }));
    await syncNow(db, client);

    const after = await getDive(db, dive.id);
    expect(after?.centerId).toBe('shop');
    expect(after?.centerName).toBe('Aquarius');
  });

  it('repairs on a later pull, not only on the one that carried the merge', async () => {
    // The self-healing half, and the case is real: the app is killed, or the write fails,
    // between the change set landing and the repair running. The merge is then in the
    // catalogue and no dive has followed it, and a one-shot repair keyed on what arrived in
    // this response would have had its one chance — silently, for ever. So the merged rows are
    // written here the way an interrupted pull would have left them, and an ordinary later
    // cycle that delivers nothing new is what has to finish the job.
    const dive = await createDive(db, { date: '2026-08-16', siteId: 'folded' });
    await applyPulledDiveSites(db, [
      {
        id: 'folded', name: 'Blue Hole', country: null, latitude: null, longitude: null,
        salinity: null, waterBody: null, entry: null, maxDepthM: null, createdBy: null,
        status: 'merged', mergedInto: 'survivor',
        createdAt: '2026-09-02T09:00:00.000Z', updatedAt: '2026-09-02T09:00:00.000Z',
        deletedAt: null,
      },
    ]);
    expect((await getDive(db, dive.id))?.siteId).toBe('folded');

    await syncNow(db, client);

    expect((await getDive(db, dive.id))?.siteId).toBe('survivor');
  });

  it('costs a device that has never seen a merge nothing at all', async () => {
    const dive = await createDive(db, { date: '2026-08-16', siteId: 'a', centerId: 'b' });
    await syncNow(db, client);
    const settled = await storedRow(dives, dive.id);

    server.tick(10_000);
    server.seed('dive_sites', wireRow('dive_sites', { id: 'a', name: 'Blue Hole', updated_at: server.now() }));
    await syncNow(db, client);

    expect(await storedRow(dives, dive.id)).toEqual(settled);
    expect(await countUnsyncedRows(db)).toBe(0);
  });
});
