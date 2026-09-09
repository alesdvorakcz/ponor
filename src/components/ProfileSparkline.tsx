import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { type DiveSample } from '../db/schema';
import { pathOf, round, sparklinePoints } from '../domain/profile';
import { themeFor } from '../theme/resolve';
import { makeStyles, PROFILE_SPARK_HEIGHT } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/**
 * How many points `sparklinePoints` (domain/profile.ts) downsamples to — spec §6: "downsampled
 * to roughly 40 points — the row is 46 px tall and more points buy nothing there."
 */
const SPARK_BUCKETS = 40;

/**
 * **The viewBox's nominal x-extent, not a width anything is laid out at** — `DepthProfile`'s
 * own `PLOT_WIDTH` says the same thing for the big card, but this is not that constant reused:
 * that one is sized near a phone's real content width specifically to keep the deepest-sample
 * MARKER's scale factor close to 1 (a non-uniform stretch would draw it visibly elliptical).
 * This drawing has no marker and no other shape whose distortion a scale factor could show —
 * only a `non-scaling-stroke` line, which by construction cannot be stretched at all — so the
 * exact number here changes nothing about what is drawn. Kept small and round for the `d`
 * string's own sake rather than borrowed from a constant whose actual justification does not
 * apply here.
 */
const SPARK_WIDTH = 100;

/** Thin, because this is a shape beside a figure rather than the figure itself (§0.4's own
 * phrase for what a row sparkline contributes) — `RmvSparkline`'s bars carry the same
 * "quieter than the thing it accompanies" reasoning in `View`s rather than a stroke width. */
const STROKE_WIDTH = 1.5;

/**
 * Half the stroke's own width, inset from both the top and bottom of the viewBox — `DepthProfile`'s
 * `PLOT_INSET_Y` finding, one size down: a value sitting exactly on `y = 0` or `y =
 * PROFILE_SPARK_HEIGHT` would have the far half of the stroke's width clipped by the viewport,
 * and a dive that spends its whole profile at the surface (v = 0 throughout) would draw that
 * clipped line for its entire length rather than for one instant.
 */
const INSET_Y = STROKE_WIDTH / 2;

export interface ProfileSparklineProps {
  /**
   * The dive's recorded profile, or `null` where there is none — `useDiveSamples`'s own
   * convention (and `DepthProfile`'s), so a caller reads one meaning for "no series" across
   * every component that draws one rather than learning a second spelling here.
   */
  samples: DiveSample[] | null;
  scheme: ColorScheme;
}

/**
 * **Task 6's row sparkline: a small monochrome silhouette of a dive's depth, beside its row's
 * own metadata** — spec §6, and the amendment §0.4 already made room for: *"a sparkline in a
 * row contributes shape and the number carries magnitude"*.
 *
 * **One stroke, and it is never a depth colour.** §0.1 spends colour on depth and nothing
 * else; the row's own `DepthValue` already bands this exact dive by that rule, so a second,
 * coloured statement of the same fact beside it would not be a second data point, it would be
 * the same one repeated in a second place. `theme.fgMuted` — the row's own metadata ink
 * (`diveChip`) — is what says "this is secondary, and it is not the depth figure" the same way
 * every muted chip elsewhere in this row already does.
 *
 * **Nothing is drawn that was not measured** (§0.4 again). `null` samples and a series
 * `sparklinePoints` cannot make two points from — nothing, one raw sample, or (in principle) a
 * series with no elapsed time between its first bucket and its last — all render `null`: no
 * card, no axis, no empty box standing in for a shape. A row without samples renders exactly
 * as it always has.
 *
 * **No axes, no marker, no interaction** (spec §6, verbatim). `DepthProfile`'s scrub, its
 * gridlines and its deepest-sample dot all exist to make a dense curve *readable*; this shape
 * is read in half a second beside a number, and every one of those additions would compete
 * with the figure it is next to rather than support it.
 *
 * **Hidden from a screen reader.** `RmvSparkline` speaks its own series because it IS the only
 * place those per-dive figures appear at all (that component's own docblock) — a handful of
 * values a sentence can hold. A depth curve downsampled to `SPARK_BUCKETS` points is not that:
 * it cannot be spoken usefully, and `DiveRow`'s accessibility label is already composed from
 * `formatDepth`'s own output specifically so a reader can never announce a depth the screen
 * contradicts. A second, independent spoken description of the same dive here would work
 * against that guarantee rather than add to it, so this draws for sighted divers only.
 */
export function ProfileSparkline({ samples, scheme }: ProfileSparklineProps) {
  if (samples === null) return null;

  const points = sparklinePoints(samples, SPARK_BUCKETS);
  const first = points.at(0);
  const last = points.at(-1);
  // Below two points there is nothing to stroke (`sparklinePoints`' own floor); and the same
  // refusal `DepthProfile` makes for a series whose first and last point share one instant —
  // there is no time axis to map onto, and dividing by its extent would produce NaN.
  if (first === undefined || last === undefined || !(last.t > first.t)) return null;

  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);

  // Measured from zero, not from the window's own minimum — `RmvSparkline`'s `cellsFor` makes
  // the identical call for the identical reason: a min–max scale would draw two close depths
  // (12 m and 13 m, say) as a mountain range, where a real dive that stayed shallow throughout
  // should read as a shallow line. `sparklinePoints`' own docblock guarantees the max of the
  // DOWNSAMPLED points is the dive's true deepest sample, wherever in the series it fell, so
  // this scale is never shallower than the row's own depth figure beside it.
  //
  // Clamped to at least 0: `sparklinePoints` does not filter by `isDisplayableDepth` the way
  // `colourRuns` does, so a device drifting negative at the surface could in principle hand
  // this a negative maximum — and dividing by a negative scale would flip the whole shape
  // upside down rather than merely mis-drawing one point.
  const maxV = Math.max(0, ...points.map((point) => point.v));
  // A scale of exactly 0 (every point at the surface, or a maximum this file rejected) would
  // divide every point by nothing; drawn against 1 instead, every point lands on the same flat
  // line at the surface, which is the true shape of a dive that never left it.
  const scale = maxV > 0 ? maxV : 1;

  const x = (t: number) => round(((t - first.t) / (last.t - first.t)) * SPARK_WIDTH);
  // Inset by `INSET_Y` at both ends, exactly as `DepthProfile`'s `yDepth` is, so a point at
  // either extreme — the surface, or this dive's own deepest reading — has room for the
  // stroke's own half-width inside the viewport rather than sitting clipped on its edge.
  const y = (v: number) =>
    round(INSET_Y + (Math.max(0, v) / scale) * (PROFILE_SPARK_HEIGHT - 2 * INSET_Y));

  const d = pathOf(points.map((point) => ({ x: x(point.t), y: y(point.v) })));

  return (
    <View style={styles.diveSparkline} accessible={false}>
      <Svg
        width="100%"
        height={PROFILE_SPARK_HEIGHT}
        viewBox={`0 0 ${SPARK_WIDTH} ${PROFILE_SPARK_HEIGHT}`}
        // Stretches to whatever the row's own flex slot gives it, exactly as `DepthProfile`'s
        // plot does — see `SPARK_WIDTH`'s own docblock for why that stretch distorts nothing
        // here.
        preserveAspectRatio="none"
      >
        <Path
          d={d}
          stroke={theme.fgMuted}
          strokeWidth={STROKE_WIDTH}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </Svg>
    </View>
  );
}
