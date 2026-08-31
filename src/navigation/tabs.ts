import type { NativeTabsProps } from 'expo-router/unstable-native-tabs';

import { type PlatformSymbol } from '../components/symbolName';
import { tabBarSurface } from '../platform/tabBarSurface';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/** One entry in the tab bar. */
export interface TabRoute {
  /** The route's file name under `src/app/(tabs)/`, without its extension. */
  name: string;
  /** The word in the bar, and the screen's own title. */
  title: string;
  /** Its glyph, in each platform's own vocabulary — `nativeTabSymbol` (components/symbolName.ts)
   * owns which key the tab bar asks for each half under. */
  symbol: PlatformSymbol;
}

/**
 * **The tab bar, as data** (DESIGN.md §3: "Four tabs plus a full-screen dive form").
 *
 * Two of the four exist today. Map is M2 and Stats is M3, and the shape of this file is the
 * whole point: adding either is adding an entry here and a route file beside `index.tsx` —
 * `(tabs)/_layout.tsx` maps over this list and has no per-tab knowledge of its own to
 * update. The order is the order they appear in the bar, and §3's own order puts Dives
 * first, which is also the group's `index` route and therefore the app's front door.
 *
 * `name` is a route file name and not a label: expo-router matches `<NativeTabs.Trigger name>`
 * against the files in `src/app/(tabs)/`, so `'index'` here means `(tabs)/index.tsx`. It is
 * not translated; `title` is the string a diver reads, and is what i18next will key when M3
 * arrives.
 */
export const TAB_ROUTES: readonly TabRoute[] = [
  // `water.waves` over `list.bullet`: the tab is the logbook, and §0.3 already spends the
  // app's iconography on water rather than on documents — a list glyph would say "rows",
  // which is the least interesting true thing about this screen.
  { name: 'index', title: 'Dives', symbol: { ios: 'water.waves', android: 'waves' } },
  { name: 'settings', title: 'Settings', symbol: { ios: 'gearshape', android: 'settings' } },
];

/**
 * What the tab bar looks like — the props `(tabs)/_layout.tsx` spreads onto `<NativeTabs>`.
 *
 * **The bar itself is the platform's**, and that is the point of using
 * `expo-router/unstable-native-tabs` rather than drawing one: on iOS 26 it is a real
 * `UITabBarController`, so the Liquid Glass material, the scroll-edge appearance, the
 * minimize-on-scroll behaviour and the platform's own accessibility and tap targets all
 * arrive without this app approximating any of them. §0.5's 48 dp floor is UIKit's
 * responsibility here rather than a `minHeight` this file has to assert — a better answer
 * than the one it replaces, since the platform's own metrics are what a diver's thumb is
 * calibrated to.
 *
 * **What this sets is ink, and only ink** (§0.1: colour encodes depth and nothing else; §10
 * forbids an accent on the `+`, which binds the bar it now sits above just as hard):
 *
 * - `iconColor` is the resting glyph, `fgMuted`.
 * - `tintColor` is the selected item. The navigator (`NativeBottomTabsNavigator.js`) uses it
 *   for both `selectedIconColor` and the selected label's colour when neither is given
 *   explicitly, so one value covers the glyph and the word together and they cannot drift.
 * - `labelStyle` is the resting label: Archivo, small, `fgMuted` — a tab label is UI chrome,
 *   the same category as `actionLabel`, never a data figure (§0.2 splits the two faces on
 *   content).
 *
 * **`backgroundColor` is deliberately not set on native.** Setting it makes the bar opaque
 * and takes away the very material this change exists to get. `src/platform/tabBarSurface`
 * owns that split — the browser needs an explicit ground because expo-router's own web CSS
 * would otherwise fall back to a hard-coded `#272727` that knows nothing about the theme.
 *
 * `minimizeBehavior` is left at its `automatic` default: iOS 26 decides whether the bar
 * shrinks as the list scrolls, which is the platform's own answer to the same question
 * §0.6 answers for the top capsule. Recorded rather than set, so the decision is visible.
 */
export function nativeTabsAppearance(scheme: ColorScheme): NativeTabsProps {
  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);
  return {
    iconColor: theme.fgMuted,
    tintColor: theme.fg,
    labelStyle: styles.tabBarLabel,
    backgroundColor: tabBarSurface(scheme),
    // The ground behind the SELECTED tab, on the two platforms that draw one (Android's
    // Material indicator, and the browser's pill). Left unset it is expo-router's own
    // hard-coded `#444444` — a literal that knows nothing about the scheme, and the only
    // colour on the bar the app was not choosing. `border` is the token the app already
    // spends on "a quiet ground one step off the surface", which is exactly what a selection
    // pill is. iOS ignores it: UIKit draws its own selection there.
    indicatorColor: theme.border,
  };
}
