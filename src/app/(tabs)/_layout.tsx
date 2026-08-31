import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { nativeTabSymbol } from '../../components/symbolName';
import { TAB_ROUTES, nativeTabsAppearance } from '../../navigation/tabs';
import { resolveScheme } from '../../theme/resolve';

/**
 * The tab bar (DESIGN.md §3's note: "**Tabs go to the bottom**; search and `+` move to a
 * top-right capsule"). A route group, so `(tabs)` adds no segment to any URL — `/` is still
 * the Dives list and the browser's address bar is unchanged by the tabs existing.
 *
 * **`NativeTabs`, not a JavaScript tab bar** (owner's call). On iOS 26 this renders a real
 * `UITabBarController`, which is the only way to get the Liquid Glass tab bar, its
 * scroll-edge behaviour and the platform's own accessibility without approximating any of
 * them; `navigation/tabs.ts` records what that buys and what it costs. It is imported from
 * `expo-router/unstable-native-tabs` — the `unstable_` name is the package's, and the props
 * used here were read off the installed build rather than the docs.
 *
 * Everything rendered below is `navigation/tabs.ts`'s data; there is deliberately nothing
 * per-tab here to keep in step with that list. Adding M2's Map or M3's Stats is an entry
 * there plus a route file beside `index.tsx` — no edit to this file at all.
 *
 * The dive form and the dive detail stay OUTSIDE this group, in the root Stack, which is
 * what makes them full-screen over the tabs rather than a third tab: §3 is "four tabs plus
 * a **full-screen** dive form."
 *
 * **No `role` on any trigger.** `NativeTabsTabBarItemRole` includes a `'search'` role that
 * would turn a tab into iOS's system search item, and it is left alone on purpose: whether
 * search becomes a native tab instead of the top-right capsule is an open question, and
 * building it both ways would mean building it twice.
 */
export default function TabsLayout() {
  const scheme = resolveScheme(useColorScheme());
  return (
    <NativeTabs {...nativeTabsAppearance(scheme)}>
      {TAB_ROUTES.map((route) => (
        <NativeTabs.Trigger key={route.name} name={route.name}>
          <NativeTabs.Trigger.Label>{route.title}</NativeTabs.Trigger.Label>
          {/* `sf` / `md`, via `nativeTabSymbol` — components/symbolName.ts is §4.1's owner
              of the per-platform key a symbol is asked for under, and the native tab bar
              spells those keys differently from `SymbolView`. There is no web key to pass:
              expo-router's browser implementation renders each tab as its title alone. */}
          <NativeTabs.Trigger.Icon {...nativeTabSymbol(route.symbol)} />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
