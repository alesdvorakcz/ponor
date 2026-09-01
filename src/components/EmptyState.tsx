import { Image, Pressable, ScrollView, Text, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDepthBoundary, METADATA_SEPARATOR } from '../format/display';
import { type UnitSystem } from '../format/units';
import { deepestBandStartM, shallowestBandEndM } from '../theme/depth';
import { makeStyles, screenBottomInset } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { DepthLegend } from './DepthLegend';

/**
 * The mark, monochrome and on a transparent ground — `scripts/build-icons.mjs` builds it from
 * the same `assets/mark.svg` the app icons come from, so the shape cannot drift from the icon.
 *
 * **A bitmap, and deliberately not a rendered SVG.** `react-native-svg` is not a dependency of
 * this project and adding one for a single drawing would buy a native rebuild and a permanent
 * runtime renderer to draw seven line segments that never change. `src/testing/
 * unexpectedGraphics.ts` guards the absence.
 *
 * Required at module scope, not inside the component: Metro resolves the asset at bundle time
 * either way, and a `require` in a render body reads as if it might not be. Annotated rather
 * than inferred, because Metro's `require` is typed `any` and an unannotated asset would hand
 * that `any` straight to a prop.
 */
const MARK: ImageSourcePropType = require('../../assets/images/mark-mono.png');

interface EmptyStateProps {
  scheme: ColorScheme;
  /** The diver's units, for the legend's labels — passed in, like `scheme`, because a screen
   * decides once and its components stay pure (`useUnitSystem`'s docblock). */
  system: UnitSystem;
  onPress: () => void;
}

/**
 * Shown only when the logbook genuinely has no dives (`useDives()` returned
 * an empty list with no error) — never for a search that matched nothing,
 * and never for a failed read. Those three read the same to a diver unless
 * DivesScreen.tsx tells them apart, and this component is only ever the
 * first of them: a failed read is a lie this component would tell if it
 * were reused for that case, which is why DivesScreen.tsx checks `error`
 * before it ever gets here (see its own comment).
 *
 * ---
 *
 * **It is a first-run screen, not a placeholder** (M1h, the owner's design). It held one
 * sentence — "Your logbook is empty." — over the button, which is the only thing the screen
 * *had* to say and nothing a diver did not already know. What it now says is the one thing no
 * other screen in Ponor can: **§0.1, the app's central conceit, was explained nowhere.** A
 * diver met the depth palette one number at a time at the right-hand end of a dive row, where
 * it reads as decoration that happens to vary. This is the only screen with no dive to attach
 * a colour to, so it is the only place the scale can appear as a scale — and the last time it
 * is seen out of context. Everything above the button is that lesson, in the order a diver
 * needs it: the mark, what state the logbook is in, what the app promises (§1's "Works at sea",
 * said to a diver rather than to a planner), the scale, and why the scale is that sequence.
 *
 * **The mark is monochrome, and that is §0.1 enforcing itself.** §0.3 strokes this same shape
 * in the depth gradient *on the app icon*, where the mark is the only thing there is. Drawn
 * inside the interface, that gradient would be colour used as **brand** — and §0.1 says colour
 * encodes depth and nothing else. So the only hue anywhere on this screen is the legend, and
 * the legend is depth. The tint and the half strength live in `emptyStateMark`
 * (theme/styles.ts), which says the same thing at the point where it could be undone; the
 * asset itself is single-colour before any tint is applied, so even a platform where tinting
 * failed could not restore the gradient (scripts/build-icons.mjs).
 *
 * **Not one number on this screen is typed here.** The legend's boundaries come from
 * `theme/depth.ts` and its words from `format/display.ts`; so do the two depths in the reason
 * line, which would otherwise be the same drift arriving one line below the legend it
 * contradicts — and in imperial, a caption reading "6 m" under bars labelled `0–20 · 20–39 · …`
 * would be a first-run screen teaching in two unit systems at once.
 *
 * The primary action sits in the bottom third of the screen (DESIGN.md
 * §0.5: wet hands, one thumb) and is styled from the `action`/`action-fg`
 * tokens — the app's one button treatment (§0.1: colour is depth and
 * nothing else, so every control, including this one, is monochrome).
 *
 * **The clearance beneath that action is the device's, never a constant**
 * (M1h — `screenBottomInset`, theme/styles.ts, owns the rule and records
 * the measurement). This wrapper carried `paddingBottom: 48` and the
 * screen it lives on sits inside a real iOS 26 `UITabBarController`, which
 * reports 83 pt of bottom safe area on an iPhone 17 Pro — 34 of home
 * indicator plus 49 of Liquid Glass tab bar. So the button rendered
 * *underneath* the bar: label illegible through the material, only its
 * left edge exposed, and still tappable, so nothing anywhere reported a
 * failure. §0.6 leaves the top-right capsule off this branch on purpose,
 * which makes this button the ONLY way a first-run diver reaches the form
 * — the one control that must never be the one that is hidden.
 *
 * This is why the component reads a hook at all rather than staying a pure
 * function of `scheme`: the clearance is a property of the device, and a
 * scheme-only stylesheet is exactly where the wrong answer hid.
 *
 * **The teaching block scrolls and the button does not, which is this screen's answer to a
 * small phone.** Five elements now sit above a control whose position is fixed by the device;
 * on a 4.7" screen, or in Czech (§0.5: 20–30 % longer), they do not all fit. The two failure
 * modes that had to be avoided are the ones this project has already paid for: content clipped
 * off the top edge with nothing to say it is there, and a button that gives back the clearance
 * `screenBottomInset` exists to defend. A `ScrollView` above a fixed footer does neither — it
 * is the arrangement `DiveFormScreen` already uses for the same pair of objects.
 *
 * Review task 7, Important #4: this is the entire first-run experience, so its `Pressable`
 * carries `accessibilityRole="button"` rather than relying on the default — `Pressable`
 * does not supply one on its own. No separate `accessibilityLabel`: unlike `DiveRow`'s
 * fragmented number/site/depth, this button's own visible text already says exactly what
 * it does.
 */
export function EmptyState({ scheme, system, onPress }: EmptyStateProps) {
  const styles = makeStyles(scheme);
  const insets = useSafeAreaInsets();
  return (
    // `paddingBottom` composed here, not in the sheet: `screenBottomInset` is the app's one
    // owner of "how far above the bottom edge content may end" (§4.1), and what the device
    // hands it on this screen already includes the tab bar in front of the button — see its
    // docblock for the measurement, and `emptyStateWrap` for why the sheet deliberately
    // carries no `paddingBottom` of its own.
    //
    // **The `+ 24` is a gap over the bar, not a guess at its height.** Composed the way
    // `DiveFormScreen`'s footer already composes `insets.bottom + 24` — the same 24, for the
    // same object: a full-width `styles.action` anchored to the bottom of a screen. Without
    // it the button lands exactly on the safe-area line, which on iOS 26 is exactly the
    // Liquid Glass bar's own top edge: legible, but abutting it, with the bar's shadow
    // falling on the button and the two reading as one stacked object (looked at on the
    // simulator, not deduced — the flush version was rendered and rejected). Inside the
    // `screenBottomInset` call rather than added after it so the app's floor still wins
    // where a device reports no inset at all: the browser's tab bar is a sibling below the
    // screen, nothing is obscured, and the empty state keeps the 48 it has had since M0.
    <View style={[styles.emptyStateWrap, { paddingBottom: screenBottomInset(insets.bottom + 24) }]}>
      <ScrollView style={styles.emptyStateScroll} contentContainerStyle={styles.emptyStateContent}>
        {/* Decorative, and said so rather than left to a platform default: the sentence and
            the legend below carry every fact the mark carries, so a screen reader announcing
            it would only ever announce "image". */}
        <Image source={MARK} style={styles.emptyStateMark} accessible={false} />
        <Text style={styles.emptyStateLabel}>NOTHING LOGGED YET</Text>
        <Text style={styles.emptyStateText}>
          Ponor keeps every dive on this phone. No account, no upload, works with the boat out
          of signal.
        </Text>
        <DepthLegend scheme={scheme} system={system} />
        <Text style={styles.emptyStateReason}>
          colour is depth{METADATA_SEPARATOR}nothing else in Ponor is coloured
        </Text>
        {/* The two depths come from `theme/depth.ts` and are read in the diver's own units,
            so this sentence can never contradict the bars directly above it — see the
            docblock, and `formatDepthBoundary` for why a band boundary is not formatted the
            way a dive's depth is. */}
        <Text style={styles.emptyStateReason}>
          red fades out by {formatDepthBoundary(shallowestBandEndM, system)}, blue carries past{' '}
          {formatDepthBoundary(deepestBandStartM, system)} — the scale follows the light
        </Text>
      </ScrollView>
      <Pressable style={styles.action} onPress={onPress} accessibilityRole="button">
        <Text style={styles.actionLabel}>Log your first dive</Text>
      </Pressable>
    </View>
  );
}
