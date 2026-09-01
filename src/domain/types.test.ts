import {
  CONFIGURATION_VALUES,
  EQUIPMENT_VALUES,
  SALINITY_VALUES,
  VISIBILITY_VALUES,
  WEATHER_VALUES,
  WEIGHTS_FEEL_VALUES,
  cylinderCount,
  type Configuration,
} from './types';

/**
 * `domain/types.ts` is almost entirely types and lists, which a test cannot meaningfully
 * assert about — the compiler already does, and that is the whole design (`Entry` cannot
 * disagree with `ENTRY_VALUES` because it *is* `ENTRY_VALUES`). Two things in it are not
 * types, and both are here: the configuration→count rule, which `derived.ts`'s gas
 * arithmetic leans on, and the ORDER of the vocabularies, which that file's own docblock
 * says "is part of what these declare" and which nothing else can check.
 */
describe('cylinderCount', () => {
  it('is one cylinder for a single and two for both of the doubles', () => {
    expect(cylinderCount('single')).toBe(1);
    expect(cylinderCount('twinset')).toBe(2);
    expect(cylinderCount('sidemount')).toBe(2);
  });

  it('is null for an unrecorded rig, never a guessed 1', () => {
    // The load-bearing half. `derived.ts` classifies null as *absent*, which is a different
    // bucket from a known single even though the gas arithmetic then falls back to one
    // cylinder — and its whole absent/contradictory policy rests on the two staying apart.
    expect(cylinderCount(null)).toBeNull();
  });

  it('is null for a rig this build has never heard of', () => {
    // Reachable through M2 sync from a client whose vocabulary is longer than this one's.
    // The parameter type says it cannot happen; the type is a label on what this client
    // produces, not a guarantee about what the network delivers.
    expect(cylinderCount('rebreather' as Configuration)).toBeNull();
    expect(cylinderCount('' as Configuration)).toBeNull();
  });

  it('answers for every member of the vocabulary, so no chip can render a countless rig', () => {
    // The `Record<Configuration, number>` behind this makes a missing member a compile
    // error; this is the runtime half of the same statement, and it is what would fail if
    // someone loosened that Record to a `Partial`.
    for (const configuration of CONFIGURATION_VALUES) {
      expect(cylinderCount(configuration)).toBeGreaterThan(0);
    }
  });
});

describe('the vocabularies', () => {
  it('offers salt and fresh, and no longer brackish', () => {
    // §10: a shipped field is removed deliberately and by name. This is the name.
    expect(SALINITY_VALUES).toEqual(['salt', 'fresh']);
  });

  it('orders weather and visibility best-to-worst, and the weighting feel around its neutral value', () => {
    // The order is what the chip row renders in, so it is behaviour rather than formatting:
    // `good` sits in the middle deliberately, so the neutral answer is not at an end of the
    // row where a thumb lands by accident.
    expect(WEATHER_VALUES[0]).toBe('sunny');
    expect(WEATHER_VALUES.at(-1)).toBe('foggy');
    expect(VISIBILITY_VALUES).toEqual(['high', 'average', 'low']);
    expect(WEIGHTS_FEEL_VALUES).toEqual(['under', 'good', 'over']);
  });

  it('holds every accessory the equipment set can record', () => {
    expect(EQUIPMENT_VALUES).toEqual(['hood', 'gloves', 'boots', 'torch', 'camera']);
  });
});
