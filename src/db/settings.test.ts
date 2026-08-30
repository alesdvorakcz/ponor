import { assignDiveNumbers, isDiveCount } from '../domain/diveNumber';
import { createDive, listDives } from './dives';
import { settings } from './schema';
import { divesBeforeQuery, getDivesBefore, readDivesBefore, setDivesBefore } from './settings';
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

  it('refuses JS numeric literal forms, which Number() would happily accept', async () => {
    // Number('0x10') is 16, Number('1e3') is 1000, Number('0b101') is 5 and
    // Number('+5') is 5 — every one an integer afterwards, so an isInteger
    // check alone lets a corrupted '0x10' become a pre-Ponor count of 16.
    // Nothing the app writes takes these forms (setDivesBefore writes
    // String(count)), which is exactly why anything that does is corruption.
    for (const bad of ['0x10', '1e3', '0b101', '0o17', '+5', '1_000']) {
      const fresh = createTestDb();
      await fresh.insert(settings).values({ key: 'dives_before', value: bad });
      await expect(getDivesBefore(fresh)).rejects.toThrow(/non-negative integer/i);
    }
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

describe('readDivesBefore', () => {
  it('is null when the row is absent — no answer yet, same as getDivesBefore treats it', () => {
    expect(readDivesBefore([])).toBeNull();
  });

  it('reads a genuinely stored count back as a real number, not the string the column stores', async () => {
    // The failure mode this function exists to not reintroduce: isDiveCount
    // requires typeof value === 'number', and the settings table is
    // text/text, so handing the raw '247' straight to isDiveCount would
    // silently read as "no offset" on every render of useDives — the exact
    // bug getDivesBefore's own module doc-comment describes, one function
    // over.
    await setDivesBefore(db, 247);
    const raw = readDivesBefore(await divesBeforeQuery(db));
    expect(raw).toBe(247);
    expect(isDiveCount(raw)).toBe(true);
  });

  it('coerces a value stored with surrounding whitespace, matching getDivesBefore', async () => {
    await db.insert(settings).values({ key: 'dives_before', value: ' 12 ' });
    expect(readDivesBefore(await divesBeforeQuery(db))).toBe(12);
  });

  it('degrades an uninterpretable stored value to something isDiveCount rejects, rather than throwing', async () => {
    await db.insert(settings).values({ key: 'dives_before', value: 'not a number' });
    const raw = readDivesBefore(await divesBeforeQuery(db));
    expect(isDiveCount(raw)).toBe(false);
  });

  it('never throws on a malformed rows argument — it runs during a render, which may not throw', () => {
    const malformed = [null, undefined, 'nope', 42, [{}], [{ value: 42 }], [null]] as unknown[];
    for (const bad of malformed) {
      expect(() => readDivesBefore(bad as unknown[])).not.toThrow();
    }
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
