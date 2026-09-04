import { eq, getTableColumns } from 'drizzle-orm';

import {
  applyPulledDiveCenters,
  applyPulledDiveSites,
  createDiveCenter,
  createDiveSite,
  diveCenterMergeTargets,
  diveSiteMergeTargets,
  getDiveCenter,
  getDiveSite,
  listDiveCenters,
  listDiveSites,
  type PulledCenter,
  type PulledSite,
} from './catalogue';
import { diveSites } from './schema';
import { createTestDb, type TestDb } from './testDb';

/**
 * The device's copy of the community catalogue (DESIGN.md §5, §2.3) — the table §6's "Local
 * only" line never mentioned and §5's "the compact site/center catalogue syncs to every
 * device, so autocomplete works fully offline" requires.
 *
 * What is worth testing here is not that a row round-trips. It is the two things that are
 * silent when wrong: **which rows a read is allowed to offer** (a merged duplicate offered
 * back to a diver re-creates the duplicate an admin just merged away), and **what a pulled row
 * does to a local one** (an older row overwriting a newer one loses an edit, and a pulled row
 * arriving flagged pushes itself back).
 */

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});

const site = (over: Partial<PulledSite> = {}): PulledSite => ({
  id: 'site-1',
  name: 'Blue Hole',
  country: 'EG',
  latitude: 27.85,
  longitude: 34.31,
  salinity: 'salt',
  waterBody: 'ocean',
  entry: 'shore',
  maxDepthM: 130,
  createdBy: 'diver-1',
  status: 'active',
  mergedInto: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

const centre = (over: Partial<PulledCenter> = {}): PulledCenter => ({
  id: 'centre-1',
  name: 'Aquarius',
  country: 'EG',
  latitude: 27.85,
  longitude: 34.31,
  website: 'https://example.test',
  createdBy: 'diver-1',
  status: 'active',
  mergedInto: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

/** The row as stored, past the reads that filter — what a pull actually left behind. */
async function storedSite(id: string) {
  const rows = await db.select().from(diveSites).where(eq(diveSites.id, id));
  return rows.at(0);
}

describe('creating a site on the boat (§2.3, §5)', () => {
  it('asks only for a name, and fills the rest itself', async () => {
    const created = await createDiveSite(db, { name: 'Shark Point' });

    expect(created.name).toBe('Shark Point');
    // §6: client-generated UUIDv7, so an offline row never needs re-mapping.
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBe(created.updatedAt);
    expect(created.deletedAt).toBeNull();
    // §5 gives status and merged_into to the admin; a new row is active by the column default
    // and `push_changes` refuses both columns from a client outright.
    expect(created.status).toBe('active');
    expect(created.mergedInto).toBeNull();
    // The server writes it from auth.uid(); a locally invented one would be fiction.
    expect(created.createdBy).toBeNull();
    expect(created.dirty).toBe(true);
  });

  it('takes the pin and the facts §2.3 collects', async () => {
    const created = await createDiveSite(db, {
      name: 'Shark Point',
      country: 'EG',
      latitude: 27.85,
      longitude: 34.31,
      salinity: 'salt',
      waterBody: 'ocean',
      entry: 'boat',
      maxDepthM: 30,
    });

    expect(created.latitude).toBe(27.85);
    expect(created.longitude).toBe(34.31);
    expect(created.entry).toBe('boat');
    expect(created.maxDepthM).toBe(30);
  });

  it('strips a forged status, merged_into, created_by or flag rather than storing it', async () => {
    // The type already refuses all four; this is the cast or the untyped payload that got past
    // it — an M2e sync row, or a screen handing a form object through. A device that could
    // write `status` would hold an opinion the server would never accept, and the row would
    // read back different from what was sent.
    const forged = {
      name: 'Shark Point',
      status: 'merged',
      mergedInto: 'somewhere-else',
      createdBy: 'somebody-else',
      dirty: false,
      id: 'forged-id',
      createdAt: '2000-01-01T00:00:00.000Z',
    } as unknown as Parameters<typeof createDiveSite>[1];

    const created = await createDiveSite(db, forged);

    expect(created.id).not.toBe('forged-id');
    expect(created.status).toBe('active');
    expect(created.mergedInto).toBeNull();
    expect(created.createdBy).toBeNull();
    expect(created.createdAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(created.dirty).toBe(true);
  });

  it('creates a centre the same way, with its own facts', async () => {
    const created = await createDiveCenter(db, { name: 'Emperor', website: 'https://e.test' });

    expect(created.name).toBe('Emperor');
    expect(created.website).toBe('https://e.test');
    expect(created.status).toBe('active');
    expect(created.dirty).toBe(true);
  });
});

describe('what a read may offer (§5, and M2c drew the same line on the server)', () => {
  it('offers an active, untombstoned site', async () => {
    await applyPulledDiveSites(db, [site()]);
    expect((await listDiveSites(db)).map((row) => row.id)).toEqual(['site-1']);
    expect((await getDiveSite(db, 'site-1'))?.name).toBe('Blue Hole');
  });

  it('never offers a merged one, because offering it re-creates the duplicate', async () => {
    // §5's repair model is an admin setting `status` to `merged` with `merged_into` naming the
    // survivor. A pull delivers that row so the device is TOLD; autocomplete offering it would
    // put the duplicate straight back into the next dive.
    await applyPulledDiveSites(db, [site({ status: 'merged', mergedInto: 'site-2' })]);

    expect(await listDiveSites(db)).toEqual([]);
    expect(await getDiveSite(db, 'site-1')).toBeNull();
    // Told, though: the row is here, it is simply not on offer.
    expect((await storedSite('site-1'))?.mergedInto).toBe('site-2');
  });

  it('never offers a hidden one', async () => {
    await applyPulledDiveSites(db, [site({ status: 'hidden' })]);
    expect(await listDiveSites(db)).toEqual([]);
  });

  it('never offers a tombstoned one (§6, db/tombstone.ts)', async () => {
    await applyPulledDiveSites(db, [site({ deletedAt: '2026-08-17T00:00:00.000Z' })]);
    expect(await listDiveSites(db)).toEqual([]);
    expect(await getDiveSite(db, 'site-1')).toBeNull();
  });

  it('applies both halves of that filter to centres too', async () => {
    await applyPulledDiveCenters(db, [
      centre({ id: 'ok' }),
      centre({ id: 'merged', status: 'merged' }),
      centre({ id: 'gone', deletedAt: '2026-08-17T00:00:00.000Z' }),
    ]);

    expect((await listDiveCenters(db)).map((row) => row.id)).toEqual(['ok']);
    expect(await getDiveCenter(db, 'merged')).toBeNull();
  });
});

describe('where a merge sends a dive (§5, M2r)', () => {
  it('reads the survivor out of exactly the rows every other read hides', async () => {
    // The read above proves a merged row is never OFFERED. This is the other half, and the two
    // are the same row: `pickable` filters it out of everything a diver picks from, and this
    // read is the one place that has to see it. A `mergeTargets` that applied `pickable` would
    // answer the empty map for ever, silently, and nothing else in the app would notice.
    await applyPulledDiveSites(db, [site({ status: 'merged', mergedInto: 'site-2' })]);

    expect(await listDiveSites(db)).toEqual([]);
    expect(Object.fromEntries(await diveSiteMergeTargets(db))).toEqual({ 'site-1': 'site-2' });
  });

  it('follows a chain of merges to its end, through rows only this read can see', async () => {
    // The case one merge cannot show. Two admin merges a month apart leave `a` pointing at `b`
    // and `b` at `c`; a device that reads one hop leaves the dive at `b`, which is a row
    // nothing shows — the very defect being fixed, one step further along.
    await applyPulledDiveSites(db, [
      site({ id: 'a', status: 'merged', mergedInto: 'b' }),
      site({ id: 'b', status: 'merged', mergedInto: 'c' }),
      site({ id: 'c' }),
    ]);

    expect(Object.fromEntries(await diveSiteMergeTargets(db))).toEqual({ a: 'c', b: 'c' });
  });

  it('answers nothing for a circular merge, and answers at all', async () => {
    // The data is the server's and the server is not this repository's. What matters here is
    // that this call RETURNS — a walk with no cycle guard hangs, and a hung suite reads as a
    // slow one (M2l). `domain/merges.test.ts` holds the shapes; this pins that a real table
    // full of them cannot stop a pull.
    await applyPulledDiveSites(db, [
      site({ id: 'a', status: 'merged', mergedInto: 'b' }),
      site({ id: 'b', status: 'merged', mergedInto: 'a' }),
      site({ id: 'self', status: 'merged', mergedInto: 'self' }),
    ]);

    expect(Object.fromEntries(await diveSiteMergeTargets(db))).toEqual({});
  });

  it('does not follow a hidden row, and does not stop reading because of one', async () => {
    await applyPulledDiveSites(db, [
      site({ id: 'withdrawn', status: 'hidden', mergedInto: 'somewhere' }),
      site({ id: 'folded', status: 'merged', mergedInto: 'survivor' }),
    ]);

    expect(Object.fromEntries(await diveSiteMergeTargets(db))).toEqual({ folded: 'survivor' });
  });

  it('still follows a merged row that was later tombstoned', async () => {
    // The merge happened; a deletion afterwards does not un-say it, and the dives at the folded
    // row still belong with the survivor's. Same reasoning as `pendingRows`' (db/dirty.ts).
    await applyPulledDiveSites(db, [
      site({ status: 'merged', mergedInto: 'site-2', deletedAt: '2026-08-17T00:00:00.000Z' }),
    ]);

    expect(Object.fromEntries(await diveSiteMergeTargets(db))).toEqual({ 'site-1': 'site-2' });
  });

  it('answers an empty map for a catalogue nobody has merged anything in', async () => {
    await applyPulledDiveSites(db, [site()]);
    expect(await diveSiteMergeTargets(db)).toEqual(new Map());
    expect(await diveCenterMergeTargets(db)).toEqual(new Map());
  });

  it('asks the same question of centres, which §5 merges in the same breath', async () => {
    // Not a courtesy: a dive carries `center_id` beside `site_id`, `tripKeyOf` groups trips by
    // the centre, and a merged centre splits one trip into two with nothing to show for it.
    await applyPulledDiveCenters(db, [
      centre({ id: 'a', status: 'merged', mergedInto: 'b' }),
      centre({ id: 'b', status: 'merged', mergedInto: 'c' }),
    ]);

    expect(Object.fromEntries(await diveCenterMergeTargets(db))).toEqual({ a: 'c', b: 'c' });
    // And the two tables are asked separately: a merged centre says nothing about sites.
    expect(await diveSiteMergeTargets(db)).toEqual(new Map());
  });
});

describe('applying what a pull returned (§7.2)', () => {
  it('writes a row this device has never seen, clean', async () => {
    const written = await applyPulledDiveSites(db, [site()]);

    expect(written).toEqual(['site-1']);
    expect((await storedSite('site-1'))?.dirty).toBe(false);
  });

  it('writes every column of it, derived from the table rather than listed', async () => {
    // §10 (M2b): "a helper is only a single owner if its output cannot lose a column". The
    // update set here comes from `getTableColumns`, so a column added to the catalogue is
    // carried by the next pull without anyone remembering — where a hand-written list produces
    // a column that arrives on first insert, looks right, and then never changes again.
    await applyPulledDiveSites(db, [site()]);

    const later = site({
      name: 'Blue Hole (north)',
      country: 'SD',
      latitude: 1.5,
      longitude: 2.5,
      salinity: 'fresh',
      waterBody: 'lake',
      entry: 'boat',
      maxDepthM: 42,
      createdBy: 'diver-2',
      status: 'hidden',
      mergedInto: 'site-2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      deletedAt: '2026-09-01T00:00:00.000Z',
    });
    await applyPulledDiveSites(db, [later]);

    const stored = await storedSite('site-1');
    const checked = Object.keys(getTableColumns(diveSites)).filter(
      (column) => column !== 'id' && column !== 'dirty',
    );
    // Floored: a column list that came back empty would make the loop below assert nothing.
    expect(checked.length).toBeGreaterThan(12);
    for (const column of checked) {
      expect(`${column}: ${String((stored as Record<string, unknown>)[column])}`).toBe(
        `${column}: ${String((later as Record<string, unknown>)[column])}`,
      );
    }
  });

  it('leaves a newer local row alone, and leaves its flag on', async () => {
    // The silent loss: a stale echo of a row the diver has just edited would otherwise
    // overwrite the edit — and clear the flag, so it would never be sent either.
    const created = await createDiveSite(db, { name: 'Shark Point' });

    const written = await applyPulledDiveSites(db, [
      site({ id: created.id, name: 'Stale Name', updatedAt: '2000-01-01T00:00:00.000Z' }),
    ]);

    expect(written).toEqual([]);
    const stored = await storedSite(created.id);
    expect(stored?.name).toBe('Shark Point');
    expect(stored?.dirty).toBe(true);
  });

  it('takes a newer server row over an older clean one, flag included', async () => {
    // The other half of §7's whole-row last-write-wins, on the rows it applies to: a row this
    // device has nothing outstanding on takes whatever the server last said.
    await applyPulledDiveSites(db, [site({ name: 'Shark Point', updatedAt: '2026-01-01T00:00:00.000Z' })]);

    const written = await applyPulledDiveSites(db, [
      site({ name: 'Shark Point (canonical)', updatedAt: '2099-01-01T00:00:00.000Z' }),
    ]);

    expect(written).toEqual(['site-1']);
    const stored = await storedSite('site-1');
    expect(stored?.name).toBe('Shark Point (canonical)');
    expect(stored?.dirty).toBe(false);
  });

  it('leaves a row this device still owes the server alone, however new the server’s copy is', async () => {
    // **M2g changed this case, and M2d's own test asserted the opposite** — that a newer server
    // row wins over a dirty local one and clears its flag. It was right about the rule §7 states
    // and wrong about what produces the comparison, which is a difference push made real:
    // `push_changes` restamps `updated_at` with the SERVER's clock, so the server's echo of a
    // row can carry a later timestamp than an edit made on this phone after the push went out —
    // purely because phones run behind. Under the old rule that echo wins, and the diver's edit
    // is gone with the flag that would have sent it. There is no second author in that story at
    // all; it is one device losing to itself.
    //
    // So a dirty row is left alone until it has gone up, and the server resolves the conflict on
    // the next push, which is where §7 puts that decision. `clearDirtyFlags` protects the flag
    // through a push; this protects the row it points at.
    const created = await createDiveSite(db, { name: 'Shark Point' });

    const written = await applyPulledDiveSites(db, [
      site({ id: created.id, name: 'Server echo', updatedAt: '2099-01-01T00:00:00.000Z' }),
    ]);

    expect(written).toEqual([]);
    const stored = await storedSite(created.id);
    expect(stored?.name).toBe('Shark Point');
    expect(stored?.dirty).toBe(true);
  });

  it('compares the timestamps as strings, in the ISO-Z spelling §7 makes the RPCs return', async () => {
    // M2a's trap, one layer down: `2026-09-02 09:00:00+00` and `2026-09-02T09:00:00.000Z` sort
    // differently, and the comparison here is SQLite's plain text comparison. This pins that
    // the two ISO-Z strings order the way their instants do.
    await applyPulledDiveSites(db, [site({ updatedAt: '2026-09-02T09:00:00.000Z' })]);
    await applyPulledDiveSites(db, [site({ name: 'A second earlier', updatedAt: '2026-09-02T08:59:59.999Z' })]);
    expect((await storedSite('site-1'))?.name).toBe('Blue Hole');

    await applyPulledDiveSites(db, [site({ name: 'A second later', updatedAt: '2026-09-02T09:00:00.001Z' })]);
    expect((await storedSite('site-1'))?.name).toBe('A second later');
  });

  it('writes nothing at all when a pull returned nothing', async () => {
    const created = await createDiveSite(db, { name: 'Shark Point' });

    expect(await applyPulledDiveSites(db, [])).toEqual([]);
    expect(await applyPulledDiveCenters(db, [])).toEqual([]);

    expect((await storedSite(created.id))?.dirty).toBe(true);
  });

  it('takes a whole catalogue in one call', async () => {
    const written = await applyPulledDiveSites(db, [
      site({ id: 'a', name: 'A' }),
      site({ id: 'b', name: 'B' }),
      site({ id: 'c', name: 'C' }),
    ]);

    expect(written.sort()).toEqual(['a', 'b', 'c']);
    expect((await listDiveSites(db)).map((row) => row.name).sort()).toEqual(['A', 'B', 'C']);
  });
});
