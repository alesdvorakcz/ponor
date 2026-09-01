import {
  comparePresets,
  duplicatePresetMessage,
  EMPTY_PRESET_MESSAGE,
  presetNamed,
  presetRefusal,
  UNNAMED_PRESET_MESSAGE,
} from './presets';
import type { GearPreset, Tank } from './types';

/**
 * A `GearPreset` with only the fields these two rules read. No database: both functions are
 * pure, and they used to be tested through `createGearPreset` against a real one purely
 * because they lived in `db/gearPresets.ts`. `db/gearPresets.test.ts` still exercises the
 * ordering through `listGearPresets`, which is what pins that the repository actually applies
 * the comparator rather than only that the comparator is right.
 */
let seq = 0;
const preset = (over: Partial<GearPreset> = {}): GearPreset => ({
  id: `preset-${String(seq++).padStart(4, '0')}`,
  name: 'twin 12 steel',
  tanks: [],
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

const sorted = (presets: GearPreset[]) => [...presets].sort(comparePresets).map((p) => p.name);

describe('comparePresets', () => {
  it('orders by name, whatever case the diver typed it in', () => {
    // Deliberately given in an order that is neither the answer nor its reverse, so a
    // comparator that merely preserved or flipped the input would fail here.
    expect(
      sorted([preset({ name: 'twin 12 steel' }), preset({ name: 'Alu 80 nitrox' }), preset({ name: 'alu 80' })]),
    ).toEqual(['alu 80', 'Alu 80 nitrox', 'twin 12 steel']);
  });

  it('ignores whitespace the diver left around a name', () => {
    expect(sorted([preset({ name: 'beta' }), preset({ name: '  alpha  ' })])).toEqual([
      '  alpha  ',
      'beta',
    ]);
  });

  /**
   * §2.1's own vocabulary is Czech-facing (§0.5: the app ships `cs`), and `localeCompare` is
   * what puts `Č` where Czech puts it rather than after `Z`. Asserted against a plain `<`
   * comparison, which is the thing this would silently degrade into: `'Čtyřka' < 'Dvojka'` is
   * false, because code-point order puts every accented letter past `Z`.
   */
  it('sorts an accented name where the language puts it, not after Z', () => {
    expect(sorted([preset({ name: 'Dvojka' }), preset({ name: 'Čtyřka' })])).toEqual([
      'Čtyřka',
      'Dvojka',
    ]);
    expect('Čtyřka' < 'Dvojka').toBe(false);
  });

  /**
   * Two presets sharing a name is a row the app itself refuses to create (`presetNamed`
   * below), but M2's `pull_changes` can deliver one from another device — and a list whose
   * order depended on which of the two the sort happened to reach first would shuffle under
   * the diver between renders. Both orders in, one order out.
   */
  it('breaks a tie on creation time, so two same-named presets have one stable order', () => {
    const older = preset({ name: 'alu 80', createdAt: '2026-08-01T00:00:00.000Z' });
    const newer = preset({ name: 'Alu 80', createdAt: '2026-08-20T00:00:00.000Z' });
    expect([...[older, newer]].sort(comparePresets).map((p) => p.id)).toEqual([older.id, newer.id]);
    expect([...[newer, older]].sort(comparePresets).map((p) => p.id)).toEqual([older.id, newer.id]);
  });
});

describe('presetNamed', () => {
  it('finds a preset whose name differs only by case or surrounding space', () => {
    const alu = preset({ name: 'Alu 80' });
    expect(presetNamed([preset({ name: 'twin 12' }), alu], '  alu 80 ')?.id).toBe(alu.id);
  });

  it('finds nothing for a name no preset holds', () => {
    expect(presetNamed([preset({ name: 'Alu 80' })], 'twin 12')).toBeNull();
  });

  it('finds nothing at all in an empty list', () => {
    expect(presetNamed([], 'alu 80')).toBeNull();
  });

  /**
   * §3's preset editor renames a preset, and a preset is not a duplicate of itself — without
   * the exception, saving under the name it already has would report a collision with itself
   * and the editor would refuse every save that did not change the name.
   */
  it('does not count the preset being edited as its own duplicate', () => {
    const alu = preset({ name: 'Alu 80' });
    expect(presetNamed([alu], 'alu 80', alu.id)).toBeNull();
  });

  /** The other half of that exception: it excuses the ONE preset named, not the question. */
  it('still finds a different preset already holding the name being moved to', () => {
    const alu = preset({ name: 'Alu 80' });
    const twin = preset({ name: 'twin 12' });
    expect(presetNamed([alu, twin], 'alu 80', twin.id)?.id).toBe(alu.id);
  });
});

// ---------------------------------------------------------------------------------------
// presetRefusal — the one owner of what stops a preset being saved (M1e fix round 1)
// ---------------------------------------------------------------------------------------

const tank = (over: Partial<Tank> = {}): Tank => ({
  material: null, sizeL: null, count: null, workingBar: null,
  o2Pct: null, hePct: null, startBar: null, endBar: null, ...over,
});

const REAL_CYLINDER = [tank({ material: 'steel', sizeL: 12 })];

describe('presetRefusal', () => {
  it('lets a real preset through, and says so in one place rather than at two call sites', () => {
    const verdict = presetRefusal([], 'twin 12 steel', REAL_CYLINDER);
    expect(verdict).toEqual({ storedName: 'twin 12 steel', name: null, cylinders: null, refused: false });
  });

  // A preset is found by its name and by nothing else — it is all a chip shows.
  it.each([['an empty name', ''], ['a whitespace-only name', '   ']])('refuses %s', (_case, name) => {
    const verdict = presetRefusal([], name, REAL_CYLINDER);
    expect(verdict.name).toBe(UNNAMED_PRESET_MESSAGE);
    expect(verdict.refused).toBe(true);
    // The cylinders are fine, and the verdict says so — which is what lets a screen with two
    // slots answer both questions at once instead of one at a time.
    expect(verdict.cylinders).toBeNull();
  });

  // Two chips reading "alu 80" with different cylinders is a row the diver cannot tell apart
  // and cannot fix by looking. The sentence quotes the spelling the EXISTING preset has, not
  // the one just typed: sending a diver to look for a chip that says no such thing would be
  // its own small lie.
  it('refuses a name another preset already has, and quotes that preset’s own spelling', () => {
    const verdict = presetRefusal([preset({ name: 'alu 80' })], 'ALU 80', REAL_CYLINDER);
    expect(verdict.name).toBe('You already have a preset called “alu 80”.');
    expect(verdict.name).toBe(duplicatePresetMessage('alu 80'));
  });

  // `exceptId`: renaming a preset to the name it already has is not a collision with
  // anything, and without the exception an editor would refuse every save that did not change
  // the name — which is most of them.
  it('lets a preset keep its own name, while still catching a different one', () => {
    const mine = preset({ name: 'alu 80' });
    const theirs = preset({ name: 'twin 12 steel' });
    expect(presetRefusal([mine, theirs], 'alu 80', REAL_CYLINDER, mine.id).refused).toBe(false);
    expect(presetRefusal([mine, theirs], 'twin 12 steel', REAL_CYLINDER, mine.id).name).toBe(
      duplicatePresetMessage('twin 12 steel'),
    );
  });

  // A preset with nothing in it is a chip that blanks a diver's cylinder block — worse than no
  // chip at all. `[]` and `[{ every field null }]` are the same claim under §6, so they get
  // the same verdict; a cylinder holding nothing but the pressures a preset never stores is
  // the third spelling of it, and the one that looks full on a form.
  it.each([
    ['no cylinders at all', [] as Tank[]],
    ['a cylinder recording nothing', [tank()]],
    ['a cylinder holding only the pressures a preset never stores', [tank({ startBar: 200, endBar: 60 })]],
  ])('refuses %s', (_case, tanks) => {
    const verdict = presetRefusal([], 'twin 12 steel', tanks);
    expect(verdict.cylinders).toBe(EMPTY_PRESET_MESSAGE);
    expect(verdict.refused).toBe(true);
  });

  // Both at once, because the two screens that ask disagree about where to SAY it and must not
  // have to disagree about what is wrong. The dive form has one slot and shows the cylinder
  // sentence first; the editor has two and shows both.
  it('answers both questions independently, so a caller can show either or both', () => {
    const verdict = presetRefusal([], '', []);
    expect(verdict.name).toBe(UNNAMED_PRESET_MESSAGE);
    expect(verdict.cylinders).toBe(EMPTY_PRESET_MESSAGE);
  });

  // `storedName` is the name as it will be written, decided here rather than trimmed again at
  // each writer: the check and the write must agree about which string was judged.
  it('hands back the name as it will be stored, trimmed', () => {
    expect(presetRefusal([], '  alu 80  ', REAL_CYLINDER).storedName).toBe('alu 80');
  });

  // `refused` is derived here rather than recomputed by every caller — §4.1's "derive, or tie
  // at compile time". A screen that had to spell out `name !== null || cylinders !== null`
  // could get it wrong in one place and right in the other.
  it('reports refusal whenever either half has something to say', () => {
    expect(presetRefusal([], '', REAL_CYLINDER).refused).toBe(true);
    expect(presetRefusal([], 'ok', []).refused).toBe(true);
    expect(presetRefusal([], 'ok', REAL_CYLINDER).refused).toBe(false);
  });
});
