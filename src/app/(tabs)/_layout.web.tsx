import { Tabs } from 'expo-router/js-tabs';
import { SymbolView } from 'expo-symbols';
import { useColorScheme } from 'react-native';

import { JS_TAB_ITEMS, jsTabsAppearance } from '../../navigation/tabs';
import { resolveScheme } from '../../theme/resolve';

/**
 * **The browser's tab bar, and the ONE reason this file exists beside `_layout.tsx`.**
 *
 * `NativeTabs` (which `_layout.tsx` renders, and which stays untouched on iOS and Android —
 * it is what gives iOS 26 its Liquid Glass bar) has a web implementation, and it is a
 * different object rather than a browser rendering of the same one. It draws a floating text
 * pill fixed at the TOP CENTRE of the window, which is DESIGN.md §3's "Tabs go to the
 * bottom" upside down, and at a narrow viewport it lands underneath the app's own top-right
 * capsule — seen at 420 px, with the capsule sitting on the word "Settings".
 * `navigation/tabs.ts`'s `jsTabsAppearance` has the full account, including why overriding
 * that CSS was rejected rather than tried.
 *
 * **Metro is not what picks this file; expo-router is.** A `.web` route file is resolved by
 * `getRoutesCore.js`'s own platform-route mechanism (`getMostSpecific`), which additionally
 * *requires* the non-platform sibling to exist — remove `_layout.tsx` and the route tree
 * throws rather than silently falling back. So the two files are a pair by construction, and
 * `_layout.tsx` remains the one every device loads.
 *
 * Everything below is `navigation/tabs.ts`'s data, exactly as `_layout.tsx`'s is: the same
 * routes in the same order, so M2n's Map and M3a's Stats were each one entry there plus a
 * route file — never an edit to either layout. The two differ only in the navigator they hand
 * it to and the shape that navigator wants its icons in.
 *
 * **The glyph is that data too now, and this file is where the reason bites hardest.** It used
 * to call `symbolName(route.symbol)` inline, and dropping that call — `name={route.symbol}` —
 * left the entire suite green, because expo-router sweeps `src/app/` as the route tree and a
 * test file here would ship to a diver's phone, so nothing could reach it. The consequence was
 * not subtle: the browser's `SymbolView` reads `name.web`, a raw `PlatformSymbol` has no such
 * key, and this bar would draw no glyphs at all — the very defect `components/symbolName.ts`
 * exists to prevent, in the one file that had no witness. `JS_TAB_ITEMS` arrives resolved and
 * carries no raw symbol, so that edit no longer type-checks.
 */
export default function WebTabsLayout() {
  const scheme = resolveScheme(useColorScheme());
  return (
    <Tabs screenOptions={jsTabsAppearance(scheme)}>
      {JS_TAB_ITEMS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            // The glyph the native bar gets through `NativeTabs.Trigger.Icon`, drawn here by
            // the same `SymbolView` the action capsule already uses in the browser. It arrives
            // carrying the `web` key this navigator actually reads — `symbolName`
            // (components/symbolName.ts) is §4.1's owner of that key and navigation/tabs.ts is
            // where it is applied. `color` and `size` come from the navigator so the glyph
            // tracks the selected/resting tint and the bar's own metrics, rather than this
            // file naming either.
            tabBarIcon: ({ color, size }) => (
              <SymbolView name={tab.icon} size={size} tintColor={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
