import { View, type ColorValue } from 'react-native';

import { type Visibility } from '../domain/types';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/**
 * How many bars each visibility level draws, and how tall each of them is.
 *
 * The mark counts up in **both** dimensions at once — *low* is one short bar, *average* two,
 * *high* three, and each added bar is taller than the last. That doubling is deliberate: one
 * bar against three is a difference in quantity, and a rising staircase is the shape everyone
 * already reads as signal strength, so the mark says "more" twice over and needs to be
 * memorised no more than a wifi icon does. DESIGN.md §0.6: the marks "encode the scale in
 * themselves… nothing has to be memorised, so nothing is a legend."
 *
 * **Drawn from `View`s, not from a symbol, and that is the cheap route rather than the
 * expensive one.** `react-native-svg` is not installed and is not to be added; a rectangle
 * with a border radius needs neither it nor an asset. The heights are named steps in
 * `theme/styles.ts` rather than numbers computed here — see `visibilityBar` there for why the
 * graphics guard requires exactly that, and why it is right to.
 *
 * `Record<Visibility, …>` rather than a lookup with a default, so a fourth level added to
 * `VISIBILITY_VALUES` fails to compile here until somebody says what it looks like. A silent
 * fallback would draw *high*'s three bars for a level nobody has thought about.
 */
const VISIBILITY_BARS: Record<Visibility, number> = { high: 3, average: 2, low: 1 };

export interface VisibilityIconProps {
  visibility: Visibility;
  /**
   * The ink the bars are painted in — handed over by `OptionChips`, never chosen here, for
   * the reason `EntryIcon`'s own prop gives: §0.6 makes the mark a companion to the label
   * beside it, and a companion holding its own colour would be `fg` on the selected chip's
   * `action` ground and vanish on exactly the chip the diver picked.
   *
   * **What this component may not do with it is paint it directly**, which is the one
   * genuinely awkward thing in this file and is worth the paragraph. §4.1 makes
   * `theme/styles.ts` the owner of "every place a token meets a style property", and
   * `src/testing/unexpectedGraphics.ts` enforces it by reporting any `View` carrying a style
   * entry that sheet did not hand out — so `style={{ backgroundColor: tintColor }}` would
   * trip the §0.4/§0.1 graphics guard, and rightly: it is the shape a chart's fill arrives
   * in. `EntryIcon` never meets this because `tintColor` on a `SymbolView` is a prop, not a
   * style, and the guard inspects styles.
   *
   * So the ink handed in is **resolved back to the sheet's own style for that ink** below.
   * The colour is still decided by `OptionChips` — this only looks up which of the two
   * prepared styles carries the value it was given — so §0.6's rule ("the icon matches the
   * label beside it") stays where that component's docblock insists it belongs, and no call
   * site is told whether its chip is selected.
   */
  tintColor: ColorValue;
  scheme: ColorScheme;
}

/**
 * A `Visibility` value as bars counting up.
 *
 * No `accessibilityLabel`, exactly as `EntryIcon` and `WeatherIcon` carry none: the chip
 * announces `` `${label}: ${displayLabel(option)}` `` and §0.6 makes the mark a supplement to
 * a word that never goes away, so a second announcement would read the same control twice.
 * That matters more here than for a symbol — a row of bare `View`s has no text of its own at
 * all, so if the chip's own label ever stopped being announced this mark would be silent.
 */
export function VisibilityIcon({ visibility, tintColor, scheme }: VisibilityIconProps) {
  const styles = makeStyles(scheme);
  const bars = VISIBILITY_BARS[visibility];
  if (bars === undefined) return null;
  // The lookup this component's `tintColor` docblock describes: which prepared ink carries
  // the value `OptionChips` handed over. Compared against the sheet's own selected label
  // colour rather than against a theme token read here, so this file never reads a token
  // (§4.1) — it only asks which of two styles the sheet already built matches.
  const ink = tintColor === styles.formChipTextSelected.color ? styles.visibilityBarInkSelected : styles.visibilityBarInk;
  const heights = [styles.visibilityBarShort, styles.visibilityBarMid, styles.visibilityBarTall];
  return (
    <View style={styles.visibilityMark}>
      {heights.slice(0, bars).map((height, i) => (
        <View key={i} style={[styles.visibilityBar, height, ink]} />
      ))}
    </View>
  );
}
