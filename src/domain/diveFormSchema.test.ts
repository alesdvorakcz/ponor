import { dive } from './diveFixture';
import { diveFormSchema, toDivePatch, toNewDiveInput } from './diveFormSchema';
import { type Tank } from './types';

const base = { date: '2026-08-16' };

describe('the coercion contract', () => {
  it('turns an empty numeric field into null, never zero', () => {
    const v = diveFormSchema.parse({ ...base, maxDepthM: '', durationMin: '', weightsKg: '' });
    expect(v.maxDepthM).toBeNull();
    expect(v.durationMin).toBeNull();
    expect(v.weightsKg).toBeNull();
    // the specific failure this guards: Number('') === 0
    expect(v.maxDepthM).not.toBe(0);
  });

  it('turns an empty cylinder size into null, because zero would void the dive gas figure', () => {
    const v = diveFormSchema.parse({ ...base, tanks: [{ sizeL: '', count: '', o2Pct: '' }] });
    expect(v.tanks[0]?.sizeL).toBeNull();
    expect(v.tanks[0]?.count).toBeNull();
    expect(v.tanks[0]?.sizeL).not.toBe(0);
  });

  it('keeps a real zero when the diver actually typed one', () => {
    const v = diveFormSchema.parse({ ...base, waterTempC: '0' });
    expect(v.waterTempC).toBe(0);
  });

  it('turns whitespace into null too', () => {
    expect(diveFormSchema.parse({ ...base, maxDepthM: '   ' }).maxDepthM).toBeNull();
  });

  it('turns unparseable text into null rather than NaN reaching the database', () => {
    expect(diveFormSchema.parse({ ...base, maxDepthM: 'abc' }).maxDepthM).toBeNull();
  });
});

describe('never blocking a save', () => {
  it('accepts a dive carrying nothing but a date', () => {
    expect(() => diveFormSchema.parse({ date: '2026-08-16' })).not.toThrow();
  });

  it('accepts a negative depth as a value rather than refusing the dive', () => {
    // §1: validation may correct or warn; it must not refuse the save.
    expect(() => diveFormSchema.parse({ ...base, maxDepthM: '-5' })).not.toThrow();
  });
});

describe('toNewDiveInput', () => {
  it('omits fields the diver left empty rather than sending nulls for all of them', () => {
    const input = toNewDiveInput(diveFormSchema.parse({ date: '2026-08-16' }));
    expect(input.date).toBe('2026-08-16');
    expect(Object.values(input).every((v) => v !== 0)).toBe(true);
  });
});

describe('toDivePatch', () => {
  /** The form as the diver found it: this dive's own stored values, parsed back through the
   * schema exactly as `DiveFormScreen` seeds and submits them. `over` is what they changed. */
  const patchAfterEditing = (stored: Parameters<typeof dive>[0], over: Record<string, unknown> = {}) => {
    const original = dive(stored);
    const values = diveFormSchema.parse({ ...original, ...over });
    return toDivePatch(original, values);
  };

  it('sends nothing at all when nothing changed', () => {
    // The whole diff in one assertion: a dive read into the form and submitted untouched
    // must produce no write. Any field that fails to round-trip shows up here as a key.
    expect(patchAfterEditing({ date: '2026-08-16', siteName: 'Blue Hole', maxDepthM: 32.4, notes: 'Arch' })).toEqual({});
  });

  it('sends the changed field, and only it', () => {
    const patch = patchAfterEditing({ siteName: 'Blue Hole', maxDepthM: 32.4 }, { maxDepthM: '28.0' });
    expect(patch).toEqual({ maxDepthM: 28 });
  });

  it('sends null for a field the diver emptied, which is what clears it', () => {
    // `undefined`/absent means "leave it alone" to the repository, so an emptied field has
    // to be named explicitly — the two instructions are not interchangeable.
    const patch = patchAfterEditing({ notes: 'Arch at 30 m' }, { notes: '' });
    expect(patch).toEqual({ notes: null });
    expect(Object.keys(patch)).toContain('notes');
  });

  it('sends a real zero, which is a value and not an absence', () => {
    // The §10 coercion contract from the other side: a diver who dove with no weight at all
    // changed the field, and omitting it because `0` is falsy would silently keep the 5 kg.
    expect(patchAfterEditing({ weightsKg: 5 }, { weightsKg: '0' })).toEqual({ weightsKg: 0 });
    // ...and a stored zero left alone is still not a change.
    expect(patchAfterEditing({ weightsKg: 0 })).toEqual({});
  });

  it('never sends status — completing a planned dive is the caller\'s decision', () => {
    // `status` is not a form field, and inferring it here would make every edit of a planned
    // dive complete it whether or not the screen meant to (DiveFormScreen owns that rule).
    expect(patchAfterEditing({ status: 'planned' })).not.toHaveProperty('status');
  });

  const tank = (over: Partial<Tank> = {}): Tank => ({
    material: 'steel', sizeL: 12, count: 1, workingBar: 232,
    o2Pct: 21, hePct: null, startBar: 200, endBar: 50, ...over,
  });

  it('leaves a recorded cylinder alone when nothing in it changed', () => {
    expect(patchAfterEditing({ tanks: [tank()] })).toEqual({});
  });

  it('sends the whole cylinder array when one field in it changed', () => {
    // `tanks` is one JSON column (§6), so the fields the diver did not touch have to ride
    // along — a patch carrying only the changed key would erase the rest of the cylinder.
    const patch = patchAfterEditing({ tanks: [tank()] }, { tanks: [{ ...tank(), endBar: 40 }] });
    expect(patch.tanks).toEqual([tank({ endBar: 40 })]);
  });

  it('treats the form\'s always-present blank cylinder as no cylinder, in both directions', () => {
    const blank: Tank = {
      material: null, sizeL: null, count: null, workingBar: null,
      o2Pct: null, hePct: null, startBar: null, endBar: null,
    };
    // The form shows one cylinder whether or not the dive has one, so an untouched cylinder
    // group must not read as an edit for a dive that recorded none...
    expect(patchAfterEditing({ tanks: [] }, { tanks: [blank] })).toEqual({});
    // ...and a dive stored WITH a blank cylinder (which is what createDive writes today for
    // a form whose cylinder group was never opened) must not read as one either.
    expect(patchAfterEditing({ tanks: [blank] }, { tanks: [blank] })).toEqual({});
  });

  it('sends an empty array when the diver clears the only cylinder they had', () => {
    expect(patchAfterEditing({ tanks: [tank()] }, { tanks: [{}] })).toEqual({ tanks: [] });
  });
});
