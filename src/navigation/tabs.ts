import type { BottomTabNavigationOptions } from 'expo-router/js-tabs';
import type { NativeTabsProps } from 'expo-router/unstable-native-tabs';

import { nativeTabSymbol, symbolName, type PlatformSymbol } from '../components/symbolName';
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
  // §3's second tab (M2n). It sits between Dives and Settings because that is §3's own order —
  // Dives, Map, Stats, Settings — and M3's Stats tab goes in the gap this leaves rather than on
  // the end. `map`/`map` is the same word in both vocabularies, which is a coincidence of these
  // two libraries and not a rule: `symbolName.test.tsx` pins the Material half like every other
  // glyph, because "they happen to agree today" is exactly the shape that stops being true.
  { name: 'map', title: 'Map', symbol: { ios: 'map', android: 'map' } },
  { name: 'settings', title: 'Settings', symbol: { ios: 'gearshape', android: 'settings' } },
];

/**
 * **The tab bar as each navigator wants to receive it — route file name, the word a diver
 * reads, and the glyph already resolved into that navigator's own key names.**
 *
 * This exists because of where the two layouts live. `src/app/` is swept by expo-router as
 * the route tree, so a test file in it ships to a diver's phone (this file's own suite
 * records that, and it is why `DivesScreen`, `DiveDetailScreen` and `GearPresetScreen` all
 * live outside it). Nothing under `src/app/` can therefore be tested — which was fine while
 * the layouts only mapped over data, and was not fine at all for the one expression each of
 * them still computed:
 *
 * ```tsx
 * <SymbolView name={symbolName(route.symbol)} … />   // _layout.web.tsx
 * <NativeTabs.Trigger.Icon {...nativeTabSymbol(route.symbol)} />   // _layout.tsx
 * ```
 *
 * Dropping either converter — `name={route.symbol}` — was **measured green across the whole
 * suite**, and it is not a hypothetical: `expo-symbols`' non-iOS `SymbolView` reads
 * `name.web`, a raw `PlatformSymbol` has no `web` key, and the browser's tab bar would draw
 * no glyphs at all. That is the exact defect `components/symbolName.ts` was written for,
 * sitting in the one file no test could reach.
 *
 * **So the conversion moves here and the layouts lose the ingredient.** These items carry no
 * `symbol` key — deliberately built field by field rather than spread from `TAB_ROUTES`, so
 * the raw value is not merely unused but *absent*. A layout can no longer pass it by mistake,
 * because there is nothing to pass: `tab.symbol` is a `tsc` error, and `tsc --noEmit` does
 * cover `src/app/` even though Jest cannot. The guarantee is moved from "nobody edits that
 * expression wrongly" to "the wrong edit does not compile", which is §4.1's "derive, or tie
 * at compile time" applied to the one tree that has no other net.
 *
 * **What that does and does not cover, stated exactly, because the difference is the whole
 * value of it.** It covers a layout mapping over the list it is given — the realistic slip,
 * and the one that was measured green before this existed. It does **not** cover a layout that
 * imports `TAB_ROUTES` again and maps over that instead: `SymbolView`'s `name` prop accepts a
 * bare `PlatformSymbol` quite happily (measured — handing it one type-checks clean and passes
 * every test, which is precisely why the original defect was invisible to all four gates), so
 * the raw shape is only unreachable while the raw value is out of scope. That is a rewrite
 * rather than an edit, and nothing here would stop it. Anyone reintroducing that import is
 * undoing this on purpose and should read this paragraph first.
 *
 * Two lists rather than one for the same reason there are two appearance functions below:
 * the native bar asks for `{sf, md}` and the browser's `SymbolView` asks for `{ios, android,
 * web}`, and they are the same two glyphs under two vocabularies. `symbolName.ts` owns both
 * spellings; the `icon` types are read off its own return types rather than restated here, so
 * a change to either shape lands in one place.
 *
 * Computed once at module load rather than per render. Both converters are pure functions of
 * a frozen list, so every value is identical to what the layouts computed inline; what
 * changes is that the objects are now stable across renders instead of fresh each time, which
 * can only reduce work downstream.
 */
export interface NativeTabItem {
  name: string;
  title: string;
  icon: ReturnType<typeof nativeTabSymbol>;
}

export interface JsTabItem {
  name: string;
  title: string;
  icon: ReturnType<typeof symbolName>;
}

/** What `(tabs)/_layout.tsx` maps over. */
export const NATIVE_TAB_ITEMS: readonly NativeTabItem[] = TAB_ROUTES.map((route) => ({
  name: route.name,
  title: route.title,
  icon: nativeTabSymbol(route.symbol),
}));

/** What `(tabs)/_layout.web.tsx` maps over. */
export const JS_TAB_ITEMS: readonly JsTabItem[] = TAB_ROUTES.map((route) => ({
  name: route.name,
  title: route.title,
  icon: symbolName(route.symbol),
}));

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
