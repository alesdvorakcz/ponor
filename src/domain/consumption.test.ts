import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiveSample } from '../db/schema';
import { suuntoJsonImporter } from './import/suunto';
import type { Tank } from './types';
import { consumptionSeries } from './consumption';

/**
 * The same trimmed Suunto fixtures the importer's own tests use, run through the real importer
 * so this suite reads exactly what the app stores rather than a hand-built series. Committed at
 * `src/domain/import/__fixtures__/suunto-d5.json` and `…-no-transmitter.json` by the import work.
 */
function fixtureSeries(name: string): { series: DiveSample[]; tank: Tank } {
  const bytes = new Uint8Array(readFileSync(join(__dirname, 'import', '__fixtures__', `${name}.json`)));
  const [imported] = suuntoJsonImporter.parse(bytes);
  if (!imported) throw new Error(`fixture ${name} yielded no dive`);
  const tank = imported.dive.tanks?.[0];
  if (!tank) throw new Error(`fixture ${name} yielded no tank`);
  return { series: imported.series ?? [], tank };
}

it('emits no point where the window is incomplete', () => {
  // The bug this rule exists for: a window that shrinks as it runs out of samples falls back
  // to noisy 10-second readings and produced a phantom 36 l/min spike at the dive's end.
  const { series, tank } = fixtureSeries('suunto-d5');
  const out = consumptionSeries(series, tank);
  const last = series[series.length - 1]?.[0] ?? 0;
  expect(out[out.length - 1]!.t).toBeLessThan(last);
});

it('emits no point above 1.5 m, where the formula inflates', () => {
  const { series, tank } = fixtureSeries('suunto-d5');
  for (const point of consumptionSeries(series, tank)) {
    expect(point.v).toBeGreaterThan(0);
  }
});

// The committed suunto-d5 fixture (used elsewhere in this file for the structural cases it's
// genuinely good at) cannot support a magnitude assertion: it is trimmed to 5 depth-bearing
// samples for the *import mapping's* sake (dive-import spec §7.1), not for windowing, and two
// of its gaps (idx1→idx2, ~230 s; idx3→idx4, ~1961 s) are far wider than the 60 s window. Every
// window it can produce overshoots the 60 s target by 4–33×, so a mean taken over it measures
// how the fixture happened to be cut, not whether rmvFrom's arithmetic is right — a test like
// that would pass even a subtly wrong formula, as long as it were wrong consistently. The two
// tests below build a series whose answer can instead be checked on paper.
// Named distinctly from the `tank` destructured out of fixtureSeries() above (a real tank
// read from a fixture) — this one builds a tank for the hand-computable series below.
const syntheticTank = (over: Partial<Tank> = {}): Tank => ({
  material: 'steel', configuration: 'single', sizeL: 10, workingBar: 232,
  o2Pct: 21, hePct: null, startBar: null, endBar: null, ...over,
});

it('computes an exact RMV at constant depth, checkable by hand', () => {
  // Held at a constant 10 m, sampled every 10 s. A window completes at exactly 6 steps (60 s),
  // so its mean depth is exactly 10 m -> ata = 10/10 + 1 = 2 (rmvFrom's own divisor). Pressure
  // falls by exactly 1 bar per sample, so a 6-step (60 s) window always drops exactly 6 bar.
  // A 10 L single cylinder (cylinders = 1) turns that into litres = 6 * 10 * 1 = 60.
  // rmvFrom(60, 10, 1) = 60 / (10/10 + 1) / 1 = 60 / 2 = 30 l/min — the value asserted below.
  const series: DiveSample[] = [];
  for (let i = 0; i <= 6; i++) series.push([i * 10, 10, null, 200 - i]);
  const points = consumptionSeries(series, syntheticTank());
  expect(points).toHaveLength(1);
  expect(points[0]!.t).toBe(30);
  expect(points[0]!.v).toBeCloseTo(30);
});

it('recomputes ata per window when depth changes between them', () => {
  // Same construction, but depth steps from 10 m (samples 0–6, t = 0..60 s) to 40 m (samples
  // 7–13, t = 70..130 s), so consecutive windows carry different mean depths — and therefore
  // different ata divisors — rather than the one constant the test above exercises. Pressure
  // keeps falling by exactly 1 bar per sample across the whole series regardless of depth, so
  // *any* 6-step (60 s) window still drops exactly 6 bar; only the mean depth changes.
  //
  // The two-pointer window advances one sample at a time while staying 60 s wide, so most
  // windows straddle the depth change and land on a mean this comment does not try to verify.
  // Two do not straddle it, and are the ones asserted below:
  //  - the first window (samples 0–6) sits entirely at 10 m: the same derivation as the
  //    constant-depth test above gives rmvFrom(60, 10, 1) = 60/2/1 = 30 l/min.
  //  - the last window (samples 7–13) sits entirely at 40 m: ata = 40/10 + 1 = 5, litres is
  //    still 6 bar * 10 L * 1 = 60 (the pressure rate never changed), so
  //    rmvFrom(60, 40, 1) = 60/5/1 = 12 l/min. Sample 13 (t = 130) is the series' last sample,
  //    so this is also the last *complete* window the two-pointer loop can form — i = 8 would
  //    need a 15th sample past t = 130 to complete one, and there isn't one — making it the
  //    series' last point.
  const series: DiveSample[] = [];
  for (let i = 0; i <= 6; i++) series.push([i * 10, 10, null, 200 - i]);
  for (let i = 7; i <= 13; i++) series.push([i * 10, 40, null, 200 - i]);
  const points = consumptionSeries(series, syntheticTank());
  expect(points[0]!.t).toBe(30);
  expect(points[0]!.v).toBeCloseTo(30);
  const last = points[points.length - 1]!;
  expect(last.t).toBe(100);
  expect(last.v).toBeCloseTo(12);
});

it('yields nothing for a dive logged without a tank transmitter', () => {
  const { series, tank } = fixtureSeries('suunto-d5-no-transmitter');
  expect(consumptionSeries(series, tank)).toEqual([]);
});

it('yields nothing without a cylinder size, since litres cannot be known', () => {
  const { series } = fixtureSeries('suunto-d5');
  expect(consumptionSeries(series, { sizeL: null } as never)).toEqual([]);
});
