import type { DiveSample } from '../db/schema';
import {
  axisMax,
  colourRuns,
  depthAxis,
  medianIntervalS,
  pathOf,
  round,
  scrubbedIndexAt,
  sparklinePoints,
} from './profile';

const s = (t: number, d: number): DiveSample => [t, d, null, null];

describe('axisMax', () => {
  // The chart has two axes and the spec gives them one rounding rule on purpose (§3 for
  // depth, §4.5 for consumption: "matching the depth axis's own rounding rule so the two
  // sides of the plot are scaled by one convention rather than two"). Asserted directly and
  // not only through `depthAxis`, because the consumption axis is this function's other
  // caller and takes litres per minute — the number that would drift if the rule were copied.
  it('runs to the next multiple of ten, whatever it is measuring', () => {
    expect(axisMax(24.33)).toBe(30);
    expect(axisMax(30)).toBe(30);
    expect(axisMax(36.93)).toBe(40);
  });

  // A dive that never left the surface, or a gas trace whose every window reads near zero,
  // would otherwise scale against a maximum of nothing and divide every point by it.
  it('never collapses to a zero-height axis', () => {
    expect(axisMax(0)).toBe(10);
    expect(axisMax(4.2)).toBe(10);
  });
});

describe('depthAxis', () => {
  it('rounds the depth axis up to the next ten metres, so the scale is readable', () => {
    expect(depthAxis(24.33)).toEqual({ max: 30, ticks: [0, 10, 20, 30] });
    expect(depthAxis(30)).toEqual({ max: 30, ticks: [0, 10, 20, 30] });
    expect(depthAxis(4.2)).toEqual({ max: 10, ticks: [0, 10] });
  });
});

describe('colourRuns', () => {
  it('breaks the curve into one run per depth band, so each stroke is the colour of its own depth', () => {
    // 3 m and 5 m are both band 1; 8 m is band 2. Two runs, and the second starts at the
    // last point of the first so the strokes meet rather than leaving a gap at the boundary.
    const runs = colourRuns([s(0, 3), s(10, 5), s(20, 8)], 'light');
    expect(runs).toHaveLength(2);
    expect(runs[0]?.points.map((p) => p.v)).toEqual([3, 5]);
    expect(runs[1]?.points.map((p) => p.v)).toEqual([5, 8]);
    expect(runs[0]?.colour).not.toBe(runs[1]?.colour);
  });

  it('drops a sample whose depth depthBand would reject, rather than let it crash the curve mid-render', () => {
    // depthBand (theme/depth.ts) throws on a negative or non-finite depth by contract, and
    // nothing upstream guarantees a stored sample honours that: domain/import/suunto.ts's own
    // `num()` keeps a sample whose depth is a finite number without ever checking its sign, so
    // a device drifting at the surface could in principle write a small negative depth into a
    // stored series. colourRuns is read straight into a render, so one bad sample must not take
    // the whole chart down with it.
    const withABadSample = [s(0, 3), s(10, NaN), s(20, 5)];
    expect(() => colourRuns(withABadSample, 'light')).not.toThrow();
    expect(
      colourRuns(withABadSample, 'light')
        .flatMap((r) => r.points)
        .map((p) => p.v),
    ).toEqual([3, 5]);
  });

  it('never produces a one-point run, even when the very first two samples straddle a boundary', () => {
    // Review, Finding 1: `points` is seeded with just the first sample and pushed
    // unconditionally on the first band change — so when the very FIRST comparison already
    // crosses a boundary (4 m is band 1; 8 m and 9 m are both band 2), the run pushed holds
    // only that one seed. Verified directly before this fix: this returned runs of length
    // [1, 3], and `pathOf` would render the first as `"M0 4"` — a stroked `<Path>` with a
    // move and no drawing command. Nothing drawn is lost by dropping it: the point survives
    // as the repeated head of the run after it.
    const runs = colourRuns([s(0, 4), s(10, 8), s(20, 9)], 'light');
    expect(runs.every((run) => run.points.length >= 2)).toBe(true);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.points.map((p) => p.v)).toEqual([4, 8, 9]);
  });
});

describe('medianIntervalS', () => {
  it('states the interval the device actually recorded, not the one it declared', () => {
    // The reference dive declares 10 s and its real deltas run 9.74-10.10. The median is
    // what a diver is told, so a device whose clock drifts is described honestly.
    expect(medianIntervalS([s(0, 1), s(9.74, 2), s(19.75, 3), s(30.1, 4)])).toBe(10);
  });

  it('has nothing to compute an interval from below two samples, and says so as zero rather than a fabricated cadence', () => {
    expect(medianIntervalS([])).toBe(0);
    expect(medianIntervalS([s(0, 3)])).toBe(0);
  });
});

describe('sparklinePoints', () => {
  it('keeps the deepest sample when downsampling, so the shape agrees with the number', () => {
    // Every-nth sampling would drop a maximum that lands on a single sample — and the row
    // draws this beside the depth figure, so the two would visibly disagree.
    const many = Array.from({ length: 100 }, (_u, i) => s(i * 10, i === 37 ? 42 : 5));
    const points = sparklinePoints(many, 10);
    expect(points.length).toBeLessThanOrEqual(10);
    expect(Math.max(...points.map((p) => p.v))).toBe(42);
  });
});

// This function is `DepthProfile`'s `Gesture.Pan()` wrapped only far enough to be called
// directly — extracted so the cases a simulated gesture stages awkwardly (an unmeasured plot,
// a finger dragged past either edge) are testable as arithmetic rather than as plumbing.
describe('scrubbedIndexAt', () => {
  /** Four samples over ten minutes, three of them bunched at the end: the shape that tells
   * "nearest by time" apart from "nearest by position in the array". */
  const UNEVEN: DiveSample[] = [
    [0, 4, null, null],
    [500, 22, null, null],
    [590, 18, null, null],
    [600, 2, null, null],
  ];

  it('maps a touch to the nearest sample by time, not to its position in the array', () => {
    // Halfway across a plot whose series runs 0→600 s is t = 300 s. The nearest sample by TIME
    // is the one at 500 s, 200 s away; the sample halfway along the ARRAY is the one at 590 s,
    // which is 290 s away. Indexing by position would land on the wrong one.
    expect(scrubbedIndexAt(150, 300, UNEVEN)).toBe(1);
  });

  it('clamps a finger dragged past either edge of the plot to the ends of the series', () => {
    expect(scrubbedIndexAt(-40, 300, UNEVEN)).toBe(0);
    expect(scrubbedIndexAt(900, 300, UNEVEN)).toBe(UNEVEN.length - 1);
  });

  it('maps nothing at all until the plot has reported a width', () => {
    expect(scrubbedIndexAt(150, null, UNEVEN)).toBeNull();
    expect(scrubbedIndexAt(150, 0, UNEVEN)).toBeNull();
  });

  // Review round 2, Finding 2: every case above is built on UNEVEN, which starts at t = 0 — so
  // none of them can tell `startS + fraction * (endS - startS)` apart from a mapping that
  // forgot the `startS +` term, since with startS = 0 the two are the same number. The one case
  // that touches a non-zero offset (the clamp test's `900`) lands on fraction 1.0, where the
  // offset cancels out of the subtraction either way.
  it('maps the touch onto the series’ own start offset, not onto zero', () => {
    // A series starting well after zero, scrubbed to the middle of the plot: fraction 0.5 of a
    // 300 pt plot is t = 500 + 0.5 * (900 − 500) = 700 s exactly — sample index 1. Dropping the
    // `startS +` term would instead compute 0.5 * (900 − 500) = 200 s, nearest to sample index
    // 0 (300 s away) rather than index 1 (0 s away).
    const OFFSET: DiveSample[] = [
      [500, 10, null, null],
      [700, 20, null, null],
      [900, 30, null, null],
    ];
    expect(scrubbedIndexAt(150, 300, OFFSET)).toBe(1);
  });

  // Review round 2, Finding 4: `scrubbedIndexAt`'s own docblock documents "ties keep the
  // earlier sample", implemented with a strict `<` — but nothing in this file pinned it, and
  // UNEVEN never produces an exact tie for any of the touches above.
  it('keeps the earlier sample on an exact tie in time, not the later one', () => {
    // Two samples equidistant from the mapped instant: t = 0 and t = 200, touched at the exact
    // midpoint (t = 100 on a 300 pt plot at x = 150). Both are 100 s away — a `<=` in place of
    // `scrubbedIndexAt`'s `<` would keep the later sample instead.
    const TIE: DiveSample[] = [
      [0, 5, null, null],
      [200, 9, null, null],
    ];
    expect(scrubbedIndexAt(150, 300, TIE)).toBe(0);
  });
});

describe('a series too short to draw', () => {
  it('returns nothing for a series too short to draw', () => {
    expect(colourRuns([s(0, 3)], 'light')).toEqual([]);
    expect(sparklinePoints([s(0, 3)], 10)).toEqual([]);
  });
});

// Task 6: extracted out of DepthProfile.tsx so ProfileSparkline can draw from the same one
// points→path-`d` builder rather than a second copy of it (§4.1) — `DepthProfile.test.tsx`'s
// existing suite is what proves the move changed no behaviour there.
describe('round', () => {
  it('rounds to two decimals, so a long series does not carry seventeen digits per coordinate', () => {
    expect(round(1 / 3)).toBe(0.33);
    expect(round(10)).toBe(10);
  });
});

describe('pathOf', () => {
  it('opens with one M, then an L per point after it', () => {
    expect(
      pathOf([
        { x: 0, y: 10 },
        { x: 5, y: 20 },
        { x: 10, y: 0 },
      ]),
    ).toBe('M0 10 L5 20 L10 0');
  });

  it('draws a single point as a bare M, with nothing to connect it to', () => {
    expect(pathOf([{ x: 3, y: 4 }])).toBe('M3 4');
  });

  it('draws nothing at all for an empty list of points', () => {
    expect(pathOf([])).toBe('');
  });
});
