import type { BottomTabNavigationOptions } from 'expo-router/js-tabs';
import type { NativeTabsProps } from 'expo-router/unstable-native-tabs';

import { type PlatformSymbol } from '../components/symbolName';
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
 * What the NATIVE tab bar looks like — the props `(tabs)/_layout.tsx` spreads onto
 * `<NativeTabs>`. `jsTabsAppearance` below is the browser's half; see it for why the two
 * bars are different objects at all.
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
 * **`backgroundColor` is deliberately not set at all.** Setting it makes the bar opaque and
 * takes away the very material this change exists to get: not "no opinion", but "the
 * platform's opinion, deliberately", the same reasoning `platform/confirmDestructive.ts`
 * records for the delete dialog. §0.1 is not broken by it either — a system material is not
 * a hue the app spent on anything, and the two things the app *does* colour here (the glyph
 * and its label) still come from tokens.
 *
 * This used to read `backgroundColor: tabBarSurface(scheme)`, a `src/platform/` split whose
 * web half returned `surface` because expo-router's own web CSS would otherwise fall back to
 * a hard-coded `#272727`. That split is gone with the file it served: the browser no longer
 * renders `NativeTabs` at all (`_layout.web.tsx`), so its web half had no reachable caller
 * and its docblock described a bar that is no longer drawn. Native was always `undefined`.
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
    // The ground behind the SELECTED tab, on the one platform left that draws one: Android's
    // Material indicator. Left unset it is expo-router's own hard-coded `#444444` — a literal
    // that knows nothing about the scheme, and the only colour on the bar the app was not
    // choosing. `border` is the token the app already spends on "a quiet ground one step off
    // the surface", which is exactly what a selection pill is. iOS ignores it: UIKit draws
    // its own selection there.
    indicatorColor: theme.border,
  };
}

/**
 * What the BROWSER's tab bar looks like — the `screenOptions` `(tabs)/_layout.web.tsx`
 * hands to expo-router's ordinary JS `Tabs`.
 *
 * **Why the browser gets a different navigator at all.** `NativeTabs` has a web
 * implementation, and it is a different object rather than a browser rendering of the same
 * one: `NativeTabsView.web.js` is a Radix tab list, and
 * `expo-router/assets/native-tabs.module.css` positions it `position: fixed; top: 24px;
 * left: 50%`. So on web the "tab bar" is a floating text pill at the TOP CENTRE — §3's
 * "tabs go to the bottom" stood on its head — and at a narrow viewport it lands underneath
 * the app's own top-right capsule (seen at 420 px, with the capsule sitting on the word
 * "Settings"). It draws no icons either: each tab is `<span>{title}</span>` and no icon
 * field is read at all.
 *
 * Fighting that CSS was the alternative and was rejected outright: the only lever is a rule
 * targeting expo-router's internal markup (`[role="tablist"][aria-label="Main"]`) inside an
 * `unstable_`-prefixed API, which breaks silently on a patch release. Swapping the navigator
 * is the supported move — `_layout.web.tsx` beside `_layout.tsx` is expo-router's own
 * platform-route mechanism (`getRoutesCore.js`'s `getMostSpecific`, which additionally
 * *requires* the non-platform sibling to exist) — and it gets web a real bottom bar with the
 * app's own glyphs in it, which is what §3 describes and what the browser is for: a surface
 * the design can be reviewed on.
 *
 * **Native is untouched by any of this.** iOS and Android keep `NativeTabs`, which is what
 * gives iOS 26 its Liquid Glass bar; `nativeTabsAppearance` above is still their appearance,
 * and this function is never called on a device.
 *
 * What it sets, and why each is here rather than left to the navigator:
 *
 * - `headerShown: false` — every screen in this app draws its own top, and the root Stack
 *   already says the same thing. A JS navigator would otherwise add a title bar the native
 *   one never had, which is a divergence in the opposite direction from the one being fixed.
 * - `tabBarActiveTintColor` / `tabBarInactiveTintColor` — `fg` and `fgMuted`, the exact pair
 *   `nativeTabsAppearance`'s `tintColor`/`iconColor` spend, so the two bars read as one
 *   design. They cover the glyph and the word together (`BottomTabItem.js` applies the tint
 *   to both), the same way `tintColor` does natively.
 * - `tabBarLabelStyle` — `webTabBarLabel`, which is `tabBarLabel` without its colour. That
 *   omission is load-bearing and theme/styles.ts records why: the navigator composes
 *   `[{ color: tint }, tabBarLabelStyle]` in that order, so a colour here would quietly win
 *   over the active tint and the selected tab would never change ink.
 * - `tabBarStyle` — the bar's own ground and hairline. Unset, react-navigation paints from
 *   ITS theme rather than the app's, and nothing in this app installs a `ThemeProvider`, so
 *   the dark theme would get a white bar. Same class of defect as the `#272727` the native
 *   web bar fell back to, arriving through a different door.
 *
 * Height, tap targets and the bottom safe-area inset are the navigator's, deliberately —
 * §0.5's 48 dp floor is kept by the same party that keeps it on the device (UIKit there,
 * react-navigation here), rather than by this app asserting a number in one of the two.
 */
export function jsTabsAppearance(scheme: ColorScheme): BottomTabNavigationOptions {
  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);
  return {
    headerShown: false,
    tabBarActiveTintColor: theme.fg,
    tabBarInactiveTintColor: theme.fgMuted,
    tabBarLabelStyle: styles.webTabBarLabel,
    tabBarStyle: styles.webTabBar,
  };
}
