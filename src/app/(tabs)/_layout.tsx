import { Tabs } from 'expo-router/js-tabs';
import { useColorScheme } from 'react-native';

import { TAB_ROUTES, tabOptions, tabScreenOptions } from '../../navigation/tabs';
import { resolveScheme } from '../../theme/resolve';

/**
 * The tab bar (DESIGN.md §3's note: "**Tabs go to the bottom**; search and `+` move to a
 * top-right capsule"). A route group, so `(tabs)` adds no segment to any URL — `/` is still
 * the Dives list and the browser's address bar is unchanged by the tabs existing.
 *
 * Everything this renders is `navigation/tabs.tsx`'s data and options; there is deliberately
 * nothing per-tab here to keep in step with that list. Adding M2's Map or M3's Stats is an
 * entry there plus a route file beside `index.tsx` — no edit to this file at all.
 *
 * The dive form and the dive detail stay OUTSIDE this group, in the root Stack, which is
 * what makes them full-screen over the tabs rather than a third tab: §3 is "four tabs plus a
 * **full-screen** dive form."
 *
 * `Tabs` comes from `expo-router/js-tabs` rather than the bare `expo-router` export, which
 * expo-router 57 marks deprecated in favour of exactly this path.
 */
export default function TabsLayout() {
  const scheme = resolveScheme(useColorScheme());
  return (
    <Tabs screenOptions={tabScreenOptions(scheme)}>
      {TAB_ROUTES.map((route) => (
        <Tabs.Screen key={route.name} name={route.name} options={tabOptions(route)} />
      ))}
    </Tabs>
  );
}
