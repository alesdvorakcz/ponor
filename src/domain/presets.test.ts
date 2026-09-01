import { comparePresets, presetNamed } from './presets';
import type { GearPreset } from './types';

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
