import { View } from 'react-native';

import { formatRmv } from '../format/display';
import { makeStyles, RMV_SPARK_STEPS } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/**
 * **The fewest dives that make a shape.** One bar is not a sparkline: normalised against
 * itself it is always full height, so it encodes nothing a diver can read and the figure
 * beside it already says everything true of that dive. Two is where a comparison begins.
 *
 * This is §0.4's instinct — *"the app never draws a schematic curve"*, because an invented
 * shape on a dive log reads as recorded data — applied one step further in: a single sample is
 * not a series, and a full bar drawn from it would say "this is as high as it gets" about a
 * logbook with one gas dive in it.
 */
const MIN_SERIES = 2;

/**
 * How many cells tall the bar for `value` is, given the tallest value in the series.
 *
 * **Measured from zero, not from the smallest value in the window**, and that is the one
 * decision here that could have gone either way. A sparkline normalised to [min, max] shows
 * the most shape, and it is exactly the wrong drawing for this figure: real RMVs sit in a
 * narrow band (12–22 l/min for most divers), so min–max would draw 14.8 and 14.9 as a bar of
 * one cell beside a bar of six — a mountain range next to a Trend row reading **"steady"**,
 * which `formatRmvTrend` prints precisely when the two figures round to the same thing. A row
 * arguing with itself is the defect this codebase keeps finding, and the version that cannot
 * do it is the one measured from zero: proportions of the tallest bar, so a real improvement
 * from 20 to 14 is a visible drop and four hundredths of a litre is not.
 *
 * **Never zero cells for a dive that is in the window.** A bar of no height is indistinguishable
 * from a dive that was skipped, and those two things must not look alike — the whole population
 * rule here is that a dive with no RMV contributes nothing rather than a zero (see the
 * component below). So the floor is one cell: present, and visibly the shortest.
 */
function cellsFor(value: number, max: number): number {
  const scaled = Math.round((value / max) * RMV_SPARK_STEPS);
  return Math.min(RMV_SPARK_STEPS, Math.max(1, scaled));
}

/**
 * What a screen reader hears instead of the bars — the series, in the order it is drawn.
 *
 * A row of unlabelled `View`s is a dead end: unlike the depth legend's swatches, whose six
 * ranges are written out beside them, and unlike `EmptyState`'s mark, whose sentence carries
 * every fact it does, these bars are the **only** place the per-dive values appear. The row's
 * own text says the mean, the Trend row says the direction and the caption says the window;
 * the shape is the one thing that would simply vanish.
 *
 * Composed here from `formatRmv` rather than assembled in `format/display.ts`, on
 * `DiveRow`'s precedent (`accessibilityLabelFor`): §4.1 owns the conversion of a stored value
 * into diver-facing text and that is what `formatRmv` is doing — the join is composition, and
 * it belongs where the pieces are chosen. Commas rather than the app's middot
 * (`METADATA_SEPARATOR`), because this string is only ever spoken and a middot is not.
 *
 * The values keep their unit each, which is repetitive to read and correct to hear: the unit
 * has one spelling in this app and it is `formatRmv`'s, and a series that said "l/min" once at
 * the end would be a second one.
 */
function seriesLabel(values: readonly number[]): string {
  const spoken = values
    .map((value) => formatRmv(value))
    .filter((text): text is string => text !== null)
    .join(', ');
  return `Each dive, oldest to newest: ${spoken}`;
}

export interface RmvSparklineProps {
  /**
   * The dives the figure beside this is averaged over, **oldest first** — `rmvTrend`'s
   * `recentValues` (domain/logbookStats.ts), which is the same array its `recent` mean is
   * taken from and comes back in that order deliberately.
   */
  values: readonly number[];
  scheme: ColorScheme;
}

/**
 * **§3's RMV, drawn** — one bar per dive in the window the figure beside it is averaged over,
 * oldest at the leading edge.
 *
 * §3 says *"charts later, counters first"* and the deeper reason is that this app has no
 * drawing primitive: `react-native-svg` is deliberately absent (`EmptyState`'s mark records
 * the same absence, and §10 has shaped the icon work around it twice). So this is `View`s,
 * exactly as the first-run depth legend's six bars and §0.6's rating dots already are, and it
 * adds no dependency. What it does need that those do not is a height that depends on data,
 * and that lives in the sheet as a **count of cells** rather than as a computed inline style —
 * see `RMV_SPARK_STEPS` (theme/styles.ts) for why that is §4.1 and the graphics guard rather
 * than a stylistic preference.
 *
 * ── Which dives, and the ones that are not here ───────────────────────────────────────────
 *
 * **A dive with no RMV is not in the series at all.** RMV needs an average depth, a duration
 * and a cylinder size together (`rmv`, domain/derived.ts) and §1 asks a diver for none of them,
 * so a real logbook has dives with no RMV scattered all through it — and this row must not
 * draw them, in either of the two ways it could. A **zero-height bar** would say the diver
 * used no gas, which is §0.4's rule ("never draw from samples that do not exist") in a second
 * figure; a **gap left in place** would be a picture of what was not recorded, and at this size
 * a gap and a short bar are the same mark. So the caller hands over `rmvTrend`'s own window,
 * whose population rule is already "the last five dives **with gas recorded**" — the words the
 * caption under the row states, so the drawing and the sentence describe one set of dives.
 *
 * **Nothing is drawn below `MIN_SERIES` values**, including none at all: a logbook where no
 * dive has an RMV is not an exotic case but the ordinary one — it is every logbook until
 * somebody records a cylinder size — and the row it lives in already says so with an em dash.
 *
 * ── Two things it is not ──────────────────────────────────────────────────────────────────
 *
 * **It is not tappable, and there is deliberately nothing to suggest it is.** A chart that
 * looks interactive and is not is worse than one that plainly is not, so there is no
 * `Pressable`, no ripple, no highlight and no 48 dp target: §0.5's floor is about things a wet
 * thumb has to hit, and this is a figure being read. Tapping a bar to open that dive is a
 * reasonable thing to want and is a decision, not an omission to be quietly filled in.
 *
 * **It carries no colour.** §0.1 spends colour on depth and an RMV is not a depth — so unlike
 * the deepest-dive figure one group up, which at least *is* a depth and still takes no band
 * (§10, twice), there is not even a band to argue about. `rmvSparkCell` is `fgMuted`.
 */
export function RmvSparkline({ values, scheme }: RmvSparklineProps) {
  const styles = makeStyles(scheme);
  // The same refusal `rmv` already makes, restated where a shape is drawn rather than trusted
  // to arrive: a NaN in the series makes `max` NaN and every bar zero cells — a row that says
  // it has data and draws none — and an Infinity makes every other bar the shortest, which is
  // a flat line a diver would read as five identical dives. Both are cheap to exclude and
  // neither is recoverable once it is on screen.
  const series = values.filter((value) => Number.isFinite(value) && value > 0);
  if (series.length < MIN_SERIES) return null;
  const max = Math.max(...series);

  return (
    <View style={styles.rmvSparkline} accessible accessibilityLabel={seriesLabel(series)}>
      {series.map((value, index) => (
        // Keyed by position, which is the one thing a value cannot supply here: two dives that
        // breathed the same 14.6 l/min are two bars, and this list is rebuilt whole from a
        // fresh window rather than reordered in place.
        <View key={index} style={styles.rmvSparkBar}>
          {Array.from({ length: cellsFor(value, max) }, (_unused, cell) => (
            <View key={cell} style={styles.rmvSparkCell} />
          ))}
        </View>
      ))}
    </View>
  );
}
