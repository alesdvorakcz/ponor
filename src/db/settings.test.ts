import { assignDiveNumbers, isDiveCount } from '../domain/diveNumber';
import { createDive, listDives } from './dives';
import { settings } from './schema';
import {
  divesBeforeQuery,
  getDivesBefore,
  openFormGroupsQuery,
  readDivesBefore,
  readOpenFormGroups,
  readUnitSystem,
  setDivesBefore,
  setOpenFormGroups,
  setUnitSystem,
  unitSystemQuery,
} from './settings';
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

// The second key this local-only table holds (DESIGN.md §3's m/ft · bar/psi · °C/°F ·
// kg/lb). Read through the same builder/reader split `dives_before` uses above, so the
// Settings screen and the live hook cannot spell the key two ways.
describe('readUnitSystem', () => {
  it('is metric on a fresh database — the default a diver who never opened Settings gets', async () => {
    expect(readUnitSystem(await unitSystemQuery(db))).toBe('metric');
  });

  it('returns the stored system', async () => {
    await db.insert(settings).values({ key: 'units', value: 'imperial' });
    expect(readUnitSystem(await unitSystemQuery(db))).toBe('imperial');
    // ...and the other way, so a reader hard-wired to one value cannot pass.
    await db.update(settings).set({ value: 'metric' });
    expect(readUnitSystem(await unitSystemQuery(db))).toBe('metric');
  });

  it('falls back to metric for a value this build cannot honour, rather than throwing', async () => {
    // Unlike `dives_before`, which throws: every figure this app prints carries its own
    // unit word, so a preference that failed to load shows the right number under the
    // right label — see readUnitSystem's own docblock for why that asymmetry is deliberate.
    for (const bad of ['Imperial', 'nautical', '', '  metric  ', 'null']) {
      const fresh = createTestDb();
      await fresh.insert(settings).values({ key: 'units', value: bad });
      expect(readUnitSystem(await unitSystemQuery(fresh))).toBe('metric');
    }
  });

  it('ignores unrelated settings keys', async () => {
    await db.insert(settings).values({ key: 'dives_before', value: '247' });
    expect(readUnitSystem(await unitSystemQuery(db))).toBe('metric');
  });

  it('never throws on a malformed rows argument — it runs during a render, which may not throw', () => {
    const malformed = [null, undefined, 'nope', 42, [{}], [{ value: 42 }], [null]] as unknown[];
    for (const bad of malformed) {
      expect(() => readUnitSystem(bad as unknown[])).not.toThrow();
      expect(readUnitSystem(bad as unknown[])).toBe('metric');
    }
  });
});

describe('setUnitSystem', () => {
  it('records the choice where readUnitSystem finds it', async () => {
    await setUnitSystem(db, 'imperial');
    expect(readUnitSystem(await unitSystemQuery(db))).toBe('imperial');
  });

  it('overwrites the previous choice rather than adding a second row', async () => {
    await setUnitSystem(db, 'imperial');
    await setUnitSystem(db, 'metric');
    const rows = await unitSystemQuery(db);
    expect(rows).toHaveLength(1);
    expect(readUnitSystem(rows)).toBe('metric');
  });

  it('leaves the diver’s pre-Ponor count alone — two keys, one table', async () => {
    await setDivesBefore(db, 247);
    await setUnitSystem(db, 'imperial');
    expect(await getDivesBefore(db)).toBe(247);
    expect(readUnitSystem(await unitSystemQuery(db))).toBe('imperial');
  });
});

// ---------------------------------------------------------------------------------------
// form_groups_open — §2.2's "groups remember themselves" (M1h, three-state since M1i)
// ---------------------------------------------------------------------------------------
//
// The third key this table holds, and the one with the weakest claim on anything: a lost or
// unreadable value costs the diver one tap on a chevron. That is why every read below degrades
// rather than reports — an empty result means "nothing decided", which is what §2.2's own
// defaults answer, so this row can never make the form say something false.
//
// **What M1i changed, and why the three states below are each their own test.** The value was a
// list of the ids that were open, which cannot tell *the diver collapsed this* from *nobody has
// ever touched it*. That was sound while every group started closed and became a defect the
// moment two groups started OPEN: the collapse had nowhere to be written down, so it undid
// itself on the next dive. An absent key is now the third state, and a `false` is a decision.

describe('readOpenFormGroups', () => {
  it('is empty on a fresh database — nothing has been decided yet', async () => {
    expect(readOpenFormGroups(await openFormGroupsQuery(db))).toEqual({});
  });

  it('reads back both kinds of decision, and says nothing about a group with neither', async () => {
    await setOpenFormGroups(db, { conditions: true, times: false });
    expect(readOpenFormGroups(await openFormGroupsQuery(db))).toEqual({ conditions: true, times: false });
  });

  // --- The upgrade path, which is the half that only looks obviously correct ---
  //
  // Until M1i the stored value was `["gas"]`, meaning *gas open* and nothing at all about any
  // other group. The faithful reading is therefore `{gas: true}` and NOT "everything else
  // collapsed": the old row could not express a collapse, so it must not be read as holding one.
  // A diver upgrading with `["gas"]` remembered keeps gas open and gets §2.2's defaults for the
  // rest, which is exactly what they had.
  //
  // The direction that matters as much: a stored OBJECT must not be read as an array. `{}` is a
  // real value — every group decided about and then un-decided, or simply a first write — and
  // `Array.isArray({})` is false, so the object arm has to come second and be reached.
  it('reads an older build’s list of open ids as “these were open, nothing was collapsed”', async () => {
    await db.insert(settings).values({ key: 'form_groups_open', value: JSON.stringify(['gas', 'conditions']) });
    expect(readOpenFormGroups(await openFormGroupsQuery(db))).toEqual({ gas: true, conditions: true });
  });

  it('round-trips an empty object as “nothing decided”, without falling into the array arm', async () => {
    await setOpenFormGroups(db, {});
    expect(readOpenFormGroups(await openFormGroupsQuery(db))).toEqual({});
  });

  // Every way this row can be unreadable, and all of them mean the same thing: §2.2's defaults.
  // A `dives_before` this corrupt throws, deliberately — see that read's own docblock for why
  // the two are not the same kind of value.
  //
  // `{"conditions":"yes"}` is here for the arm that used to be "not an array": a value that is
  // not a boolean is not a decision, and dropping it is what stops a hand-edited row from
  // meaning whatever JavaScript's truthiness says it means.
  it.each([
    ['not JSON at all', 'conditions,gas'],
    ['JSON that is not a memory at all', '42'],
    ['a decision that is not a decision', '{"conditions":"yes"}'],
    ['an empty string', ''],
  ])('degrades %s to no memory rather than throwing', async (_case, value) => {
    await db.insert(settings).values({ key: 'form_groups_open', value });
    expect(readOpenFormGroups(await openFormGroupsQuery(db))).toEqual({});
  });

  // §10's "kept, not refused", the same policy `optionalTokenSet` applies to an equipment token
  // a newer client wrote: a build that has never heard of a group must not delete another
  // build's memory of it merely by opening a form. What is dropped is what could never be a
  // decision about a group at all.
  it('keeps a group it has never heard of, in both of its states', async () => {
    await db
      .insert(settings)
      .values({ key: 'form_groups_open', value: JSON.stringify({ conditions: true, profile: false, notes: 7 }) });
    expect(readOpenFormGroups(await openFormGroupsQuery(db))).toEqual({ conditions: true, profile: false });
  });

  it('keeps an unknown id out of an older build’s list too, and drops what is not an id', async () => {
    await db
      .insert(settings)
      .values({ key: 'form_groups_open', value: JSON.stringify(['conditions', 'profile', 7, null, { id: 'gas' }]) });
    expect(readOpenFormGroups(await openFormGroupsQuery(db))).toEqual({ conditions: true, profile: true });
  });
});

describe('setOpenFormGroups', () => {
  it('overwrites the previous memory rather than adding a second row', async () => {
    await setOpenFormGroups(db, { conditions: true });
    await setOpenFormGroups(db, { people: true, notes: true });
    const rows = await openFormGroupsQuery(db);
    expect(rows).toHaveLength(1);
    expect(readOpenFormGroups(rows)).toEqual({ people: true, notes: true });
  });

  // The whole memory, every time — which is what lets the form compose one write out of two
  // quick presses instead of losing the first (DiveFormScreen's `toggleGroup`).
  it('stores an empty memory as a real answer, not as an absence', async () => {
    await setOpenFormGroups(db, { conditions: true });
    await setOpenFormGroups(db, {});
    expect(readOpenFormGroups(await openFormGroupsQuery(db))).toEqual({});
  });

  // The write half of M1i's third state: a collapse has to survive as a `false`, because an id
  // simply left out reads as "never decided" and the group would start open again on the next
  // dive. Read back through the reader, so this pins the round trip rather than the JSON.
  it('stores a collapse as a decision, not as an omission', async () => {
    await setOpenFormGroups(db, { times: false });
    expect(readOpenFormGroups(await openFormGroupsQuery(db))).toEqual({ times: false });
  });

  it('leaves the other two keys alone — three keys, one table', async () => {
    await setDivesBefore(db, 247);
    await setUnitSystem(db, 'imperial');
    await setOpenFormGroups(db, { gas: true });
    expect(await getDivesBefore(db)).toBe(247);
    expect(readUnitSystem(await unitSystemQuery(db))).toBe('imperial');
    expect(readOpenFormGroups(await openFormGroupsQuery(db))).toEqual({ gas: true });
  });
});
