import { Tabs } from 'expo-router/js-tabs';
import { SymbolView } from 'expo-symbols';
import { useColorScheme } from 'react-native';

import { symbolName } from '../../components/symbolName';
import { TAB_ROUTES, jsTabsAppearance } from '../../navigation/tabs';
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
 * `TAB_ROUTES` in the same order, so adding M2's Map or M3's Stats is still one entry there
 * plus a route file — never an edit to either layout. The two differ only in the navigator
 * they hand it to and the shape that navigator wants its icons in.
 */
export default function WebTabsLayout() {
  const scheme = resolveScheme(useColorScheme());
  return (
    <Tabs screenOptions={jsTabsAppearance(scheme)}>
      {TAB_ROUTES.map((route) => (
        <Tabs.Screen
          key={route.name}
          name={route.name}
          options={{
            title: route.title,
            // The glyph the native bar gets through `NativeTabs.Trigger.Icon`, drawn here by
            // the same `SymbolView` the action capsule already uses in the browser —
            // `symbolName` (components/symbolName.ts) is §4.1's owner of the per-platform key
            // it is asked for under, and supplies the `web` half. `color` and `size` come
            // from the navigator so the glyph tracks the selected/resting tint and the bar's
            // own metrics, rather than this file naming either.
            tabBarIcon: ({ color, size }) => (
              <SymbolView name={symbolName(route.symbol)} size={size} tintColor={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
