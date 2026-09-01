import { Text, View } from 'react-native';

import { formatDepthBandRange } from '../format/display';
import { type UnitSystem } from '../format/units';
import { depthBandColor, depthBandRanges } from '../theme/depth';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

interface DepthLegendProps {
  scheme: ColorScheme;
  /** The diver's own units (§3), passed in rather than read here — the shape every component
   * in this codebase takes for both `scheme` and `system`, so one place per screen decides
   * and a test can render either system without a database (`useUnitSystem`'s own docblock). */
  system: UnitSystem;
}

/**
 * **The depth scale, shown as a scale** — six bars in the six band colours, each under its
 * own range.
 *
 * This is the only place in Ponor where a depth colour appears **detached from a dive**, and
 * that is the whole argument for it existing. DESIGN.md §0.1 is the app's central conceit —
 * colour encodes depth, and nothing else is ever coloured — and until M1h nothing anywhere
 * said so. A diver met the palette one number at a time, at the right-hand end of a dive row,
 * where it looks like decoration that happens to vary. The first-run screen is the one screen
 * that can teach it, because it is the one screen with no dive to attach a colour to; §0.6
 * puts it there and nowhere else, and it is the last time the scale is seen out of context.
 *
 * **Nothing here is typed twice.** The boundaries come from `depthBandRanges` and the colours
 * from `depthBandColor` — both in `theme/depth.ts`, §4.1's single owner of the depth scale —
 * and the words come from `formatDepthBandRange` in `format/display.ts`, which owns every
 * conversion of a stored value into diver-facing text. A legend with `0–6 · 6–12 · 12–20`
 * written into it is the defect §4.1 is named for, and it is the worst-behaved instance of
 * it: a palette edit would leave the one screen whose job is teaching the scale teaching the
 * wrong one, in the right colours, which is exactly what would stop anyone noticing.
 *
 * **The bars are equal, and the bands are not.** 0–6, 6–12, 12–20, 20–30, 30–40 and then
 * open-ended: drawn to scale, the last band would need infinite room and the first two would
 * be slivers. Six equal columns say "six bands, in this order, shallow to deep", which is the
 * fact the legend is for; the numbers underneath carry the depths.
 *
 * **The swatches carry no accessible text on purpose.** They are `View`s with no label, so a
 * screen reader hears the six ranges and skips the paint — which is the same information, in
 * the order it is drawn. §0.1's own guarantee is that colour never carries meaning alone
 * (a depth is always redundantly encoded as a number), and a legend that needed its colours
 * described would be the counterexample.
 */
export function DepthLegend({ scheme, system }: DepthLegendProps) {
  const styles = makeStyles(scheme);
  return (
    <View style={styles.depthLegend}>
      {depthBandRanges.map((range) => (
        <View key={range.band} style={styles.depthLegendBand}>
          {/* The band's colour is composed here, not in the sheet, for the reason
              `depthValue` records: it depends on the band as well as on the scheme, so a
              scheme-only stylesheet cannot hold it. `depthBandColor` rather than
              `depthColor(someDepthInsideTheBand)` — asking for a colour with an invented
              depth would put §0.1's boundary rule in this file as well as in `depthBand`. */}
          <View style={[styles.depthLegendBar, { backgroundColor: depthBandColor(range.band, scheme) }]} />
          <Text style={styles.depthLegendLabel}>
            {formatDepthBandRange(range.fromM, range.toM, system)}
          </Text>
        </View>
      ))}
    </View>
  );
}
