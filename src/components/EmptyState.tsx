import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { makeStyles, screenBottomInset } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

interface EmptyStateProps {
  scheme: ColorScheme;
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
 * Review task 7, Important #4: this is the entire first-run experience, so its `Pressable`
 * carries `accessibilityRole="button"` rather than relying on the default — `Pressable`
 * does not supply one on its own. No separate `accessibilityLabel`: unlike `DiveRow`'s
 * fragmented number/site/depth, this button's own visible text already says exactly what
 * it does.
 */
export function EmptyState({ scheme, onPress }: EmptyStateProps) {
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
      <Text style={styles.emptyStateText}>Your logbook is empty.</Text>
      <Pressable style={styles.action} onPress={onPress} accessibilityRole="button">
        <Text style={styles.actionLabel}>Log your first dive</Text>
      </Pressable>
    </View>
  );
}
