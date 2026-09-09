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

it('skips a window once its mean depth drops below PROFILE_RMV_MIN_DEPTH_M', () => {
  // A descent (t=0..20) into a 20 m bottom phase (t=20..80), then a return to
  // near-surface that levels off at 1 m — below PROFILE_RMV_MIN_DEPTH_M (1.5 m) — for the
  // rest of the dive (t=110..170). Pressure keeps falling by exactly 1 bar/sample
  // throughout and 10 s spacing means every complete window spans exactly 6 steps (60 s,
  // same as the two tests above), so litres and minutes never change shape near the
  // surface — only mean depth does. That is exactly why this rule is needed: rmvFrom
  // itself does not reject a shallow-but-positive depth (ata approaches 1, not 0 or
  // negative), so a window sitting entirely in the 1 m tail would still produce a valid,
  // inflated value if this check didn't exist — the "emits no point above 1.5 m" fixture
  // test above names that failure mode, but its own assertion (every point.v > 0) can't
  // detect a missing rule, since rmvFrom's other guards already make that true regardless.
  //
  // Window means (mean of the 7 depths at indices i..i+6, summed from the array below):
  //  i=9  -> 12,4,1,1,1,1,1 -> 21/7 = 3.0            -> kept, the series' last point
  //  i=10 ->  4,1,1,1,1,1,1 -> 10/7 ≈ 1.4286 (<1.5)  -> skipped
  //  i=11 ->  1,1,1,1,1,1,1 ->  7/7 = 1.0    (<1.5)  -> skipped
  // i=12 would need a sample past t=170 to complete a window, and there isn't one, so the
  // loop stops there regardless (the same "stops entirely" rule the first test in this
  // file exercises) — i=10 and i=11 are excluded by the depth rule specifically, before
  // that end-of-series rule ever gets a chance to.
  const depths = [4, 12, 20, 20, 20, 20, 20, 20, 20, 12, 4, 1, 1, 1, 1, 1, 1, 1];
  const series: DiveSample[] = depths.map((depth, i) => [i * 10, depth, null, 200 - i]);
  const points = consumptionSeries(series, syntheticTank());

  // Every kept window's t, i=0..9 -> t = 10*i + 30. If i=10 or i=11 leaked through, this
  // would carry an extra 130 or 140 at the end instead of stopping at 120.
  expect(points.map((p) => p.t)).toEqual([30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  // The last kept window (i=9, mean depth 3.0): ata = 3/10 + 1 = 1.3, litres is still
  // 6 bar * 10 L * 1 cylinder = 60 (the pressure rate never changed), so
  // rmvFrom(60, 3, 1) = 60 / 1.3 ≈ 46.15 l/min — still a real, positive value, confirming
  // i=9 survives on its own merits and isn't merely the last thing before an accident.
  expect(points[points.length - 1]!.v).toBeCloseTo(46.15);
});

it('falls back to one cylinder when configuration was never recorded', () => {
  // The same series as "computes an exact RMV at constant depth" above — 7 samples, 10 s
  // apart, all at 10 m, pressure falling 1 bar/sample, a 10 L tank — except configuration
  // is null instead of 'single'. That one input decides which branch of consumption.ts's
  // `cylinderCount(tank.configuration) ?? 1` runs: cylinderCount('single') already
  // returns 1 on its own, so the test above's `single` tank never reaches the `?? 1`
  // fallback at all, and a changed fallback couldn't have moved its number. A `null`
  // configuration is what actually exercises that line — and it is the normal case, not
  // an edge one: the Suunto importer sets `configuration: null` unconditionally
  // (src/domain/import/suunto.ts), so every imported dive's chart is drawn through this
  // exact fallback. It also has to agree with derived.ts's gasUsedLitres, which falls
  // back to 1 the same way for the Stats screen's own figure on the same dive.
  //
  // ata = 10/10 + 1 = 2 (as in the constant-depth test). Litres = 6 bar * 10 L *
  // 1 cylinder (the fallback) = 60. rmvFrom(60, 10, 1) = 60 / 2 / 1 = 30 l/min. If the
  // fallback ever became `?? 2`, litres would double to 120 and this would read 60.
  const series: DiveSample[] = [];
  for (let i = 0; i <= 6; i++) series.push([i * 10, 10, null, 200 - i]);
  const points = consumptionSeries(series, syntheticTank({ configuration: null }));
  expect(points).toHaveLength(1);
  expect(points[0]!.v).toBeCloseTo(30);
});

it('yields nothing for a dive logged without a tank transmitter', () => {
  const { series, tank } = fixtureSeries('suunto-d5-no-transmitter');
  expect(consumptionSeries(series, tank)).toEqual([]);
});

it('yields nothing without a cylinder size, since litres cannot be known', () => {
  const { series } = fixtureSeries('suunto-d5');
  expect(consumptionSeries(series, { sizeL: null } as never)).toEqual([]);
});
