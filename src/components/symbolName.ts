import { type AndroidSymbol, type SFSymbol } from 'expo-symbols';

/**
 * One symbol, named in each platform's own vocabulary: an SF Symbol on iOS, a Material
 * Symbol everywhere else. Both halves are typed against `expo-symbols`' own unions, so a
 * name neither library actually has fails `tsc` rather than rendering an empty box on a
 * device — the guarantee `EntryIcon.tsx` and `SearchCapsule.tsx` already relied on.
 */
export interface PlatformSymbol {
  ios: SFSymbol;
  android: AndroidSymbol;
}

/**
 * **The one owner of what `SymbolView`'s `name` prop must contain.** Every call site goes
 * through here rather than building the object itself, so the answer is stated once rather
 * than agreed at each. (This sentence used to enumerate the call sites, which was true when
 * it was written and false by the time the weather glyphs, the action capsule and M1h's
 * condition marks had been added. A list of callers in the callee's own docblock is a second
 * copy of something the call graph already knows, and it goes stale the same way §4.1's
 * duplicated rules do. `symbolName.test.tsx` names the ones it actually renders, because
 * *that* list is a claim about coverage and has to be exact.)
 *
 * It exists because of a specific hole. `expo-symbols` ships two implementations:
 * `SymbolView.ios.tsx`, which reads `name.ios`, and `SymbolView.tsx`, used by **both Android
 * and web**, which reads
 *
 * ```ts
 * props.name[Platform.OS === 'android' ? 'android' : 'web']
 * ```
 *
 * and renders `props.fallback` — nothing, here — when that key is missing. The app passed
 * `{ ios, android }`, so in a browser `name` came out `undefined` and neither icon drew at
 * all. Confirmed in Chrome before this file was written, and confirmed again after.
 *
 * **`web` is derived from `android`, never written twice.** That is not a convenience: the
 * non-iOS `SymbolView` is one file serving both platforms, loading the same
 * `MaterialSymbols_400Regular` face and mapping the name through the same `symbols.json`
 * codepoint table either way. The browser's glyph *is* the Android glyph, so writing it out
 * separately would be §4.1's "one rule written in two places" with a guaranteed-identical
 * value on both sides — the kind that drifts silently because nothing ever forces the two to
 * be compared.
 *
 * **Nothing changes on iOS.** `SymbolView.ios.tsx` spreads the props it was given and then
 * overwrites `name` with `props.name.ios`, so the extra key never reaches the native view:
 * the host node's `name` is the same plain string it always was, which is what
 * `SearchCapsule.test.tsx` and `EntryIcon.test.tsx` assert against.
 *
 * **No `fallback`.** §0.6 makes the icon a companion to a label that is always present ("it
 * supplements the label rather than replacing it — never an icon alone"), so an absent
 * symbol degrades to the label, which is a valid state and not a broken one — that is
 * already how `EntryIcon` treats `other`. A `fallback` would also be spread straight into
 * the iOS native view's props, which is a React node arriving at a native view manager for
 * no gain.
 */
export function symbolName(symbol: PlatformSymbol): PlatformSymbol & { web: AndroidSymbol } {
  return { ...symbol, web: symbol.android };
}

/**
 * The same one symbol, under the keys **`expo-router`'s native tab bar** asks for: `sf` for
 * the SF Symbol and `md` for the Material one (`NativeTabs.Trigger.Icon`,
 * expo-router/unstable-native-tabs).
 *
 * It lives here rather than at the tab layout, because this file is §4.1's owner of "the
 * per-platform key an SF/Material symbol is requested by" and the native tab bar simply
 * spells those keys differently from `SymbolView`. Two names for the same two values is
 * exactly the shape that drifts, and the fix is one place that knows both — not one place
 * that knows `SymbolView`'s names and another that knows the tab bar's.
 *
 * **No `web` key, and its absence is a finding rather than an oversight.** expo-router's
 * web implementation of native tabs (`NativeTabsView.web.js`) renders each tab as a Radix
 * `TabsTrigger` containing a single `<span>` of the tab's title, and reads no icon field at
 * all: `props.tabs.map(tab => <TabItem title={tab.options.title ?? tab.name} …/>)`. There is
 * simply no web key for it to be asked under.
 *
 * That is also half of why the browser does not render native tabs any more: `(tabs)/
 * _layout.web.tsx` hands the same `TAB_ROUTES` to expo-router's JS `Tabs` instead, and gets
 * its glyphs through `symbolName` above and the ordinary `SymbolView` — which does read
 * `web`, and which the action capsule was already using there. So the browser has icons; it
 * just does not get them through this function.
 */
export function nativeTabSymbol(symbol: PlatformSymbol): { sf: SFSymbol; md: AndroidSymbol } {
  return { sf: symbol.ios, md: symbol.android };
}
