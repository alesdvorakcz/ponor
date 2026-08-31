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
 * **The one owner of what `SymbolView`'s `name` prop must contain.** Both call sites — the
 * search capsule's magnifier and the `entry` chips' walk/ferry pair — go through here, so
 * the answer is stated once rather than agreed twice.
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
