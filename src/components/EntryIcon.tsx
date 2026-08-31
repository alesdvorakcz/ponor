import { SymbolView } from 'expo-symbols';
import { type ColorValue } from 'react-native';

import { type Entry } from '../domain/types';
import { symbolName, type PlatformSymbol } from './symbolName';

/**
 * The symbol for one `Entry` value, or nothing at all — and **nothing at all is the normal
 * case**, which is the whole reason this module exists as its own owner rather than as a
 * lookup table inlined beside a chip.
 *
 * DESIGN.md §0.6: "**An icon appears only where the value has one.** *Shore* and *boat* do.
 * *Salt*, *fresh* and *brackish* do not, and neither do *wet*, *semidry* and *dry* or
 * *steel* and *alu* — drawn as icons those collapse into near-identical droplets and suits
 * separated by tally marks, which is a legend. §10's computed-value square is the
 * precedent: a symbol that needs a legend has already failed."
 *
 * So `entry` is the only one of the form's five fixed-choice fields with a map here, and
 * this file is named for that field rather than for options in general: adding a salinity
 * icon has to be a deliberate act against §0.6, not a matter of dropping one more line into
 * a table that already looks like it wants filling.
 *
 * **`other` is deliberately absent, not forgotten.** It is a real member of `Entry` with no
 * conventional symbol, and inventing one for it would be the legend §0.6 rules out — so the
 * record is `Partial`, and a value with no entry here simply draws no icon. That also makes
 * a member added to `Entry` later silently iconless, which is the safe default: an entry
 * method nobody has drawn a symbol for should show its label alone, not the nearest
 * available picture.
 *
 * The two symbols are Apple's own transport-mode vocabulary — the pair Maps uses for "on
 * foot" against "by vehicle" — because that is exactly the distinction `entry` records: you
 * either walked in or a boat took you. Both names were checked against the unions below
 * (`SFSymbol`, `AndroidSymbol`) rather than assumed to exist; the types are what enforce it
 * from here on, since a name neither platform has fails `tsc` instead of rendering an empty
 * box on a device.
 */
const ENTRY_SYMBOLS: Partial<Record<Entry, PlatformSymbol>> = {
  shore: { ios: 'figure.walk', android: 'directions_walk' },
  boat: { ios: 'ferry.fill', android: 'directions_boat_filled' },
};

export interface EntryIconProps {
  entry: Entry;
  /**
   * The ink the icon is drawn in — passed in rather than resolved here, because §0.6 makes
   * the icon a companion to the label beside it ("it **supplements the label rather than
   * replacing it** — never an icon alone"), and a companion that kept its own colour would
   * stay `fg` on an inverted chip's `action` ground and disappear. The caller hands over
   * whatever ink its own label is wearing, which is the only value that can be right in
   * both states.
   */
  tintColor: ColorValue;
  /** Matched to the label's own cap height at the one call site; a default so a future
   * caller cannot accidentally get expo-symbols' own 24. */
  size?: number;
}

/**
 * An `Entry` value's SF Symbol, or `null` for a value that has none.
 *
 * The mechanism is `SearchCapsule.tsx`'s, not a second one: `expo-symbols`' `SymbolView`
 * with `name` in its object form — built by `symbolName`, the one owner of what that object
 * must contain — so iOS resolves a real SF Symbol and Android and the browser resolve
 * Material Symbols' own equivalent. Read that component for why this is a real symbol view
 * rather than a drawn or imported approximation, `symbolName.ts` for the `web` key both call
 * sites used to omit, and `EntryIcon.test.tsx` (following `SearchCapsule.test.tsx`) for the
 * native module the assertion pins — a substituted image would never produce a
 * `SymbolModule`-named host node at all.
 *
 * No `accessibilityLabel` and no `fallback`. The chip around it already announces
 * `` `${label}: ${displayLabel(option)}` `` (DiveFormScreen.tsx's `OptionChips`), and an
 * icon that supplements a label it sits beside must not be announced a second time — a
 * screen reader would read "Entry: Shore, walking" for a control offering one thing.
 */
export function EntryIcon({ entry, tintColor, size = 15 }: EntryIconProps) {
  const symbol = ENTRY_SYMBOLS[entry];
  if (symbol === undefined) return null;
  return <SymbolView name={symbolName(symbol)} size={size} tintColor={tintColor} />;
}
