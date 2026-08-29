import { assignDiveNumbers } from '../domain/diveNumber';
import { createDive, listDives } from './dives';
import { settings } from './schema';
import { getDivesBefore, setDivesBefore } from './settings';
import { createTestDb, type TestDb } from './testDb';

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});

describe('getDivesBefore', () => {
  it('is 0 on a fresh database — no answer yet means no prior dives', async () => {
    expect(await getDivesBefore(db)).toBe(0);
  });

  it('returns a number, not the string the text column actually stores', async () => {
    // The whole point: settings is a text/text table, so the stored value is
    // '247'. Number.isInteger('247') is false, which is how the count used to
    // vanish.
    await db.insert(settings).values({ key: 'dives_before', value: '247' });
    const raw = (await db.select().from(settings))[0];
    expect(typeof raw?.value).toBe('string');

    const count = await getDivesBefore(db);
    expect(count).toBe(247);
    expect(typeof count).toBe('number');
  });

  it('throws rather than silently returning 0 for a value it cannot interpret', async () => {
    for (const bad of ['not a number', '', '   ', '2.5', '-3', 'NaN', 'Infinity', '1e3x']) {
      const fresh = createTestDb();
      await fresh.insert(settings).values({ key: 'dives_before', value: bad });
      await expect(getDivesBefore(fresh)).rejects.toThrow(/non-negative integer/i);
    }
  });

  it('accepts a value stored with surrounding whitespace', async () => {
    await db.insert(settings).values({ key: 'dives_before', value: ' 12 ' });
    expect(await getDivesBefore(db)).toBe(12);
  });

  it('ignores unrelated settings keys', async () => {
    await db.insert(settings).values({ key: 'units', value: 'metric' });
    expect(await getDivesBefore(db)).toBe(0);
  });
});

describe('setDivesBefore', () => {
  it('round-trips through the text column as a number', async () => {
    await setDivesBefore(db, 247);
    expect(await getDivesBefore(db)).toBe(247);
  });

  it('overwrites rather than inserting a second row', async () => {
    await setDivesBefore(db, 247);
    await setDivesBefore(db, 250);
    expect(await getDivesBefore(db)).toBe(250);
    expect(await db.select().from(settings)).toHaveLength(1);
  });

  it('accepts zero — a diver with no prior dives', async () => {
    await setDivesBefore(db, 0);
    expect(await getDivesBefore(db)).toBe(0);
  });

  it('refuses a count that is not a non-negative integer, keeping getDivesBefore safe', async () => {
    for (const bad of [-1, 2.5, NaN, Infinity, '247' as unknown as number]) {
      await expect(setDivesBefore(db, bad)).rejects.toThrow(/non-negative integer/i);
    }
    expect(await db.select().from(settings)).toHaveLength(0);
  });
});

describe('the numbering path this accessor exists to protect', () => {
  it('offsets dive numbers by the stored count instead of losing it', async () => {
    // With the raw string this produced 1; the diver's 247 pre-Ponor dives
    // vanished with no error anywhere.
    await setDivesBefore(db, 247);
    await createDive(db, { date: '2026-08-16' });
    const numbers = assignDiveNumbers(await listDives(db), await getDivesBefore(db));
    expect([...numbers.values()]).toEqual([248]);
  });
});
