import { createDive, getDive, listDives, softDeleteDive, updateDive } from './dives';
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
