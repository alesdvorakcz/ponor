import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { type DiveSample } from '../db/schema';
import { PROFILE_RMV_WINDOW_S, consumptionSeries } from '../domain/consumption';
import { axisMax, colourRuns, depthAxis, medianIntervalS, type ProfilePoint } from '../domain/profile';
import { type Dive } from '../domain/types';
import {
  formatDepthBoundary,
  formatDuration,
  formatRmv,
  formatSampleCount,
  formatSampleInterval,
  isDisplayableDepth,
  METADATA_SEPARATOR,
} from '../format/display';
import { type UnitSystem } from '../format/units';
import { t } from '../i18n';
import { depthColor } from '../theme/depth';
import { themeFor } from '../theme/resolve';
import { makeStyles, PROFILE_PLOT_HEIGHT } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/**
 * **The viewBox's nominal x-extent, not a width anything is laid out at.**
 *
 * The `<Svg>` is `width="100%"` with `preserveAspectRatio="none"`, so the drawing stretches to
 * whatever the content column gives it (`profilePlot`, theme/styles.ts) and this number only
 * decides the units the path data is written in. It is set near a phone's real content width
 * so the horizontal scale sits at about 1: every stroke carries `vectorEffect="non-scaling-
 * stroke"` and so cannot be distorted at all, and the deepest-sample dot — the one shape a
 * non-uniform scale genuinely stretches — is drawn a per cent or two wide rather than visibly
 * elliptical.
 *
 * **Measuring the column would be better and belongs to the next task.** The scrub gesture
 * (spec §5) has to map a touch's x back to a time, which needs the real width; `onLayout` is
 * where that comes from, and it does not fire under Jest, so a component that depended on it
 * today would render an empty plot in every test in this file. This constant is what that
 * measurement will fall back to before the first layout pass.
 */
export const PLOT_WIDTH = 320;

/**
 * The three stroke weights and the marker's radius, in viewBox units.
 *
 * **Deliberately not in `makeStyles`**, which is the one place a *token* may meet a *style
 * property* (theme/styles.ts's own header). None of these is either: they are geometry handed
 * to an SVG element as props, they carry no colour, and no `View` is painted with them — so
 * putting them in the sheet would widen its contract rather than honour it. `PROFILE_PLOT_HEIGHT`
 * is in the sheet precisely because it *is* shared with a style: the axis column is sized
 * against it.
 */
const DEPTH_STROKE_WIDTH = 2;
const GAS_STROKE_WIDTH = 1;
const GRID_STROKE_WIDTH = 1;
const DEEPEST_MARK_RADIUS = 3;

/**
 * **How far the plotted curve is pulled in from the viewBox's own top and bottom edge**, in
 * viewBox units. Without it, a stroke or marker drawn at either extreme value sits exactly on
 * `y = 0` or `y = PROFILE_PLOT_HEIGHT` and has the far half of its own width or radius clipped
 * by the viewport: a round `axis.max` sample puts the deepest-sample marker's centre on the
 * bottom edge with nothing beyond it to show the rest of its `r = 3`, and a near-surface
 * sample thins the depth stroke the same way at the top.
 *
 * Derived from the two named constants that can actually poke past a point sitting on either
 * edge, rather than a new magic number: half the widest stroke this plot draws, and the
 * marker's own radius, whichever reaches further. The marker wins today (`3` beats
 * `DEPTH_STROKE_WIDTH / 2`'s `1`), but writing it as a `max` of both means a stroke that ever
 * grew past `2 * DEEPEST_MARK_RADIUS` could not silently reopen this clip.
 *
 * Applied to both vertical scales (`yDepth` and `yGas`) rather than the depth curve alone:
 * the two share this one viewBox and its top and bottom edges, and a gas trace whose own
 * extreme reading still touched `y = 0` or `y = PROFILE_PLOT_HEIGHT` would carry the identical
 * clip this constant exists to remove, just on a thinner stroke.
 */
const PLOT_INSET_Y = Math.max(DEPTH_STROKE_WIDTH / 2, DEEPEST_MARK_RADIUS);

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

/** A point in the plot's own coordinates. */
type Plotted = { x: number; y: number };

/** Path data to two decimals — enough for a plot this size, and it keeps a 222-point `d`
 * string from carrying seventeen digits per coordinate. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** One `M`, then an `L` per point after it. A run of fewer than two points draws nothing at
 * all, so callers never hand one over — see `gasSegments` and `colourRuns`, both of which
 * refuse to produce one. */
function pathOf(points: readonly Plotted[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
}

/**
 * Several stretches of one series as a single path — each begins with its own `M`, so the pen
 * lifts between them and nothing is drawn across the gap.
 *
 * **One `Path` rather than one per stretch**, which is what the spec's §2 amendment bought the
 * dependency for: the whole argument for adopting `react-native-svg` was counted in native
 * views, and a surfacing diver can produce a handful of breaks in a dive. SVG's own subpath is
 * exactly this, so there is nothing to gain by spending an element on each.
 */
function multiPathOf(segments: readonly (readonly Plotted[])[]): string {
  return segments.map(pathOf).join(' ');
}

/**
 * The consumption series split where it must not be joined up — see `GAS_GAP_S`.
 *
 * A segment left holding a single point is dropped rather than emitted: one point draws no
 * stroke, so keeping it would put a stray `M` in the path data that nothing renders, and the
 * chart would claim a fragment it does not actually show. §0.4's rule reaching one step
 * further in, exactly as `RmvSparkline`'s own `MIN_SERIES` does for a row of bars.
 */
function gasSegments(points: readonly ProfilePoint[]): ProfilePoint[][] {
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

export interface DepthProfileProps {
  /**
   * The dive the series belongs to. Read for exactly two things: `maxDepthM`, which scales the
   * depth axis (spec §3 — the device's own maximum is finer than the series and the samples
   * can be shallower), and `tanks`, which is where the cylinder size the gas trace needs comes
   * from.
   */
  dive: Dive;
  /**
   * The dive's recorded profile, or `null` where there is none — `useDiveSamples`' own answer,
   * handed down rather than read here. A screen does the fetching; a component is a pure
   * function of its props (`useUnitSystem`'s standing rule), which is what lets every test in
   * this file render the real card without a database.
   */
  samples: DiveSample[] | null;
  scheme: ColorScheme;
  /** The diver's units, for the axis labels and the caption. The drawing itself is unitless:
   * every point is scaled against an axis in stored SI, so switching systems relabels the
   * chart and redraws not one pixel of it. */
  units: UnitSystem;
}

/**
 * **§0.4's depth profile: the dive as the computer recorded it, stroked through the depth
 * gradient.**
 *
 * ── What is drawn, and what is refused ────────────────────────────────────────────────────
 *
 * **Nothing at all, unless there is a real series with a real shape in it.** `null` samples,
 * an empty series, a series of one point, a series whose depths `depthBand` would reject, and
 * a series with no elapsed time between its first point and its last all render `null` — no
 * card, no title, no empty plot. §0.4 forbids drawing a curve from anything but real samples
 * and forbids a placeholder standing in for one, and a card carrying a title and an axis over
 * an empty box is exactly that placeholder.
 *
 * **Colour is depth and nothing else** (§0.1). Every stroke of the curve is `depthColor()`'s
 * answer for the band that stroke draws — `colourRuns` (domain/profile.ts) owns the split, one
 * `Path` per band, so no single stroke ever spans two colours and the colour stays *data*
 * rather than becoming a gradient smeared across the dive. The gridlines are `border` and the
 * gas trace is `fgMuted`: the two theme tokens for a hairline and for secondary ink, read from
 * `themeFor` because an SVG `stroke` is a prop and not a style property, so `makeStyles` — the
 * one place a token may meet a *style* — is not where it can come from. `depthColor` reaching
 * a component directly is the same shape and has the same licence (`unexpectedGraphics`'s own
 * `isDepthPaint` exists for it).
 *
 * **The depth axis is scaled from the dive's stored maximum, not from the deepest sample**
 * (spec §3, import spec §4.2), taking whichever of the two is deeper so the curve can never
 * run off the bottom of a plot scaled by a header that disagrees with its own series.
 *
 * **The dot marks the deepest SAMPLE**, in that sample's own band colour — not the stored
 * maximum, which is a figure with no point on the curve to sit on. §0.4 again: the mark has to
 * be somewhere the device actually was.
 *
 * ── The gas trace ─────────────────────────────────────────────────────────────────────────
 *
 * Instantaneous RMV over a moving 60 s window (`consumptionSeries`, domain/consumption.ts),
 * muted, against a right axis that runs 0 to the next multiple of ten — `axisMax`, the same
 * function the depth axis uses, so spec §4.5's *"one convention rather than two"* is one
 * function rather than two roundings that happen to agree.
 *
 * **It is absent entirely when there is nothing to compute it from** — no cylinder size, no
 * per-sample pressure, or fewer than two windows that clear the 1.5 m floor. No trace, no
 * right axis, no apology.
 *
 * **Which cylinder it describes: the dive's first, which is the main one.** `Tank`'s own
 * docblock (domain/types.ts) states that rule — *"first entry = the main cylinder"* — and the
 * per-sample pressures in a series come from one transmitter, which is on that cylinder;
 * `domain/consumption.test.ts` already pairs the reference dive's series with `tanks[0]` on
 * exactly this basis. Note what this is NOT: it is not `derived.ts`'s whole-dive figure, which
 * reads *every* cylinder (`gasUsedLitres`) because it is summing what the diver breathed, and
 * it is not the M1b defect the dive detail records — showing one cylinder's MOD as though it
 * were the dive's — because that hid a fact the other cylinders carried, where this trace can
 * only ever describe the cylinder the transmitter was actually on. A diver who also logged a
 * stage will see it in the whole-dive figure and not in this curve, which is the truth about
 * what was measured.
 *
 * ── The drawing itself ────────────────────────────────────────────────────────────────────
 *
 * One `<Svg>`, stretched to the content column (see `PLOT_WIDTH`), holding the gridlines, then
 * the gas trace, then the depth runs, then the mark — in that order, because that is the order
 * they stack: the secondary series passes under the curve it accompanies, never over it.
 *
 * **The axis labels are `Text`, not SVG text**, and that is deliberate: they are type, so they
 * belong to §0.2's faces and to `makeStyles` like every other word in the app, and they stay
 * readable to a screen reader and to a test. `profileDepthAxis` (theme/styles.ts) carries the
 * arithmetic that lands each one on its own gridline.
 *
 * **The drawing carries no accessibility label of its own, and that is a decision.** Every
 * fact on this card that can be said in words already is: the caption states how many readings
 * and how often, the axis labels state the range, and the hero above states the dive's maximum
 * depth and duration. What is left is the *shape*, which is the one thing a label cannot
 * convey — and spec §5's scrub readout, which puts the depth and gas at a chosen instant on
 * screen as text, is the designed answer to reading the curve rather than looking at it. A
 * sentence invented here would be a second owner of those same facts before that lands.
 */
export function DepthProfile({ dive, samples, scheme, units }: DepthProfileProps) {
  if (samples === null) return null;

  const runs = colourRuns(samples, scheme);
  // Every point that will actually be stroked, in order — including the boundary samples
  // `colourRuns` repeats into the run they open, which are harmless here: a duplicate cannot
  // change where the curve starts, ends, or reaches its deepest.
  const drawn = runs.flatMap((run) => run.points);
  const first = drawn.at(0);
  const last = drawn.at(-1);
  // `colourRuns` returns `[]` below two usable samples, which is the "nothing to draw" case in
  // full: no samples, one sample, or a series whose depths it had to reject.
  if (first === undefined || last === undefined) return null;

  // ONE x domain for both series — the full RECORDED series' time extent, its first sample's
  // own offset to its last — not `drawn`'s (`colourRuns` may reject trailing samples over a
  // bad depth) and not the depth curve's alone: `consumptionSeries` below reads every sample
  // regardless of whether its depth could be banded, so a gas point can sit past whatever
  // `drawn` alone would call the end of the dive. Both series are subsets of ONE recorded
  // array, so reading the domain off that same array is what makes the axis mean one thing
  // rather than two — a depth curve that stops short of this domain's own right edge because
  // its trailing samples had no usable depth is the honest rendering of that, not a bug to
  // paper over. A series whose first and last sample share one instant has no time axis to
  // draw at all and is refused rather than divided by zero.
  const firstSample = samples.at(0);
  const lastSample = samples.at(-1);
  // `first`/`last` above already being defined means `colourRuns` found at least two bandable
  // samples IN `samples`, so both ends of the raw array exist too — `noUncheckedIndexedAccess`'s
  // claim, not a real possibility, exactly as `consumption.ts`'s own `start`/`end` narrowing.
  if (firstSample === undefined || lastSample === undefined) return null;
  const startS = firstSample[0];
  const endS = lastSample[0];
  if (!(endS > startS)) return null;

  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);

  // Ties keep the earliest, matching `sparklinePoints`' own `deepestOf` — the mark lands as
  // early in the dive as the data allows rather than on whichever equal sample came last.
  const deepest = drawn.reduce((best, point) => (point.v > best.v ? point : best), first);
  // `isDisplayableDepth`, not `?? 0`: a stored maximum that is null, NaN or negative is not a
  // scale, and `format/display.ts` is the one owner of that question (§4.1). Whichever of the
  // two is deeper wins, so a header that disagrees with its own series can never scale the
  // plot shallower than the curve it has to contain.
  const storedMaxM = isDisplayableDepth(dive.maxDepthM) ? dive.maxDepthM : 0;
  const axis = depthAxis(Math.max(storedMaxM, deepest.v));

  const x = (seconds: number): number => round(((seconds - startS) / (endS - startS)) * PLOT_WIDTH);
  // Inset by `PLOT_INSET_Y` at both ends (see its own docblock) so a value at either extreme —
  // 0 m, or a deepest sample sitting exactly on `axis.max` — has room for its own stroke width
  // or marker radius inside the viewport instead of sitting on the edge.
  const yDepth = (metres: number): number =>
    round(PLOT_INSET_Y + (metres / axis.max) * (PROFILE_PLOT_HEIGHT - 2 * PLOT_INSET_Y));

  // The main cylinder — see this component's docblock for why that is the first and why it is
  // not `derived.ts`'s whole-dive read. `consumptionSeries` decides for itself whether the
  // tank and the series can support a curve at all, and answers `[]` when they cannot.
  const tank = dive.tanks.at(0);
  const gas = tank === undefined ? [] : gasSegments(consumptionSeries(samples, tank));
  const gasDrawn = gas.flat();
  const gasMax = gasDrawn.length > 0 ? axisMax(Math.max(...gasDrawn.map((point) => point.v))) : 0;
  // Inverted (rate 0 at the bottom, gasMax at the top) and inset exactly like `yDepth` above —
  // the same edge either scale could sit on is the same viewBox, so it takes the same margin.
  const yGas = (rate: number): number =>
    round(PROFILE_PLOT_HEIGHT - PLOT_INSET_Y - (rate / gasMax) * (PROFILE_PLOT_HEIGHT - 2 * PLOT_INSET_Y));

  // The caption describes the STORED series, not the subset that survived to be stroked: it
  // says what the device recorded and how often, and both halves have to be read off the same
  // array or they would describe two different things.
  const caption = [formatSampleCount(samples.length), formatSampleInterval(medianIntervalS(samples))]
    .filter((part): part is string => part !== null)
    .join(METADATA_SEPARATOR);

  // Start, midpoint, end of the domain above (spec §3) — `startS`, not `0`: the axis now
  // starts at the series' own first sample, so its start label has to read the same instant
  // the curve's own left edge does. `formatDuration` cannot fail for a finite positive span,
  // but it is nullable by contract and this app does not assert past a contract.
  const timeLabels = [startS, (startS + endS) / 2, endS]
    .map((seconds) => formatDuration(seconds / 60))
    .filter((label): label is string => label !== null);

  return (
    <View style={styles.profileCard}>
      <View style={styles.profileHeader}>
        <Text style={styles.profileTitle}>{t('group.profile')}</Text>
        <Text style={styles.profileMeta}>{caption}</Text>
      </View>
      <View style={styles.profilePlotRow}>
        <View style={styles.profileDepthAxis}>
          {/* `formatDepthBoundary`, not `formatDepth`: a gridline is a whole number of metres
              by construction, and "0.0 m" beside "10.0 m" would claim a decimetre of
              significance an axis tick has never had — that formatter's own argument, one
              figure over. In imperial the ticks are still the stored 10 m steps, converted,
              so the labels read 0/33/66/98 ft: honest, and the same thing the first-run depth
              legend does with §0.1's own band boundaries. */}
          {axis.ticks.map((tick) => (
            <Text key={tick} style={styles.profileAxisLabel}>
              {formatDepthBoundary(tick, units)}
            </Text>
          ))}
        </View>
        <View style={styles.profilePlot}>
          <Svg
            width="100%"
            height={PROFILE_PLOT_HEIGHT}
            viewBox={`0 0 ${PLOT_WIDTH} ${PROFILE_PLOT_HEIGHT}`}
            // The drawing fills the column rather than letterboxing inside it. Nothing is
            // distorted by that: every stroke below is `non-scaling-stroke`, and the one
            // shape a horizontal-only scale could stretch is the mark, whose scale factor is
            // about 1 at the width this viewBox is written for (see `PLOT_WIDTH`).
            preserveAspectRatio="none"
          >
            {axis.ticks.map((tick) => (
              <Line
                key={tick}
                x1={0}
                y1={yDepth(tick)}
                x2={PLOT_WIDTH}
                y2={yDepth(tick)}
                stroke={theme.border}
                strokeWidth={GRID_STROKE_WIDTH}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {gasDrawn.length > 0 && (
              <Path
                d={multiPathOf(
                  gas.map((segment) => segment.map((point) => ({ x: x(point.t), y: yGas(point.v) }))),
                )}
                stroke={theme.fgMuted}
                strokeWidth={GAS_STROKE_WIDTH}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="none"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {runs.map((run, index) => (
              <Path
                key={index}
                d={pathOf(run.points.map((point) => ({ x: x(point.t), y: yDepth(point.v) })))}
                stroke={run.colour}
                strokeWidth={DEPTH_STROKE_WIDTH}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="none"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <Circle
              cx={x(deepest.t)}
              cy={yDepth(deepest.v)}
              r={DEEPEST_MARK_RADIUS}
              fill={depthColor(deepest.v, scheme)}
            />
          </Svg>
          <View style={styles.profileTimeAxis}>
            {timeLabels.map((label, index) => (
              <Text key={index} style={styles.profileAxisLabel}>
                {label}
              </Text>
            ))}
          </View>
        </View>
        {/* The consumption axis, stated once at its top: the value the trace's own ceiling
            stands for, with the unit that says what the second series is. It runs to zero at
            the plot's floor, which the trace itself shows. Absent with the trace. */}
        {gasDrawn.length > 0 && (
          <Text style={styles.profileGasAxisLabel}>{formatRmv(gasMax, units)}</Text>
        )}
      </View>
    </View>
  );
}
