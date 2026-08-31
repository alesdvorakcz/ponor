import { Fragment } from 'react';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { symbolName, type PlatformSymbol } from './symbolName';

/** One glyph in the capsule. */
export interface CapsuleAction {
  /** React key, and what a test names the glyph by. */
  key: string;
  /** The symbol, in each platform's own vocabulary — `symbolName` supplies the `web` half. */
  symbol: PlatformSymbol;
  /**
   * What a screen reader announces. The glyph is alone in its button — there is no label
   * beside it to fall back on, unlike §0.6's option chips where "the icon supplements the
   * label rather than replacing it" — so this is the only thing that names the control and
   * is required, not optional.
   */
  label: string;
  onPress: () => void;
}

interface ActionCapsuleProps {
  scheme: ColorScheme;
  /** Rendered in order, separated by a hairline. Two today; §3 expects a third. */
  actions: readonly CapsuleAction[];
}

/** The symbol's drawn size inside its 48 dp box (`capsuleGlyph`, theme/styles.ts). Matches
 * the search capsule's own magnifier at 18, one point up: that one sits beside text at the
 * same scale, where these stand alone and carry the whole control. */
const GLYPH_SIZE = 19;

/**
 * DESIGN.md §3's note (owner's call, recorded during M1d, built with Settings): "**Tabs go
 * to the bottom; search and `+` move to a top-right capsule**... Calendar answers it: one
 * top-right glass capsule carrying view-toggle, magnifier and `+` as **equal monochrome
 * glyphs**, with the bottom left to navigation. Ponor follows that."
 *
 * This component owns the capsule's shape, its material and the glyphs inside it; its caller
 * owns where it sits — the same division of labour `SearchCapsule` next door has, which is
 * what lets one capsule serve two screens. On the Dives screen it is the sole occupant of
 * that screen's pinned bar (`divesBar`, theme/styles.ts), at its trailing edge; on the search
 * screen it sits in the dock beside the field. It floated over the dive list until a row in
 * flow existed to hold it, and carried a recede-on-scroll while it did — see `divesBar` for
 * why neither is needed now.
 *
 * **Equal glyphs, and that settles a question §3 left open**: "Whether `+` is an equal glyph
 * or carries some emphasis is decided when it is built; §10's 'no accent on the `+`' binds
 * either way, since that was about hue, not weight." Equal — the note's own words for what
 * Calendar does, and the shape that lets a third and fourth glyph join without one of them
 * being the odd one out. What the `+` loses in prominence it is not asked to make up here:
 * §3 already names the mitigation, and it is the empty state's full-size "Log your first
 * dive" in the bottom third (§0.5), which is untouched.
 *
 * **Two materials, chosen at render time** by `isLiquidGlassAvailable()` rather than a
 * static platform check — the identical mechanism, and the identical reasoning, that
 * `SearchCapsule.tsx` records: real Liquid Glass where the OS has it (iOS 26+), and
 * everywhere else the same shape in an opaque `surface` fill, which "must look deliberate
 * rather than degraded" (§0.6). `ActionCapsule.test.tsx` pins the two shape-for-shape
 * rather than each on its own, exactly as that component's own suite does.
 *
 * **Monochrome, all of it.** §0.1 spends every hue on depth and §10 forbids an accent on the
 * `+` by name; both glyphs are `fg`, and the capsule's own ground is `surface`.
 */
export function ActionCapsule({ scheme, actions }: ActionCapsuleProps) {
  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);

  const contents = actions.map((action, index) => (
    <Fragment key={action.key}>
      {/* Between glyphs only, never leading or trailing — a hairline against the capsule's
          own edge would read as a cut rather than a seam. */}
      {index > 0 && <View style={styles.capsuleDivider} />}
      <Pressable
        style={styles.capsuleGlyph}
        onPress={action.onPress}
        accessibilityRole="button"
        accessibilityLabel={action.label}
      >
        {/* Through `symbolName`, which supplies the `web` key the browser's SymbolView reads
            — see that module for why `web` is derived from `android` and why nothing about
            the iOS render changes. */}
        <SymbolView name={symbolName(action.symbol)} size={GLYPH_SIZE} tintColor={theme.fg} />
      </Pressable>
    </Fragment>
  ));

  if (isLiquidGlassAvailable()) {
    return (
      <GlassView style={styles.actionCapsuleGlass} glassEffectStyle="regular">
        {contents}
      </GlassView>
    );
  }
  return <View style={styles.actionCapsulePlain}>{contents}</View>;
}
