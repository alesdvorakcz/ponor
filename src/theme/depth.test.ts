import { depthBand, depthBandColor, depthBandRanges, depthColor, depthColorOrNull } from './depth';
import { depthBandLimits, depthScale } from './tokens';

describe('the band/colour pairing depthColor depends on', () => {
  // depth.ts proves at compile time that the scale is one longer than the
  // limits, but it proves it against tokens.d.ts — a hand-written declaration
  // for a plain-JS module. Only a runtime check can catch tokens.js drifting
  // from its own declaration, and the failure mode is silent: React Native
  // renders `color: undefined` as the default text colour without throwing, so
  // a short palette would break DESIGN.md §0.1 with no crash anywhere.
  it('gives every band exactly one colour, in both schemes', () => {
    expect(depthBandLimits).toHaveLength(5);
    for (const scheme of ['dark', 'light'] as const) {
      expect(depthScale[scheme]).toHaveLength(depthBandLimits.length + 1);
    }
  });

  it('returns a real colour for every band, never undefined', () => {
    // One depth per band, taken from the limits themselves so this follows a
    // palette change rather than hard-coding today's boundaries.
    const [, , , , deepestLimit] = depthBandLimits;
    const perBand = [...depthBandLimits, deepestLimit + 1];
    for (const scheme of ['dark', 'light'] as const) {
      const colours = perBand.map((metres) => depthColor(metres, scheme));
      expect(colours).toHaveLength(6);
      expect(colours.every((colour) => /^#[0-9A-Fa-f]{6}$/.test(colour))).toBe(true);
      expect(new Set(colours).size).toBe(6); // and each band is distinguishable
    }
  });
});

describe('depthBand', () => {
  it('puts a surface dive in band 1', () => {
    expect(depthBand(0)).toBe(1);
  });

  it('puts a shallow dive in band 1', () => {
    expect(depthBand(4.5)).toBe(1);
  });

  it('treats a boundary depth as belonging to the shallower band', () => {
    expect(depthBand(6)).toBe(1);
    expect(depthBand(6.1)).toBe(2);
    expect(depthBand(20)).toBe(3);
    expect(depthBand(20.1)).toBe(4);
  });

  it('puts anything past 40 m in band 6', () => {
    expect(depthBand(40)).toBe(5);
    expect(depthBand(40.1)).toBe(6);
    expect(depthBand(120)).toBe(6);
  });

  it('rejects a negative depth', () => {
    expect(() => depthBand(-1)).toThrow(RangeError);
  });

  it('rejects a depth that is not a finite number', () => {
    expect(() => depthBand(Number.NaN)).toThrow(RangeError);
  });
});

describe('depthColor', () => {
  it('returns the dark colour for the band', () => {
    expect(depthColor(32.4, 'dark')).toBe('#2E9BE0');
  });

  it('returns the light colour for the same band', () => {
    expect(depthColor(32.4, 'light')).toBe('#0B76B8');
  });

  it('colours a quarry dive differently from a deep reef dive', () => {
    expect(depthColor(14.8, 'dark')).toBe('#F5CE3E');
    expect(depthColor(41.0, 'dark')).toBe('#6673E4');
  });
});

// M1's dive fields are all nullable except the date, and an empty numeric form field
// parses to NaN (`parseFloat('') === NaN`). A list row cannot let that reach
// `depthColor` and throw during render, but `depthColor`/`depthBand`'s throw-on-invalid
// contract is correct and stays as-is (see the `depthColor`/`depthBand` suites above) —
// this is the null-safe entry point a render path should call instead.
describe('depthColorOrNull', () => {
  it('returns null for a null depth', () => {
    expect(depthColorOrNull(null, 'dark')).toBeNull();
  });

  it('returns null for an undefined depth', () => {
    expect(depthColorOrNull(undefined, 'dark')).toBeNull();
  });

  it('returns null for NaN, as parseFloat gives an empty numeric field', () => {
    expect(depthColorOrNull(Number.NaN, 'dark')).toBeNull();
  });

  it('returns null for a negative depth', () => {
    expect(depthColorOrNull(-1, 'dark')).toBeNull();
  });

  it('returns null for a non-finite depth', () => {
    expect(depthColorOrNull(Number.POSITIVE_INFINITY, 'dark')).toBeNull();
    expect(depthColorOrNull(Number.NEGATIVE_INFINITY, 'dark')).toBeNull();
  });

  it('returns the same colour depthColor would for a valid depth, in both schemes', () => {
    expect(depthColorOrNull(32.4, 'dark')).toBe(depthColor(32.4, 'dark'));
    expect(depthColorOrNull(32.4, 'light')).toBe(depthColor(32.4, 'light'));
  });
});

// **The scale as spans, which is the one thing a first-run screen can teach** (DESIGN.md
// §0.6's empty state, M1h). `depthBandRanges` is what `DepthLegend` prints, and the defect it
// exists to prevent is the one §4.1 is named for: a legend with `0–6, 6–12, 12–20, …` typed
// into it is a second copy of `depthBandLimits`, and the first palette edit leaves a screen
// whose whole purpose is teaching the scale confidently teaching the wrong one — in the right
// colours, which is what would stop anyone noticing.
//
// So none of these restates a boundary. Each asks `depthBand` — the function every dive's
// colour already goes through — whether it agrees with the span, which is the only form of
// this assertion that a hand-typed legend could not also pass.
describe('the depth scale as spans', () => {
  it('has one span per band, and numbers them in order', () => {
    expect(depthBandRanges).toHaveLength(depthBandLimits.length + 1);
    expect(depthBandRanges.map((range) => range.band)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('starts at the surface and ends open, because the deepest band has no floor', () => {
    expect(depthBandRanges.at(0)?.fromM).toBe(0);
    expect(depthBandRanges.at(-1)?.toM).toBeNull();
    // Every other span is closed: a `null` anywhere else would print "12+ m" in the middle of
    // a scale that continues.
    expect(depthBandRanges.filter((range) => range.toM === null)).toHaveLength(1);
  });

  it('leaves no gap and no overlap, so each span begins where the last one ended', () => {
    for (const [index, range] of depthBandRanges.entries()) {
      if (index === 0) continue;
      expect(range.fromM).toBe(depthBandRanges[index - 1]?.toM);
    }
  });

  // **The assertion a retyped legend fails.** `depthBand` is what colours a dive; if a span
  // claims 12–20 and `depthBand(20)` says band 4, the legend prints one boundary and the
  // logbook draws another. Asked at the top of each span and at its bottom edge, because
  // `depthBand` puts a depth exactly on a boundary in the SHALLOWER band and a span that
  // quietly disagreed about that would be off by one whole band at every edge.
  it('agrees with the band a dive at either end of it would actually be drawn in', () => {
    for (const range of depthBandRanges) {
      // Just inside the top of the span: `fromM` itself belongs to the band above it.
      expect(depthBand(range.fromM + 0.01)).toBe(range.band);
      if (range.toM !== null) {
        expect(depthBand(range.toM)).toBe(range.band);
        // ...and one centimetre deeper is the next band down, which is what makes the span an
        // interval rather than a lower bound.
        expect(depthBand(range.toM + 0.01)).toBe(range.band + 1);
      }
    }
  });

  it('paints each span in the colour a dive inside it is painted in', () => {
    for (const scheme of ['dark', 'light'] as const) {
      for (const range of depthBandRanges) {
        expect(depthBandColor(range.band, scheme)).toBe(depthColor(range.fromM + 0.01, scheme));
      }
    }
  });
});

// `depthColor` is now `depthBand` and `depthBandColor` composed. The split is what lets the
// legend ask for a band's colour without inventing a depth to ask with — and these pin that
// the two halves still answer as one, since a second lookup table inside `depthBandColor`
// would pass every test above and colour the legend differently from the logbook.
describe('depthBandColor', () => {
  it('hands back the same six colours the scale declares, in band order', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const colours = depthBandRanges.map((range) => depthBandColor(range.band, scheme));
      expect(colours).toEqual([...depthScale[scheme]]);
    }
  });
});
