import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';

import { createDiveCenter, createDiveSite, listDiveCenters, listDiveSites } from '../db/catalogue';
import type { PushableTable } from '../db/dirty';
import { createDive, listDives, softDeleteDive } from '../db/dives';
import { createGearPreset, listGearPresets } from '../db/gearPresets';
import { diveCenters, diveSites, dives, gearPresets, settings } from '../db/schema';
import { getLastPulledAt, recordPull } from '../db/syncState';
import {
  divesBeforeQuery,
  readDivesBefore,
  readOpenFormGroups,
  readUnitSystem,
  openFormGroupsQuery,
  setDivesBefore,
  setOpenFormGroups,
  setUnitSystem,
  unitSystemQuery,
} from '../db/settings';
import { createTestDb, type TestDb } from '../db/testDb';
import { fakeSupabaseClient, FakeSyncServer } from '../testing/fakeSyncServer';
import { createLocalLogbook, localLogbook, type LocalLogbook } from './localLogbook';
import { countUnsyncedRows, pullChanges, pushPendingRows } from './sync';

/**
 * **§7.4's two effects of an account on a device: the adoption, and the erase that is "the one
 * destructive action in v1".**
 *
 * **No round trip has ever been performed from this repository** — see `cloud/sync.test.ts` for
 * what that means and what these tests therefore do and do not prove. The database here is
 * real; the server is `src/testing/fakeSyncServer.ts`.
 *
 * The failure this file exists for is not silent, it is loud and permanent: a wipe that ran on
 * a device holding rows the account has never received is a diver's logbook destroyed, under a
 * confirmation dialog that had just promised the opposite. Everything below is aimed at the one
 * rule that prevents it — **sign-out pushes first, and refuses if anything is still dirty** —
 * and, as much, at the rule being a *check* rather than a promise: the refusal is decided by
 * counting flags in SQLite, never by believing what the push said about itself.
 */

let db: TestDb;
let server: FakeSyncServer;
let client: SupabaseClient;

beforeEach(() => {
  db = createTestDb();
  server = new FakeSyncServer();
  client = fakeSupabaseClient(server) as unknown as SupabaseClient;
});

/**
 * The seam over the real database and the fake server.
 *
 * `exclusive` is §7.5's engine lock (`cloud/syncEngine.ts`'s `runExclusive`), and the default
 * here is a pass-through that **records that it was entered** — so every wipe below is running
 * inside it, and one test can say so out loud rather than every test assuming it. `over.hold`
 * replaces it with a lock that never grants, which is how "the erase waits for the lock" is
 * proved rather than read.
 */
let lockedRuns: number;

beforeEach(() => {
  lockedRuns = 0;
});

function seam(over: { client?: SupabaseClient | null; hold?: boolean } = {}): LocalLogbook {
  const backend = 'client' in over ? over.client ?? null : client;
  return createLocalLogbook({
    db,
    client: () => backend,
    exclusive: (work) => {
      lockedRuns += 1;
      if (over.hold === true) return new Promise<never>(() => {});
      return work();
    },
  });
}

function wired(logbook: LocalLogbook) {
  if (!logbook.wired) throw new Error('the seam under test is not wired');
  return logbook;
}

async function flags(table: PushableTable): Promise<boolean[]> {
  const rows = await db.select({ dirty: table.dirty }).from(table);
  return rows.map((row) => row.dirty === true);
}

async function clocks(table: PushableTable): Promise<unknown[]> {
  const rows = await db.select({ updatedAt: table.updatedAt }).from(table);
  return rows.map((row) => row.updatedAt);
}

/**
 * A device with something of every kind on it, **all of it already sent** — which is what makes
 * it a fair starting point for a wipe: the interesting refusals below each add exactly one thing
 * the server has not seen, so the count they refuse over can only be that one thing.
 */
async function aSyncedLogbook() {
  const dive = await createDive(db, { date: '2026-08-16', maxDepthM: 18 });
  const preset = await createGearPreset(db, { name: 'twin 12 steel' });
  const site = await createDiveSite(db, { name: 'Blue Hole' });
  const centre = await createDiveCenter(db, { name: 'Emperor' });
  await pushPendingRows(db, client);
  expect(await countUnsyncedRows(db)).toBe(0);

  await setUnitSystem(db, 'imperial');
  await setOpenFormGroups(db, { conditions: true });
  await setDivesBefore(db, 247);
  await recordPull(db, '2026-09-02T08:59:00.000Z');
  return { dive, preset, site, centre };
}

describe('adopt — §7.4’s "every local row is marked dirty and pushed"', () => {
  it('flags every row on the device, across all four tables', async () => {
    await aSyncedLogbook();
    // Every row is put into the OPPOSITE state first, by hand, past every rule under test —
    // so "it ended up dirty" can only be the adoption and never the create that set it up.
    for (const table of [dives, gearPresets, diveSites, diveCenters]) {
      await db.update(table).set({ dirty: false } as Record<string, unknown>);
      expect(await flags(table)).toEqual([false]);
    }

    await wired(seam()).adopt();

    for (const table of [dives, gearPresets, diveSites, diveCenters]) {
      expect(await flags(table)).toEqual([true]);
    }
  });

  /**
   * §7.4: "Nothing on the client changes at sign-in but the dirty flags." Advancing
   * `updated_at` here would be this device claiming a write it did not make, and §6's
   * last-write-wins would then let a sign-in beat a real edit made on the diver's other phone a
   * moment earlier — silently, and on every row at once.
   */
  it('moves no clock at all', async () => {
    await aSyncedLogbook();
    const before = {
      dives: await clocks(dives),
      presets: await clocks(gearPresets),
      sites: await clocks(diveSites),
      centres: await clocks(diveCenters),
    };
    expect(before.dives.length).toBe(1);

    await wired(seam()).adopt();

    expect(await clocks(dives)).toEqual(before.dives);
    expect(await clocks(gearPresets)).toEqual(before.presets);
    expect(await clocks(diveSites)).toEqual(before.sites);
    expect(await clocks(diveCenters)).toEqual(before.centres);
  });

  /**
   * §7.4's sentence is "4 dives from this phone were added to your logbook", and a diver counts
   * dives they can see. The flagging and the count deliberately disagree: a deleted dive travels
   * as a row (its tombstone has to reach the account) and is not something the diver added.
   */
  it('counts the dives a diver would count, and flags more rows than it counts', async () => {
    await createDive(db, { date: '2026-08-16' });
    await createDive(db, { date: '2026-08-17' });
    const deleted = await createDive(db, { date: '2026-08-18' });
    await softDeleteDive(db, deleted.id);
    await createGearPreset(db, { name: 'alu 80' });
    await createDiveSite(db, { name: 'Blue Hole' });

    expect(await wired(seam()).adopt()).toBe(2);

    // …and the tombstone is flagged all the same, or the deletion never leaves the phone.
    expect((await flags(dives)).filter(Boolean).length).toBe(3);
    expect(await flags(gearPresets)).toEqual([true]);
    expect(await flags(diveSites)).toEqual([true]);
  });

  it('says nothing on a fresh phone rather than saying nought', async () => {
    expect(await wired(seam()).adopt()).toBe(0);
  });
});

describe('wipe — §7.4’s erase, and the rule that gates it', () => {
  it('pushes what this device owes before it looks at anything', async () => {
    await createDive(db, { date: '2026-08-16' });
    await createDiveSite(db, { name: 'Blue Hole' });

    expect(await wired(seam()).wipe()).toEqual({ done: true });

    expect(server.calls.map((call) => call.rpc)).toEqual(['push_changes']);
    expect(server.rows('dives').length).toBe(1);
    expect(server.rows('dive_sites').length).toBe(1);
    expect(await listDives(db)).toEqual([]);
  });

  /**
   * **The whole rule, in the case it exists for.** A diver on a boat: the push cannot happen,
   * the dive has reached nobody, and the dialog in front of this control promised the logbook
   * would come back on the next sign-in. It refuses, and nothing is touched.
   */
  it('refuses, and erases nothing at all, when the push could not happen', async () => {
    const { dive } = await aSyncedLogbook();
    await createDive(db, { date: '2026-08-19', notes: 'logged on the boat' });
    server.refusal = { message: 'fetch failed' };

    expect(await wired(seam()).wipe()).toEqual({ done: false, pending: 1 });

    expect((await listDives(db)).length).toBe(2);
    expect((await listDives(db)).map((row) => row.id)).toContain(dive.id);
    expect((await listGearPresets(db)).length).toBe(1);
    expect((await listDiveSites(db)).length).toBe(1);
    expect((await listDiveCenters(db)).length).toBe(1);
    expect(await getLastPulledAt(db)).toBe('2026-09-02T08:59:00.000Z');
    expect(readDivesBefore(await divesBeforeQuery(db))).toBe(247);
  });

  /**
   * **The refusal is a check, not a promise.** This push *succeeds* — no error, no throw — and
   * simply stores nothing, which is what a server silently dropping a row looks like from here.
   * A wipe gated on "did the push report success" erases the logbook; a wipe gated on the flags
   * themselves refuses. That difference is the reason `countUnsyncedRows` reads the database.
   */
  it('refuses even when the push said it worked, because it counts the rows and not the answer', async () => {
    await createDive(db, { date: '2026-08-16' });
    const forgetful = {
      rpc: async () => ({ data: { server_time: server.now(), changes: {} }, error: null }),
    } as unknown as SupabaseClient;

    expect(await wired(seam({ client: forgetful })).wipe()).toEqual({ done: false, pending: 1 });
    expect((await listDives(db)).length).toBe(1);
  });

  /** A build with no backend cannot push, so it cannot have sent anything — and the check reads
   * exactly the same, which is the point of it being a count rather than a conversation. */
  it('refuses on a build with no backend at all, rather than assuming there was nothing to send', async () => {
    await createDive(db, { date: '2026-08-16' });

    expect(await wired(seam({ client: null })).wipe()).toEqual({ done: false, pending: 1 });
    expect((await listDives(db)).length).toBe(1);
  });

  it('erases the four synced tables and the watermark', async () => {
    await aSyncedLogbook();

    expect(await wired(seam()).wipe()).toEqual({ done: true });

    expect(await listDives(db)).toEqual([]);
    expect(await listGearPresets(db)).toEqual([]);
    expect(await listDiveSites(db)).toEqual([]);
    expect(await listDiveCenters(db)).toEqual([]);
    // §7.4, and M2d recorded this as the one that is not optional: a watermark from the account
    // that left makes the next account's first pull start from a moment it has never seen, and
    // everything older is skipped on that device for ever.
    expect(await getLastPulledAt(db)).toBeNull();
  });

  /**
   * §7.4: "`settings` **stays** — units, locale and the form-group memory are things this diver
   * set on this device and re-asking would be hostile — with `dives_before` the one exception,
   * because §6 syncs it to the profile and leaving it would hand the next account a wrong
   * pre-Ponor number that shifts every dive number after it (§2.5)."
   */
  it('keeps what the diver set on this device, and takes only dives_before', async () => {
    await aSyncedLogbook();

    await wired(seam()).wipe();

    expect(readUnitSystem(await unitSystemQuery(db))).toBe('imperial');
    expect(readOpenFormGroups(await openFormGroupsQuery(db))).toEqual({ conditions: true });
    expect(readDivesBefore(await divesBeforeQuery(db))).toBeNull();
    // And it is a keyed delete rather than a cleared table: two keys survive, one goes.
    expect((await db.select().from(settings)).length).toBe(2);
    expect(await db.select().from(settings).where(eq(settings.key, 'dives_before'))).toEqual([]);
  });

  /**
   * The catalogue is the least obvious of the four tables (§7.4) and the reason is a
   * correctness one rather than tidiness: `adopt` flags **every** row of these tables, so a
   * pulled site left behind by one diver is a site the next diver's first push claims
   * authorship of.
   */
  it('takes the community catalogue with it, pulled rows included', async () => {
    // A row that arrived by pull rather than being created here — the case §7.4 calls the least
    // obvious of the four tables, and the one a reader is most likely to want to keep.
    server.seed('dive_sites', { id: 's-community', name: 'Blue Hole', status: 'active' });
    server.seed('dive_centers', { id: 'c-community', name: 'Emperor', status: 'active' });
    await pullChanges(db, client);
    expect((await listDiveSites(db)).length).toBe(1);
    expect((await listDiveCenters(db)).length).toBe(1);
    expect(await countUnsyncedRows(db)).toBe(0);

    expect(await wired(seam()).wipe()).toEqual({ done: true });

    expect(await listDiveSites(db)).toEqual([]);
    expect(await listDiveCenters(db)).toEqual([]);
  });

  it('is happy to wipe a device that never had anything on it', async () => {
    expect(await wired(seam()).wipe()).toEqual({ done: true });
    expect(await listDives(db)).toEqual([]);
  });

  /**
   * **The erase runs inside §7.5's engine lock, and every wipe above proves it by running at
   * all** — the `exclusive` those seams are built with counts its entries, and if `wipe` stopped
   * going through it that count would be zero while everything else still passed.
   *
   * The reason it has to is M2h's, not M2g's: until triggers existed, nothing in the running app
   * could sync while a diver was signing out. Now a foreground, a save window or a retry can
   * land mid-erase, and the one that lands between the delete and `auth.signOut()` puts the
   * whole logbook back on a device that is leaving the account — §7.4's "the only way a second
   * account could ever see them", produced by the feature meant to keep the logbook safe.
   */
  it('takes the sync engine’s lock, once, around the whole of itself', async () => {
    await createDive(db, { date: '2026-08-16' });

    expect(lockedRuns).toBe(0);
    expect(await wired(seam()).wipe()).toEqual({ done: true });
    expect(lockedRuns).toBe(1);
  });

  /**
   * **And it is genuinely *inside* the lock rather than merely beside it.** The lock here never
   * grants, so a wipe that had taken it would do nothing whatever; one that had not would push
   * and erase regardless, and this is the only way to tell those apart from outside.
   *
   * The push is checked as well as the erase, because the whole of the wipe is what has to be
   * held: a cycle overlapping the push is the double-push the engine exists to prevent, and one
   * overlapping the count would have the gate read flags a concurrent push was clearing.
   */
  it('does nothing at all — not even the push — while the lock is held elsewhere', async () => {
    await createDive(db, { date: '2026-08-16' });

    let settled = false;
    void wired(seam({ hold: true }))
      .wipe()
      .then(() => {
        settled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(settled).toBe(false);
    expect(server.calls).toEqual([]);
    expect((await listDives(db)).length).toBe(1);
  });
});

describe('the seam the app actually ships', () => {
  /**
   * M2e shipped `{ wired: false }` and said in as many words that the wipe "cannot land before
   * §7.1's push exists". It exists, and the ordering constraint has been replaced by the
   * runtime rule the tests above are about. This pins that the app is on the wired arm — every
   * behaviour in `auth.ts` that depends on it is a claim about the app only while this holds.
   */
  it('is wired', () => {
    expect(localLogbook.wired).toBe(true);
  });

  /**
   * **And it is wired to §7.5's engine, not to a pass-through.**
   *
   * Every wipe above runs against a lock this file supplies, which proves the *rule* and says
   * nothing about the *app*: a singleton built with `exclusive: (work) => work()` passes all of
   * them and leaves a diver's sign-out open to the cycle that pulls their logbook back onto the
   * device they are leaving. The singleton cannot be exercised here — it holds the app's real
   * database, which is a native module under Jest — so this reads the wiring off the source, the
   * same way `syncTriggers.test.tsx` reads the app root's one line.
   */
  it('takes its lock from the app’s one sync engine', () => {
    const source = fs.readFileSync(path.join(__dirname, 'localLogbook.ts'), 'utf8');

    expect(source).toContain("import { syncEngine } from './syncEngine'");
    expect(source).toContain('exclusive: (work) => syncEngine.runExclusive(work)');
  });
});
