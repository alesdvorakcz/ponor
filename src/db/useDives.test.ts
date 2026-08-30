import { createDive, diveRowsQuery, toDives } from './dives';
import { createTestDb, type TestDb } from './testDb';
import { divesBeforeQuery, readDivesBefore, setDivesBefore } from './settings';
import { composeDives } from './useDives';

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});

describe('composeDives', () => {
  it('numbers logged dives from the offset and leaves planned dives unnumbered', async () => {
    const first = await createDive(db, { date: '2026-08-16' });
    const second = await createDive(db, { date: '2026-08-17' });
    const planned = await createDive(db, { date: '2026-08-20', status: 'planned' });

    const { dives, numbers } = composeDives(await diveRowsQuery(db), 247);

    expect(dives.map((d) => d.id)).toEqual([planned.id, second.id, first.id]);
    expect(numbers.get(first.id)).toBe(248);
    expect(numbers.get(second.id)).toBe(249);
    expect(numbers.has(planned.id)).toBe(false);
  });

  it('treats an uninterpretable offset as no offset rather than throwing at render', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    const { numbers } = composeDives(await diveRowsQuery(db), Number.NaN);
    expect(numbers.get(dive.id)).toBe(1);
  });

  it('agrees with toDives on ordering — composeDives must not re-sort or re-filter on its own', async () => {
    // composeDives's job is numbering, not reading. If it ever grew a second
    // opinion about order (or the tombstone filter) instead of trusting the
    // rows it is handed through toDives, that would be exactly the
    // one-rule-two-places drift this task exists to close, one level up.
    await createDive(db, { date: '2026-08-16' });
    await createDive(db, { date: '2026-08-18' });
    await createDive(db, { date: '2026-08-17' });

    const rows = await diveRowsQuery(db);
    const { dives } = composeDives(rows, 0);
    expect(dives).toEqual(toDives(rows));
  });
});

describe('composeDives + readDivesBefore, the exact pipeline useDives runs', () => {
  it('reflects a real stored dives_before offset end to end', async () => {
    // composeDives's own tests above pass 247 in directly, which never
    // touches the settings table's text column. useDives always goes
    // through readDivesBefore first (settings.ts), which is where a stored
    // '247' gets turned back into the number 247 — this drives that exact
    // chain: setDivesBefore -> divesBeforeQuery -> readDivesBefore ->
    // composeDives, with nothing standing in for the middle two steps.
    await setDivesBefore(db, 247);
    const first = await createDive(db, { date: '2026-08-16' });

    const { numbers } = composeDives(
      await diveRowsQuery(db),
      readDivesBefore(await divesBeforeQuery(db)),
    );
    expect(numbers.get(first.id)).toBe(248);
  });

  it('is unaffected by a settings row for an unrelated key', async () => {
    const first = await createDive(db, { date: '2026-08-16' });
    const { numbers } = composeDives(
      await diveRowsQuery(db),
      readDivesBefore(await divesBeforeQuery(db)),
    );
    expect(numbers.get(first.id)).toBe(1);
  });
});
