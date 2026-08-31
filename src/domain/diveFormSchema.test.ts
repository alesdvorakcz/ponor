import { dive } from './diveFixture';
import {
  diveFormSchema,
  toDivePatch,
  toNewDiveInput,
  unknownBooleanNote,
  unknownOptionNote,
  UNKNOWN_BOOLEAN_NOTE,
  UNKNOWN_OPTION_NOTE,
} from './diveFormSchema';
import {
  ENTRY_VALUES,
  SALINITY_VALUES,
  SUIT_VALUES,
  TANK_MATERIAL_VALUES,
  WATER_BODY_VALUES,
  type Tank,
} from './types';

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

describe('a decimal comma, which is what `decimal-pad` types on a Czech device', () => {
  it('reads a comma as the decimal point in every numeric field, not as no number at all', () => {
    // `Number('18,4')` is NaN, which the contract above faithfully maps to null — the right
    // reading of "not a number" and the wrong reading of what the diver did. Ponor ships
    // `cs`; on a Czech, German or French keypad the separator key types `,`.
    const v = diveFormSchema.parse({
      ...base,
      maxDepthM: '18,4',
      avgDepthM: '9,7',
      durationMin: '47,5',
      waterTempC: '-1,5',
      weightsKg: '6,5',
      latitude: '50,12345',
      tanks: [{ sizeL: '11,1', workingBar: '232', startBar: '210,5' }],
    });
    expect(v.maxDepthM).toBe(18.4);
    expect(v.avgDepthM).toBe(9.7);
    expect(v.durationMin).toBe(47.5);
    expect(v.waterTempC).toBe(-1.5);
    expect(v.weightsKg).toBe(6.5);
    expect(v.latitude).toBe(50.12345);
    expect(v.tanks[0]?.sizeL).toBe(11.1);
    expect(v.tanks[0]?.startBar).toBe(210.5);
  });

  it('still refuses text that names no number, however many commas it has', () => {
    // The separator rule must not turn the transform into something that accepts anything:
    // these still name no number, so they still land on null rather than on a guess.
    expect(diveFormSchema.parse({ ...base, maxDepthM: '1,2,3' }).maxDepthM).toBeNull();
    expect(diveFormSchema.parse({ ...base, maxDepthM: ',' }).maxDepthM).toBeNull();
    expect(diveFormSchema.parse({ ...base, maxDepthM: '18,4 m' }).maxDepthM).toBeNull();
  });

  it('leaves a full stop exactly as it was, so the two spellings agree', () => {
    expect(diveFormSchema.parse({ ...base, maxDepthM: '18.4' }).maxDepthM).toBe(18.4);
  });
});

// The five fixed-option fields, each checked against `domain/types.ts`'s own array rather
// than a list written out here — which is the whole point. The schema used to carry its own
// copy of all five, so a member added to `Entry` reached a Zod field that rejected it: a
// value the domain calls legal, blocking the whole save (§1 says nothing may), with no chip
// to pick it and nothing failing to compile. Looping over the source array is what makes
// this test grow a case on its own the day a vocabulary does.
describe('the fixed-option fields, against the vocabulary they come from', () => {
  const vocabularies = [
    ['entry', ENTRY_VALUES],
    ['salinity', SALINITY_VALUES],
    ['waterBody', WATER_BODY_VALUES],
    ['suit', SUIT_VALUES],
  ] as const;

  it.each(vocabularies)('accepts every %s the domain declares', (field, values) => {
    expect(values.length).toBeGreaterThan(1);
    for (const value of values) {
      expect(diveFormSchema.parse({ ...base, [field]: value })[field]).toBe(value);
    }
  });

  it('accepts every cylinder material the domain declares', () => {
    expect(TANK_MATERIAL_VALUES.length).toBeGreaterThan(1);
    for (const material of TANK_MATERIAL_VALUES) {
      expect(diveFormSchema.parse({ ...base, tanks: [{ material }] }).tanks[0]?.material).toBe(material);
    }
  });

  // --- A value no vocabulary contains: kept and flagged, never refused ---
  //
  // DESIGN.md §10, settled after M1d: "a value outside the expected range is saved and can be
  // flagged; it is not refused", and §1 binds this form as hard as it binds the database.
  // These two fields used to reject one, which makes `handleSubmit` decline to call
  // `onValid` for the WHOLE form — so a row written by a newer client, delivered by M2 sync
  // and carried into a fresh dive by carry-over, turned Save into a dead button on a dive the
  // diver had opened to change something else. Wave A gave that refusal a message; the
  // refusal itself is what had to go.

  it('keeps a fixed-choice value it has never heard of, rather than refusing the dive', () => {
    // 'by helicopter' is absurd on purpose, and 'liveaboard' — the kind of member `Entry`
    // might genuinely grow one day — is checked beside it: the rule is about values this
    // client cannot represent, not about values that look silly.
    for (const entry of ['by helicopter', 'liveaboard']) {
      expect(diveFormSchema.parse({ ...base, entry }).entry).toBe(entry);
    }
    // Not silently dropped either, which would be the other way to "not refuse": a null here
    // clears a column the diver never touched, on a dive they opened to fix a note.
    expect(diveFormSchema.parse({ ...base, entry: 'liveaboard' }).entry).not.toBeNull();
  });

  it('keeps a yes/no value that is not one, for the same reason', () => {
    expect(() => diveFormSchema.parse({ ...base, hood: 'sometimes' })).not.toThrow();
    expect(diveFormSchema.parse({ ...base, hood: 'sometimes' }).hood).toBe('sometimes');
  });

  it('flags exactly the values it cannot represent, and nothing a chip can produce', () => {
    // The flag replaces the rejection, so it is what a diver actually sees. Both directions
    // are the test: a note on a value from a newer client, and NO note on any value this
    // form's own controls hand back — including the three "nothing picked" spellings, which
    // is how an untouched field reaches this and must never be flagged.
    expect(unknownOptionNote(ENTRY_VALUES, 'liveaboard')).toBe(UNKNOWN_OPTION_NOTE);
    for (const value of ENTRY_VALUES) expect(unknownOptionNote(ENTRY_VALUES, value)).toBeUndefined();
    for (const empty of [null, undefined, '']) expect(unknownOptionNote(ENTRY_VALUES, empty)).toBeUndefined();

    expect(unknownBooleanNote('sometimes')).toBe(UNKNOWN_BOOLEAN_NOTE);
    for (const value of [true, false, null, undefined]) expect(unknownBooleanNote(value)).toBeUndefined();
  });

  it('tells the diver the value is kept, rather than that the save was refused', () => {
    // The sentence is the whole difference between the old policy and this one, so it is
    // asserted rather than left to whoever edits it next: a note reading "pick one of the
    // options to save" would describe a refusal that no longer happens.
    for (const note of [UNKNOWN_OPTION_NOTE, UNKNOWN_BOOLEAN_NOTE]) {
      expect(note).toContain('saved as it is');
      expect(note).not.toContain('to save.');
    }
  });
});

describe('the status control (§2.4)', () => {
  it('logs a dive the form never said anything about', () => {
    // A plan is the exception, not a mode: a form carrying no status at all is logging a
    // dive. Asserted as the literal `'logged'` rather than "not planned", so a schema that
    // let the key go missing entirely — leaving `createDive`'s own `?? 'logged'` to guess —
    // fails here instead of passing on someone else's fallback.
    expect(diveFormSchema.parse(base).status).toBe('logged');
  });

  it('keeps a plan a plan', () => {
    expect(diveFormSchema.parse({ ...base, status: 'planned' }).status).toBe('planned');
  });

  it('reads an absent, empty or null control as logged rather than as nothing', () => {
    // `status` is one of the three columns §6 makes non-nullable, so unlike every other
    // optional field on this form there is no `null` for it to land on. M2 sync and
    // carry-over both hand this schema objects it did not build.
    expect(diveFormSchema.parse({ ...base, status: null }).status).toBe('logged');
    expect(diveFormSchema.parse({ ...base, status: undefined }).status).toBe('logged');
  });

  it('refuses a status that is not one, because no diver could have typed it', () => {
    // The same line `optionalPicked` draws for entry/salinity/suit: these are taps on a
    // fixed control, so an out-of-range value is a bug upstream rather than a diver to be
    // argued with (§1). Silently coercing it to 'logged' would hide an M2 sync writing a
    // status this client has never heard of.
    expect(() => diveFormSchema.parse({ ...base, status: 'draft' })).toThrow();
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

  it('carries the status the control was on, either way', () => {
    // The producer half of §2.4, and the reason this task existed at all: nothing in the app
    // could reach `status: 'planned'` before, because the form had no field for it and the
    // form is `createDive`'s only caller. Both states asserted — an input that always said
    // 'logged' would pass the second line alone, which is exactly the state it was in.
    expect(toNewDiveInput(diveFormSchema.parse({ ...base, status: 'planned' })).status).toBe('planned');
    expect(toNewDiveInput(diveFormSchema.parse(base)).status).toBe('logged');
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

  it('does not clear a stored depth when the diver retypes it with a decimal comma', () => {
    // The edit path is where the decimal-comma defect actually destroyed data. Typing
    // `18,4` over a stored 18.4 parsed to null, which is not "no change" to the repository
    // but the explicit instruction to CLEAR the column — a depth the diver could see on
    // screen, gone, with the app reporting a successful save.
    expect(patchAfterEditing({ maxDepthM: 18.4 }, { maxDepthM: '18,4' })).toEqual({});
    // ...and a comma that really does change the value still writes the new number rather
    // than the null, so this is not passing merely because nothing is ever sent.
    expect(patchAfterEditing({ maxDepthM: 18.4 }, { maxDepthM: '21,6' })).toEqual({ maxDepthM: 21.6 });
    // The same in a cylinder, where a null would ride along inside the whole JSON blob.
    expect(patchAfterEditing({ tanks: [tank({ sizeL: 11.1 })] }, { tanks: [{ ...tank({ sizeL: 11.1 }), sizeL: '11,1' }] })).toEqual({});
  });

  it('never sends status for a dive whose status the diver did not touch', () => {
    // The bug this replaced lived one layer up: `DiveFormScreen` ran
    // `if (target.status === 'planned') patch.status = 'logged'` on every save, so editing a
    // planned dive to fix a typo silently completed it. `status` is a form field now, so it
    // is diffed like everything else — unchanged means absent, for a plan exactly as for a
    // logged dive, and both are checked because a rule keyed on either value would pass
    // whichever half it agreed with.
    expect(patchAfterEditing({ status: 'planned' })).not.toHaveProperty('status');
    expect(patchAfterEditing({ status: 'logged' })).not.toHaveProperty('status');
  });

  it('sends status when the diver moved the control, and nothing else with it', () => {
    // §2.4's completion, and its opposite. Both directions, because a diff that always sent
    // `'logged'` would satisfy the first line and fail the second — and that is precisely
    // the shape of the rule this replaced.
    expect(patchAfterEditing({ status: 'planned' }, { status: 'logged' })).toEqual({ status: 'logged' });
    expect(patchAfterEditing({ status: 'logged' }, { status: 'planned' })).toEqual({ status: 'planned' });
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
