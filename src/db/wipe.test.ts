import { sql } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';

import {
  applyPulledDiveCenters,
  applyPulledDiveSites,
  createDiveCenter,
  createDiveSite,
  wipeDiveCenters,
  wipeDiveSites,
  type PulledCenter,
  type PulledSite,
} from './catalogue';
import { createDive, softDeleteDive, wipeDives } from './dives';
import { createGearPreset, softDeleteGearPreset, wipeGearPresets } from './gearPresets';
import { diveCenters, diveSites, dives, gearPresets, syncState } from './schema';
import { forgetLastPulledAt, recordPull } from './syncState';
import { createTestDb, type TestDb } from './testDb';

/**
 * **DESIGN.md §7.4's sign-out erase, and the only property of it that is not obvious: the
 * statement has to *visit* the rows, or nothing on screen is told they went** (M2i).
 *
 * `db/wipe.ts` carries the mechanism in full. The short version is that `delete from t` with
 * no WHERE takes SQLite's truncate path, which frees the table's pages without visiting a
 * row, so `sqlite3_update_hook` never fires — and that hook is the whole of what
 * `expo-sqlite`'s `addDatabaseChangeListener` and therefore drizzle's `useLiveQuery` run on.
 * The owner met it as a signed-out phone still drawing three erased dives, summary line and
 * all, until the app was relaunched.
 *
 * ── The verification gap, stated rather than papered over ────────────────────────────────
 *
 * **No test in this repository observes the notification.** Jest runs `better-sqlite3`, which
 * has no update hook to subscribe to, and expo-sqlite cannot run here at all. So what is
 * checked below is the statement, not the event it causes on a device.
 *
 * The instrument that looks like it would close the gap makes it worse: an `AFTER DELETE`
 * trigger counting rows would report all five of these healthy while they were broken,
 * because a trigger on the table is itself one of the conditions that disables the truncate
 * optimisation. Measured, not assumed — the last case in this file is that measurement, kept
 * as an executable record of why the obvious test is not here.
 *
 * ── The two checks, and which one is the guarantee ───────────────────────────────────────
 *
 * 1. **The opcodes of the statement each wipe actually ran.** This is the fix: `Clear` is the
 *    truncate, a per-row `Delete` is what reaches the hook. It is red the moment a `.where()`
 *    is removed from any of the five, which is the whole point of it — the clause looks like
 *    a no-op and the next reader will want to tidy it away.
 * 2. **The table is empty afterwards, tombstones included.** This one is the *safety net for
 *    the new predicate*, not the guarantee — it passes with or without the fix, because a
 *    truncate deletes the rows perfectly well. It is here because a wrong predicate fails in
 *    the far worse direction: rows left behind on a signed-out phone, which is exactly what
 *    §7.4 exists to prevent. `where 0 = 1` produces the same opcodes as `where 1 = 1` and
 *    deletes nothing, so check 1 cannot see it and this one must.
 *
 * `dirty.test.ts` also asserts these erases erase, from the other direction — its question is
 * "is every write path classified and exercised", and it seeds a live row. The seeds here are
 * chosen for the predicate instead: a tombstoned row beside a live one, a clean row beside a
 * dirty one, and the one-row table, because `deleted_at` and `dirty` are the columns a
 * careless "true for every row" would trip over.
 */

/** The statements Drizzle ran on `db`, in order — reset before each test. */
let statements: string[] = [];
let db: TestDb;

beforeEach(() => {
  db = createTestDb({ onStatement: (statement) => statements.push(statement) });
  statements = [];
});

const STAMP = '2026-09-03T08:00:00.000Z';

const pulledSite = (id: string, deletedAt: string | null): PulledSite => ({
  id,
  name: 'Blue Hole',
  country: 'EG',
  latitude: null,
  longitude: null,
  salinity: null,
  waterBody: null,
  entry: null,
  maxDepthM: null,
  createdBy: null,
  status: 'active',
  mergedInto: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  deletedAt,
});

const pulledCenter = (id: string, deletedAt: string | null): PulledCenter => ({
  id,
  name: 'Dahab Divers',
  country: 'EG',
  latitude: null,
  longitude: null,
  website: null,
  createdBy: null,
  status: 'active',
  mergedInto: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  deletedAt,
});

interface WipeSite {
  /** The table it empties, for the emptiness check. */
  readonly table: SQLiteTable & { readonly id: SQLiteColumn };
  /** Rows in every state the table has — see this file's docblock for why that matters. */
  readonly seed: (database: TestDb) => Promise<void>;
  /** How many rows `seed` leaves. Pinned, so an empty seed cannot make the check vacuous. */
  readonly seeded: number;
  /**
   * How many of them are tombstoned. `null` for a table with no `deleted_at` at all
   * (`sync_state`, §6's local-only watermark) — a `0` there would read as "we checked and
   * there were none", which is a different and untrue statement.
   */
  readonly tombstones: ((database: TestDb) => Promise<number>) | null;
  readonly wipe: (database: TestDb) => Promise<void>;
}

const tombstonesIn = async (
  database: TestDb,
  table: SQLiteTable & { readonly deletedAt: SQLiteColumn },
): Promise<number> => {
  const rows = await database.select({ deletedAt: table.deletedAt }).from(table);
  return rows.filter((row) => row.deletedAt !== null).length;
};

const SITES: Record<string, WipeSite> = {
  'db/dives.ts wipeDives': {
    table: dives,
    seeded: 2,
    seed: async (database) => {
      await createDive(database, { date: '2026-08-16', maxDepthM: 18 });
      const gone = await createDive(database, { date: '2026-08-17' });
      await softDeleteDive(database, gone.id);
    },
    tombstones: (database) => tombstonesIn(database, dives),
    wipe: (database) => wipeDives(database),
  },
  'db/gearPresets.ts wipeGearPresets': {
    table: gearPresets,
    seeded: 2,
    seed: async (database) => {
      await createGearPreset(database, { name: 'twin 12 steel' });
      const gone = await createGearPreset(database, { name: 'alu 80' });
      await softDeleteGearPreset(database, gone.id);
    },
    tombstones: (database) => tombstonesIn(database, gearPresets),
    wipe: (database) => wipeGearPresets(database),
  },
  'db/catalogue.ts wipeDiveSites': {
    table: diveSites,
    seeded: 2,
    seed: async (database) => {
      // One created on the boat — dirty, live — and one pulled and already tombstoned by the
      // admin, which arrives clean. The two states a site can be in on a device (§5, §7.2).
      await createDiveSite(database, { name: 'Blue Hole' });
      await applyPulledDiveSites(database, [pulledSite('pulled-site', STAMP)]);
    },
    tombstones: (database) => tombstonesIn(database, diveSites),
    wipe: (database) => wipeDiveSites(database),
  },
  'db/catalogue.ts wipeDiveCenters': {
    table: diveCenters,
    seeded: 2,
    seed: async (database) => {
      await createDiveCenter(database, { name: 'Dahab Divers' });
      await applyPulledDiveCenters(database, [pulledCenter('pulled-center', STAMP)]);
    },
    tombstones: (database) => tombstonesIn(database, diveCenters),
    wipe: (database) => wipeDiveCenters(database),
  },
  'db/syncState.ts forgetLastPulledAt': {
    table: syncState,
    seeded: 1,
    seed: async (database) => {
      await recordPull(database, STAMP);
    },
    tombstones: null,
    wipe: (database) => forgetLastPulledAt(database),
  },
};

const sites = Object.entries(SITES);

/** Every `delete` Drizzle has run since the last reset. */
function deletesRun(): string[] {
  return statements.filter((statement) => /^\s*delete\s+from/i.test(statement));
}

/** The opcodes SQLite compiles `statement` into — the mechanism itself, read off the planner. */
function opcodesOf(statement: string): string[] {
  const rows = db.all<{ opcode: string }>(sql.raw(`explain ${statement}`));
  return rows.map((row) => row.opcode);
}

describe('§7.4’s wipe emits a statement that visits every row (M2i)', () => {
  it('covers every bare-delete site there is, so a sixth cannot be added unnoticed', () => {
    // The floor `dirty.test.ts` puts under its own census, for the same reason: a table below
    // that quietly stopped being listed would be a wipe nobody checked, and the failure is a
    // screen drawing a logbook that has been erased.
    expect(sites.length).toBe(5);
  });

  it.each(sites)('%s', async (_name, site) => {
    await site.seed(db);
    statements = [];

    await site.wipe(db);

    // Taken from the run, never rebuilt here: a query this file constructed would be this
    // file asserting about its own code (§4.1's rule about a check derived from its subject).
    // Exactly one, so a wipe that ran nothing at all cannot pass by having nothing to inspect.
    const deletes = deletesRun();
    expect(deletes.length).toBe(1);
    const statement = deletes[0] ?? '';

    const opcodes = opcodesOf(statement);

    // `Clear` is the truncate optimisation: the pages go, no row is visited, and the update
    // hook expo-sqlite's change listener is built on never fires. `Delete` is the per-row
    // opcode that does fire it. (`IdxDelete` is a different opcode and is not this.)
    expect({ statement, clears: opcodes.includes('Clear') }).toEqual({ statement, clears: false });
    expect({ statement, visitsRows: opcodes.includes('Delete') }).toEqual({
      statement,
      visitsRows: true,
    });
  });
});

describe('and the predicate that does it still takes every row with it', () => {
  it.each(sites)('%s', async (_name, site) => {
    await site.seed(db);

    // Counted before as well as after: a wipe of an empty table passes trivially, which would
    // make this a check that cannot fail.
    expect((await db.select({ id: site.table.id }).from(site.table)).length).toBe(site.seeded);
    if (site.tombstones !== null) {
      // `deleted_at` is exactly the column a careless "true for every row" would trip over —
      // `where deleted_at is null` looks like a filter for live rows and leaves every deleted
      // one on a signed-out phone.
      expect(await site.tombstones(db)).toBeGreaterThan(0);
    }

    await site.wipe(db);

    expect(await db.select({ id: site.table.id }).from(site.table)).toEqual([]);
  });
});

describe('why the obvious instrument is not used', () => {
  it('is disabled by the trigger that would have watched it', () => {
    // An `AFTER DELETE` trigger is the natural way to count rows going past, and it is
    // useless here: a trigger on the table is one of the conditions (`bComplex`) that turns
    // the truncate optimisation off, so a bare delete starts visiting rows the moment one
    // exists. Executed rather than asserted in a comment, because "the test changes the
    // behaviour it tests" is a claim worth being able to re-run.
    db.run(sql`create table wipe_probe (id text primary key not null)`);
    expect(opcodesOf('delete from wipe_probe')).toContain('Clear');

    db.run(sql`create table wipe_probe_log (n integer)`);
    db.run(
      sql`create trigger wipe_probe_watch after delete on wipe_probe begin insert into wipe_probe_log values (1); end`,
    );

    const watched = opcodesOf('delete from wipe_probe');
    expect(watched).not.toContain('Clear');
    expect(watched).toContain('Delete');
  });

  it('is why the check above reads the statement instead', () => {
    // And the other half of "guard the guards": the opcode check cannot tell `1 = 1` from a
    // predicate that matches nothing, because SQLite compiles both into the same row-visiting
    // shape. That is the whole reason the emptiness check exists beside it rather than being
    // filed as redundant with `dirty.test.ts`.
    db.run(sql`create table wipe_probe_2 (id text primary key not null)`);
    expect(opcodesOf('delete from wipe_probe_2 where 0 = 1')).toContain('Delete');
  });
});
