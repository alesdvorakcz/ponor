import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { getTableName } from 'drizzle-orm';

import { createDiveCenter, createDiveSite } from '../db/catalogue';
import { createDive, softDeleteDive } from '../db/dives';
import { createGearPreset } from '../db/gearPresets';
import { createTestDb, type TestDb } from '../db/testDb';
import { SYNCED_TABLES } from './sync';
import { PENDING_TABLES, usePendingChanges } from './usePendingChanges';

/**
 * **§7.5's quiet indicator, and the count behind it.**
 *
 * The database is real and in memory with the real migrations on it. Two things are stubbed and
 * both are stubbed *narrowly*, so that what is exercised is this module's own arithmetic and
 * `db/dirty.ts`'s real query rather than a fixture agreeing with itself:
 *
 * · `db/client`'s `db` becomes the in-memory one, because `expo-sqlite` is a native module and
 *   cannot run under Jest (`src/db/testDb.ts`).
 * · `useLiveQuery` becomes a synchronous read of **the query it is handed**. It is not given
 *   rows to return: it runs the real builder against the real database, so a query that
 *   selected the wrong rows — every row instead of the dirty ones, say — would show up here as
 *   a wrong number rather than as a fixture nobody checked.
 */

let mockDb: TestDb;

jest.mock('../db/client', () => ({
  get db() {
    return mockDb;
  },
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  // better-sqlite3's builder is synchronous under its promise surface, so `.all()` is the
  // whole of what a live read is here. `error`/`updatedAt` are part of the shape the real hook
  // returns and are deliberately left as a successful read: this module reads neither, and
  // `usePendingChanges.ts` records why.
  useLiveQuery: (query: { all: () => unknown[] }) => ({
    data: query.all(),
    error: undefined,
    updatedAt: new Date(),
  }),
}));

beforeEach(() => {
  mockDb = createTestDb();
});

/** The count, rendered — read back off the tree rather than captured in a variable, because
 * assigning to one during render is a side effect this repo's lint rejects outright, and
 * rightly: what a hook returns is what a screen draws. */
function Harness() {
  return <Text>{`pending ${usePendingChanges()}`}</Text>;
}

async function count(): Promise<number> {
  const tree = await render(<Harness />);
  // The root itself, then everything under it: `queryAll` walks descendants only, and this
  // harness's whole tree is a single node.
  const nodes = tree.root ? [tree.root, ...tree.root.queryAll(() => true)] : [];
  const lines = nodes
    .filter((node) => node.type === 'Text')
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === 'string');
  // Floored: no line at all would make every `toBe` below compare `NaN`, which fails — but it
  // would fail for the wrong reason, and a reader chasing it would be looking at the hook.
  expect(lines).toHaveLength(1);
  return Number(lines[0]?.replace('pending ', ''));
}

describe('the count', () => {
  it('is zero on a device that has written nothing', async () => {
    expect(await count()).toBe(0);
  });

  /**
   * **Every synced table is in it**, and each contributes a different number so that a term
   * dropped from the sum cannot be hidden by another. §7.4's wipe counts all four for the same
   * reason `countUnsyncedRows` gives — a per-table answer would let a diver's dives be treated
   * as sent because their presets were the thing that had not gone up.
   */
  it('adds up every table §7 pushes, and each of them differently', async () => {
    await createDive(mockDb, { date: '2026-08-16' });
    await createDive(mockDb, { date: '2026-08-17' });
    await createDive(mockDb, { date: '2026-08-18' });
    await createGearPreset(mockDb, { name: 'twin 12' });
    await createGearPreset(mockDb, { name: 'single 15' });
    await createDiveSite(mockDb, { name: 'Blue Hole' });
    await createDiveCenter(mockDb, { name: 'Dahab Divers' });
    await createDiveCenter(mockDb, { name: 'Nautilus' });
    await createDiveCenter(mockDb, { name: 'Poseidon' });
    await createDiveCenter(mockDb, { name: 'Triton' });

    expect(await count()).toBe(10);
  });

  /**
   * **A deleted dive is still owed.** §7 propagates a deletion as a row, so a tombstone is
   * pending until the server has it — `pendingRows` (db/dirty.ts) is deliberately not
   * tombstone-filtered, and an indicator that used the diver-facing read instead would tell
   * someone their logbook was fully synced while a deletion sat on the phone for ever.
   */
  it('counts a deleted dive, because a deletion has to go up like anything else', async () => {
    const dive = await createDive(mockDb, { date: '2026-08-16' });
    await softDeleteDive(mockDb, dive.id);

    expect(await count()).toBe(1);
  });

  /** It counts what is *owed*, not what exists: a row the server has acknowledged is not in it.
   * The flag is cleared here by hand rather than by a push, because what this asserts is the
   * condition being read and not the protocol. */
  it('leaves out a row the server has already taken', async () => {
    const dive = await createDive(mockDb, { date: '2026-08-16' });
    await createGearPreset(mockDb, { name: 'twin 12' });
    await mockDb.run(`update dives set dirty = 0 where id = '${dive.id}'`);

    expect(await count()).toBe(1);
  });
});

describe('the tie to §7’s own list of synced tables', () => {
  /**
   * **A fifth synced table must not be able to go missing from the indicator.**
   *
   * `cloud/sync.ts` owns the list (§4.1) and this module cannot loop over it — a hook inside a
   * loop is a hook whose call order depends on a list — so the tie is here instead: the two
   * lists name the same tables, in the same order. A table added to the protocol and not to
   * the count would otherwise be rows a diver is never told are waiting.
   */
  it('names exactly the tables §7 pushes, in the same order', () => {
    expect(PENDING_TABLES.map(getTableName)).toEqual(
      SYNCED_TABLES.map((synced) => getTableName(synced.table)),
    );
  });

  /** Floored, because two empty lists are equal. */
  it('is four tables, not an empty agreement', () => {
    expect(PENDING_TABLES.length).toBe(4);
    expect(PENDING_TABLES.map(getTableName)).toEqual([
      'dives',
      'gear_presets',
      'dive_sites',
      'dive_centers',
    ]);
  });
});
