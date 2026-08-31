import { render, type RenderResult } from '@testing-library/react-native';
import { View } from 'react-native';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { TAB_ROUTES, tabOptions, tabScreenOptions } from './tabs';

// expo-symbols' SymbolView resolves to a native view manager named `SymbolModule` under
// Jest's one hard-coded platform (`ios`) — the same resolution SearchCapsule.test.tsx
// documents at length, and the same reason a drawn or imported approximation would produce
// no such node at all.
function findSymbol(t: RenderResult) {
  const [node] = t.root ? t.root.queryAll((n) => typeof n.type === 'string' && n.type.includes('SymbolModule')) : [];
  if (!node) throw new Error('tabBarIcon did not render a SymbolView');
  return node;
}

// DESIGN.md §3: two tabs today, four eventually (Map is M2, Stats is M3). The order is the
// order they appear in the bar, and Dives is first because it is also the group's `index`
// route — the app's front door.
it('lists Dives first and Settings second', async () => {
  expect(TAB_ROUTES.map((t) => t.name)).toEqual(['index', 'settings']);
  expect(TAB_ROUTES.map((t) => t.title)).toEqual(['Dives', 'Settings']);
});

/**
 * **Every tab names a route file that actually exists, and every route file has a tab.**
 *
 * `name` is matched by expo-router against the files in `src/app/(tabs)/`, so a typo here
 * produces a tab that navigates nowhere — and it does so silently, since a `<Tabs.Screen>`
 * for an unknown name is simply ignored. Nothing else in this repo can catch that: the list
 * is plain data, so `tsc` has no opinion on it, and a rendered navigator would need the
 * whole router to be up.
 *
 * The reverse direction is what makes this a real check rather than a spelling test. A
 * route file added under `(tabs)/` and NOT listed here still becomes a tab — expo-router
 * derives tabs from the directory, not from this list — so it would appear in the bar with
 * a default title, no glyph, and none of `tabOptions`' treatment. Reading the directory is
 * the only way to see that; §4.1's "derive, or tie at compile time" with the filesystem as
 * the other side of the tie.
 */
it('matches the route files under src/app/(tabs)/, in both directions', async () => {
  const routeFiles = readdirSync(join(__dirname, '..', 'app', '(tabs)'))
    .filter((file) => file.endsWith('.tsx') && file !== '_layout.tsx')
    .map((file) => file.replace(/\.tsx$/, ''));
  expect([...TAB_ROUTES.map((t) => t.name)].sort()).toEqual([...routeFiles].sort());
});

// The bar is monochrome (§0.1: colour encodes depth and nothing else; §10 forbids an accent
// on the `+`, which binds the bar it now sits above just as hard). What separates the
// current tab from the others is `fg` against `fgMuted` — the one lever §0.6 already uses
// for "Up next" against a trip title — and both tints are read off the theme rather than
// retyped here, so a literal that merely looked right would fail.
it('separates the current tab from the others with ink alone, in both schemes', async () => {
  for (const scheme of ['light', 'dark'] as const) {
    const options = tabScreenOptions(scheme);
    expect(options.tabBarActiveTintColor).toBe(themeFor(scheme).fg);
    expect(options.tabBarInactiveTintColor).toBe(themeFor(scheme).fgMuted);
    expect(options.tabBarStyle).toBe(makeStyles(scheme).tabBar);
  }
  // ...and the two schemes genuinely differ, so neither could be a fixed colour that
  // happened to satisfy the loop above for one of them.
  expect(tabScreenOptions('light').tabBarActiveTintColor).not.toBe(tabScreenOptions('dark').tabBarActiveTintColor);
});

/**
 * §0.5's 48 dp tap-target floor, and it is a guarantee this file has to make rather than
 * inherit.
 *
 * The vendored `BottomTabBar` computes its own height as 49 + inset — comfortably over the
 * floor — EXCEPT when `isCompact` holds, which it does on an iPhone (not iPad) in landscape
 * whenever labels sit beside icons. That branch returns 32. Left to the default the label
 * position is chosen from the device width, so the bar would silently drop under the floor
 * whenever a diver turned the phone sideways. Pinning `below-icon` removes the branch.
 *
 * Asserted as the two halves that actually deliver it, rather than as a rendered height a
 * unit test cannot produce: the label position that keeps the bar at 49, and the item's own
 * minimum.
 */
it('keeps every tab at the 48 dp floor, including the landscape bar that would otherwise compact to 32', async () => {
  const options = tabScreenOptions('dark');
  expect(options.tabBarLabelPosition).toBe('below-icon');
  expect(options.tabBarItemStyle).toBe(makeStyles('dark').tabBarItem);
  expect((makeStyles('dark').tabBarItem as { minHeight?: number }).minHeight).toBeGreaterThanOrEqual(48);
});

// The app draws its own headings (§0.6's `screenHeading`), so a navigator-supplied bar would
// be the one piece of chrome in Ponor whose type and colour came from somewhere other than
// theme/styles.ts.
it('shows no navigator header', async () => {
  expect(tabScreenOptions('dark').headerShown).toBe(false);
});

// Each tab's glyph is a real SF Symbol resolved through to the native layer — the same proof
// SearchCapsule.test.tsx and ActionCapsule.test.tsx apply to theirs, for the same reason: a
// drawn stand-in would never produce a `SymbolModule` host node. The Android/web halves are
// a compile-time guarantee instead (`symbolName`'s typed unions), since Jest's one platform
// is iOS and `name.android` never reaches a rendered tree here.
it.each(TAB_ROUTES)('draws $title with a real SF Symbol', async (route) => {
  const icon = tabOptions(route).tabBarIcon;
  if (!icon) throw new Error(`${route.name} has no tabBarIcon`);
  // Wrapped in a View rather than rendered bare: `root` resolves to the outermost HOST
  // node and `queryAll` searches its descendants, so a SymbolView rendered as the tree's own
  // root is not among them (found by writing it bare first and watching the query come back
  // empty against a perfectly correct icon).
  const t = await render(
    <View>{icon({ focused: false, color: '#123456', size: 24 })}</View>,
  );
  expect(findSymbol(t).props.name).toBe(route.symbol.ios);
});

// The tint arrives from the navigator already resolved to whichever of the two tints
// applies, so the icon inverts with its label rather than deciding a second time which tab
// is current. A glyph that read the theme itself would ignore this and pass every other
// assertion in this file.
it('tints a tab glyph with the colour the navigator hands it, not one of its own', async () => {
  const [first] = TAB_ROUTES;
  if (!first) throw new Error('TAB_ROUTES is empty');
  const icon = tabOptions(first).tabBarIcon;
  if (!icon) throw new Error('no tabBarIcon');
  const t = await render(<View>{icon({ focused: true, color: '#ABCDEF', size: 24 })}</View>);
  expect(findSymbol(t).props.tintColor).toBe('#ABCDEF');
});
