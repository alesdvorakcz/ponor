import { assignDiveNumbers } from '../domain/diveNumber';
import { createDive, getDive, listDives, softDeleteDive, updateDive } from './dives';
import { dives } from './schema';
import { createTestDb, type TestDb } from './testDb';

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});

describe('createDive', () => {
  it('saves a dive with only a date — the one required field', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    expect(dive.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(dive.date).toBe('2026-08-16');
    expect(dive.status).toBe('logged');
    expect(dive.maxDepthM).toBeNull();
    expect(dive.tanks).toEqual([]);
  });

  it('round-trips the tanks JSON array', async () => {
    const tanks = [
      { material: 'steel' as const, sizeL: 12, count: 1, workingBar: 232, o2Pct: 21, hePct: null, startBar: 200, endBar: 50 },
    ];
    const created = await createDive(db, { date: '2026-08-16', tanks });
    const read = await getDive(db, created.id);
    expect(read?.tanks).toEqual(tanks);
  });

  it('round-trips booleans as booleans, not integers', async () => {
    const created = await createDive(db, { date: '2026-08-16', hood: true, gloves: false });
    const read = await getDive(db, created.id);
    expect(read?.hood).toBe(true);
    expect(read?.gloves).toBe(false);
  });

  it('stamps created and updated times', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    expect(dive.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dive.updatedAt).toBe(dive.createdAt);
    expect(dive.deletedAt).toBeNull();
  });
});

describe('getDive', () => {
  it('returns null for an unknown id', async () => {
    expect(await getDive(db, 'nope')).toBeNull();
  });
});

describe('listDives', () => {
  it('returns every dive, newest date first', async () => {
    await createDive(db, { date: '2026-08-16' });
    await createDive(db, { date: '2026-08-18' });
    await createDive(db, { date: '2026-08-17' });
    expect((await listDives(db)).map((d) => d.date)).toEqual(['2026-08-18', '2026-08-17', '2026-08-16']);
  });

  it('includes planned dives — the list pins them on top itself', async () => {
    await createDive(db, { date: '2026-08-16' });
    await createDive(db, { date: '2026-08-20', status: 'planned' });
    expect(await listDives(db)).toHaveLength(2);
  });

  it('is empty on a fresh database', async () => {
    expect(await listDives(db)).toEqual([]);
  });

  it("orders in lock-step with assignDiveNumbers — the exact reverse, across every tier", async () => {
    // One fixture exercising every tier assignDiveNumbers sorts by (date,
    // timeIn, manualOrder, createdAt, id): two timed dives, two hand-ordered
    // (manualOrder) dives, two dives tied on everything down to id, and a
    // second date. createDive can't force an identical createdAt or a chosen
    // id, so these are inserted directly. A drift in any one tier between
    // this function's order and assignDiveNumbers's — the exact bug this
    // test exists to catch, since the two used to be two separate,
    // independently hand-written tier lists — would show up here.
    const rows: (typeof dives.$inferInsert)[] = [
      { id: 'd-timed-early', status: 'logged', date: '2026-08-16', timeIn: '08:00', manualOrder: null, createdAt: '2026-08-16T04:00:00.000Z', updatedAt: '2026-08-16T04:00:00.000Z' },
      { id: 'e-timed-late', status: 'logged', date: '2026-08-16', timeIn: '15:00', manualOrder: null, createdAt: '2026-08-16T05:00:00.000Z', updatedAt: '2026-08-16T05:00:00.000Z' },
      { id: 'c-hand-1', status: 'logged', date: '2026-08-16', timeIn: null, manualOrder: 1, createdAt: '2026-08-16T03:00:00.000Z', updatedAt: '2026-08-16T03:00:00.000Z' },
      { id: 'b-hand-2', status: 'logged', date: '2026-08-16', timeIn: null, manualOrder: 2, createdAt: '2026-08-16T02:00:00.000Z', updatedAt: '2026-08-16T02:00:00.000Z' },
      { id: 'a-untimed-tie', status: 'logged', date: '2026-08-16', timeIn: null, manualOrder: null, createdAt: '2026-08-16T01:00:00.000Z', updatedAt: '2026-08-16T01:00:00.000Z' },
      { id: 'z-untimed-tie', status: 'logged', date: '2026-08-16', timeIn: null, manualOrder: null, createdAt: '2026-08-16T01:00:00.000Z', updatedAt: '2026-08-16T01:00:00.000Z' },
      { id: 'f-other-date', status: 'logged', date: '2026-08-17', timeIn: null, manualOrder: null, createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z' },
    ];
    for (const row of rows) await db.insert(dives).values(row);

    const listed = await listDives(db);
    const numbers = assignDiveNumbers(listed, 0);

    // Tier-agnostic: whatever order listDives produces, the dive number
    // assigned to the dive at each position must count down from length to
    // 1 — i.e. this function's order is the exact reverse of
    // assignDiveNumbers's, position for position, regardless of which tier
    // decided that position.
    expect(listed).toHaveLength(rows.length);
    listed.forEach((dive, index) => {
      expect(numbers.get(dive.id)).toBe(listed.length - index);
    });

    // And a concrete, human-checkable sequence: newest date on top; within
    // 2026-08-16, the id-tied pair first (z before a — id descending, the
    // mirror of assignDiveNumbers's id-ascending tie-break), then
    // hand-ordered (higher manualOrder first), then timed (latest time
    // first) — the mirror image of date -> timeIn -> manualOrder ->
    // createdAt -> id ascending.
    expect(listed.map((d) => d.id)).toEqual([
      'f-other-date',
      'z-untimed-tie',
      'a-untimed-tie',
      'b-hand-2',
      'c-hand-1',
      'e-timed-late',
      'd-timed-early',
    ]);
  });
});

describe('updateDive', () => {
  it('changes only what it is given', async () => {
    const created = await createDive(db, { date: '2026-08-16', siteName: 'Elphinstone Reef' });
    const updated = await updateDive(db, created.id, { maxDepthM: 32.4 });
    expect(updated.maxDepthM).toBe(32.4);
    expect(updated.siteName).toBe('Elphinstone Reef');
  });

  it('moves updatedAt forward but leaves createdAt alone', async () => {
    const created = await createDive(db, { date: '2026-08-16' });
    const updated = await updateDive(db, created.id, { notes: 'Two oceanic whitetips.' });
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
  });

  it('can clear a field back to null', async () => {
    const created = await createDive(db, { date: '2026-08-16', buddy: 'Petr' });
    const updated = await updateDive(db, created.id, { buddy: null });
    expect(updated.buddy).toBeNull();
  });

  it('rejects an unknown id rather than silently doing nothing', async () => {
    await expect(updateDive(db, 'nope', { notes: 'x' })).rejects.toThrow(/not found/i);
  });
});

describe('softDeleteDive', () => {
  it('tombstones rather than removing, so sync can propagate the deletion', async () => {
    const created = await createDive(db, { date: '2026-08-16' });
    await softDeleteDive(db, created.id);
    expect(await getDive(db, created.id)).toBeNull();
    expect(await listDives(db)).toEqual([]);
  });
});
