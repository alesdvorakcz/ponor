import type { DiveSample } from '../db/schema';
import { isDisplayableDepth } from '../format/display';
import { depthBand, depthColor } from '../theme/depth';
import type { ColorScheme } from '../theme/tokens';

/**
 * One drawable point of a profile curve: `t` is seconds from the dive's start, `v` is
 * whatever is being plotted against time. Named generically rather than e.g. `{ seconds,
 * depthM }` because Task 2's consumption series (litres per minute, not metres) reuses this
 * exact shape (docs/superpowers/specs/2026-09-09-dive-profile-design.md §8) — a depth-specific
 * name here would make that reuse a lie.
 */
export type ProfilePoint = { t: number; v: number };

/**
 * One coloured stroke of the depth curve. Every point in a run shares a depth band
 * (`depthBand`, theme/depth.ts) and therefore a colour — see `colourRuns`, the one function
 * that produces these.
 */
export type ColourRun = { colour: string; points: ProfilePoint[] };

const AXIS_STEP = 10;

/**
 * **How far an axis runs: up to the next multiple of ten, and never less than one step.**
 *
 * One function because the chart has two axes and the profile spec asks for exactly one
 * convention: §3 gives the depth axis `ceil(maxDepthM / 10) * 10`, and §4.5 gives the
 * consumption axis `ceil(max / 10) * 10` explicitly so that "the two sides of the plot are
 * scaled by one convention rather than two". Written twice, they would be one rule in two
 * places — §4.1's defining defect — and the first tuning of either would silently leave the
 * plot's two edges rounding differently.
 *
 * The floor of one step is what keeps a degenerate axis drawable: a dive that never left the
 * surface, or a gas trace whose every window reads near zero, would otherwise scale against a
 * maximum of 0 and divide every point by nothing.
 *
 * Deliberately unitless. It is handed metres by `depthAxis` below and litres per minute by
 * the chart, and it must not learn the difference — the moment it does, the two axes stop
 * being one rule.
 */
export function axisMax(value: number): number {
  return Math.max(AXIS_STEP, Math.ceil(value / AXIS_STEP) * AXIS_STEP);
}

/** The vertical scale, rounded up to the next 10 m so the gridlines are round numbers a
 * diver reads without arithmetic. Driven by the dive's stored `maxDepthM` rather than the
 * deepest sample: the import spec (§4.2) records that the device's own maximum is finer
 * than the series and the samples can be shallower. */
export function depthAxis(maxDepthM: number): { max: number; ticks: number[] } {
  const max = axisMax(maxDepthM);
  const ticks: number[] = [];
  for (let m = 0; m <= max; m += AXIS_STEP) ticks.push(m);
  return { max, ticks };
}

/** A sample as a drawable point: `t` its recorded second, `v` its depth in metres. */
function pointOf(sample: DiveSample): ProfilePoint {
  return { t: sample[0], v: sample[1] };
}

/**
 * True for a sample `depthBand` will actually band, rather than throw on. `depthBand`'s own
 * contract — a `RangeError` on a negative or non-finite depth — is the right one for a
 * function whose caller is expected to have validated its input, and loosening it there is
 * not this module's place. But nothing between the device and this file promises that
 * input is always valid: `domain/import/suunto.ts`'s own `num()` keeps a sample as long as
 * its depth is a finite number and never checks its sign, so a device whose sensor drifts at
 * the surface could in principle write a small negative depth straight into a stored series.
 * `colourRuns` is read straight into a render (`DepthProfile`, `ProfileSparkline`) — the same
 * "cannot throw mid-render" position `depthColorOrNull` exists for, one depth at a time — so
 * a sample this predicate rejects is dropped here rather than left to crash the whole chart
 * over one bad point.
 *
 * Delegates to `isDisplayableDepth` (format/display.ts), the one owner of "can this depth be
 * shown". That module's docblock records the finiteness/sign check drifting apart once before
 * (a dangling-label bug) and names deferring to it as the way to make the predicate a one owner
 * "by construction rather than by two conditions that happen to currently agree". This wrapper
 * exists to extract the depth from the sample tuple before checking — a tuple-specific detail
 * that `depthBand` itself does not bundle.
 */
function hasBandableDepth(sample: DiveSample): boolean {
  return isDisplayableDepth(sample[1]);
}

/**
 * Splits a sample series into one run per depth band — the `Path`-per-colour design the
 * drawing-primitive amendment calls for (spec §2/§3): each stroke is a single flat colour,
 * which is what keeps colour data rather than turning it into a gradient smeared across the
 * dive's whole depth range.
 *
 * **The sample at a band boundary is repeated**: it is the last point of the run it is
 * leaving and, again, the first point of the run it enters. Without the repeat, the run that
 * is ending and the run that is starting would meet at two different samples — the boundary
 * sample closes the first, the very next sample opens the second — leaving a visible notch at
 * every band change. A dive that spends its bottom time hovering a metre either side of a
 * boundary would show that notch dozens of times over.
 *
 * A run's colour is decided from the first sample genuinely inside its band, before the
 * repeat above is applied — never from the finished run's own `points[0]`, which for every
 * run but the first *is* the repeated boundary sample and, depth-wise, still belongs to the
 * band the curve is leaving. Colouring from it would paint every run but the first in the
 * colour of the band before it.
 *
 * Fewer than two bandable samples can draw no stroke at all, so this returns `[]` rather than
 * one run holding a single point.
 */
export function colourRuns(samples: DiveSample[], scheme: ColorScheme): ColourRun[] {
  const bandable = samples.filter(hasBandableDepth);
  const first = bandable.at(0);
  if (bandable.length < 2 || first === undefined) return [];

  const runs: ColourRun[] = [];
  let colour = depthColor(first[1], scheme);
  let points: ProfilePoint[] = [pointOf(first)];

  for (const sample of bandable.slice(1)) {
    const point = pointOf(sample);
    const previous = points.at(-1);
    if (previous !== undefined && depthBand(previous.v) !== depthBand(point.v)) {
      runs.push({ colour, points });
      colour = depthColor(point.v, scheme);
      points = [previous, point]; // repeat the boundary sample so the strokes meet
    } else {
      points.push(point);
    }
  }

  runs.push({ colour, points });
  return runs;
}

/**
 * The interval a device actually recorded, as the median of the deltas between consecutive
 * samples, rounded to the nearest whole second — not the file's own declared interval, which
 * a device's clock drift can make false. The reference dive states 10 s while its real deltas
 * run 9.74-10.10 s (spec §3): a diver reading "10 s" under the chart is reading what the
 * device actually did, not a number carried over unexamined from its header.
 *
 * The median, not the mean: one long pause between samples (a device brought to the surface
 * and back down, say) would drag a mean toward a number no single interval in the series is
 * actually close to, where the median stays inside the pack.
 *
 * Fewer than two samples make zero deltas, and the median of nothing is undefined. This
 * returns `0` rather than `NaN` or a thrown error — the same empty/degenerate-but-total
 * answer `depthAxis` and `colourRuns` give instead of refusing to run. In practice this is
 * never the number a diver sees: spec §3's cluster metadata sits under the chart `colourRuns`
 * draws, so nothing calls this without already having a curve to caption.
 */
export function medianIntervalS(samples: DiveSample[]): number {
  const deltas: number[] = [];
  let previous: DiveSample | undefined;
  for (const sample of samples) {
    if (previous !== undefined) deltas.push(sample[0] - previous[0]);
    previous = sample;
  }
  if (deltas.length === 0) return 0;

  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const median =
    deltas.length % 2 === 1
      ? deltas.at(mid) ?? 0
      : ((deltas.at(mid - 1) ?? 0) + (deltas.at(mid) ?? 0)) / 2;
  return Math.round(median);
}

/** The deepest sample in a bucket, or `undefined` for an empty one — ties keep the first, so
 * the emitted point stays as early in the bucket as the data allows. */
function deepestOf(bucket: DiveSample[]): DiveSample | undefined {
  let best: DiveSample | undefined;
  for (const sample of bucket) {
    if (best === undefined || sample[1] > best[1]) best = sample;
  }
  return best;
}

/**
 * Downsamples a series to at most `buckets` points for the row sparkline (spec §6): splits it
 * into that many contiguous chunks by position and keeps each chunk's deepest sample.
 *
 * **Not every *n*th sample.** A dive's true maximum routinely lands on a single sample — the
 * reference dive's does — and a row draws this sparkline right beside that same figure.
 * Skipping every *n*th sample would drop that one point about as often as it kept it, and a
 * sparkline shallower than the number beside it would read as the two disagreeing about the
 * dive. Taking each chunk's deepest sample instead means the silhouette's lowest point is
 * always the dive's real maximum, wherever in the series it falls.
 *
 * Chunked by position rather than by the samples' own time span: the series is already in
 * chronological order, so an equal split by count gives (near enough) equal spans of time for
 * the roughly-regular interval a real device records, with no need to reason about a gap or a
 * run of dropped samples the way a time-span split would.
 *
 * Fewer than two samples can draw no shape at all, so this returns `[]`, matching
 * `colourRuns`.
 */
export function sparklinePoints(samples: DiveSample[], buckets: number): ProfilePoint[] {
  if (samples.length < 2) return [];

  const bucketCount = Math.max(1, Math.min(Math.trunc(buckets), samples.length));
  const points: ProfilePoint[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const start = Math.floor((i * samples.length) / bucketCount);
    const end = Math.floor(((i + 1) * samples.length) / bucketCount);
    const deepest = deepestOf(samples.slice(start, end));
    if (deepest !== undefined) points.push(pointOf(deepest));
  }

  return points;
}
