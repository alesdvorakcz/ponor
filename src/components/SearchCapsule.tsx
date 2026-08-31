import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { TextInput, View } from 'react-native';

import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { symbolName } from './symbolName';

interface SearchCapsuleProps {
  scheme: ColorScheme;
  value: string;
  onChangeText: (text: string) => void;
  /**
   * Takes focus, and raises the keyboard, as soon as this renders.
   *
   * Set only by the search screen (`SearchScreen.tsx`), where the diver has *just* pressed a
   * magnifier and this field is the entire reason that screen exists — arriving on it and
   * having to tap once more would be a second tap for a decision already made. Off
   * everywhere else, so a field that merely happens to be on screen never steals focus or
   * summons a keyboard nobody asked for.
   */
  autoFocus?: boolean;
}

/**
 * DESIGN.md §0.6 — the Dives screen's search field, moved off the top of the screen (M1c
 * task 11) into a floating capsule at the bottom, beside the "+". This component owns only
 * the capsule's own shape and material; DivesScreen.tsx owns where it sits (the floating
 * row beside the fab, positioned off `useSafeAreaInsets`) and whether it is currently
 * hidden (`useHideOnScroll`) — this component has no opinion on either, so it renders the
 * same way regardless of where its caller puts it.
 *
 * Measured off iOS 26 Messages rather than recalled, per the task brief: no bar, no top
 * rule, no border — separation from the list comes entirely from `floatingShadow`
 * (theme/styles.ts), shared with the "+" beside it. Two materials, chosen at render time by
 * `isLiquidGlassAvailable()` (expo-glass-effect) rather than a static platform check, since
 * that is the one function this device's own OS actually answers: real Liquid Glass where
 * it exists (iOS 26+ only), and — "the common case, [which] must look deliberate rather
 * than degraded" — the exact same shape in a plain, opaque `surface` fill everywhere else.
 * SearchCapsule.test.tsx pins that the two are shape-for-shape identical, not just each
 * individually plausible.
 */
export function SearchCapsule({ scheme, value, onChangeText, autoFocus }: SearchCapsuleProps) {
  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);

  // An SF Symbol, not a drawn/imported approximation (expo-symbols, DESIGN.md §0.6) — real
  // enough that SearchCapsule.test.tsx can pin the exact native module it resolves to.
  // `name`'s object form supplies Material Symbols' own "search" off iOS (expo-symbols falls
  // back to `fallback` — here, nothing — when a platform's key is missing), which this suite
  // cannot itself observe (Jest's one platform is iOS — see SearchCapsule.test.tsx's own
  // note) but `AndroidSymbol` types at compile time regardless.
  //
  // Through `symbolName`, which is what supplies the `web` key the browser's SymbolView
  // reads and this call site used to omit — read that file for why `web` is derived from
  // `android` rather than named again, and why nothing about the iOS render changes.
  const icon = (
    <SymbolView
      name={symbolName({ ios: 'magnifyingglass', android: 'search' })}
      size={18}
      tintColor={theme.fg}
    />
  );
  const input = (
    <TextInput
      style={styles.searchCapsuleInput}
      placeholder="Search dives"
      placeholderTextColor={theme.fgMuted}
      value={value}
      onChangeText={onChangeText}
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus={autoFocus}
      accessibilityLabel="Search dives"
    />
  );

  if (isLiquidGlassAvailable()) {
    return (
      <GlassView style={styles.searchCapsuleGlass} glassEffectStyle="regular">
        {icon}
        {input}
      </GlassView>
    );
  }
  return (
    <View style={styles.searchCapsulePlain}>
      {icon}
      {input}
    </View>
  );
}
