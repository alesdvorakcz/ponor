import { dive } from './diveFixture';
import {
  diveFormSchema,
  toDisplayUnits,
  toDivePatch,
  toInputString,
  toNewDiveInput,
  sameEquipment,
  toStoredTanks,
  unknownOptionNote,
  outOfScaleNote,
  optionNote,
  toFormNumber,
  UNKNOWN_OPTION_NOTE,
} from './diveFormSchema';
import { type UnitSystem } from '../format/units';
import {
  CONDITION_SCALE_VALUES,
  ENTRY_VALUES,
  RATING_VALUES,
  SALINITY_VALUES,
  SUIT_VALUES,
  TANK_MATERIAL_VALUES,
  WATER_BODY_VALUES,
  type Tank,
} from './types';

const base = { date: '2026-08-16' };

/** The form as the diver found it: this dive's own stored values, parsed back through the
 * schema exactly as `DiveFormScreen` seeds and submits them. `over` is what they changed. */
const patchAfterEditing = (
  stored: Parameters<typeof dive>[0],
  over: Record<string, unknown> = {},
  units: UnitSystem = 'metric',
) => {
  const original = dive(stored);
  // Seeded exactly as `DiveFormScreen` seeds it — through `toDisplayUnits`, so the form
  // holds the figures the diver actually reads — and then overridden with whatever they
  // typed, in those same units.
  const values = diveFormSchema.parse({ ...toDisplayUnits(original, units), ...over });
  return toDivePatch(original, values, units);
};


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
    const v = diveFormSchema.parse({ ...base, tanks: [{ sizeL: '', o2Pct: '' }] });
    expect(v.tanks[0]?.sizeL).toBeNull();
    expect(v.tanks[0]?.o2Pct).toBeNull();
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

  // The same contract read from the other end, and the reason it is one function rather than
  // one per screen: `String(null)` is the text "null", which is what a field would show a
  // diver in place of an empty box.
  it('shows an unrecorded value as an empty field, never as the word null', () => {
    expect(toInputString(null)).toBe('');
    expect(toInputString(undefined)).toBe('');
  });

  it('shows a recorded value exactly as it is, including a zero', () => {
    expect(toInputString(232)).toBe('232');
    expect(toInputString(0)).toBe('0');
    expect(toInputString('12,5')).toBe('12,5');
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

  it('keeps an equipment token it has never heard of, for the same reason', () => {
    // The set's own version of the rule. Rejecting the token would make `handleSubmit`
    // decline to call `onValid` for the WHOLE form, so a dive synced from a newer build
    // could not be saved at all — over an accessory the diver cannot even see.
    const v = diveFormSchema.parse({ ...base, equipment: ['hood', 'rebreather-bailout'] });
    expect(v.equipment).toEqual(['hood', 'rebreather-bailout']);
  });

  it('reads anything that is not an array at all as an empty set, never as a refusal', () => {
    // `[]` is what the column means by "nothing recorded" (§6), so a malformed sync payload
    // costs the field and nothing else — the same degradation `schema.ts`'s decoder applies
    // one layer down.
    for (const raw of [null, undefined, 'hood', 7, { hood: true }]) {
      expect(diveFormSchema.parse({ ...base, equipment: raw }).equipment).toEqual([]);
    }
  });

  it('copies the equipment array rather than holding the caller\'s own', () => {
    // Two reasons, and the second is the one that bites: nothing downstream may mutate a
    // value the caller still holds, and `toDivePatch` must never find two fields equal by
    // aliasing rather than by their contents actually matching.
    const held = ['hood'];
    const v = diveFormSchema.parse({ ...base, equipment: held });
    expect(v.equipment).toEqual(['hood']);
    expect(v.equipment).not.toBe(held);
  });

  it('flags exactly the values it cannot represent, and nothing a chip can produce', () => {
    // The flag replaces the rejection, so it is what a diver actually sees. Both directions
    // are the test: a note on a value from a newer client, and NO note on any value this
    // form's own controls hand back — including the three "nothing picked" spellings, which
    // is how an untouched field reaches this and must never be flagged.
    expect(unknownOptionNote(ENTRY_VALUES, 'liveaboard')).toBe(UNKNOWN_OPTION_NOTE);
    for (const value of ENTRY_VALUES) expect(unknownOptionNote(ENTRY_VALUES, value)).toBeUndefined();
    for (const empty of [null, undefined, '']) expect(unknownOptionNote(ENTRY_VALUES, empty)).toBeUndefined();

  });

  it('tells the diver the value is kept, rather than that the save was refused', () => {
    // The sentence is the whole difference between the old policy and this one, so it is
    // asserted rather than left to whoever edits it next: a note reading "pick one of the
    // options to save" would describe a refusal that no longer happens.
    expect(UNKNOWN_OPTION_NOTE).toContain('saved as it is');
    expect(UNKNOWN_OPTION_NOTE).not.toContain('to save.');
  });
});

// --- The numeric scales' own note (M1h), and why it is not the one above ---
//
// DESIGN.md §10 recorded this as **still owed** from M1d: "`rating`, `waves`, `current` and
// `surge` are bare `optionalNumber` … nothing is *refused* — §1 holds — but nothing is flagged
// either." It stayed harmless while those four were text boxes, because a stored `9` was
// simply visible in one. M1h turned them into chips, where a 9 matches no chip and the row
// renders as if nothing were recorded — the value perfectly saved and completely invisible.
describe('outOfScaleNote', () => {
  it('says nothing about any level the scale actually offers, or about an untouched field', () => {
    for (const level of CONDITION_SCALE_VALUES) {
      expect(outOfScaleNote(CONDITION_SCALE_VALUES, level)).toBeUndefined();
    }
    // Every spelling of "nothing recorded" this form can produce. `'   '` is the one worth
    // naming: `Number('')` is `0`, not `NaN`, so a note that coerced before checking for blank
    // would announce "0 is not one of these options" on an untouched Rating row — over a value
    // the diver never entered.
    for (const empty of [null, undefined, '', '   ']) {
      expect(outOfScaleNote(RATING_VALUES, empty)).toBeUndefined();
    }
  });

  it('reads a typed or synced string as the level it spells, rather than as foreign', () => {
    // These four fields were `decimal-pad` text boxes until M1h, so a string is what a stored
    // form value could genuinely be — and a Czech keypad types the decimal comma, which the
    // save path has always understood. A note that flagged `'2'` would fire on the very value
    // its own chip row is about to show as selected.
    expect(outOfScaleNote(CONDITION_SCALE_VALUES, '2')).toBeUndefined();
    expect(outOfScaleNote(CONDITION_SCALE_VALUES, '2,0')).toBeUndefined();
  });

  it('names the number it found, because a chip row cannot show it', () => {
    // The point of the note. "Out of range" without the value replaces one invisibility with
    // another — the diver still cannot find out what their dive holds.
    expect(outOfScaleNote(RATING_VALUES, 9)).toContain('9');
    expect(outOfScaleNote(CONDITION_SCALE_VALUES, 7)).toContain('7');
    // Including the case the two scales disagree about: 0 is a legal condition level and is
    // NOT a legal rating, since an unrated dive is `null` rather than zero stars.
    expect(outOfScaleNote(CONDITION_SCALE_VALUES, 0)).toBeUndefined();
    expect(outOfScaleNote(RATING_VALUES, 0)).toContain('0');
  });

  /**
   * **Does this sentence say where the value came from?**
   *
   * The property DESIGN.md §10 asks of this note is that it attributes the value to nobody:
   * these four fields are the only ones in the app where the diver could have typed the bad
   * number himself, so `UNKNOWN_OPTION_NOTE`'s "came from a newer version of Ponor" would
   * blame a future build for the owner's own keypad, on his own dive, in his own logbook. The
   * intent was always "assert the ABSENCE of attribution, so rewording stays free and
   * re-blaming does not".
   *
   * **The first defence of it was backwards in both directions, and measured so.** It banned
   * the sibling's two distinctive words (`'newer version'`, `'Ponor'`) and pinned one literal
   * phrase of its own (`'saved as it is'`). So a differently-worded blame passed — *"9 was
   * written by another app, not by you. It is saved as it is …"* was green — while an innocent
   * rewording failed — *"9 is not offered here. Your entry is kept exactly as recorded …"* was
   * red. It banned two spellings of one blame and pinned one spelling of one promise; neither
   * of those is the rule, and between them they protected the opposite of what was wanted.
   *
   * The rule is grammatical, and it is small enough to state: **a sentence can only attribute
   * a value by putting it in the past or somewhere else.** Authorship is a claim about history
   * ("was written", "came from", "created", "typed") or about provenance ("*from* a newer
   * version", "*by* another app"). A note that says only what is true here and now — this
   * number is not one of the options, it is kept, tap to replace it — has no grammar left to
   * blame anybody with. So the ban is on that class of word rather than on any one sentence,
   * and a rewrite that stays in the present tense about the value in front of the diver is
   * free to say it however it likes.
   *
   * **It is proved rather than assumed.** The same predicate runs against
   * `UNKNOWN_OPTION_NOTE` below — the one note in this app that deliberately DOES attribute —
   * and it has to say so. A list of words nothing would ever contain passes for ever and
   * defends nothing, which is precisely how the version this replaces went wrong.
   */
  const ORIGIN_WORDS =
    /\b(was|were|came|come|comes|written|wrote|created|sent|arrived|imported|synced|typed|entered|made|from|by)\b/i;
  const attributesAnOrigin = (note: string | undefined) => ORIGIN_WORDS.test(note ?? '');

  it('attributes the value to nobody, unlike its sibling', () => {
    expect(attributesAnOrigin(outOfScaleNote(RATING_VALUES, 9))).toBe(false);
    expect(attributesAnOrigin(outOfScaleNote(CONDITION_SCALE_VALUES, 7))).toBe(false);
    // The teeth. `UNKNOWN_OPTION_NOTE` names a source on purpose and is right to — a value
    // outside a closed vocabulary was never typeable, so it can only have come from another
    // client. If the predicate cannot see the attribution in *that* sentence, it is not
    // seeing attribution at all and the two assertions above mean nothing.
    expect(attributesAnOrigin(UNKNOWN_OPTION_NOTE)).toBe(true);
  });

  it('promises the value is kept, in whichever words it chooses to', () => {
    // The other half of what makes the note honest rather than alarming: §1 means nothing is
    // refused and nothing is rewritten, and the sentence has to say so, or a diver reading
    // "9 is not one of these options" is left assuming their dive lost it.
    //
    // A disjunction rather than a literal, deliberately, and it is the correction to the same
    // mistake the predicate above replaces: pinning `'saved as it is'` made every rewording of
    // this promise a test failure, including ones that keep it perfectly ("your entry is
    // *kept* exactly as recorded"). What must not change is that the promise is there at all —
    // dropping it is red, saying it differently is not.
    expect(outOfScaleNote(RATING_VALUES, 9)).toMatch(/\b(saved|kept|keeps|stays|stored|unchanged)\b/i);
  });
});

describe('optionNote', () => {
  // Which note a vocabulary gets is decided once, from the vocabulary itself, rather than by
  // eleven chip rows each passing the right one. The dispatch is the thing worth pinning:
  // wired backwards, a rating of 9 would announce that it came from a newer version of Ponor.
  it('gives a word vocabulary the unknown-option note and a numeric scale the out-of-scale one', () => {
    expect(optionNote(ENTRY_VALUES, 'liveaboard')).toBe(UNKNOWN_OPTION_NOTE);
    expect(optionNote(RATING_VALUES, 9)).toBe(outOfScaleNote(RATING_VALUES, 9));
    expect(optionNote(RATING_VALUES, 9)).not.toBe(UNKNOWN_OPTION_NOTE);
  });

  it('says nothing for a value either kind of vocabulary actually offers', () => {
    for (const value of ENTRY_VALUES) expect(optionNote(ENTRY_VALUES, value)).toBeUndefined();
    for (const level of CONDITION_SCALE_VALUES) expect(optionNote(CONDITION_SCALE_VALUES, level)).toBeUndefined();
  });
});

describe('toFormNumber', () => {
  // `optionalNumber`'s transform, named and exported so the chip rows can ask the same
  // question the save path asks. The contract is "empty means absent, never 0" plus "a comma
  // is a decimal point", and both halves have cost this project a bug before.
  it('reads every spelling of absent as null, never as zero', () => {
    for (const empty of [null, undefined, '', '   ', 'abc']) expect(toFormNumber(empty)).toBeNull();
  });

  it('reads a decimal comma the way a Czech keypad types it', () => {
    expect(toFormNumber('18,4')).toBe(18.4);
  });

  it('passes a real number through, zero included', () => {
    expect(toFormNumber(0)).toBe(0);
    expect(toFormNumber('0')).toBe(0);
    expect(toFormNumber(Number.NaN)).toBeNull();
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
    const input = toNewDiveInput(diveFormSchema.parse({ date: '2026-08-16' }), 'metric');
    expect(input.date).toBe('2026-08-16');
    expect(Object.values(input).every((v) => v !== 0)).toBe(true);
  });

  it('keeps a recorded zero, which is a value and not an absence', () => {
    // `toDivePatch`'s own "sends a real zero" test, from the creation side — and the half
    // that was undefended until this round. The loop in `toNewDiveInput` omits a field whose
    // value is `null`; narrowing that by one falsy step (`value !== null && value !== 0`)
    // left the whole suite green, so nothing anywhere said that a zero must survive a save.
    //
    // M1h is what made it reachable by a thumb rather than only by a keypad: the three 0–3
    // scales became chip rows, so *Flat* water and *no* current are level 0 — a value a
    // diver picks deliberately and would have watched save as "not recorded".
    expect(CONDITION_SCALE_VALUES).toContain(0); // or the three assertions below prove nothing
    const input = toNewDiveInput(
      diveFormSchema.parse({ ...base, waves: 0, current: 0, surge: 0, weightsKg: '0' }),
      'metric',
    );
    expect(input).toEqual(expect.objectContaining({ waves: 0, current: 0, surge: 0, weightsKg: 0 }));
    // Named explicitly as well as valued, because `undefined` and `0` are both falsy and
    // `objectContaining` is the assertion that would notice — but only if the key is there.
    for (const field of ['waves', 'current', 'surge', 'weightsKg']) expect(Object.keys(input)).toContain(field);
  });

  it.each([
    ['waves', CONDITION_SCALE_VALUES],
    ['current', CONDITION_SCALE_VALUES],
    ['surge', CONDITION_SCALE_VALUES],
    ['rating', RATING_VALUES],
  ] as const)('carries every level %s offers, top to bottom', (field, values) => {
    // The same guarantee swept over the vocabularies themselves rather than over one
    // hand-picked level, because **which scales have a zero is `domain/types.ts`'s answer
    // and not this file's**: a scale that gains one is covered on the day it does, and a
    // scale that is reordered or widened cannot quietly lose a level on the way to the
    // database. `RATING_VALUES` is in the table despite starting at 1 — an unrated dive is
    // `null`, not zero stars — so that the two kinds of scale are stated side by side and
    // the next reader can see which one carries the falsy member.
    for (const level of values) {
      const input = toNewDiveInput(diveFormSchema.parse({ ...base, [field]: level }), 'metric');
      expect(input[field]).toBe(level);
    }
  });

  it('carries the status the control was on, either way', () => {
    // The producer half of §2.4, and the reason this task existed at all: nothing in the app
    // could reach `status: 'planned'` before, because the form had no field for it and the
    // form is `createDive`'s only caller. Both states asserted — an input that always said
    // 'logged' would pass the second line alone, which is exactly the state it was in.
    expect(toNewDiveInput(diveFormSchema.parse({ ...base, status: 'planned' }), 'metric').status).toBe('planned');
    expect(toNewDiveInput(diveFormSchema.parse(base), 'metric').status).toBe('logged');
  });
});

describe('toDivePatch', () => {
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
    material: 'steel', configuration: 'single', sizeL: 12, workingBar: 232,
    o2Pct: 21, hePct: null, startBar: 200, endBar: 50, ...over,
  });

  it('leaves a recorded equipment set alone when nothing in it changed', () => {
    // The assertion `Object.is` cannot make. `equipment` is an array, and two arrays are
    // never `Object.is`-equal however identical their contents — so without a comparison of
    // its own this key would be written on every single save, advancing `updated_at` and
    // handing §7's whole-row last-write-wins to the device that changed nothing.
    expect(patchAfterEditing({ equipment: ['hood', 'gloves'] })).toEqual({});
    expect(patchAfterEditing({ equipment: [] })).toEqual({});
  });

  it('sends the equipment set when the diver actually changed it, in both directions', () => {
    // The other half, so the test above cannot be passing merely because this key is never
    // sent at all — which is the failure mode a set-comparison bug would take.
    expect(patchAfterEditing({ equipment: ['hood'] }, { equipment: ['hood', 'torch'] }))
      .toEqual({ equipment: ['hood', 'torch'] });
    expect(patchAfterEditing({ equipment: ['hood', 'torch'] }, { equipment: [] }))
      .toEqual({ equipment: [] });
  });

  it('does not read a reordered equipment set as an edit', () => {
    // A stored order this build did not write — an older build, a hand-edited row, another
    // client. Wearing a hood and gloves is one fact whichever order it was written down in.
    expect(patchAfterEditing({ equipment: ['gloves', 'hood'] }, { equipment: ['hood', 'gloves'] }))
      .toEqual({});
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
      material: null, configuration: null, sizeL: null, workingBar: null,
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

// DESIGN.md §3's unit setting, from the two ends the form actually has: `toDisplayUnits`
// seeds the fields with the figures the diver reads, and `toNewDiveInput`/`toDivePatch`
// put SI back before anything is written. §6 stores SI and only SI.
describe('working in the diver’s own units', () => {
  describe('toDisplayUnits', () => {
    it('leaves a metric form exactly as the dive is stored, unrounded', () => {
      // Not merely "unconverted": no rounding either. 24.63 is what the diver typed and
      // what a metric save must write back, even though the detail screen shows 24.6.
      const seeded = toDisplayUnits(dive({ maxDepthM: 24.63, waterTempC: 25, weightsKg: 6.5 }), 'metric');
      expect(seeded.maxDepthM).toBe(24.63);
      expect(seeded.waterTempC).toBe(25);
      expect(seeded.weightsKg).toBe(6.5);
    });

    it('converts every field carrying one of the four pairs, and no other', () => {
      const seeded = toDisplayUnits(
        dive({
          maxDepthM: 24.6,
          avgDepthM: 18,
          visibilityM: 20,
          waterTempC: 25,
          airTempC: 30,
          weightsKg: 6.5,
          durationMin: 47,
          rating: 4,
          latitude: 50.12345,
          tanks: [{ sizeL: 12, configuration: 'single', workingBar: 232, startBar: 200, endBar: 50, o2Pct: 32, hePct: null, material: 'steel' }],
        }),
        'imperial',
      );
      expect(seeded.maxDepthM).toBe(81);
      expect(seeded.avgDepthM).toBe(59);
      expect(seeded.visibilityM).toBe(66);
      expect(seeded.waterTempC).toBe(77);
      expect(seeded.airTempC).toBe(86);
      expect(seeded.weightsKg).toBe(14);
      expect(seeded.tanks?.[0]?.workingBar).toBe(3365);
      expect(seeded.tanks?.[0]?.startBar).toBe(2901);
      expect(seeded.tanks?.[0]?.endBar).toBe(725);
      // Untouched: minutes are minutes, a rating is a rating, a coordinate is degrees, and
      // a cylinder's litres have no imperial counterpart that is the same quantity.
      expect(seeded.durationMin).toBe(47);
      expect(seeded.rating).toBe(4);
      expect(seeded.latitude).toBe(50.12345);
      expect(seeded.tanks?.[0]?.sizeL).toBe(12);
      expect(seeded.tanks?.[0]?.o2Pct).toBe(32);
      expect(seeded.tanks?.[0]?.configuration).toBe('single');
      // ...and nothing that is not a number at all.
      expect(seeded.tanks?.[0]?.material).toBe('steel');
    });
  });

  describe('toNewDiveInput', () => {
    it('writes SI whatever the diver typed in', () => {
      const values = diveFormSchema.parse({
        ...base,
        maxDepthM: '81',
        waterTempC: '77',
        weightsKg: '14',
        tanks: [{ startBar: '3000' }],
      });
      const input = toNewDiveInput(values, 'imperial');
      expect(input.maxDepthM).toBeCloseTo(24.6888, 10);
      expect(input.waterTempC).toBeCloseTo(25, 10);
      expect(input.weightsKg).toBeCloseTo(6.35029318, 10);
      expect(input.tanks?.[0]?.startBar).toBeCloseTo(206.8427187950508, 10);
    });

    it('writes a metric diver’s figures through untouched', () => {
      const input = toNewDiveInput(diveFormSchema.parse({ ...base, maxDepthM: '24.63' }), 'metric');
      expect(input.maxDepthM).toBe(24.63);
    });
  });

  describe('toDivePatch', () => {
    // The defect the display-space comparison exists to prevent. 24.6 m reads as 81 ft;
    // 81 ft converts back to 24.6888 m, so a naive diff would report a changed depth on a
    // save that only corrected a buddy's name — on every imperial dive, forever, with
    // updated_at advancing behind it.
    it('writes nothing for a field the imperial diver never touched', () => {
      expect(
        patchAfterEditing(
          { maxDepthM: 24.6, waterTempC: 25, weightsKg: 6.5, tanks: [{ startBar: 200, endBar: 50, sizeL: 12, configuration: 'single', workingBar: 232, o2Pct: 32, hePct: null, material: 'steel' }] },
          {},
          'imperial',
        ),
      ).toEqual({});
    });

    it('writes only the field the imperial diver did change, in SI', () => {
      const patch = patchAfterEditing({ maxDepthM: 24.6, buddy: 'Jana' }, { maxDepthM: '82' }, 'imperial');
      expect(Object.keys(patch)).toEqual(['maxDepthM']);
      expect(patch.maxDepthM).toBeCloseTo(24.9936, 10);
    });

    it('writes an unrelated edit without disturbing the depth it sits beside', () => {
      const patch = patchAfterEditing({ maxDepthM: 24.6, buddy: 'Jana' }, { buddy: 'Petr' }, 'imperial');
      expect(patch).toEqual({ buddy: 'Petr' });
    });

    it('leaves a cylinder alone whose pressures the imperial diver only read', () => {
      const stored = { tanks: [{ sizeL: 12, configuration: 'single' as const, workingBar: 232, o2Pct: 32, hePct: null, startBar: 200, endBar: 50, material: 'steel' as const }] };
      expect(patchAfterEditing(stored, {}, 'imperial')).toEqual({});
    });
  });

  // The cylinders-only door into the same rules, used by the two screens that hold raw form
  // cylinders outside a submit: the dive form's *Save as preset* (M1e task 2) and §3's
  // preset editor (task 3).
  describe('toStoredTanks', () => {
    const stored: Tank = {
      material: 'steel', configuration: 'single', sizeL: 12, workingBar: 232,
      o2Pct: 32, hePct: null, startBar: null, endBar: null,
    };

    it('parses what the diver typed and writes it in SI', () => {
      expect(toStoredTanks([{ sizeL: '12', workingBar: '3365' }], 'imperial')[0]).toMatchObject({
        sizeL: 12,
        workingBar: 232.00858291511537,
      });
    });

    it('reads an empty field as null rather than as zero', () => {
      // `diveFormSchema`'s own coercion contract, reached through this function rather than
      // re-implemented beside it: `Number('')` is 0, and `derived.ts` reads a 0 size as
      // contradictory, which voids a whole dive's gas figure (§10).
      expect(toStoredTanks([{ sizeL: '', workingBar: '' }], 'metric')[0]).toMatchObject({ sizeL: null, workingBar: null });
    });

    /**
     * **§10: "A display rounding may never rewrite stored data."**
     *
     * A preset stored at 232 bar shows an imperial diver 3365 psi, and 3365 psi converts back
     * to 232.00858… bar — so an editor that saved an untouched cylinder would erode the
     * figure and, worse, advance `updated_at` on a write that changed nothing, which under §7's
     * whole-row last-write-wins hands the conflict to the device that did nothing. Pinned with
     * `toBe`, not `toBeCloseTo`: "about 232" is exactly what the defect produces.
     */
    it('hands back the stored figure untouched when the diver only read it', () => {
      const converted = toStoredTanks([{ ...stored, workingBar: '3365' }], 'imperial', [stored]);
      expect(converted[0]?.workingBar).toBe(232);
    });

    it('still converts the field the imperial diver actually changed', () => {
      const converted = toStoredTanks([{ ...stored, workingBar: '3000' }], 'imperial', [stored]);
      expect(converted[0]?.workingBar).toBeCloseTo(206.8427187950508, 10);
    });

    // The dive form captures a preset that has nothing stored yet, so it passes no cylinders
    // to preserve against — and must keep converting. Without this the fix above could have
    // been "never convert at all".
    it('converts everything when there is no stored cylinder to preserve against', () => {
      expect(toStoredTanks([{ workingBar: '3365' }], 'imperial')[0]?.workingBar).toBe(232.00858291511537);
    });

    // Index-wise, the pairing `toDivePatch` and `sameTanks` already use for these arrays:
    // cylinder 1 is cylinder 1. A stored array shorter than the form's leaves the extra
    // cylinders with nothing to preserve against, which is simply the case above.
    it('pairs each cylinder with the stored one at its own index', () => {
      const deco: Tank = { ...stored, workingBar: 207 };
      const converted = toStoredTanks(
        [{ ...stored, workingBar: '3365' }, { ...deco, workingBar: '3002' }],
        'imperial',
        [stored, deco],
      );
      expect(converted.map((tank) => tank.workingBar)).toEqual([232, 207]);
    });
  });
});

describe('sameEquipment', () => {
  it('is true for the same tokens in a different order', () => {
    expect(sameEquipment(['hood', 'gloves'], ['gloves', 'hood'])).toBe(true);
    expect(sameEquipment([], [])).toBe(true);
  });

  it('is false when one holds a token the other does not', () => {
    expect(sameEquipment(['hood'], ['gloves'])).toBe(false);
    expect(sameEquipment(['hood'], ['hood', 'gloves'])).toBe(false);
    expect(sameEquipment([], ['hood'])).toBe(false);
  });

  it('compares set sizes, not array lengths, so a repeated token cannot fake a match', () => {
    // The discriminating case for the implementation: `['hood', 'hood']` and
    // `['hood', 'gloves']` are the same array LENGTH, and every member of the first is
    // present in the second — so a length-plus-membership check calls them equal. They are
    // not: one records a hood and the other records a hood and gloves.
    expect(sameEquipment(['hood', 'hood'], ['hood', 'gloves'])).toBe(false);
    // ...and a duplicate against the fact it duplicates is still the same fact.
    expect(sameEquipment(['hood', 'hood'], ['hood'])).toBe(true);
  });
});
