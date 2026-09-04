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
  /**
   * **Whether this glyph is a switch, and whether it is on** (M3e).
   *
   * Absent — the ordinary case, and every glyph in the Dives and search capsules — means *this
   * is a plain trigger*: it acts and reports nothing, and the tree it renders is identical to
   * the one it rendered before this key existed (measured, not assumed — see the
   * `accessibilityState` below for what that cost in a branch that could not fail). Present means the glyph is one of a set the
   * diver is choosing among, and it is drawn in §0.6's one treatment for a chosen thing
   * (`capsuleGlyphInkSelected`, theme/styles.ts) and announced with `accessibilityState`.
   *
   * **Optional rather than required, and that is the widening being kept as narrow as it can
   * be.** `MapScreen`'s note used to record this component's contract as "plain triggers with
   * fixed labels — neither reports a state", which was true while §3's layers were a mode: a
   * control that takes you somewhere needs no state, because the summary line says where you
   * are. A filter has no such elsewhere — three switches are on or off at once and no sentence
   * can carry three states — so the control has to hold them. The alternative was a second
   * capsule idiom for one screen, which is what §0.6 exists to stop.
   *
   * `boolean | undefined` rather than a `variant` on the capsule, because the two kinds mix in
   * one row on principle: the Map's capsule is three switches today and gains an ordinary
   * trigger the day it grows one.
   */
  selected?: boolean;
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
 * what lets one capsule serve two screens. On the Dives screen it floats beside the large
 * title, over the list (`capsuleFloat`, theme/styles.ts); on the search screen it sits in
 * the dock beside the field. It carried a recede-on-scroll while it floated the first time,
 * and then sat in a pinned bar for two milestones — see `capsuleFloat` for why it needs
 * neither now, and what had to stop being sticky for that to be true.
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
 * `+` by name; an unswitched glyph is `fg`, a switched-on one is `actionFg` on `action`, and the
 * capsule's own ground is `surface`. There is no third ink anywhere in here.
 *
 * **A glyph may be a switch as well as a trigger** (M3e, `CapsuleAction.selected`) — the Map
 * tab's three layer filters are switches and everything else in the app is a trigger. The
 * component does not know which screen it is on: it draws whichever each action says it is, so
 * the two mix in one row.
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
        // **A trigger reports no selectedness, and it needs no branch to do it.** A
        // `action.selected === undefined ? undefined : {…}` conditional was written here first
        // and measured: `Pressable` builds `{busy, checked, disabled, expanded, selected}` from
        // whatever it is handed, so the two spellings reach the host node byte for byte the same
        // and nothing could ever have caught the difference. §10 declines a guard nothing could
        // catch failing, so this is one line rather than two — and an absent `selected` is what
        // makes a trigger a trigger to a screen reader, not a switch that is off.
        accessibilityState={{ selected: action.selected }}
      >
        {/* The pill that carries §0.6's chosen-thing ink. Always rendered, so a switch and a
            trigger have the same tree and the same 48 dp box, and only the fill differs. */}
        <View style={[styles.capsuleGlyphInk, action.selected === true && styles.capsuleGlyphInkSelected]}>
          {/* Through `symbolName`, which supplies the `web` key the browser's SymbolView reads
              — see that module for why `web` is derived from `android` and why nothing about
              the iOS render changes. Inverted ink inside an inverted pill, exactly as a
              selected option chip's label is (`selectedInk`, theme/styles.ts). */}
          <SymbolView
            name={symbolName(action.symbol)}
            size={GLYPH_SIZE}
            tintColor={action.selected === true ? theme.actionFg : theme.fg}
          />
        </View>
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
