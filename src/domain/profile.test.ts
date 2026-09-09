import type { DiveSample } from '../db/schema';
import { axisMax, colourRuns, depthAxis, medianIntervalS, sparklinePoints } from './profile';

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

describe('a series too short to draw', () => {
  it('returns nothing for a series too short to draw', () => {
    expect(colourRuns([s(0, 3)], 'light')).toEqual([]);
    expect(sparklinePoints([s(0, 3)], 10)).toEqual([]);
  });
});
