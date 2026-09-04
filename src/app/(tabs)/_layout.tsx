import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { NATIVE_TAB_ITEMS, nativeTabsAppearance } from '../../navigation/tabs';
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
 * per-tab here to keep in step with that list. Both tabs §3 was still owed arrived that way —
 * Map in M2n and Stats in M3a — as one entry there plus a route file beside `index.tsx`, with
 * no edit to this file at all.
 *
 * **That now includes the glyph, and the reason is that this file cannot be tested.**
 * expo-router sweeps `src/app/` as the route tree, so a test file here would ship to a
 * diver's phone; `navigation/tabs.test.ts` records that and it is why every screen in this app
 * lives outside this directory. This file used to call `nativeTabSymbol` itself, which made
 * the one expression in it that could be wrong also the one expression nothing could check.
 * `NATIVE_TAB_ITEMS` arrives with the glyph already in the native bar's `{sf, md}` spelling
 * and with no raw symbol on it at all, so passing the unconverted value is not a mistake this
 * file can make — it does not compile. See that module for the measurement behind it.
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
      {NATIVE_TAB_ITEMS.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <NativeTabs.Trigger.Label>{tab.title}</NativeTabs.Trigger.Label>
          {/* Already `{sf, md}`. components/symbolName.ts is §4.1's owner of the per-platform
              key a symbol is asked for under, and the native tab bar spells those keys
              differently from `SymbolView`; navigation/tabs.ts is where that conversion is
              applied, so it sits inside the tested tree. There is no web key in it either
              way: expo-router's browser implementation of NativeTabs renders each tab as its
              title alone, which is half of why the browser gets a different navigator. */}
          <NativeTabs.Trigger.Icon {...tab.icon} />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
