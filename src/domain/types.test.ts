import * as domain from './types';
import {
  AGENCY_VALUES,
  CONFIGURATION_VALUES,
  EQUIPMENT_VALUES,
  SALINITY_VALUES,
  SERVICE_VALUES,
  SITE_TYPE_VALUES,
  SUITABLE_FOR_VALUES,
  VISIBILITY_VALUES,
  WEATHER_VALUES,
  WEIGHTS_FEEL_VALUES,
  cylinderCount,
  type Configuration,
} from './types';

/** A vocabulary member: lowercase words joined by a single `_` (§10, 2026-11-17). */
const SNAKE_CASE = /^[a-z]+(_[a-z]+)*$/;

/**
 * Every closed vocabulary `domain/types.ts` declares, found by its own naming convention
 * rather than listed here — so a vocabulary added there is swept on the commit that adds it,
 * and a list of the lists cannot go stale the way the first version of this file's sweep did.
 *
 * The count is asserted alongside the sweep for the reason a derived list always needs one: a
 * filter that matched nothing would pass every assertion below without running one.
 */
const ALL_VOCABULARIES: [string, readonly unknown[]][] = Object.entries(
  domain as Record<string, unknown>,
).filter((entry): entry is [string, readonly unknown[]] => entry[0].endsWith('_VALUES') && Array.isArray(entry[1]));

/**
 * The vocabularies of **words** — `Entry`, `Suit`, `Weather` and the rest — which is what
 * every vocabulary in this file was until M1h.
 *
 * Split from the numeric ones below rather than the sweep being loosened to accommodate them,
 * because the two obey genuinely different rules and a sweep that admitted both would check
 * neither: "lowercase words joined by `_`" is meaningless for `2`, and "ascending with no gaps" is
 * meaningless for `semidry`. Both halves are still *discovered* from the same `_VALUES`
 * convention, so a vocabulary added to `domain/types.ts` lands in one bucket or the other and
 * cannot slip between them — which the total asserted below is what guarantees.
 */
const VOCABULARIES: [string, readonly string[]][] = ALL_VOCABULARIES.filter(
  (entry): entry is [string, readonly string[]] => entry[1].every((member) => typeof member === 'string'),
);

/**
 * The **ordered numeric scales** — the 0–3 condition scales and the 1–5 rating — which M1h
 * added when §0.6's icon sheet turned four text fields into chip rows.
 *
 * These are vocabularies in exactly the sense this file means: a closed list a form offers as
 * a fixed set of chips, with the type derived from the list. What they are *not* is the
 * storage type; `Dive['waves']` and `Dive['rating']` stay `number | null` per §10, and
 * `domain/types.ts` carries the paragraph explaining why the two must not be unified.
 */
const NUMERIC_SCALES: [string, readonly number[]][] = ALL_VOCABULARIES.filter(
  (entry): entry is [string, readonly number[]] => entry[1].every((member) => typeof member === 'number'),
);

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

  it('offers the site types, suitable-for levels, services and agencies #31 names, in that order', () => {
    // #31's lists as the issue orders them, which is the order the chips appear in. Four
    // members are more than one word and are spelled in snake_case by the rule below:
    // `open_water`, `sdi_tdi`, `swim_through` and `blue_water`.
    expect(SITE_TYPE_VALUES).toEqual([
      'wreck',
      'reef',
      'wall',
      'pinnacle',
      'canyon',
      'swim_through',
      'muck',
      'drift',
      'blue_water',
    ]);
    expect(SUITABLE_FOR_VALUES).toEqual(['open_water', 'advanced', 'experienced', 'technical']);
    expect(SERVICE_VALUES).toEqual(['air', 'nitrox', 'trimix', 'rental', 'courses', 'boat', 'shore', 'repair']);
    expect(AGENCY_VALUES).toEqual(['padi', 'ssi', 'cmas', 'naui', 'sdi_tdi', 'raid', 'gue', 'bsac', 'iantd', 'other']);
  });

  // M1h: `WEATHER_VALUES` shipped holding `partly`, which is half a phrase — a diver means
  // *partly cloudy* — and the two ways of finishing the phrase in place were both rejected:
  // a lookup table inside `formatWeather` puts the missing word in the formatter and leaves
  // the stored value meaning nothing on its own, and `'partly cloudy'` with a space shapes
  // the vocabulary so that `capitalize` happens to work. The scale changed instead, to
  // `cloudy` (some cloud) and `overcast` (solid grey).
  //
  // **What is actually checkable is the convention, not the judgement.** No test can say that
  // `partly` fails to mean itself; that is recorded in `domain/types.ts` and §10. This pins the
  // half a machine can see — every member of every vocabulary is lowercase words joined by a
  // single `_` — which is what forbids the rejected `'partly cloudy'` spelling and any
  // capitals, and what `semidry` (one word) and `open_water` (snake_case, since the owner's
  // 2026-11-17 call replaced M1h's one-word rule for multi-word values) both obey.
  it('spells every member as lowercase words joined by a single underscore', () => {
    // **Derived, not listed.** The first version of this test typed out eight of the ten
    // vocabularies and quietly omitted `ENTRY_VALUES` and `TANK_MATERIAL_VALUES` — a
    // hand-maintained list of the lists, which is §4.1's defect one level up and exactly what
    // this file exists to catch one level down. Every `*_VALUES` export is swept, so a
    // vocabulary added to `domain/types.ts` is covered on the commit that adds it.
    expect(VOCABULARIES.map(([name]) => name)).toHaveLength(15);
    for (const [, vocabulary] of VOCABULARIES) {
      for (const member of vocabulary) {
        expect(member).toMatch(SNAKE_CASE);
      }
    }
    // The rule has to be able to fail: a space, a capital, a doubled or a leading separator.
    for (const bad of ['partly cloudy', 'Open_Water', 'open__water', '_open', 'open_', 'Swim_Through']) {
      expect(bad).not.toMatch(SNAKE_CASE);
    }
  });

  // The numeric scales' equivalent of the rule above: what a machine can check about a list
  // of levels is that it really is a *scale*.
  //
  // **Ascending is behaviour, not tidiness**, and it is why this is asserted rather than left
  // to the eye. `domain/types.ts` says the order of a vocabulary "is the order the chips
  // appear in", and §0.6's marks for these two are built on that order meaning something:
  // current arrows accumulate one way and visibility bars count up, so a mark drawn for the
  // second chip shows more than the mark on the first. Shuffle the list and the row still
  // renders, still saves, and now shows three arrows to the left of one — a mark that
  // contradicts its own scale, which is precisely the legend §0.6 rules out.
  it('declares every numeric scale as ascending whole levels, which is what its marks assume', () => {
    expect(NUMERIC_SCALES.map(([name]) => name)).toHaveLength(2);
    for (const [, scale] of NUMERIC_SCALES) {
      expect(scale.length).toBeGreaterThan(0);
      for (const level of scale) expect(Number.isInteger(level)).toBe(true);
      // Strictly ascending, which also rules out a repeated level — two chips a diver cannot
      // tell apart, saving the same value.
      for (let i = 1; i < scale.length; i += 1) expect(scale[i]).toBeGreaterThan(scale[i - 1] as number);
    }
  });

  // The sweeps above are worth what their discovery is worth, so this pins the discovery
  // itself: every `*_VALUES` export lands in exactly one of the two buckets. A vocabulary of
  // mixed types, or of anything that is neither a string nor a number, would be swept by
  // neither and would pass both tests above by being invisible to them — which is the same
  // hole `VOCABULARIES` was rewritten to close when it was a hand-typed list.
  it('sweeps every vocabulary it declares, under one rule or the other', () => {
    expect(VOCABULARIES.length + NUMERIC_SCALES.length).toBe(ALL_VOCABULARIES.length);
  });
});
