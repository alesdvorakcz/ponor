import { SymbolView } from 'expo-symbols';
import type { BottomTabNavigationOptions } from 'expo-router/js-tabs';

import { symbolName, type PlatformSymbol } from '../components/symbolName';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/** One entry in the tab bar. */
export interface TabRoute {
  /** The route's file name under `src/app/(tabs)/`, without its extension. */
  name: string;
  /** The word in the bar, and the screen's own title. */
  title: string;
  /** Its glyph, in each platform's own vocabulary — `symbolName` supplies the `web` half. */
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
 * `name` is a route file name and not a label: expo-router matches `<Tabs.Screen name>`
 * against the files in `src/app/(tabs)/`, so `'index'` here means `(tabs)/index.tsx` and
 * a typo produces a tab that navigates nowhere. It is not translated; `title` is the
 * string a diver reads, and is what i18next will key when M3 arrives.
 */
export const TAB_ROUTES: readonly TabRoute[] = [
  // `water.waves` over `list.bullet`: the tab is the logbook, and §0.3 already spends the
  // app's iconography on water rather than on documents — a list glyph would say "rows",
  // which is the least interesting true thing about this screen.
  { name: 'index', title: 'Dives', symbol: { ios: 'water.waves', android: 'waves' } },
  { name: 'settings', title: 'Settings', symbol: { ios: 'gearshape', android: 'settings' } },
];

/**
 * What every tab shares.
 *
 * **`headerShown: false`** because the app draws its own headings (§0.6's `screenHeading`)
 * and always has — the root Stack sets the same, and a navigator-supplied bar would be the
 * one piece of chrome in Ponor whose type and colour came from somewhere other than
 * `theme/styles.ts`.
 *
 * **`tabBarLabelPosition: 'below-icon'` is a guarantee, not a preference.** The vendored
 * `BottomTabBar` drops from a 49 dp bar to a 32 dp "compact" one on an iPhone in landscape,
 * and only when labels sit BESIDE icons (`isCompact` in that file: iOS, not iPad,
 * landscape, horizontal labels). Left to the default the position is chosen from the
 * device width, so the bar would silently fall under §0.5's 48 dp floor whenever a diver
 * turned the phone sideways. Pinning the label below the icon removes that branch
 * entirely; `styles.tabBarItem`'s own `minHeight: 48` is the second half of the same
 * guarantee, on the item rather than the bar.
 *
 * **The tints are the only thing separating the current tab from the others**, and they are
 * `fg` against `fgMuted` — §0.1 leaves no hue for chrome, and §10 forbids an accent on the
 * `+` by name, which binds the bar it now sits above just as hard. It is the same lever
 * §0.6 already pulls for "Up next" against a trip's title.
 */
export function tabScreenOptions(scheme: ColorScheme): BottomTabNavigationOptions {
  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);
  return {
    headerShown: false,
    tabBarLabelPosition: 'below-icon',
    tabBarActiveTintColor: theme.fg,
    tabBarInactiveTintColor: theme.fgMuted,
    tabBarStyle: styles.tabBar,
    tabBarItemStyle: styles.tabBarItem,
    tabBarLabelStyle: styles.tabBarLabel,
  };
}

/**
 * One tab's own options: its title, and its glyph.
 *
 * `color` arrives from the navigator already resolved to whichever of the two tints above
 * applies, so the icon inverts with its label rather than this deciding a second time which
 * tab is current — the same "take the colour you were handed" split `OptionChips` uses when
 * it passes its chips' ink out to an icon.
 */
export function tabOptions(route: TabRoute): BottomTabNavigationOptions {
  return {
    title: route.title,
    tabBarIcon: ({ color, size }) => (
      <SymbolView name={symbolName(route.symbol)} size={size} tintColor={color} />
    ),
  };
}
