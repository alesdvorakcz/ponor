import { render } from '@testing-library/react-native';
import { SymbolView } from 'expo-symbols';

import { CurrentIcon, SurgeIcon } from './ConditionMarks';
import { EntryIcon } from './EntryIcon';
import { SearchCapsule } from './SearchCapsule';
import { symbolName } from './symbolName';

// The one thing `SearchCapsule.test.tsx` and `EntryIcon.test.tsx` structurally cannot see.
//
// Those two suites assert against the HOST node a real `SymbolView` renders down to, which is
// the right check for "this is a genuine SF Symbol and not a drawn approximation" — but
// `SymbolView.ios.tsx` overwrites `name` with `props.name.ios` before handing it to the native
// view, so by the time it reaches a host node the object the component actually passed is
// gone. A missing `web` key is therefore invisible from there, which is exactly how it stayed
// missing: every icon test was green while neither icon drew anything at all in a browser.
//
// So this file mocks `SymbolView` and reads the props the app HANDS the library. That is the
// boundary the defect lives on. It is a separate file rather than three more tests in the two
// existing suites because `jest.mock` is hoisted per module and applies to the whole file —
// mocking `expo-symbols` inside either of those would destroy the native-module resolution
// they exist to pin.
//
// It cannot, and does not pretend to, observe a browser: Jest's one platform here is iOS
// (jest-expo's stock preset), so `SymbolView.tsx` — the non-iOS implementation that reads
// `name.web` — never loads under this suite. What is asserted is the app's side of the
// contract, which is the half the app owns.
jest.mock('expo-symbols', () => ({ SymbolView: jest.fn(() => null) }));
const mockSymbolView = SymbolView as unknown as jest.Mock;

// isLiquidGlassAvailable caches its first answer module-wide (SearchCapsule.test.tsx's own
// note), and the capsule renders the same icon either way, so this suite pins the branch
// rather than leaving the shared cache to decide which one it got.
jest.mock('expo-glass-effect', () => ({
  ...jest.requireActual('expo-glass-effect'),
  isLiquidGlassAvailable: jest.fn(() => false),
}));

afterEach(() => mockSymbolView.mockClear());

/** The `name` object of the one `SymbolView` a render produced. */
function nameProp(): Record<string, string> | undefined {
  return mockSymbolView.mock.calls[0]?.[0]?.name;
}

// The rule symbolName.ts exists to state: expo-symbols' non-iOS SymbolView serves Android and
// web from one file, one Material Symbols face and one codepoint table, so the browser's glyph
// IS the Android glyph. Asserted as equality with whatever `android` was handed in, not
// against a literal, so this keeps holding for symbols nobody has added yet.
it('derives the browser’s symbol from the Android one, and leaves both other keys alone', () => {
  expect(symbolName({ ios: 'ferry.fill', android: 'directions_boat_filled' })).toEqual({
    ios: 'ferry.fill',
    android: 'directions_boat_filled',
    web: 'directions_boat_filled',
  });
});

// Call sites, not only the owner, because the owner being correct buys nothing if a component
// still builds the object itself — which is the state this repo was in, twice over, before
// symbolName.ts. DESIGN.md §4.1: "a second implementation is a defect, not a style preference."
//
// **This file reaches some call sites and not others, and the list is worth knowing rather
// than assuming.** Pinned below: the search capsule's magnifier, the two `entry` chips, and
// the two condition marks. Not pinned anywhere in the suite: `WeatherIcon`'s six sky glyphs,
// `DivesScreen`'s search and log-dive glyphs and `SearchScreen`'s close glyph (all three
// reaching the library through `ActionCapsule`), and `navigation/tabs.ts`' two tab glyphs. For
// every one of those, a wrong or swapped `android` name is green here and green on a
// simulator, for the reason the next block spells out — the same hole the marks below were in
// until this commit. Closing them is a separate pass and not one this file should be read as
// having done.
it('gives the search capsule’s magnifier a web name, not just an iOS and an Android one', async () => {
  await render(<SearchCapsule scheme="dark" value="" onChangeText={() => {}} />);
  const name = nameProp();
  expect(name?.web).toBe('search');
  expect(name?.web).toBe(name?.android);
});

it.each([
  ['shore', 'directions_walk'],
  ['boat', 'directions_boat_filled'],
] as const)('gives the %s chip’s icon a web name, not just an iOS and an Android one', async (entry, material) => {
  await render(<EntryIcon entry={entry} tintColor="#000000" />);
  const name = nameProp();
  expect(name?.web).toBe(material);
  expect(name?.web).toBe(name?.android);
});

// --- The two condition marks M1h added, on the same boundary and after the same defect ---
//
// `ConditionMarks.test.tsx` pins a great deal about these two — one symbol per level, no mark
// at all at level 0, the same glyph repeated rather than three different ones, a real SF
// Symbol rather than a drawn approximation, and the current's arrow differing from the surge's
// — and `DiveFormScreen.test.tsx`'s `REPEATED_MARK_SYMBOLS` witness pins which mark each chip
// row is wired to. **None of that can see `android`.** Both files render through the real
// `SymbolView.ios.tsx`, which overwrites `name` with `props.name.ios` before the value reaches
// a host node, so every assertion in either file reads one string: the SF name. The object the
// component actually handed over is gone by then.
//
// Measured rather than assumed: swapping the two marks' `android` values in
// `ConditionMarks.tsx` while leaving both `ios` names correct left the entire suite green at
// **1575/1575** — the whole of it, as it stood the moment before these two assertions were
// added. (With them, that same swap is **2 failed / 1577**, and one merely wrong Material name
// is **1 failed / 1577**.) The swap is not a curiosity — it is an Android and browser diver reading
// two arrows going opposite ways on the *Current* row and one arrow going right on *Surge*,
// which is exactly the "which row am I on" confusion the differing glyph exists to prevent
// (`ConditionMarks.tsx`'s header). A plain wrong Material name is just as invisible, and it
// degrades to no glyph at all in a browser, which is the defect that made this file exist.
// Neither shows up in a simulator run either, because the simulator is iOS.
//
// So they are pinned here, where the props the app HANDS the library are readable, in the same
// shape as the capsule and the chips above. Level 1 draws exactly one symbol, which is the one
// `nameProp()` reads. Both keys are asserted against their literal name rather than only
// against each other: `web` derived from `android` is already the rule test at the top of this
// file, and equality alone would pass two identically-wrong names — including the swap.
it.each([
  ['current', CurrentIcon, 'arrow_forward'],
  ['surge', SurgeIcon, 'sync_alt'],
] as const)('gives the %s mark an Android and a web name, not just an iOS one', async (_row, Mark, material) => {
  await render(<Mark level={1} tintColor="#000000" scheme="dark" />);
  const name = nameProp();
  expect(name?.android).toBe(material);
  expect(name?.web).toBe(material);
});

// §0.6: "*other* does not [have a symbol]" — and the fix for the web gap must not have
// quietly turned "no icon" into "an icon with an empty name", which on the browser's
// SymbolView would render its (absent) fallback and on iOS a blank box.
it('still renders no symbol at all for an entry that has none', async () => {
  await render(<EntryIcon entry="other" tintColor="#000000" />);
  expect(mockSymbolView).not.toHaveBeenCalled();
});
