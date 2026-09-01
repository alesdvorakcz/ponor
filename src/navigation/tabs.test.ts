import { JS_TAB_ITEMS, NATIVE_TAB_ITEMS, TAB_ROUTES, jsTabsAppearance, nativeTabsAppearance } from './tabs';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';

// DESIGN.md §3's note: "Tabs go to the bottom." Two navigators now render that one bar —
// `NativeTabs` on iOS and Android (`(tabs)/_layout.tsx`), expo-router's JS `Tabs` in the
// browser (`_layout.web.tsx`) — because the web build of `NativeTabs` is a different object
// that draws a text pill fixed at the TOP CENTRE and collides with the app's own top-right
// capsule at a narrow viewport. See `jsTabsAppearance`'s own docblock for the full account.
//
// Neither layout file can be tested where it lives: expo-router sweeps `src/app/` as routes,
// and a test file in that tree kills the app at launch. So each layout is deliberately a map
// over `TAB_ROUTES` handing a navigator the appearance functions below, and those functions
// are what these tests pin — the same split `navigation/tabs.test.tsx` used to make for the
// JS navigator built and discarded before native tabs landed.

// The one thing the two bars must agree on, and the reason a diver never sees "two designs":
// the ink. `iconColor`/`tintColor` are what the native bar spends; `tabBarInactiveTintColor`/
// `tabBarActiveTintColor` are the same two values under the JS navigator's own names. Read
// off both functions rather than against a token literal, so a change to one bar's resting or
// selected ink fails here instead of quietly making the browser look like a different app.
it('spends the same two inks on both bars, so the browser and the device read as one design', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const native = nativeTabsAppearance(scheme);
    const js = jsTabsAppearance(scheme);
    expect(js.tabBarInactiveTintColor).toBe(native.iconColor);
    expect(js.tabBarActiveTintColor).toBe(native.tintColor);
  }
});

// §0.1: colour encodes depth and nothing else, so the bar is monochrome — resting ink is
// muted, selected ink is full. Checked against the theme itself, because "the two differ" on
// its own would pass for any pair at all, including an accent.
it('draws the bar in ink only — muted at rest, full when selected', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const theme = themeFor(scheme);
    const js = jsTabsAppearance(scheme);
    expect(js.tabBarInactiveTintColor).toBe(theme.fgMuted);
    expect(js.tabBarActiveTintColor).toBe(theme.fg);
  }
});

// **The trap this file exists for most.** `BottomTabItem.js` composes
// `[{ color: activeOrInactiveTint }, tabBarLabelStyle]` in that order, so any `color` on the
// label style wins over `tabBarActiveTintColor` and the selected tab's word never changes
// ink — silently, since both values are perfectly valid colours and nothing throws. The
// native bar's own `tabBarLabel` DOES carry a colour (its navigator wants it there), which is
// exactly how the wrong key gets used here by someone reading one line of this file.
it('gives the browser a label style with no colour in it, so the selected tab can change ink', () => {
  const js = jsTabsAppearance('dark');
  expect(js.tabBarLabelStyle).toBe(makeStyles('dark').webTabBarLabel);
  expect(js.tabBarLabelStyle).not.toHaveProperty('color');
  // ...and it is not simply a different, colourless font: the two bars share one type rule.
  const native = makeStyles('dark').tabBarLabel as Record<string, unknown>;
  const web = makeStyles('dark').webTabBarLabel as Record<string, unknown>;
  expect(web.fontFamily).toBe(native.fontFamily);
  expect(web.fontSize).toBe(native.fontSize);
});

// react-navigation paints the bar from ITS theme when `tabBarStyle` says nothing, and nothing
// in this app installs a `ThemeProvider` — so the dark theme would get react-navigation's
// light default, a white bar under a dark list. The same class of defect as the `#272727`
// expo-router's own web CSS fell back to, arriving through a different door. Both schemes are
// checked, since one that read the scheme and ignored it would pass a single-scheme test.
it('paints the browser bar from the app theme rather than react-navigation defaults', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const theme = themeFor(scheme);
    const bar = makeStyles(scheme).webTabBar as Record<string, unknown>;
    expect(jsTabsAppearance(scheme).tabBarStyle).toBe(bar);
    expect(bar.backgroundColor).toBe(theme.bg);
    // `borderColor`, not `borderTopColor`, and the property NAME is the load-bearing part:
    // react-navigation sets the shorthand from its own theme, and react-native-web resolves
    // shorthand-against-longhand by generated-CSS order rather than by style-array order, so
    // the longhand lost and the browser drew the navigator's `rgb(216, 216, 216)` on both
    // schemes. Naming the same property is what lets the app's token win. theme/styles.ts
    // records the measurement; this is what fails if someone "tidies" it back.
    expect(bar.borderColor).toBe(theme.border);
  }
  expect(jsTabsAppearance('light').tabBarStyle).not.toBe(jsTabsAppearance('dark').tabBarStyle);
});

// Every screen in this app draws its own top and the root Stack already says so. A JS
// navigator defaults to showing one, so the browser would grow a title bar the device never
// had — a divergence in the opposite direction from the one this navigator exists to fix.
it('shows no navigator header in the browser, matching every screen the device draws', () => {
  expect(jsTabsAppearance('light').headerShown).toBe(false);
});

// The native bar's ground is UIKit's, and that is the entire reason `(tabs)/_layout.tsx` uses
// native tabs: naming a `backgroundColor` replaces iOS 26's Liquid Glass material with an
// opaque fill. This used to be a `src/platform/tabBarSurface` split whose web half returned a
// token — dead once the browser stopped rendering this navigator, and removed with it, so the
// guarantee is asserted here instead of resting on a deleted file's compile-time shape check.
it('names no ground for the native bar, so iOS keeps drawing its own material', () => {
  for (const scheme of ['light', 'dark'] as const) {
    expect(nativeTabsAppearance(scheme).backgroundColor).toBeUndefined();
  }
});

// Both layouts map over this same list in this same order, and §3 puts Dives first — it is
// also the group's `index` route, so it is the app's front door. `name` is a route FILE name
// (expo-router matches it against `src/app/(tabs)/`), never a label; `title` is the word a
// diver reads. Pinned because a swap here would silently reorder the bar on both platforms.
it('lists the tabs once, in §3\'s order, keyed by route file name', () => {
  expect(TAB_ROUTES.map((route) => route.name)).toEqual(['index', 'settings']);
  expect(TAB_ROUTES.map((route) => route.title)).toEqual(['Dives', 'Settings']);
});

// --- What each layout is handed, and why the glyph is resolved here rather than there ---
//
// The header of this file says a layout cannot be tested where it lives. That was tolerable
// while both layouts only mapped over data, and it was not tolerable for the one expression
// each still computed: `symbolName(route.symbol)` in the browser's, `nativeTabSymbol(route.
// symbol)` in the device's. Dropping either — `name={route.symbol}` — was **measured green
// across the entire suite**, and the browser consequence is total: expo-symbols' non-iOS
// `SymbolView` reads `name.web`, a raw `PlatformSymbol` has no `web` key, and the bar draws no
// glyphs at all. The one defect `components/symbolName.ts` exists to prevent, in the one file
// no test could reach.
//
// So the resolution moved into `tabs.ts` and both layouts became pure rendering. These tests
// own the *structure* of that move — every route resolved, in order, nothing raw left on it.
// Which Material name each glyph resolves TO is `components/symbolName.test.tsx`'s, along with
// every other per-platform name in the app; §4.1, one owner per rule, and this file asserting
// the names too would be the second copy that drifts.

it('hands each navigator every tab, in order, with the route name and title it renders', () => {
  // Derived from `TAB_ROUTES` rather than re-typed as `['index', 'settings']`: the order and
  // the titles are pinned against the source above, so a tab added there but dropped by
  // either resolver fails here instead of being invisible on one platform.
  expect(NATIVE_TAB_ITEMS.map((tab) => tab.name)).toEqual(TAB_ROUTES.map((route) => route.name));
  expect(JS_TAB_ITEMS.map((tab) => tab.name)).toEqual(TAB_ROUTES.map((route) => route.name));
  expect(NATIVE_TAB_ITEMS.map((tab) => tab.title)).toEqual(TAB_ROUTES.map((route) => route.title));
  expect(JS_TAB_ITEMS.map((tab) => tab.title)).toEqual(TAB_ROUTES.map((route) => route.title));
});

it('gives each navigator its icon under the keys that navigator actually reads', () => {
  // Two vocabularies for one glyph. The native bar asks `NativeTabs.Trigger.Icon` for
  // `sf`/`md`; the browser's `SymbolView` reads `ios`/`android`/`web`. Presence, not spelling
  // — a missing key is a blank bar on the platform that reads it, and `web` is the one that
  // was actually missing in this app once, in both icons, until symbolName.ts existed.
  for (const tab of NATIVE_TAB_ITEMS) {
    expect(Object.keys(tab.icon).sort()).toEqual(['md', 'sf']);
  }
  for (const tab of JS_TAB_ITEMS) {
    expect(Object.keys(tab.icon).sort()).toEqual(['android', 'ios', 'web']);
  }
});

// **The assertion that replaces a test neither layout can have.**
//
// `tsc --noEmit` covers `src/app/` even though Jest cannot reach it, so the way to protect an
// untestable file is to make the wrong edit fail to compile. Both layouts now map over these
// items and nothing else, and the items are built field by field rather than spread from
// `TAB_ROUTES` — so `tab.symbol` is not merely unused there, it does not exist, and a layout
// passing the unconverted value is a type error rather than a silently blank tab bar.
//
// That property is invisible in the layouts (it is the absence of an option) and it would
// survive a well-meaning `...route` spread in `tabs.ts` looking like a tidy-up, which is
// exactly how it would come back. Asserted at runtime, here, so the tidy-up is red.
it('hands the layouts no raw symbol to pass by mistake', () => {
  for (const tab of [...NATIVE_TAB_ITEMS, ...JS_TAB_ITEMS]) {
    expect(tab).not.toHaveProperty('symbol');
  }
  // And the list is not empty, or the loop above proves nothing at all.
  expect(NATIVE_TAB_ITEMS.length).toBe(TAB_ROUTES.length);
  expect(JS_TAB_ITEMS.length).toBe(TAB_ROUTES.length);
  expect(TAB_ROUTES.length).toBeGreaterThan(0);
});
