import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';

import * as catalogueModule from './catalogue';
import {
  applyPulledDiveCenters,
  applyPulledDiveSites,
  clearDiveCenterDirtyFlags,
  clearDiveSiteDirtyFlags,
  createDiveCenter,
  createDiveSite,
  pendingDiveSites,
} from './catalogue';
import { clearDirtyFlags, type PushableTable } from './dirty';
import * as divesModule from './dives';
import {
  clearDiveDirtyFlags,
  createDive,
  getDive,
  pendingDives,
  reorderDivesForDate,
  softDeleteDive,
  updateDive,
} from './dives';
import * as presetsModule from './gearPresets';
import {
  clearGearPresetDirtyFlags,
  createGearPreset,
  pendingGearPresets,
  softDeleteGearPreset,
  updateGearPreset,
} from './gearPresets';
import { diveCenters, diveSites, dives, gearPresets } from './schema';
import { createTestDb, type TestDb } from './testDb';

/**
 * DESIGN.md §7.1's dirty flag, and the one property that matters about it: **you cannot write
 * without setting it, and you cannot set it without writing.**
 *
 * Every failure this file is aimed at is silent. A write path that forgets the flag is a row
 * that never reaches the server, on one device, raising nothing, possibly for months — the
 * dive is on screen, the save succeeded, the app says nothing is wrong. A no-op write that
 * *sets* it pushes an unchanged row and lets the server restamp `updated_at`, which under
 * §7's whole-row last-write-wins is the device that did nothing beating the device that did
 * something. A pulled row that arrives flagged pushes itself straight back. None of the three
 * is visible in a diff, a screen, a log or a lint.
 *
 * So this file does three things a review cannot:
 *
 *   1. **Enumerates every write path from the module's own exports** and requires each to be
 *      classified — a write that flags, a write that clears, or neither with a reason. A new
 *      export is red until somebody says which it is, so M2e adding a writer to one of these
 *      owners cannot quietly add an unflagged one.
 *   2. **Exercises each classified write against a real database**, from a row the harness
 *      has itself put into the opposite state — so "it ended up dirty" can only be the write
 *      under test, never left over from the create that set it up.
 *   3. **Holds the two halves of "every write sets it" structurally**: an INSERT that omits
 *      the flag does not compile (the column is NOT NULL with no Drizzle default, and the
 *      `@ts-expect-error` block below is what makes that falsifiable), and every UPDATE an
 *      owner issues is swept out of its source and required to carry the stamp — which is
 *      what catches a second write inside a function whose first write is the one an exercise
 *      looks at.
 */

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});

/** Long enough for `new Date().toISOString()` to move — the repositories' own `tick`. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** The flag as the column actually holds it, read past every repository that might mask it. */
async function isDirty(table: PushableTable, id: string): Promise<boolean> {
  const rows = await db.select({ dirty: table.dirty }).from(table).where(eq(table.id, id));
  const row = rows.at(0);
  if (row === undefined) throw new Error(`no row ${id}`);
  return row.dirty === true;
}

/** Puts a row into a state by hand, bypassing every rule this file is testing. */
async function setFlag(table: PushableTable, id: string, dirty: boolean): Promise<void> {
  await db
    .update(table)
    .set({ dirty } as Record<string, unknown>)
    .where(eq(table.id, id));
}

interface Subject {
  readonly table: PushableTable;
  readonly id: string;
  /** The clock as it stood when the subject was prepared — what a flag-clearing write needs. */
  readonly updatedAt?: string;
}

/**
 * How one export of an owner module treats the flag.
 *
 * `leaves: 'dirty'` is a write a diver made and the server has not seen. `leaves: 'clean'` is
 * the other direction — the flag coming off a row that has been sent, or a row that arrived
 * from the server and was never this device's to send. `reads` is everything that is not a
 * write at all, and it carries a reason so that reclassifying a writer as a reader is a
 * sentence somebody has to write rather than a line somebody deletes.
 */
type WritePath =
  | {
      readonly leaves: 'dirty' | 'clean';
      /** Prepares the row the write acts on. Omitted where the write creates its own. */
      readonly given?: (database: TestDb) => Promise<Subject>;
      readonly when: (database: TestDb, given: Subject | null) => Promise<Subject>;
    }
  | { readonly reads: string };

const aDive = async (database: TestDb): Promise<Subject> => {
  const dive = await createDive(database, { date: '2026-08-16' });
  return { table: dives, id: dive.id, updatedAt: dive.updatedAt };
};

const aPreset = async (database: TestDb): Promise<Subject> => {
  const preset = await createGearPreset(database, { name: 'twin 12 steel' });
  return { table: gearPresets, id: preset.id, updatedAt: preset.updatedAt };
};

const aSite = async (database: TestDb): Promise<Subject> => {
  const site = await createDiveSite(database, { name: 'Blue Hole' });
  return { table: diveSites, id: site.id, updatedAt: site.updatedAt };
};

const aCenter = async (database: TestDb): Promise<Subject> => {
  const centre = await createDiveCenter(database, { name: 'Aquarius' });
  return { table: diveCenters, id: centre.id, updatedAt: centre.updatedAt };
};

/** The subject as the harness prepared it, or a loud failure — never a silently skipped case. */
function required(given: Subject | null): Subject {
  if (given === null) throw new Error('this write path declares a `given` and did not get one');
  return given;
}

const DIVES: Record<keyof typeof divesModule, WritePath> = {
  createDive: {
    leaves: 'dirty',
    when: async (database) => {
      const dive = await createDive(database, { date: '2026-08-16', maxDepthM: 18 });
      return { table: dives, id: dive.id };
    },
  },
  updateDive: {
    leaves: 'dirty',
    given: aDive,
    when: async (database, given) => {
      const subject = required(given);
      await updateDive(database, subject.id, { notes: 'thermocline at 14 m' });
      return subject;
    },
  },
  reorderDivesForDate: {
    leaves: 'dirty',
    given: aDive,
    when: async (database, given) => {
      const subject = required(given);
      // A second untimed dive on the same date, so the reorder has two ids to renumber. Only
      // the first is the subject; the harness cleaned it, and this write has to flag it again.
      const second = await createDive(database, { date: '2026-08-16' });
      await setFlag(dives, second.id, false);
      await reorderDivesForDate(database, '2026-08-16', [second.id, subject.id]);
      return subject;
    },
  },
  softDeleteDive: {
    leaves: 'dirty',
    given: aDive,
    when: async (database, given) => {
      const subject = required(given);
      await softDeleteDive(database, subject.id);
      return subject;
    },
  },
  clearDiveDirtyFlags: {
    leaves: 'clean',
    given: aDive,
    when: async (database, given) => {
      const subject = required(given);
      await clearDiveDirtyFlags(database, [{ id: subject.id, updatedAt: subject.updatedAt ?? '' }]);
      return subject;
    },
  },
  liveDives: { reads: 'The tombstone filter (db/tombstone.ts), not a write.' },
  toDives: { reads: 'Rows to sorted domain dives — a mapper over what a read returned.' },
  getDive: { reads: 'A read.' },
  diveRowsQuery: { reads: 'A query builder for useLiveQuery.' },
  listDives: { reads: 'A read.' },
  pendingDives: { reads: 'The push set — reads the flag, never moves it.' },
};

const PRESETS: Record<keyof typeof presetsModule, WritePath> = {
  createGearPreset: {
    leaves: 'dirty',
    when: async (database) => {
      const preset = await createGearPreset(database, { name: 'alu 80' });
      return { table: gearPresets, id: preset.id };
    },
  },
  updateGearPreset: {
    leaves: 'dirty',
    given: aPreset,
    when: async (database, given) => {
      const subject = required(given);
      await updateGearPreset(database, subject.id, { name: 'twin 12 steel, nitrox' });
      return subject;
    },
  },
  softDeleteGearPreset: {
    leaves: 'dirty',
    given: aPreset,
    when: async (database, given) => {
      const subject = required(given);
      await softDeleteGearPreset(database, subject.id);
      return subject;
    },
  },
  clearGearPresetDirtyFlags: {
    leaves: 'clean',
    given: aPreset,
    when: async (database, given) => {
      const subject = required(given);
      await clearGearPresetDirtyFlags(database, [
        { id: subject.id, updatedAt: subject.updatedAt ?? '' },
      ]);
      return subject;
    },
  },
  getGearPreset: { reads: 'A read.' },
  gearPresetRowsQuery: { reads: 'A query builder for useLiveQuery.' },
  toGearPresets: { reads: 'Rows to sorted domain presets — a mapper.' },
  listGearPresets: { reads: 'A read.' },
  pendingGearPresets: { reads: 'The push set — reads the flag, never moves it.' },
};

/** A server row for a site, in the shape `pull_changes` renders (M2b's `sync_site`). */
const pulledSite = (id: string, updatedAt: string) => ({
  id,
  name: 'Blue Hole',
  country: 'EG',
  latitude: 27.85,
  longitude: 34.31,
  salinity: 'salt' as const,
  waterBody: 'ocean' as const,
  entry: 'shore' as const,
  maxDepthM: 130,
  createdBy: 'e5b0…',
  status: 'active' as const,
  mergedInto: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt,
  deletedAt: null,
});

const pulledCenter = (id: string, updatedAt: string) => ({
  id,
  name: 'Aquarius',
  country: 'EG',
  latitude: 27.85,
  longitude: 34.31,
  website: 'https://example.test',
  createdBy: 'e5b0…',
  status: 'active' as const,
  mergedInto: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt,
  deletedAt: null,
});

const CATALOGUE: Record<keyof typeof catalogueModule, WritePath> = {
  createDiveSite: {
    leaves: 'dirty',
    when: async (database) => {
      const site = await createDiveSite(database, { name: 'Shark Point' });
      return { table: diveSites, id: site.id };
    },
  },
  createDiveCenter: {
    leaves: 'dirty',
    when: async (database) => {
      const centre = await createDiveCenter(database, { name: 'Emperor' });
      return { table: diveCenters, id: centre.id };
    },
  },
  applyPulledDiveSites: {
    leaves: 'clean',
    given: aSite,
    when: async (database, given) => {
      const subject = required(given);
      await applyPulledDiveSites(database, [pulledSite(subject.id, '2099-01-01T00:00:00.000Z')]);
      return subject;
    },
  },
  applyPulledDiveCenters: {
    leaves: 'clean',
    given: aCenter,
    when: async (database, given) => {
      const subject = required(given);
      await applyPulledDiveCenters(database, [pulledCenter(subject.id, '2099-01-01T00:00:00.000Z')]);
      return subject;
    },
  },
  clearDiveSiteDirtyFlags: {
    leaves: 'clean',
    given: aSite,
    when: async (database, given) => {
      const subject = required(given);
      await clearDiveSiteDirtyFlags(database, [
        { id: subject.id, updatedAt: subject.updatedAt ?? '' },
      ]);
      return subject;
    },
  },
  clearDiveCenterDirtyFlags: {
    leaves: 'clean',
    given: aCenter,
    when: async (database, given) => {
      const subject = required(given);
      await clearDiveCenterDirtyFlags(database, [
        { id: subject.id, updatedAt: subject.updatedAt ?? '' },
      ]);
      return subject;
    },
  },
  diveSiteRowsQuery: { reads: 'A query builder for useLiveQuery.' },
  diveCenterRowsQuery: { reads: 'A query builder for useLiveQuery.' },
  listDiveSites: { reads: 'A read.' },
  listDiveCenters: { reads: 'A read.' },
  getDiveSite: { reads: 'A read.' },
  getDiveCenter: { reads: 'A read.' },
  pendingDiveSites: { reads: 'The push set — reads the flag, never moves it.' },
  pendingDiveCenters: { reads: 'The push set — reads the flag, never moves it.' },
};

const OWNERS: Record<string, { module: Record<string, unknown>; paths: Record<string, WritePath> }> = {
  'db/dives.ts': { module: divesModule, paths: DIVES },
  'db/gearPresets.ts': { module: presetsModule, paths: PRESETS },
  'db/catalogue.ts': { module: catalogueModule, paths: CATALOGUE },
};

const writePaths = Object.entries(OWNERS).flatMap(([owner, { paths }]) =>
  Object.entries(paths).flatMap(([name, path_]) =>
    'reads' in path_ ? [] : [[`${owner} ${name}`, path_] as const],
  ),
);

describe('every write path is classified, and the classification is exhaustive (§4.1, §7.1)', () => {
  it.each(Object.keys(OWNERS))('%s classifies every one of its exports', (owner) => {
    const entry = OWNERS[owner];
    if (entry === undefined) throw new Error(`no owner ${owner}`);
    // Read from the module object, not from a list here: an export added by a later task —
    // M2e's "mark every row dirty at sign-in" (§7.4) is the one already owed — turns this red
    // until it is placed. A write path nobody classified is a write path nobody exercised.
    expect(Object.keys(entry.paths).sort()).toEqual(Object.keys(entry.module).sort());
    expect(Object.keys(entry.module).length).toBeGreaterThan(4);
  });

  it('floors how many write paths each owner has, so one cannot be filed as a read', () => {
    // Classification is only as good as its floor. Nothing above stops somebody moving
    // `createDive` into the `reads` half with a plausible sentence — and it would then simply
    // never be exercised, which is a green suite that has stopped checking the thing it is
    // named after. These are today's counts, and they go UP by a deliberate edit.
    const FLOORS: Record<string, number> = {
      // create · update · reorder · soft-delete · clear
      'db/dives.ts': 5,
      // create · update · soft-delete · clear
      'db/gearPresets.ts': 4,
      // create ×2 · apply-pulled ×2 · clear ×2
      'db/catalogue.ts': 6,
    };
    expect(Object.keys(FLOORS).sort()).toEqual(Object.keys(OWNERS).sort());
    for (const [owner, floor] of Object.entries(FLOORS)) {
      expect(`${owner}: ${writePaths.filter(([name]) => name.startsWith(owner)).length}`).toBe(
        `${owner}: ${floor}`,
      );
    }
    expect(writePaths.length).toBe(15);

    // And a read is classified with a reason, not with an empty string.
    for (const { paths } of Object.values(OWNERS)) {
      for (const path_ of Object.values(paths)) {
        if ('reads' in path_) expect(path_.reads.trim().length).toBeGreaterThan(5);
      }
    }
  });
});

describe('what each write does to the flag, exercised against a real database (§7.1)', () => {
  it.each(writePaths)('%s', async (_name, path_) => {
    const given = path_.given ? await path_.given(db) : null;

    // The row starts in the OPPOSITE state to the one being claimed, and that is what makes
    // the assertion mean anything: a `createDive` that flags would otherwise carry every
    // later write in its module, and a `clear` would pass against a row that was never dirty.
    if (given !== null) {
      await setFlag(given.table, given.id, path_.leaves !== 'dirty');
      expect(await isDirty(given.table, given.id)).toBe(path_.leaves !== 'dirty');
      await tick();
    }

    const subject = await path_.when(db, given);
    expect(await isDirty(subject.table, subject.id)).toBe(path_.leaves === 'dirty');
  });
});

describe('the flag is a consequence of a write, never its subject (§4.1)', () => {
  it('ignores a forged flag in a create, the way it ignores a forged id or clock', async () => {
    // `IMMUTABLE_FIELDS` already makes this a compile error; this is the cast or the untyped
    // payload that got past it — and the value it would forge is the dangerous one. A caller
    // able to write `dirty: false` is a caller telling the repository that the server has seen
    // something it has not, which is a dive that exists on exactly one phone for ever.
    const forged = { date: '2026-08-16', dirty: false } as unknown as Parameters<typeof createDive>[1];
    const dive = await createDive(db, forged);
    expect(await isDirty(dives, dive.id)).toBe(true);

    const preset = await createGearPreset(db, {
      name: 'alu 80',
      dirty: false,
    } as unknown as Parameters<typeof createGearPreset>[1]);
    expect(await isDirty(gearPresets, preset.id)).toBe(true);
  });

  it('treats a patch of nothing but a forged flag as the no-op it is', async () => {
    // **This is what makes the runtime strip load-bearing, and it took a mutation to find.**
    // A forged flag in a CREATE is defeated twice over — the strip removes it, and the stamp
    // is spread last in the row literal anyway — so a test of that alone stays green with the
    // strip deleted, which is `IMMUTABLE_FIELDS`'s own docblock warning about object-literal
    // order arriving in practice. Here the strip is the only defender: unstripped, `dirty`
    // names a real column, so the patch is no longer empty, the early return does not fire,
    // and a patch that asks for nothing becomes a real write that advances `updated_at` —
    // §6's "a device that did nothing must not win against one that did".
    const dive = await createDive(db, { date: '2026-08-16' });
    await setFlag(dives, dive.id, false);
    await tick();

    const unchanged = await updateDive(db, dive.id, {
      dirty: false,
    } as unknown as Parameters<typeof updateDive>[2]);

    expect(unchanged.updatedAt).toBe(dive.updatedAt);
    expect(await isDirty(dives, dive.id)).toBe(false);
  });

  it('ignores a forged flag in a patch', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    await clearDiveDirtyFlags(db, [{ id: dive.id, updatedAt: dive.updatedAt }]);
    await tick();

    // The patch names a real column, so nothing rejects it as unknown — it is stripped. It
    // carries a real edit beside it, because a patch of nothing but the forged flag is a
    // no-op, and a no-op correctly writes nothing at all (see the block below).
    await updateDive(db, dive.id, {
      notes: 'thermocline at 14 m',
      dirty: false,
    } as unknown as Parameters<typeof updateDive>[2]);

    // The edit landed and flagged the row; the forged value did not survive the strip.
    expect((await getDive(db, dive.id))?.notes).toBe('thermocline at 14 m');
    expect(await isDirty(dives, dive.id)).toBe(true);
  });
});

describe('a write that changes nothing must not flag (§6, §7)', () => {
  // §6's reason for `updated_at` — "a device that did nothing must not win against one that
  // did" — reaches the flag whole, and one step further: a no-op that flagged would push an
  // unchanged row, have the server restamp it, and hand the conflict to the device that made
  // no edit. Both repositories already refuse to advance the clock; this is the same refusal
  // read off the other column.
  it('updateDive with nothing left to write leaves the flag alone', async () => {
    const dive = await createDive(db, { date: '2026-08-16', notes: 'kelp' });
    await setFlag(dives, dive.id, false);

    const unchanged = await updateDive(db, dive.id, {});

    expect(unchanged.id).toBe(dive.id);
    expect(unchanged.updatedAt).toBe(dive.updatedAt);
    expect(await isDirty(dives, dive.id)).toBe(false);
  });

  it('updateGearPreset asked for what is already stored leaves the flag alone', async () => {
    const preset = await createGearPreset(db, { name: 'twin 12 steel' });
    await setFlag(gearPresets, preset.id, false);
    await tick();

    const unchanged = await updateGearPreset(db, preset.id, { name: 'twin 12 steel', tanks: [] });

    expect(unchanged.updatedAt).toBe(preset.updatedAt);
    expect(await isDirty(gearPresets, preset.id)).toBe(false);
  });
});

describe('the push set (§7.1)', () => {
  it('holds a deleted dive, because a tombstone is what tells the other device', async () => {
    // The mistake this exists against is one line: reusing `liveDives` — the filter every read
    // of a dive applies — for the push set. Deletions would then never leave the phone, and
    // the diver's other device would keep showing a dive they deleted, with nothing raised.
    const dive = await createDive(db, { date: '2026-08-16' });
    await clearDiveDirtyFlags(db, [{ id: dive.id, updatedAt: dive.updatedAt }]);
    await tick();
    await softDeleteDive(db, dive.id);

    const pending = await pendingDives(db);
    expect(pending.map((row) => row.id)).toEqual([dive.id]);
    expect(pending.at(0)?.deletedAt).not.toBeNull();
  });

  it('holds a deleted preset, for the same reason', async () => {
    const preset = await createGearPreset(db, { name: 'alu 80' });
    await clearGearPresetDirtyFlags(db, [{ id: preset.id, updatedAt: preset.updatedAt }]);
    await tick();
    await softDeleteGearPreset(db, preset.id);

    expect((await pendingGearPresets(db)).map((row) => row.id)).toEqual([preset.id]);
  });

  it('holds nothing once everything has gone up', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    const preset = await createGearPreset(db, { name: 'alu 80' });
    const site = await createDiveSite(db, { name: 'Blue Hole' });

    await clearDiveDirtyFlags(db, [{ id: dive.id, updatedAt: dive.updatedAt }]);
    await clearGearPresetDirtyFlags(db, [{ id: preset.id, updatedAt: preset.updatedAt }]);
    await clearDiveSiteDirtyFlags(db, [{ id: site.id, updatedAt: site.updatedAt }]);

    expect(await pendingDives(db)).toEqual([]);
    expect(await pendingGearPresets(db)).toEqual([]);
    expect(await pendingDiveSites(db)).toEqual([]);
  });
});

describe('clearing a flag (§7.1, "the client clears its flags")', () => {
  it('keeps the flag on a row edited while the push was in flight', async () => {
    // The silent loss this refuses: a push takes a second, the diver edits a dive while it is
    // in the air, and a clear that swept every flag would drop an edit the server has never
    // seen. The dive would look right on the phone and never sync again.
    const dive = await createDive(db, { date: '2026-08-16' });
    const pushed = { id: dive.id, updatedAt: dive.updatedAt };
    await tick();

    const edited = await updateDive(db, dive.id, { notes: 'edited mid-push' });
    expect(edited.updatedAt).not.toBe(dive.updatedAt);

    const cleared = await clearDiveDirtyFlags(db, [pushed]);

    expect(cleared).toEqual([]);
    expect(await isDirty(dives, dive.id)).toBe(true);
  });

  it('clears nothing when handed nothing, rather than clearing the table', async () => {
    // `and()`/`or()` are `SQL | undefined` in Drizzle and `.where(undefined)` is an UPDATE with
    // no WHERE at all — every row in the table, silently, which on the next sync means every
    // unsent dive on the device is quietly forgotten.
    const first = await createDive(db, { date: '2026-08-16' });
    const second = await createDive(db, { date: '2026-08-17' });

    expect(await clearDirtyFlags(db, dives, [])).toEqual([]);

    expect(await isDirty(dives, first.id)).toBe(true);
    expect(await isDirty(dives, second.id)).toBe(true);
  });

  it('clears only the rows it was handed', async () => {
    const first = await createDive(db, { date: '2026-08-16' });
    const second = await createDive(db, { date: '2026-08-17' });

    const cleared = await clearDiveDirtyFlags(db, [{ id: first.id, updatedAt: first.updatedAt }]);

    expect(cleared).toEqual([first.id]);
    expect(await isDirty(dives, first.id)).toBe(false);
    expect(await isDirty(dives, second.id)).toBe(true);
  });
});

describe('the owners are the only writers, and every write of theirs carries the stamp', () => {
  const SRC = path.join(__dirname, '..');
  const OWNER_SOURCES = ['dives.ts', 'gearPresets.ts', 'catalogue.ts', 'dirty.ts'].map((file) =>
    path.join(__dirname, file),
  );

  /** Every source file of the app — tests excluded, since a test may write what it likes. */
  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    });
  }

  it('lets only the repositories write to the database at all (§4.1)', () => {
    // §4.1 gives every write to a dive to `db/dives.ts` and every write to a preset to
    // `db/gearPresets.ts`, and M2d adds the catalogue's to `db/catalogue.ts`. That is what
    // makes "every write sets the flag" checkable at all: a screen or a hook issuing its own
    // UPDATE would be outside every rule above, and would fail nothing.
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(50);

    const writers = files
      .filter((file) => /\bdb\s*\.\s*(insert|update|delete)\s*\(/s.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file))
      .sort();

    expect(writers).toEqual(
      [
        'db/catalogue.ts',
        // The shared mechanism the three owners reach the flag through — it is reached from
        // an owner and from nowhere else, which the classification matrix above is what pins.
        'db/dirty.ts',
        'db/dives.ts',
        'db/gearPresets.ts',
        // The two local-only tables (§6). Neither is synced, so neither has a flag to set:
        // `settings` is the diver's preferences and `sync_state` is §7.3's watermark.
        'db/settings.ts',
        'db/syncState.ts',
      ].sort(),
    );
  });

  it('stamps every UPDATE an owner issues, in one of the three spellings there are', () => {
    // The enumerating half of the matrix above, and it is aimed at UPDATEs specifically: a
    // second `.set(` inside a function whose first write is the one an exercise looks at would
    // pass every assertion so far. (Inserts are held one level harder — by the compiler, see
    // the block below — because the column is NOT NULL with no Drizzle default.)
    //
    // **The check is over spellings, and that is deliberate rather than a weakness.** There
    // are exactly three ways an owner writes the flag: `...stampLocalWrite()` inline, a spread
    // of a `stamp` taken from it a line earlier (where a second timestamp has to equal it),
    // and `dirty:` written out (the one place the flag comes OFF a row). A fourth spelling
    // fails here and has to be added on purpose, which is the same "an exception list you edit
    // deliberately" the parity tests are built on.
    const sites: string[] = [];
    for (const file of OWNER_SOURCES) {
      const source = fs.readFileSync(file, 'utf8');
      const name = path.basename(file);
      for (const match of source.matchAll(/\.set\(/g)) {
        const end = source.indexOf(';', match.index);
        const statement = source.slice(match.index, end === -1 ? source.length : end);
        sites.push(
          `${name} ${
            /\.\.\.stampLocalWrite\(\)|\.\.\.stamp[ ,}]|dirty:/.test(statement) ? 'stamped' : 'UNSTAMPED'
          }`,
        );
      }
    }

    // Floored, so a sweep that stopped matching — a reformatted `.set (`, a rename — cannot
    // pass by finding nothing at all. Six today: three edits, two soft deletes, one clear.
    expect(sites.length).toBeGreaterThan(5);
    expect(sites.filter((site) => site.endsWith('UNSTAMPED'))).toEqual([]);
  });

  it('does not compile an insert that leaves the flag out (§7.1)', () => {
    // The insert side of the same guarantee, and the strongest form available: `dirty` is NOT
    // NULL with **no Drizzle default**, so Drizzle's own insert type requires it. Every
    // `@ts-expect-error` below is an assertion that `npm run typecheck` still refuses the row
    // — delete the flag from `schema.ts`'s `dirtyFlag`, or give it a `.default()`, and these
    // four lines stop erroring and the gate goes red.
    const stamps = { createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z' };

    // @ts-expect-error — a dive insert with no flag
    const dive: typeof dives.$inferInsert = { id: 'a', date: '2026-08-16', ...stamps };
    // @ts-expect-error — a preset insert with no flag
    const preset: typeof gearPresets.$inferInsert = { id: 'b', name: 'alu 80', ...stamps };
    // @ts-expect-error — a site insert with no flag
    const site: typeof diveSites.$inferInsert = { id: 'c', ...stamps };
    // @ts-expect-error — a centre insert with no flag
    const centre: typeof diveCenters.$inferInsert = { id: 'd', ...stamps };

    // Used, so the four declarations are not dead code the linter would ask to delete.
    expect([dive, preset, site, centre].map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('the migration that added the flag (0001)', () => {
  const MIGRATIONS = path.join(__dirname, 'migrations');
  const apply = (sqlite: Database.Database, file: string) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) sqlite.exec(statement);
  };

  it('lands on a database that already holds dives, and marks them all as owing a push', () => {
    // **This is the case `createTestDb` cannot see.** SQLite accepts `add column … not null`
    // with no default on an EMPTY table and refuses it on one with rows — so the migration
    // drizzle-kit generated passes every test in this repository and fails on the first phone
    // that has ever logged a dive. The `default 1` in the file is what makes it run, and 1 is
    // also the honest value: nothing has ever been pushed, so everything is owed.
    const sqlite = new Database(':memory:');
    apply(sqlite, '0000_thin_warpath.sql');
    sqlite
      .prepare('insert into dives (id, date, created_at, updated_at) values (?, ?, ?, ?)')
      .run('pre-existing', '2026-08-16', '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z');

    apply(sqlite, '0001_steep_drax.sql');

    const row = sqlite.prepare('select dirty from dives where id = ?').get('pre-existing');
    expect(row).toEqual({ dirty: 1 });
  });

  it('would not run at all without that default, which is why it is written down', () => {
    // Executed rather than asserted in a comment: this is the exact statement drizzle-kit
    // emits for a `.notNull()` column with no Drizzle-side default.
    const sqlite = new Database(':memory:');
    apply(sqlite, '0000_thin_warpath.sql');
    sqlite
      .prepare('insert into dives (id, date, created_at, updated_at) values (?, ?, ?, ?)')
      .run('pre-existing', '2026-08-16', '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z');

    expect(() => sqlite.exec('ALTER TABLE `dives` ADD `flagless` integer NOT NULL;')).toThrow(
      /NOT NULL column with default value NULL/,
    );
  });
});
