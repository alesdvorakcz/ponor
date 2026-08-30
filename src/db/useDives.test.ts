import { assignDiveNumbers } from '../domain/diveNumber';
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

  // Review task 7, Minor #1 / cannot-fail #5: composeDives used to re-check
  // `isDiveCount(divesBefore) ? divesBefore : 0` itself before handing the result to
  // `assignDiveNumbers`, which applies the identical predicate with the identical fallback
  // — a fourth copy of a rule diveNumber.ts already owns (its own docblock names
  // `assignDiveNumbers` as the one legitimate site for exactly this fallback). Proven dead
  // by mutation: replacing composeDives's guard with a bare cast changed nothing, because
  // `assignDiveNumbers` re-derives the identical answer regardless. Removed, so composeDives
  // now forwards `divesBefore` unchanged — the assertion below pins THAT (delegation),
  // rather than re-testing the coercion rule itself, which diveNumber.test.ts already pins
  // with a mutation-resistant assertion tied directly to `isDiveCount`
  // ("is the same rule assignDiveNumbers applies to its offset").
  it('forwards an uninterpretable offset to assignDiveNumbers unchanged, rather than throwing at render', async () => {
    await createDive(db, { date: '2026-08-16' });
    const rows = await diveRowsQuery(db);
    expect(() => composeDives(rows, Number.NaN)).not.toThrow();
    // Not just "returns 1" (NaN and a hardcoded 0 would look identical that way) — compared
    // against calling assignDiveNumbers directly with the SAME uninterpretable value, so a
    // future composeDives that stopped forwarding divesBefore at all (e.g. hardcoded 0)
    // would diverge from this the moment the two are compared against a real offset too.
    const dives = toDives(rows);
    expect(composeDives(rows, Number.NaN).numbers).toEqual(assignDiveNumbers(dives, Number.NaN));
    expect(composeDives(rows, 247).numbers).toEqual(assignDiveNumbers(dives, 247));
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
