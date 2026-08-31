import { Text } from 'react-native';

import { formatDepthParts } from '../format/display';
import { type UnitSystem } from '../format/units';
import { depthColorOrNull } from '../theme/depth';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

interface DepthValueProps {
  /** **The stored metre value, always** — never a converted one. It is what the colour is
   * computed from (§0.1), and `units` below decides only what the text reads. */
  metres: number | null;
  scheme: ColorScheme;
  /** Which of §3's systems the NUMBER is printed in. It does not reach the colour: see
   * this component's own docblock. */
  units: UnitSystem;
  /**
   * `'row'` (default) is the 20 px dive-row anchor (§0.6); `'hero'` is the 34 px
   * treatment for dive detail. Defaulting to `'row'` is what lets every call site
   * written before this prop existed keep compiling unchanged.
   */
  variant?: 'row' | 'hero';
}

/**
 * A depth in its band's colour — the app's one piece of expressive colour (§0.1).
 *
 * This is where the depth scale belongs: a component renders a depth through
 * `DepthValue`, not by calling `depthColor`/`depthColorOrNull` itself. Colour is
 * depth's alone, and a second caller reaching for the scale to tint something else
 * would break the rule that keeps it readable at a glance. `src/app/index.tsx`
 * (now `src/screens/DivesScreen.tsx`) used to be the one exception (the M0
 * scaffold screen, left alone until the task that replaced it landed) — that
 * task has landed, so no exception remains.
 *
 * Renders nothing at all for a depth it can't show — unrecorded, non-finite, or
 * negative — rather than let a bad value throw mid-render; see `depthColorOrNull`
 * for why a negative depth is a real possibility here. A placeholder dash would
 * occupy the slot where a real value goes and read, at a glance down a list, as a
 * value the diver failed to enter — which §1 explicitly refuses to do.
 *
 * §0.6 makes depth the anchor of a row: larger, tabular, right-aligned, in its band
 * colour, with the unit set quieter than the number. `formatDepthParts` (display.ts)
 * stays the only thing that decides the numeral and unit — this reads its `value`/`unit`
 * fields directly rather than parsing a formatted string, so the unit can carry its own
 * (dimmer) style without ever risking a re-parse that display.ts's own shape could break
 * (M1c task 1 review, Important: an earlier version split `formatDepth`'s string on its
 * one space, which had no fallback if that space were ever absent).
 *
 * **The colour comes from `metres` and the text from `units`, and the two lines below are
 * where that is enforced.** `depthColorOrNull` is handed the stored metre value and is
 * never told which system is on screen; `formatDepthParts` is handed both. §0.1's bands are
 * metres because they follow the order water strips colour out — physics, not preference —
 * so a dive reading `81 ft` must draw in the exact band its `24.7 m` draws in. Colouring
 * from `parts.value` instead would be an easy edit and would put every imperial dive deeper
 * than about 12 m into band 6, since 40 *feet* is past the last limit in the table.
 */
export function DepthValue({ metres, scheme, units, variant = 'row' }: DepthValueProps) {
  const colour = depthColorOrNull(metres, scheme);
  const parts = formatDepthParts(metres, units);
  if (colour === null || parts === null) return null;

  const styles = makeStyles(scheme);
  return (
    <Text style={[variant === 'hero' ? styles.depthValueHero : styles.depthValue, { color: colour }]}>
      {parts.value}
      <Text style={variant === 'hero' ? styles.depthUnitHero : styles.depthUnit}>{` ${parts.unit}`}</Text>
    </Text>
  );
}
