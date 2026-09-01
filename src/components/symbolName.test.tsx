import { render } from '@testing-library/react-native';
import { SymbolView } from 'expo-symbols';

import { WEATHER_VALUES, type Weather } from '../domain/types';
import { JS_TAB_ITEMS, NATIVE_TAB_ITEMS } from '../navigation/tabs';
import { LOG_DIVE_GLYPH, SEARCH_GLYPH } from '../screens/DivesScreen';
import { CLOSE_SEARCH_GLYPH } from '../screens/SearchScreen';
import { ActionCapsule } from './ActionCapsule';
import { CurrentIcon, SurgeIcon } from './ConditionMarks';
import { EntryIcon } from './EntryIcon';
import { SearchCapsule } from './SearchCapsule';
import { symbolName } from './symbolName';
import { WeatherIcon } from './WeatherIcon';

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
// **Every `PlatformSymbol` the app ships is pinned below, and that completeness is the point
// rather than a nicety.** The hole this file exists to close is invisible by construction —
// the test environment is iOS, `SymbolView.ios.tsx` discards every key but `ios`, and the
// simulator is iOS too — so "which call sites are checked" cannot be inferred from anything;
// it can only be listed. Sixteen symbols in six places: the search capsule's magnifier, the
// two `entry` chips, the two condition marks, `WeatherIcon`'s six skies, the three capsule
// glyphs `DivesScreen` and `SearchScreen` hand to `ActionCapsule`, and `navigation/tabs.ts`'
// two. Five of the sixteen had a witness before this pass; the other eleven were green under
// any wrong or swapped Material name.
//
// If you add a symbol, add it here. Two of the blocks below make that failure loud rather
// than trusting this sentence — the weather table is a total `Record<Weather, …>`, so a
// seventh sky fails `tsc` until it is named, and the tab-route block iterates `TAB_ROUTES`
// itself. The rest cannot be derived and are listed by hand.
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

// --- The six skies ---
//
// The worst of the eleven that had no witness, and the reason is that a weather glyph is the
// only symbol in the app whose wrongness is *readable as a fact about the dive*. A swapped
// arrow on a condition chip is confusing; `rainy` drawing `foggy` tells an Android or browser
// diver that a dive they logged in rain was logged in fog, next to a label that still says
// *Rainy*, and the chip's own word is the only thing that contradicts it. Six names in one
// record is also where a copy-paste slip is most likely to survive review — `sunny`/`cloudy`
// and `rainy`/`foggy` are adjacent lines with plausible-looking values either way round.
//
// A **total** `Record<Weather, …>`, deliberately, and the same argument `WEATHER_SYMBOLS`
// itself makes: `WEATHER_VALUES` is the vocabulary owner (§4.1), a seventh sky would be a
// `tsc` failure here until someone writes its Material name, and iterating the vocabulary
// rather than this table's own keys is what stops the test from agreeing with itself. A
// `Partial` would let a new sky arrive untested and silent, which is the shape of the gap this
// whole file exists to close.
const WEATHER_MATERIAL: Record<Weather, string> = {
  sunny: 'sunny',
  cloudy: 'partly_cloudy_day',
  overcast: 'cloud',
  rainy: 'rainy',
  windy: 'air',
  foggy: 'foggy',
};

it.each(WEATHER_VALUES)('gives the %s sky an Android and a web name, not just an iOS one', async (weather) => {
  await render(<WeatherIcon weather={weather} tintColor="#000000" />);
  const name = nameProp();
  expect(name?.android).toBe(WEATHER_MATERIAL[weather]);
  expect(name?.web).toBe(WEATHER_MATERIAL[weather]);
});

// --- The three capsule glyphs ---
//
// These live in the two screens rather than in `ActionCapsule` — the component owns the
// capsule's shape and material, its caller owns which glyphs go in it, which is what lets one
// capsule serve two screens (`ActionCapsule.tsx`'s header). So the literals are the screens'
// and they are exported for this, with each screen's own note saying why.
//
// Rendered through `ActionCapsule` rather than by calling `symbolName` on the constant, so
// what is pinned is the value that actually reaches the library: a screen that stopped passing
// its `symbol` through the capsule, or a capsule that stopped calling `symbolName`, is the
// defect, and asserting on the constant alone would sail past both. One action per render,
// because `nameProp()` reads the first `SymbolView` call.
//
// `isLiquidGlassAvailable` is mocked false at the top of this file, so the capsule takes its
// plain `View` branch; the glyphs are identical either way (`ActionCapsule.test.tsx` is what
// pins that, shape for shape) and this suite has no opinion about the material.
it.each([
  ['dive list’s magnifier', SEARCH_GLYPH, 'search'],
  ['dive list’s plus', LOG_DIVE_GLYPH, 'add'],
  ['search screen’s close', CLOSE_SEARCH_GLYPH, 'close'],
] as const)('gives the %s an Android and a web name, not just an iOS one', async (label, symbol, material) => {
  await render(
    <ActionCapsule scheme="dark" actions={[{ key: 'only', symbol, label, onPress: () => {} }]} />,
  );
  const name = nameProp();
  expect(name?.android).toBe(material);
  expect(name?.web).toBe(material);
});

// --- The two tab glyphs, which are the one call site with no render to observe ---
//
// The tabs' symbols reach the library in two different shapes on two different platforms:
// `{sf, md}` for `NativeTabs.Trigger.Icon` in `(tabs)/_layout.tsx`, and `{ios, android, web}`
// for an ordinary `SymbolView` in `(tabs)/_layout.web.tsx` — the browser gets the JS tab bar,
// so the `md`/`web` split is not academic here, it is the only bar a browser draws.
//
// **Asserted against the data rather than against a render, and that is forced rather than
// chosen.** expo-router sweeps `src/app/` as the route tree, so a test file there would ship
// to a diver's phone; nothing under it can be mounted. This is the same shape as this file's
// very first test, which calls `symbolName` directly on a literal.
//
// **What that used to leave uncovered, and what changed.** While the two layouts called the
// converters themselves, dropping the call — `name={route.symbol}` — was green across the
// whole suite at **1588/1588**: measured, and the exact defect `symbolName.ts` was written
// for, since the browser's `SymbolView` reads `name.web`, finds nothing on a raw
// `PlatformSymbol`, and draws no glyph. The conversion now happens in `navigation/tabs.ts`,
// inside the tested tree, and the items it hands each layout carry **no raw symbol at all**,
// so that edit is a `tsc` error rather than a silent blank bar. `tabs.test.ts` owns that
// structural property — every route resolved, in order, with nothing raw left on it.
//
// What is read here is `NATIVE_TAB_ITEMS`/`JS_TAB_ITEMS` themselves rather than the
// converters applied to `TAB_ROUTES`, because those two lists are literally what the layouts
// map over: a resolution that dropped a route, or resolved it with the wrong glyph, is caught
// here, where re-deriving the answer from the source would only have proved the converters
// still work.
it.each([
  ['index', 'waves'],
  ['settings', 'settings'],
] as const)('gives the %s tab an Android and a web name, not just an iOS one', (name, material) => {
  const native = NATIVE_TAB_ITEMS.find((tab) => tab.name === name);
  const js = JS_TAB_ITEMS.find((tab) => tab.name === name);
  // The routes existing is part of the assertion: `.find` on a name nobody ships returns
  // `undefined`, and every expectation below would then be checking `undefined?.android`
  // against itself. A renamed or dropped tab must fail here rather than pass vacuously.
  expect(native).toBeDefined();
  expect(js).toBeDefined();
  expect(js?.icon.android).toBe(material);
  expect(js?.icon.web).toBe(material);
  expect(native?.icon.md).toBe(material);
});

// §0.6: "*other* does not [have a symbol]" — and the fix for the web gap must not have
// quietly turned "no icon" into "an icon with an empty name", which on the browser's
// SymbolView would render its (absent) fallback and on iOS a blank box.
it('still renders no symbol at all for an entry that has none', async () => {
  await render(<EntryIcon entry="other" tintColor="#000000" />);
  expect(mockSymbolView).not.toHaveBeenCalled();
});
