import { eq, sql } from 'drizzle-orm';

import type { Tank } from '../domain/types';
import {
  createGearPreset,
  gearPresetRowsQuery,
  getGearPreset,
  listGearPresets,
  presetNamed,
  softDeleteGearPreset,
  toGearPresets,
  updateGearPreset,
} from './gearPresets';
import { gearPresets } from './schema';
import { createTestDb, type TestDb } from './testDb';

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});

/**
 * Long enough for `new Date().toISOString()` to produce a different value — the same
 * helper `dives.test.ts` carries, for the same reason: timestamps here are
 * millisecond-resolution, so a test asserting that `updated_at` moved (or did not) has to
 * make the movement observable rather than hope for it.
 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** One fully-recorded cylinder, pressures included — the shape a diver's form holds. */
const twelveSteel = (over: Partial<Tank> = {}): Tank => ({
  material: 'steel',
  sizeL: 12,
  count: 1,
  workingBar: 232,
  o2Pct: 21,
  hePct: null,
  startBar: 210,
  endBar: 50,
  ...over,
});

describe('migration 0001', () => {
  it('leaves gear_presets holding cylinders and gas, and nothing else', async () => {
    const columns = (await db.all<{ name: string }>(sql`pragma table_info(gear_presets)`)).map(
      (column) => column.name,
    );
    expect(columns.sort()).toEqual(
      ['created_at', 'deleted_at', 'id', 'name', 'tanks', 'updated_at'].sort(),
    );
    // Named individually as well as by the whole list, so a failure says which of the
    // owner's five dropped columns came back rather than printing two sorted arrays.
    for (const dropped of ['suit', 'hood', 'gloves', 'boots', 'weights_kg']) {
      expect(columns).not.toContain(dropped);
    }
  });
});

describe('createGearPreset', () => {
  it('saves a preset with a name and its cylinders', async () => {
    const preset = await createGearPreset(db, { name: 'twin 12 steel', tanks: [twelveSteel()] });
    expect(preset.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(preset.name).toBe('twin 12 steel');
    expect(preset.tanks).toHaveLength(1);
    expect(preset.deletedAt).toBeNull();
    expect(preset.createdAt).toBe(preset.updatedAt);
  });

  it('saves a preset with no cylinders at all as [], never null', async () => {
    const preset = await createGearPreset(db, { name: 'empty' });
    expect(preset.tanks).toEqual([]);
    const read = await getGearPreset(db, preset.id);
    expect(read?.tanks).toEqual([]);
  });

  /**
   * DESIGN.md §10, the binding statement: "The pressures are not stored either, on
   * precisely §2.1's reasoning for carry-over: a preset that filled in 200 bar would be
   * inventing a reading."
   */
  it('strips the pressures, keeping the hardware and the gas', async () => {
    const preset = await createGearPreset(db, { name: 'twin 12 steel', tanks: [twelveSteel()] });
    const read = await getGearPreset(db, preset.id);
    expect(read?.tanks[0]).toEqual({
      material: 'steel',
      sizeL: 12,
      count: 1,
      workingBar: 232,
      o2Pct: 21,
      hePct: null,
      startBar: null,
      endBar: null,
    });
  });

  it('strips them from every cylinder, not just the first', async () => {
    const preset = await createGearPreset(db, {
      name: 'bottom plus deco',
      tanks: [twelveSteel(), twelveSteel({ sizeL: 7, o2Pct: 80, startBar: 200, endBar: 180 })],
    });
    expect(preset.tanks.map((tank) => [tank.startBar, tank.endBar])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('ignores a forged id/createdAt/updatedAt/deletedAt in the input', async () => {
    const created = await createGearPreset(db, {
      name: 'forged',
      id: 'not-a-real-id',
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
      deletedAt: '2000-01-01T00:00:00.000Z',
    } as Parameters<typeof createGearPreset>[1]);
    expect(created.id).not.toBe('not-a-real-id');
    expect(created.createdAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(created.deletedAt).toBeNull();
  });
});

describe('getGearPreset', () => {
  it('returns null for an id that names nothing', async () => {
    expect(await getGearPreset(db, 'nobody')).toBeNull();
  });

  it('returns null for a tombstoned preset', async () => {
    const created = await createGearPreset(db, { name: 'gone' });
    await softDeleteGearPreset(db, created.id);
    expect(await getGearPreset(db, created.id)).toBeNull();
  });
});

describe('listGearPresets', () => {
  it('leaves out tombstoned presets', async () => {
    const kept = await createGearPreset(db, { name: 'kept' });
    const gone = await createGearPreset(db, { name: 'gone' });
    await softDeleteGearPreset(db, gone.id);
    expect((await listGearPresets(db)).map((preset) => preset.id)).toEqual([kept.id]);
  });

  /**
   * The ordering decision (`comparePresets`, gearPresets.ts): by name, case-insensitively.
   * Deliberately not the creation order the rows happen to come back in, which is what a
   * missing comparator would silently produce — so the three below are created in an order
   * that is neither the answer nor its reverse.
   */
  it('sorts by name, whatever case the diver typed it in', async () => {
    await createGearPreset(db, { name: 'twin 12 steel' });
    await createGearPreset(db, { name: 'Alu 80 nitrox' });
    await createGearPreset(db, { name: 'alu 80' });
    expect((await listGearPresets(db)).map((preset) => preset.name)).toEqual([
      'alu 80',
      'Alu 80 nitrox',
      'twin 12 steel',
    ]);
  });

  it('sorts the rows it is given rather than trusting their order', async () => {
    const later = await createGearPreset(db, { name: 'zulu' });
    const earlier = await createGearPreset(db, { name: 'alpha' });
    // Handed back to front on purpose: `useLiveQuery` makes no ordering promise at all, so
    // `toGearPresets` may not assume the query produced one.
    expect(toGearPresets([later, earlier]).map((preset) => preset.name)).toEqual(['alpha', 'zulu']);
  });

  it('builds a query the hook can re-run, tombstone-filtered', async () => {
    const kept = await createGearPreset(db, { name: 'kept' });
    const gone = await createGearPreset(db, { name: 'gone' });
    await softDeleteGearPreset(db, gone.id);
    const rows = await gearPresetRowsQuery(db);
    expect(rows.map((row) => row.id)).toEqual([kept.id]);
  });
});

describe('updateGearPreset', () => {
  it('renames a preset and stamps the clock', async () => {
    const created = await createGearPreset(db, { name: 'alu 80' });
    await tick();
    const updated = await updateGearPreset(db, created.id, { name: 'alu 80 nitrox' });
    expect(updated.name).toBe('alu 80 nitrox');
    expect(updated.updatedAt > created.updatedAt).toBe(true);
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it('replaces the cylinders, pressures stripped on the way in as well', async () => {
    const created = await createGearPreset(db, { name: 'alu 80' });
    const updated = await updateGearPreset(db, created.id, {
      tanks: [twelveSteel({ startBar: 200, endBar: 40 })],
    });
    expect(updated.tanks[0]?.startBar).toBeNull();
    expect(updated.tanks[0]?.endBar).toBeNull();
    expect(updated.tanks[0]?.sizeL).toBe(12);
  });

  /**
   * DESIGN.md §7 is whole-row last-write-wins keyed on `updated_at`, so a write that
   * changes nothing must not advance it — otherwise the device that did nothing wins the
   * conflict against the device that did something. `updateDive`'s own guard exists for
   * exactly this; Task 3's editor is what makes it reachable here (open a preset, change
   * nothing, tap Save).
   */
  it('does not advance updated_at for a write that changes nothing', async () => {
    const created = await createGearPreset(db, { name: 'alu 80', tanks: [twelveSteel()] });
    await tick();
    const again = await updateGearPreset(db, created.id, {
      name: 'alu 80',
      tanks: [twelveSteel()],
    });
    expect(again.updatedAt).toBe(created.updatedAt);
  });

  /**
   * The same, one layer subtler: the cylinders the editor hands back still carry the
   * pressures the form let the diver look at, and the stored preset holds nulls. The strip
   * has to happen BEFORE the comparison, or every save of an untouched preset writes.
   */
  it('does not advance it for cylinders that differ only by the pressures it strips', async () => {
    const created = await createGearPreset(db, { name: 'alu 80', tanks: [twelveSteel()] });
    await tick();
    const again = await updateGearPreset(db, created.id, {
      tanks: [twelveSteel({ startBar: 190, endBar: 30 })],
    });
    expect(again.updatedAt).toBe(created.updatedAt);
  });

  it('does not advance it for a patch with nothing in it at all', async () => {
    const created = await createGearPreset(db, { name: 'alu 80' });
    await tick();
    const again = await updateGearPreset(db, created.id, {});
    expect(again.updatedAt).toBe(created.updatedAt);
  });

  it('throws on an id that names no live preset', async () => {
    await expect(updateGearPreset(db, 'nobody', { name: 'x' })).rejects.toThrow(/not found/);
  });

  it('throws rather than editing a tombstoned preset', async () => {
    const created = await createGearPreset(db, { name: 'gone' });
    await softDeleteGearPreset(db, created.id);
    await expect(updateGearPreset(db, created.id, { name: 'back' })).rejects.toThrow(/not found/);
  });

  /**
   * `updateDive`'s own history: a key naming no column was dropped by Drizzle's SET builder
   * and the update ran anyway — a silent non-write that still advanced the clock, and
   * therefore still won the sync conflict against a real edit on another device.
   */
  it('throws on a key that names no column, rather than writing nothing and bumping the clock', async () => {
    const created = await createGearPreset(db, { name: 'alu 80' });
    await expect(
      updateGearPreset(db, created.id, { weightsKg: 6 } as Parameters<typeof updateGearPreset>[2]),
    ).rejects.toThrow(/weightsKg/);
  });

  it('ignores a forged id/createdAt/updatedAt/deletedAt in the patch', async () => {
    const created = await createGearPreset(db, { name: 'alu 80' });
    await tick();
    const updated = await updateGearPreset(db, created.id, {
      name: 'alu 80 nitrox',
      id: 'stolen',
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
      deletedAt: '2000-01-01T00:00:00.000Z',
    } as Parameters<typeof updateGearPreset>[2]);
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(updated.deletedAt).toBeNull();
    expect(await getGearPreset(db, created.id)).not.toBeNull();
  });
});

describe('softDeleteGearPreset', () => {
  /**
   * The row must SURVIVE, not merely stop being read: DESIGN.md §6 keeps rows for ever so
   * M2's `pull_changes` can propagate the deletion. A hard `DELETE` passes "reads no longer
   * return it", and that exact weaker assertion was found asserting the bug during M1d — so
   * this reads the raw table past every tombstone filter.
   */
  it('tombstones rather than removing, so sync can propagate the deletion', async () => {
    const created = await createGearPreset(db, { name: 'twin 12 steel', tanks: [twelveSteel()] });
    await softDeleteGearPreset(db, created.id);

    const raw = await db.select().from(gearPresets).where(eq(gearPresets.id, created.id));
    expect(raw).toHaveLength(1);
    expect(raw[0]?.name).toBe('twin 12 steel');
    expect(raw[0]?.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Stamped together, so §7's last-write-wins carries the deletion rather than losing it
    // to an older-looking row on another device.
    expect(raw[0]?.updatedAt).toBe(raw[0]?.deletedAt);
  });

  it('throws on an id that names nothing, rather than silently doing nothing', async () => {
    await expect(softDeleteGearPreset(db, 'nobody')).rejects.toThrow(/not found/);
  });

  it('throws on a preset that is already tombstoned', async () => {
    const created = await createGearPreset(db, { name: 'gone' });
    await softDeleteGearPreset(db, created.id);
    await expect(softDeleteGearPreset(db, created.id)).rejects.toThrow(/not found/);
  });
});

describe('presetNamed', () => {
  it('finds a preset whose name differs only by case or surrounding space', async () => {
    const created = await createGearPreset(db, { name: 'Alu 80' });
    const presets = await listGearPresets(db);
    expect(presetNamed(presets, '  alu 80 ')?.id).toBe(created.id);
  });

  it('finds nothing for a name no preset holds', async () => {
    await createGearPreset(db, { name: 'Alu 80' });
    expect(presetNamed(await listGearPresets(db), 'twin 12')).toBeNull();
  });

  /**
   * Task 3's editor renames a preset, and a preset is not a duplicate of itself — without
   * the exception, saving a preset under the name it already has would report a collision
   * with itself.
   */
  it('does not count the preset being edited as its own duplicate', async () => {
    const created = await createGearPreset(db, { name: 'Alu 80' });
    const presets = await listGearPresets(db);
    expect(presetNamed(presets, 'alu 80', created.id)).toBeNull();
  });
});
