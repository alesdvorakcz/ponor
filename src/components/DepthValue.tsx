import { Text } from 'react-native';

import { formatDepth } from '../format/display';
import { depthColorOrNull } from '../theme/depth';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

interface DepthValueProps {
  metres: number | null;
  scheme: ColorScheme;
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
 * colour, with the unit set quieter than the number. `formatDepth` stays the only
 * thing that decides the string ("32.4 m") — splitting it here on the space it
 * always contains is a presentation detail, not a second formatter, so the unit can
 * carry its own (dimmer) style without formatDepth knowing anything about display.
 */
export function DepthValue({ metres, scheme, variant = 'row' }: DepthValueProps) {
  const colour = depthColorOrNull(metres, scheme);
  const text = formatDepth(metres);
  if (colour === null || text === null) return null;

  const styles = makeStyles(scheme);
  const [value, unit] = text.split(' ');
  return (
    <Text style={[variant === 'hero' ? styles.depthValueHero : styles.depthValue, { color: colour }]}>
      {value}
      <Text style={variant === 'hero' ? styles.depthUnitHero : styles.depthUnit}>{` ${unit}`}</Text>
    </Text>
  );
}
