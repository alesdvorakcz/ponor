import { Text } from 'react-native';

import { formatDepth } from '../format/display';
import { depthColorOrNull } from '../theme/depth';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

interface DepthValueProps {
  metres: number | null;
  scheme: ColorScheme;
}

/**
 * A depth in its band's colour — the app's one piece of expressive colour (§0.1).
 *
 * This is where the depth scale belongs: a component renders a depth through
 * `DepthValue`, not by calling `depthColor`/`depthColorOrNull` itself. Colour is
 * depth's alone, and a second caller reaching for the scale to tint something else
 * would break the rule that keeps it readable at a glance. `src/app/index.tsx` used
 * to be the one exception (the M0 scaffold screen, left alone until the task that
 * replaced it landed) — that task has landed, so no exception remains.
 *
 * Renders nothing at all for a depth it can't show — unrecorded, non-finite, or
 * negative — rather than let a bad value throw mid-render; see `depthColorOrNull`
 * for why a negative depth is a real possibility here. A placeholder dash would
 * occupy the slot where a real value goes and read, at a glance down a list, as a
 * value the diver failed to enter — which §1 explicitly refuses to do.
 */
export function DepthValue({ metres, scheme }: DepthValueProps) {
  const text = formatDepth(metres);
  const colour = depthColorOrNull(metres, scheme);
  if (text === null || colour === null) return null;

  const styles = makeStyles(scheme);
  return (
    <Text style={[styles.depthValue, { color: colour }]}>
      {text}
    </Text>
  );
}
