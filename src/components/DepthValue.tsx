import { Text } from 'react-native';

import { formatDepth } from '../format/display';
import { depthColor } from '../theme/depth';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

interface DepthValueProps {
  metres: number | null;
  scheme: ColorScheme;
}

/**
 * A depth in its band's colour — the app's one piece of expressive colour (§0.1).
 *
 * The only caller of `depthColor` in the app. Colour is depth's alone; a second
 * component reaching for the depth scale to tint something else would break the
 * rule that makes the scale readable at a glance.
 *
 * Renders nothing at all for an unrecorded depth. A placeholder dash would
 * occupy the slot where a real value goes and read, at a glance down a list, as
 * a value the diver failed to enter — which §1 explicitly refuses to do.
 */
export function DepthValue({ metres, scheme }: DepthValueProps) {
  const text = formatDepth(metres);
  // `metres === null` is redundant with `text === null` at runtime — formatDepth
  // already rejects null, NaN and non-finite input — but narrows `metres` to
  // `number` for depthColor below without a cast.
  if (text === null || metres === null) return null;

  const styles = makeStyles(scheme);
  return (
    <Text style={[styles.depthValue, { color: depthColor(metres, scheme) }]}>
      {text}
    </Text>
  );
}
