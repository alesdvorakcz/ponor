import type { DiveSample } from '../db/schema';
import { isDisplayableDepth } from '../format/display';
import { depthBand, depthColor } from '../theme/depth';
import type { ColorScheme } from '../theme/tokens';
import { PROFILE_RMV_WINDOW_S } from './consumption';

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
 * How many points `sparklinePoints` downsamples a dive's series to, for the row sparkline
 * (spec §6: "downsampled to roughly 40 points — the row is 46 px tall and more points buy
 * nothing there").
 *
 * **Lives here, beside the function it parameterises, rather than beside `ProfileSparkline`
 * (components/ProfileSparkline.tsx) where it used to sit.** Task 6's review costed that
 * arrangement: `ProfileSparkline` called `sparklinePoints` itself, so a 500-dive logbook held
 * every dive's FULL series in memory (~250 samples each, ~125,000 four-element arrays, 8–12
 * MB) for the sake of a shape drawn from 40 of them — and `DivesScreen`, `MapScreen` and
 * `SearchScreen` all live under `(tabs)` and never unmount, so a diver who visits all three
 * held three independent copies of that. `toDiveSampleShapes` (db/diveSamples.ts) is what
 * actually calls `sparklinePoints` now, at the map-building step rather than per row per
 * render — see that function's own docblock for why moving the call mattered and this constant
 * with it.
 */
export const SPARK_BUCKETS = 40;

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

/**
 * Whether `points` has enough to draw a stroke at all: at least two of them, with a first and
 * last that do not share one instant — a series whose whole extent is one recorded moment has
 * no time axis to map onto. `ProfileSparkline` (components/ProfileSparkline.tsx) asks exactly
 * this before it draws; `DiveRow`'s `showBottomRow` asks it too, for a narrower question of its
 * own — whether reserving a bottom row for a shape is worth it at all — so that the row can
 * never reserve space `ProfileSparkline` then declines to draw into, nor the reverse.
 *
 * **One function rather than two independently-tuned checks.** A review found `DiveRow` using
 * `points !== undefined` in `isSparkDrawable`'s place — true of a one-point array, which
 * `toDiveSampleShapes` (db/diveSamples.ts) does not currently hand a real screen but the public
 * `points` prop does not itself forbid. `null` and `undefined` both answer `false` so either
 * caller can hand this whatever "no series" spelling it already has on hand.
 */
export function isSparkDrawable(points: readonly ProfilePoint[] | null | undefined): boolean {
  if (points === null || points === undefined) return false;
  const first = points.at(0);
  const last = points.at(-1);
  return first !== undefined && last !== undefined && last.t > first.t;
}

/**
 * A point already placed in a drawing's own coordinates — `x`/`y` in whatever units the
 * caller scaled to (viewBox units, for both `DepthProfile` and Task 6's `ProfileSparkline`) —
 * as opposed to `ProfilePoint`'s `t`/`v`, which stay in the dive's own units (seconds, metres).
 * Kept distinct from `ProfilePoint` for the reason that type's own docblock gives for staying
 * generic: a caller must never mistake an unscaled domain point for one already laid out on
 * the page.
 */
export type Plotted = { x: number; y: number };

/** Path data to two decimals — enough for either drawing this module feeds, and it keeps a
 * 222-point `d` string from carrying seventeen digits per coordinate. */
export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * One `M`, then an `L` per point after it — the whole of what turns a list of already-scaled
 * points into SVG path data.
 *
 * **Task 6 moved this here from `DepthProfile.tsx`, and it is now this rule's one owner
 * (§4.1).** `DepthProfile` draws the depth curve with it, and its own `multiPathOf` (several
 * stretches as one path, each with its own `M`) is built on top of it for the gas trace;
 * `ProfileSparkline` draws the row's downsampled silhouette with it too. A second, independent
 * points-to-`d` builder in either component is exactly the recurring defect this file's other
 * docblocks (`sparklinePoints`, `colourRuns`) keep naming, one layer down — from domain data to
 * drawing data.
 *
 * A run of fewer than two points still draws *something*: a single point is a bare `M` with
 * nothing to connect it to, and an empty list draws nothing at all (`''`, not a stray `M`). Real
 * callers never hand this either shape — `gasSegments` and `colourRuns` both refuse to produce a
 * one-point run, and `sparklinePoints` refuses to produce one at all below two samples — so both
 * are this function's own floor rather than a case any caller relies on.
 */
export function pathOf(points: readonly Plotted[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
}

/**
 * **How far apart two consumption points may be before the trace breaks** — two windows, from
 * spec §4.3: *"where consecutive points are more than two windows apart — the diver was above
 * 1.5 m in between — the trace breaks rather than bridging the interval with a straight line
 * it did not measure."*
 *
 * Derived from `PROFILE_RMV_WINDOW_S` rather than written as its own number, so tuning the
 * window (which the owner asked to be able to do) moves this with it. One window apart is
 * ordinary — consecutive windows overlap heavily — so the threshold has to be wider than the
 * window itself to mean anything.
 *
 * **The rule lives here and not in `consumptionSeries`**, and that is not an accident of
 * layering: that function returns a flat array of points, which has nowhere to say "and here
 * the diver surfaced". A gap is a fact about the *drawing*, so the drawing is what has to
 * respect it.
 */
const GAS_GAP_S = PROFILE_RMV_WINDOW_S * 2;

/**
 * The consumption series split where it must not be joined up — see `GAS_GAP_S`.
 *
 * A segment left holding a single point is dropped rather than emitted: one point draws no
 * stroke, so keeping it would put a stray `M` in the path data that nothing renders, and the
 * chart would claim a fragment it does not actually show. §0.4's rule reaching one step
 * further in, exactly as `RmvSparkline`'s own `MIN_SERIES` does for a row of bars.
 */
export function gasSegments(points: readonly ProfilePoint[]): ProfilePoint[][] {
  const segments: ProfilePoint[][] = [];
  let current: ProfilePoint[] = [];
  let previous: ProfilePoint | undefined;

  for (const point of points) {
    if (previous !== undefined && point.t - previous.t > GAS_GAP_S) {
      segments.push(current);
      current = [];
    }
    current.push(point);
    previous = point;
  }
  segments.push(current);

  return segments.filter((segment) => segment.length > 1);
}

/**
 * **The whole of what a touch means: which recorded sample the finger is on** — or `null` when
 * the question cannot be answered yet.
 *
 * **The part that can be wrong, not the gesture wiring around it.** `DepthProfile`'s
 * `Gesture.Pan()` is a thin wrapper over this: the pan reads an `x` and calls it, and
 * everything a scrub could get wrong — the direction of the mapping, the clamp at either end,
 * what "nearest" is measured in — is decided here, where a test can state it as arithmetic
 * rather than through a simulated drag.
 *
 * **Two different widths are in play and this is where they meet.** The drawing is written in
 * viewBox units (`PLOT_WIDTH`, `DepthProfile.tsx`) and stretched to the column; a touch
 * arrives in the column's own points. So the mapping goes through the *measured* width — the
 * fraction across the plot is what the two scales share — and never through `PLOT_WIDTH`,
 * which is not a size anything is laid out at.
 *
 * **`null` until the plot has been measured, rather than a guess.** `onLayout` has not fired
 * before the first layout pass (and never fires at all under Jest), and an unmeasured plot
 * mapped through a fallback width would put every touch somewhere it is not — at `x / 320` of a
 * dive, which for a narrow column is the wrong sample and for the first touch of all is sample
 * zero. A readout that jumps to the start of the dive when a diver touches its middle is worse
 * than one that does nothing for a frame, so this does nothing.
 *
 * **Nearest by TIME, not by position in the array.** The x axis is the series' time extent
 * (both series share it — see `DepthProfile`, which reads it off ONE domain for both), and a
 * device that dropped samples, or one whose series carries a surface interval in the middle,
 * has stretches where index and instant have nothing to do with each other. Ties keep the
 * earlier sample, matching `deepestSampleIndex` below and `sparklinePoints`' own `deepestOf`.
 *
 * A finger past either edge clamps to that end of the dive: a pan continues to report positions
 * outside the view it started in, and the sample nearest a touch 40 pt to the left of the plot
 * is the first one.
 */
export function scrubbedIndexAt(
  x: number,
  width: number | null,
  samples: readonly DiveSample[],
): number | null {
  if (width === null || !(width > 0)) return null;

  const first = samples.at(0);
  const last = samples.at(-1);
  if (first === undefined || last === undefined) return null;
  const startS = first[0];
  const endS = last[0];
  // The same refusal `DepthProfile` makes: a series whose first and last sample share one
  // instant has no time axis to map onto, and dividing by its extent would produce NaN.
  if (!(endS > startS)) return null;

  const at = startS + Math.min(1, Math.max(0, x / width)) * (endS - startS);

  let nearest = 0;
  let gap = Math.abs(startS - at);
  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i];
    if (sample === undefined) continue;
    const distance = Math.abs(sample[0] - at);
    if (distance < gap) {
      nearest = i;
      gap = distance;
    }
  }
  return nearest;
}

/**
 * **Where the deepest sample is in the series** — the one fact the marked dot and the untouched
 * readout are both about (spec §5: the readout before any touch "explains what the dot is").
 *
 * An index rather than a point, because the scrub's state is an index into this same array and
 * the default has to be a value of that same kind — otherwise the card would hold two different
 * notions of "which sample is being described" and they could drift.
 *
 * Filtered by `isDisplayableDepth`, which is what `colourRuns` filters by (`hasBandableDepth`
 * delegates to it), so the sample this finds is always one the curve actually strokes. Ties
 * keep the earliest, exactly as `sparklinePoints`' `deepestOf` does: the mark lands as early in
 * the dive as the data allows rather than on whichever equal sample came last.
 *
 * `null` for a series holding no displayable depth at all — which `DepthProfile` has already
 * refused to draw by the time it asks, but the function answers for itself rather than relying
 * on that.
 */
export function deepestSampleIndex(samples: readonly DiveSample[]): number | null {
  let deepest: number | null = null;
  let depth = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const metres = samples[i]?.[1];
    if (!isDisplayableDepth(metres) || !(metres > depth)) continue;
    deepest = i;
    depth = metres;
  }
  return deepest;
}

/**
 * **The consumption reading at one instant, or `null` where there is not one** — spec §5's
 * *"an em dash where there is no gas value — inside the surface break, or on a dive with no
 * transmitter"*.
 *
 * **The segments decide, so the readout and the trace can never disagree.** It takes the
 * already-split segments (`gasSegments` above), not the flat series, and answers only for an
 * instant that falls *within* one of them — so the figure appears exactly where the trace has a
 * stroke under the hairline, and the slot holds a dash exactly where the pen was lifted. Before
 * the first window and after the last are the same case as a gap in the middle: no complete
 * window covered that instant, so there is nothing measured to report.
 *
 * Inside a segment it returns the nearest point's value and **never interpolates between two**
 * (§0.4). Ties keep the earlier point, as everything else here does.
 */
export function gasAt(segments: readonly (readonly ProfilePoint[])[], seconds: number): number | null {
  for (const segment of segments) {
    const opens = segment.at(0);
    const closes = segment.at(-1);
    if (opens === undefined || closes === undefined) continue;
    if (seconds < opens.t || seconds > closes.t) continue;

    let nearest = opens;
    for (const point of segment) {
      if (Math.abs(point.t - seconds) < Math.abs(nearest.t - seconds)) nearest = point;
    }
    return nearest.v;
  }
  return null;
}
