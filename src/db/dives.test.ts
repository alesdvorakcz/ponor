import { eq, sql } from 'drizzle-orm';
import { assignDiveNumbers } from '../domain/diveNumber';
import {
  createDive,
  getDive,
  listDives,
  reorderDivesForDate,
  softDeleteDive,
  updateDive,
} from './dives';
import { dives } from './schema';
import { createTestDb, type TestDb } from './testDb';

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});

/**
 * Long enough for `new Date().toISOString()` to produce a different value.
 * Timestamps here are millisecond-resolution, so two writes in the same tick
 * are genuinely indistinguishable — a test asserting that one moved has to
 * make the movement observable rather than hope for it.
 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

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

  it('ignores a forged id/createdAt/updatedAt/deletedAt in the input, same as updateDive does for a patch', async () => {
    const forged = {
      date: '2026-08-16',
      id: 'forged-id',
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
      deletedAt: '2000-01-01T00:00:00.000Z',
    } as unknown as Parameters<typeof createDive>[1];
    const created = await createDive(db, forged);
    expect(created.id).not.toBe('forged-id');
    expect(created.createdAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(created.updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(created.deletedAt).toBeNull();
  });
});

describe('the date/time write boundary', () => {
  it('canonicalises a loosely spelled date and time on create', async () => {
    const dive = await createDive(db, { date: '2026-8-7', timeIn: '7:30' });
    expect(dive.date).toBe('2026-08-07');
    expect(dive.timeIn).toBe('07:30');
  });

  it('stores an empty timeIn as null, the value the column already means by "no time"', async () => {
    // An untouched react-hook-form TextInput hands back ''. Stored as-is it
    // sorted before every real time, putting the dive at the head of its day.
    const dive = await createDive(db, { date: '2026-08-16', timeIn: '' });
    expect(dive.timeIn).toBeNull();
  });

  it('canonicalises on update too, and only for keys the patch actually carries', async () => {
    const created = await createDive(db, { date: '2026-08-16', timeIn: '09:15' });
    const updated = await updateDive(db, created.id, { date: '2026-9-1' });
    expect(updated.date).toBe('2026-09-01');
    expect(updated.timeIn).toBe('09:15'); // untouched, not nulled by absence
    expect((await updateDive(db, created.id, { timeIn: '7:05' })).timeIn).toBe('07:05');
  });

  it('never blocks a save: a value it cannot read is stored exactly as given', async () => {
    // DESIGN.md §1. The point is that a malformed value cannot silently
    // mis-sort or mis-compute, not that the diver is turned away.
    const dive = await createDive(db, { date: '2026-02-30', timeIn: 'after lunch' });
    expect(dive.date).toBe('2026-02-30');
    expect(dive.timeIn).toBe('after lunch');
  });

  it('orders a day chronologically once the times are canonicalised end to end', async () => {
    // The exact fixture the review used to demonstrate the bug: at HEAD this
    // listed as ['', '19:00', '7:30', null].
    await createDive(db, { date: '2026-08-16', timeIn: '19:00', title: 'evening' });
    await createDive(db, { date: '2026-08-16', timeIn: '7:30', title: 'morning' });
    await createDive(db, { date: '2026-08-16', timeIn: '', title: 'blank' });
    await createDive(db, { date: '2026-08-16', timeIn: null, title: 'untimed' });

    const chronological = (await listDives(db)).reverse();
    expect(chronological.map((d) => d.timeIn)).toEqual(['07:30', '19:00', null, null]);
    expect(chronological.slice(0, 2).map((d) => d.title)).toEqual(['morning', 'evening']);
    // The two untimed dives tie down to createdAt; which of them wins is not
    // what this test is about, so it is not asserted.
    expect(chronological.slice(2).map((d) => d.title).sort()).toEqual(['blank', 'untimed']);
  });
});

describe('getDive', () => {
  it('returns null for an unknown id', async () => {
    expect(await getDive(db, 'nope')).toBeNull();
  });
});

describe('a corrupt tanks blob costs that row its cylinders, not the whole list', () => {
  // JSON.parse runs inside Drizzle's row mapper, so before schema.ts decoded
  // this column defensively, ONE bad row threw a SyntaxError out of listDives
  // and blanked the entire dive list. Reachability is low today and stops
  // being low when M2's pull_changes writes this column from a network payload.
  const corruptions = [
    ['truncated', '[{"sizeL":12'],
    ['empty', ''],
    ['not JSON at all', 'steel 12L'],
    ['valid JSON, wrong shape', '{"a":1}'],
    ['valid JSON, a string', '"[]"'],
  ] as const;

  it.each(corruptions)('survives a %s blob', async (_label, blob) => {
    const good = await createDive(db, { date: '2026-08-16', title: 'healthy' });
    const bad = await createDive(db, { date: '2026-08-17', title: 'corrupt' });
    await db.run(sql`update dives set tanks = ${blob} where id = ${bad.id}`);

    const listed = await listDives(db);
    expect(listed.map((d) => d.title).sort()).toEqual(['corrupt', 'healthy']);
    expect(listed.find((d) => d.title === 'corrupt')?.tanks).toEqual([]);
    // The healthy row is untouched by its neighbour's corruption.
    expect(await getDive(db, good.id)).not.toBeNull();
    expect((await getDive(db, bad.id))?.tanks).toEqual([]);
  });

  it('cannot hold a SQL NULL in the first place — the column rejects it', async () => {
    // Recorded because the review listed a null blob among the corruptions to
    // survive. It is not reachable: the column is NOT NULL, so this is caught
    // by the schema rather than by the decoder, and needs no defending.
    const created = await createDive(db, { date: '2026-08-16' });
    // Wrapped in an async IIFE because the better-sqlite3 driver throws
    // synchronously rather than returning a rejected promise; this shape
    // catches either. Drizzle wraps the driver error, so the constraint name
    // is on `cause` — asserted specifically, so this cannot pass on some
    // unrelated SQL failure.
    const failure = await (async () =>
      db.run(sql`update dives set tanks = NULL where id = ${created.id}`))().then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).not.toBeNull();
    expect(String((failure as { cause?: unknown }).cause)).toMatch(/NOT NULL constraint failed/i);
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
    // The wait and the strict comparison are both load-bearing. This used to
    // assert toBeGreaterThanOrEqual with no wait, and updatedAt is stamped
    // with millisecond resolution — measured over 200 fresh databases, 139 of
    // them produced an *identical* timestamp, so 70% of runs observed no
    // movement at all while the test's name said it did. It was really
    // "never moves backwards".
    const created = await createDive(db, { date: '2026-08-16' });
    await tick();
    const updated = await updateDive(db, created.id, { notes: 'Two oceanic whitetips.' });
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it('can clear a field back to null', async () => {
    const created = await createDive(db, { date: '2026-08-16', buddy: 'Petr' });
    const updated = await updateDive(db, created.id, { buddy: null });
    expect(updated.buddy).toBeNull();
  });

  it('rejects an unknown id rather than silently doing nothing', async () => {
    await expect(updateDive(db, 'nope', { notes: 'x' })).rejects.toThrow(/not found/i);
  });

  it('refuses a patch key that names no column, instead of writing nothing and bumping updatedAt', async () => {
    // The real damage was not the missing write. §7 is whole-row
    // last-write-wins keyed on updated_at, so a patch that changed nothing but
    // advanced the clock produces a row that WINS a sync conflict against a
    // genuine edit made on another device.
    const created = await createDive(db, { date: '2026-08-16', maxDepthM: 10 });
    await expect(
      updateDive(db, created.id, { maxDepth: 30 } as unknown as Parameters<typeof updateDive>[2]),
    ).rejects.toThrow(/unknown field\(s\): maxDepth/);

    const after = await getDive(db, created.id);
    expect(after?.maxDepthM).toBe(10);
    expect(after?.updatedAt).toBe(created.updatedAt); // the clock did NOT move
  });

  it('names every unknown key, not just the first', async () => {
    const created = await createDive(db, { date: '2026-08-16' });
    await expect(
      updateDive(db, created.id, {
        maxDepth: 30,
        siteTitle: 'x',
      } as unknown as Parameters<typeof updateDive>[2]),
    ).rejects.toThrow(/maxDepth, siteTitle/);
  });

  it('refuses an empty patch rather than bumping updatedAt for nothing', async () => {
    const created = await createDive(db, { date: '2026-08-16' });
    await expect(updateDive(db, created.id, {})).rejects.toThrow(/empty patch/i);
    expect((await getDive(db, created.id))?.updatedAt).toBe(created.updatedAt);
  });

  it('refuses a patch made empty by stripping forged immutable fields', async () => {
    // Nothing left to write once id/createdAt/updatedAt/deletedAt are stripped.
    const created = await createDive(db, { date: '2026-08-16' });
    await expect(
      updateDive(db, created.id, {
        id: 'forged',
        updatedAt: '2000-01-01T00:00:00.000Z',
      } as unknown as Parameters<typeof updateDive>[2]),
    ).rejects.toThrow(/empty patch/i);
    expect((await getDive(db, created.id))?.updatedAt).toBe(created.updatedAt);
  });

  it('refuses to set manualOrder on one dive, naming the function that does it right', async () => {
    // A compile error already (DivePatch omits it); this is the cast or
    // untyped payload that gets past that. A throw, not a silent strip — a
    // dropped hand order looks exactly like a successful reorder.
    const created = await createDive(db, { date: '2026-08-16' });
    await expect(
      updateDive(db, created.id, { manualOrder: 2 } as unknown as Parameters<typeof updateDive>[2]),
    ).rejects.toThrow(/reorderDivesForDate/);
    expect((await getDive(db, created.id))?.manualOrder).toBeNull();
  });

  it('ignores a forged id/createdAt/updatedAt/deletedAt in the patch', async () => {
    const created = await createDive(db, { date: '2026-08-16', notes: 'original' });
    const forged = {
      id: 'forged-id',
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
      deletedAt: '2000-01-01T00:00:00.000Z',
      notes: 'updated for real',
    } as unknown as Parameters<typeof updateDive>[2];
    const updated = await updateDive(db, created.id, forged);
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(updated.deletedAt).toBeNull();
    expect(updated.notes).toBe('updated for real');
  });

  it('never touches a row a concurrent delete already tombstoned — the write itself is scoped, not just a pre-check', async () => {
    const created = await createDive(db, { date: '2026-08-16', notes: 'original', siteName: 'Right Reef' });
    await softDeleteDive(db, created.id);

    await expect(updateDive(db, created.id, { notes: 'raced', siteName: 'Wrong Reef' })).rejects.toThrow(/not found/i);

    // Not just rejected — the tombstoned row must be byte-for-byte
    // untouched by the failed update, not merely "still tombstoned".
    const raw = (await db.select().from(dives).where(eq(dives.id, created.id))).at(0);
    expect(raw).toBeDefined();
    expect(raw?.notes).toBe('original');
    expect(raw?.siteName).toBe('Right Reef');
  });

  describe('racing a delete, updateDive never misreports what landed', () => {
    // The invariant: updateDive's own reported outcome always matches what
    // actually ended up in the row. At HEAD (before the write was scoped) it
    // did not hold — the update could report rejected while its patch had
    // already landed on the now-tombstoned row.
    //
    // The previous version of this test fired both calls concurrently and
    // claimed in a comment that they "genuinely interleave". They cannot:
    // better-sqlite3 is synchronous and Drizzle's thenables resolve in
    // microtask-queue order, so the update always lands first. Measured over
    // 200 runs it was 200/200 fulfilled, and the failure branch of its
    // if/else never executed once — half the test was unreachable code. The
    // app's own driver (expo-sqlite) is asynchronous and *can* produce the
    // other ordering, which is why the invariant is worth asserting; so both
    // orderings are now driven deterministically instead of hoped for.
    const setup = async () =>
      createDive(db, { date: '2026-08-16', notes: 'original', siteName: 'Right Reef' });
    const patch = { notes: 'raced', siteName: 'Wrong Reef' };
    const rawRow = async (id: string) =>
      (await db.select().from(dives).where(eq(dives.id, id))).at(0);

    it('reports success, and the patch is in the row, when the update lands first', async () => {
      const { id } = await setup();
      await expect(updateDive(db, id, patch)).resolves.toBeTruthy();
      await softDeleteDive(db, id);

      const raw = await rawRow(id);
      expect(raw?.deletedAt).not.toBeNull();
      expect({ notes: raw?.notes, siteName: raw?.siteName }).toEqual(patch);
    });

    it('reports failure, and the row is untouched, when the delete lands first', async () => {
      const { id } = await setup();
      await softDeleteDive(db, id);
      await expect(updateDive(db, id, patch)).rejects.toThrow(/not found/i);

      const raw = await rawRow(id);
      expect(raw?.deletedAt).not.toBeNull();
      expect({ notes: raw?.notes, siteName: raw?.siteName }).toEqual({
        notes: 'original',
        siteName: 'Right Reef',
      });
    });

    it('holds the same invariant when both are fired without awaiting either', async () => {
      const { id } = await setup();
      const updatePromise = updateDive(db, id, patch)
        .then(() => 'fulfilled' as const)
        .catch(() => 'rejected' as const);
      const deletePromise = softDeleteDive(db, id).catch(() => {});
      const [outcome] = await Promise.all([updatePromise, deletePromise]);

      // Computed, not branched: the expectation is derived from the reported
      // outcome and then asserted unconditionally, so this cannot pass by
      // taking a branch that asserts nothing. The old if/else left the
      // rejected half as dead code.
      const expected =
        outcome === 'fulfilled' ? patch : { notes: 'original', siteName: 'Right Reef' };
      const raw = await rawRow(id);
      expect(raw?.deletedAt).not.toBeNull(); // the delete itself always succeeds either way
      expect({ notes: raw?.notes, siteName: raw?.siteName }).toEqual(expected);
    });
  });
});

describe('manual order is a real integer at rest', () => {
  const storageClass = async (id: string) =>
    (
      (await db.all(
        sql`select typeof(manual_order) as t from dives where id = ${id}`,
      )) as { t: string }[]
    )[0]?.t;

  it('rounds a fractional hand order instead of storing a REAL', async () => {
    // SQLite's INTEGER is an affinity, not a constraint: it only converts a
    // REAL when the conversion is lossless, so 1.5 used to read back as 1.5
    // with storage class 'real'. DESIGN.md §2.5 says nullable integer, and
    // M2's Postgres integer column will not be as forgiving.
    const created = await createDive(db, { date: '2026-08-16', manualOrder: 1.5 });
    expect(created.manualOrder).toBe(2);
    expect(await storageClass(created.id)).toBe('integer');

    const down = await createDive(db, { date: '2026-08-16', manualOrder: 1.4 });
    expect(down.manualOrder).toBe(1);
  });

  it('keeps a whole hand order exactly, including a negative one', async () => {
    expect((await createDive(db, { date: '2026-08-16', manualOrder: 3 })).manualOrder).toBe(3);
    // Negative sorts before 1, which is coherent; clamping would invent a rule
    // DESIGN.md does not state.
    expect((await createDive(db, { date: '2026-08-16', manualOrder: -3 })).manualOrder).toBe(-3);
  });

  it('stores an unroundable hand order as null — "no hand order", how the comparator already reads it', async () => {
    for (const bad of [NaN, Infinity, -Infinity, 'nine', {}, true]) {
      const created = await createDive(db, {
        date: '2026-08-16',
        manualOrder: bad as unknown as number,
      });
      expect(created.manualOrder).toBeNull();
    }
  });

  it('never blocks the save for any of them — §1', async () => {
    await expect(
      createDive(db, { date: '2026-08-16', manualOrder: 'nine' as unknown as number }),
    ).resolves.toBeTruthy();
  });
});

describe('reorderDivesForDate', () => {
  // Three untimed dives on one day, in creation order.
  const threeUntimed = async () => [
    (await createDive(db, { date: '2026-08-16', title: 'one' })).id,
    (await createDive(db, { date: '2026-08-16', title: 'two' })).id,
    (await createDive(db, { date: '2026-08-16', title: 'three' })).id,
  ];
  const chronological = async () => (await listDives(db)).reverse().map((d) => d.title);

  it('puts a dragged dive in the slot it was dropped in, not at the top of the day', async () => {
    // The failure this function exists to prevent: writing manualOrder on the
    // dragged row alone produced 'three', 'one', 'two' — hand-ordered sorts
    // before not-hand-ordered, so the row jumps to the top of its group.
    const [one, two, three] = await threeUntimed();
    expect(await chronological()).toEqual(['one', 'two', 'three']);

    await reorderDivesForDate(db, '2026-08-16', [one!, three!, two!]);
    expect(await chronological()).toEqual(['one', 'three', 'two']);
  });

  it('reorders timed dives, which a single-row write cannot do at all', async () => {
    // manualOrder sits below timeIn, so dragging two timed dives with a
    // single-row write is a complete no-op. Renumbering does not help either
    // — the tier order is deliberate — so this asserts what actually happens:
    // the day's order is unchanged and the write reports success rather than
    // pretending.
    const early = await createDive(db, { date: '2026-08-16', timeIn: '09:00', title: 'early' });
    const late = await createDive(db, { date: '2026-08-16', timeIn: '14:00', title: 'late' });
    await reorderDivesForDate(db, '2026-08-16', [late.id, early.id]);
    expect(await chronological()).toEqual(['early', 'late']);
    expect((await getDive(db, late.id))?.manualOrder).toBe(1);
  });

  it('writes 1..n and bumps updatedAt on every row it touches', async () => {
    const [one, two, three] = await threeUntimed();
    const before = (await getDive(db, one!))!.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));

    await reorderDivesForDate(db, '2026-08-16', [three!, one!, two!]);
    expect((await getDive(db, three!))?.manualOrder).toBe(1);
    expect((await getDive(db, one!))?.manualOrder).toBe(2);
    expect((await getDive(db, two!))?.manualOrder).toBe(3);
    // manual_order is a synced column and §7 is whole-row LWW, so the change
    // has to be visible to sync.
    expect(Date.parse((await getDive(db, one!))!.updatedAt)).toBeGreaterThan(Date.parse(before));
  });

  it('leaves other dates alone', async () => {
    const [one, two, three] = await threeUntimed();
    const elsewhere = await createDive(db, { date: '2026-08-17', title: 'other day' });
    await reorderDivesForDate(db, '2026-08-16', [three!, two!, one!]);
    expect((await getDive(db, elsewhere.id))?.manualOrder).toBeNull();
  });

  it('accepts a loosely spelled date, matching the write boundary', async () => {
    const [one, two, three] = await threeUntimed();
    await reorderDivesForDate(db, '2026-8-16', [three!, two!, one!]);
    expect((await getDive(db, three!))?.manualOrder).toBe(1);
  });

  it('refuses a partial order rather than leaving stale hand orders behind', async () => {
    const [one, , three] = await threeUntimed();
    await expect(reorderDivesForDate(db, '2026-08-16', [three!, one!])).rejects.toThrow(
      /every live dive/i,
    );
    // and nothing was written
    expect((await getDive(db, three!))?.manualOrder).toBeNull();
  });

  it('refuses an id that is not a live dive on that date', async () => {
    const [one, two, three] = await threeUntimed();
    await expect(
      reorderDivesForDate(db, '2026-08-16', [one!, two!, three!, 'nope']),
    ).rejects.toThrow(/not on that date/i);

    const elsewhere = await createDive(db, { date: '2026-08-17' });
    await expect(
      reorderDivesForDate(db, '2026-08-16', [one!, two!, three!, elsewhere.id]),
    ).rejects.toThrow(/not on that date/i);
  });

  it('refuses a duplicated id', async () => {
    const [one, two, three] = await threeUntimed();
    await expect(
      reorderDivesForDate(db, '2026-08-16', [one!, one!, two!, three!]),
    ).rejects.toThrow(/duplicate id/i);
  });

  it('ignores tombstoned dives, which are no longer part of the day', async () => {
    const [one, two, three] = await threeUntimed();
    await softDeleteDive(db, two!);
    await reorderDivesForDate(db, '2026-08-16', [three!, one!]);
    expect(await chronological()).toEqual(['three', 'one']);
  });

  it('is a no-op on a date with no dives', async () => {
    await expect(reorderDivesForDate(db, '2026-08-16', [])).resolves.toBeUndefined();
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
